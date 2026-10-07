/**
 * The line: stations 1-8 driven by the station machine. Each turn of the loop
 * asks `nextStep` what to do from committed state alone, does it, and commits
 * what happened, so a run resumed from any committed state takes the same next
 * step a run that never stopped would have taken.
 *
 * What each station does here:
 * - `intake` and `integrate`: nothing of their own at M1; their exit gates are
 *   the station. `integrate`'s merge is I1's.
 * - `spec`, `test-design`, `plan`: lock the artifacts the run was admitted
 *   with, and refuse a lock whose hash differs from the admission hash (I3).
 *   `plan` also enters the graph's tasks into run state.
 * - `build`: runs each task through the driver over a fresh copy of the base
 *   and the diff accepted so far, never over the author's working copy, and
 *   records the result in the Vault before anything reads it (D-P6-02).
 * - `verify`: collects the task's own diff, refuses one that touches a locked
 *   artifact or leaves the task's grant, builds a tree from base and the
 *   cumulative diff, and runs every check over it in a fresh sandbox, read-only
 *   and with no egress. The verdict follows the check results alone (I2); the
 *   claim is diffed against the evidence and never decides anything. The
 *   tree the task was handed and the tree the checks ran over are read for
 *   tamper; each finding is recorded, carried in the bundle, and escalates
 *   `integrate`'s exit, and none decides the task's status.
 * - `review`: seats a reviewer against the authors' recorded model families
 *   (I6) and runs it on context its contract grants, over a view holding only
 *   the files those grants cover.
 *
 * Every driver call — each build attempt, a failed one included, and each
 * review seat — writes one `UsageRecord` from what the sandbox's relay counted,
 * read by `destroy` after the sandbox stopped (D-P13-08). What the driver says
 * it used is recorded in its result and is never the source of a cost.
 *
 * Locks are re-verified before every task step, after the checks, and on every
 * exit once anything is locked. A mismatch records a violation, and a run with
 * a recorded violation does not continue (I3).
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  capabilityRefusal,
  escalationAt,
  grantedContext,
  locksHeldLeaving,
  M1_STATIONS,
  maxStarts,
  nextStep,
  parkRefusal,
  seatReviewer,
  STATION_CONTRACTS,
  StrictPolicyEngine,
  tierFor,
  transition,
} from '@olympus-ai/core';
import type {
  AgentClaim,
  RunCancellation,
  ApprovalGrant,
  ApprovalKey,
  ContextGrant,
  Driver,
  FailedCheck,
  ModelIdentity,
  Policy,
  RoleId,
  Run,
  RunId,
  RunState,
  StationId,
  StationRefusal,
  TamperedPath,
  Task,
  TaskAttempts,
  TaskGraph,
  TaskId,
  TaskRequest,
  TaskResult,
  TaskStatus,
  VaultRef,
} from '@olympus-ai/core';
import type { CheckResult, CheckSpec, IntegrityViolation, TamperReport } from '@olympus-ai/integrity';
import { readUsage } from './cost.js';
import { recordDecision, recordEgress, stationDecider } from './decisions.js';
import { requiredShortfall } from './gate.js';
import type { EgressPolicy, RelayMeter, SandboxHandle, SandboxSpec, Teardown } from '@olympus-ai/sandbox';
import type { AdmissionRecord, AdmittedArtifact, DiffEntry, EvidenceBundle, IntegrationOpened, IntegrationRecord, UnstartedCheck, UsageReading, UsageRecord, Vault } from '@olympus-ai/vault';
import type { BuiltGraph } from './graph.js';
import type { RunOutcome } from './run.js';
import { acceptedEscalations, analyzeTamper, tamperFindings } from './tamper.js';
import { claimEvidenceDiff, countSuites, suiteCountFor, taskResultProblems, writesOutsideGrant } from './verification.js';
import {
  attemptPaths,
  basePath,
  composeDiff,
  copyOnly,
  copyTree,
  diffDigest,
  hashAt,
  materialize,
  ownDiff,
  reviewPath,
  treePath,
} from './workspace.js';

export interface LineContext {
  readonly run: Run;
  readonly policy: Policy;
  readonly artifacts: AdmissionRecord['artifacts'];
  readonly graph: TaskGraph;
  readonly checks: readonly CheckSpec[];
  readonly components: BuiltGraph;
  /** The digest of the base the runtime snapshotted at admission. */
  readonly baseTreeSha256: string;
  /** Replaced by every commit. */
  state: RunState;
  /**
   * Asked between steps, never during one: a cancellation it returns is
   * committed by the line itself, so no step in flight loses a commit to a
   * version race, and the usage record of a call already made is kept (D-P9-04).
   */
  readonly cancelRequested?: () => RunCancellation | null;
  /** Told of every state the line commits, after the Vault stored it. Serves the event stream; it cannot change what is committed. */
  readonly onCommit?: (state: RunState) => void;
}

const engine = new StrictPolicyEngine();

const NO_ESCALATIONS = { protectedPathsTouched: [], tamperFindings: [] } as const;

/**
 * A violation needs a role. Before any task has run at M1 no agent has touched
 * the workspace, so a mismatch there cannot be attributed to one; the record
 * says so rather than naming a role that did not act.
 */
const UNATTRIBUTED = 'unattributed' as RoleId;

/**
 * Drives the run until it completes or is refused. `changed` carries admitted
 * artifacts found altered before the line started, on resume; they are a
 * tamper like any other.
 */
export async function runLine(ctx: LineContext, changed: readonly TamperedPath[] = []): Promise<RunOutcome> {
  if (changed.length > 0) {
    return refused(ctx, ctx.state.station, await recordTamper(ctx, ctx.state.station, null, [...changed], { phase: 'resume' }), null);
  }
  for (;;) {
    const cancel = ctx.state.cancelled === null ? (ctx.cancelRequested?.() ?? null) : null;
    if (cancel !== null) await commit(ctx, { cancelled: cancel });
    const step = nextStep(ctx.state, ctx.graph);
    let refusal: StationRefusal | undefined;
    // The task a refusal was made over, for its record; null for one made over the station.
    let task: TaskId | null = null;
    switch (step.kind) {
      case 'refuse':
        return refused(ctx, ctx.state.station, step.refusal, null);
      case 'work':
        refusal = await work(ctx, step.station);
        break;
      case 'build':
        task = step.task.id;
        refusal = await build(ctx, step.task);
        break;
      case 'verify':
        task = step.task.id;
        refusal = await verify(ctx, step.task);
        break;
      case 'review':
        task = step.task.id;
        refusal = await review(ctx, step.task);
        break;
      case 'finish':
        await commit(ctx, { phase: 'exiting' });
        break;
      case 'exit': {
        const tampered = locksHeldLeaving(step.from) ? await tamperedPaths(ctx) : [];
        // Tamper findings escalate the gate `protectedPathPolicy` names, and only that one.
        const escalations = step.from === 'integrate' ? await integrateEscalations(ctx.components.vault, ctx.state, (ref) => readBundle(ctx, ref)) : NO_ESCALATIONS;
        const next = transition({
          from: step.from,
          to: step.to,
          level: ctx.run.requestedLevel,
          policy: ctx.policy,
          tampered,
          grants: ctx.state.approvals,
          protectedPathsTouched: escalations.protectedPathsTouched,
          tamperFindings: escalations.tamperFindings,
        });
        if (!next.ok) {
          refusal = next.reason === 'lock-tamper'
            ? await recordTamper(ctx, step.from, null, next.tampered, { phase: 'exit' })
            : next;
          break;
        }
        // One human approval crosses one exit: the grant is spent in the same
        // commit as the move, so a stop between the two leaves it unspent and
        // the gate is evaluated again (A-P4-04).
        const approvals = spend(ctx.state.approvals, next.spends);
        // The run has passed its last M1 exit gate; `observe` is never entered at M1.
        if (!M1_STATIONS.includes(next.next)) {
          // Merged before the grant is spent: a stop between the two leaves the grant unspent, and the
          // resume finds the pull request merged at the same commit and records the same act (D-I1b-01).
          if (step.from === 'integrate') await mergeAccepted(ctx);
          if (next.spends !== null) await commit(ctx, { approvals });
          return { ok: true, state: ctx.state };
        }
        await commit(ctx, { station: next.next, phase: 'working', approvals });
        break;
      }
    }
    if (refusal !== undefined) return refused(ctx, ctx.state.station, refusal, task);
  }
}

/**
 * A refusal leaves the line only once it is recorded, naming the station
 * machine or the line as the decider (D-P14-07, D-P14-09). A park is recorded
 * over the task it parked, however the refusal reached here.
 */
async function refused(ctx: LineContext, at: StationId, transition: StationRefusal, task: TaskId | null): Promise<RunOutcome> {
  // A park this drive made was recorded by `park`, before it was committed; a park found on resume is recorded again here (D-P14-07).
  if (transition.reason === 'parked' && parksRecorded(ctx).has(transition.task)) return { ok: false, reason: 'refused', at, transition, state: ctx.state };
  await recordDecision(
    { vault: ctx.components.vault, runId: ctx.run.id, taskId: transition.reason === 'parked' ? transition.task : task, station: at },
    { cause: 'station-refused', decidedBy: stationDecider(transition), refusal: transition },
  );
  return { ok: false, reason: 'refused', at, transition, state: ctx.state };
}

/** The parks each drive recorded itself, so the refusal it stops on is not recorded twice. */
const PARKS_RECORDED = new WeakMap<LineContext, Set<TaskId>>();

function parksRecorded(ctx: LineContext): Set<TaskId> {
  let parks = PARKS_RECORDED.get(ctx);
  if (parks === undefined) {
    parks = new Set();
    PARKS_RECORDED.set(ctx, parks);
  }
  return parks;
}

/**
 * Parks a task. The park is a decision, so it is recorded before the parked
 * status is committed: committed state never holds a park its record lacks,
 * and a stop between the two leaves a record of a park that did not take
 * effect, never the reverse (D-P14-07; external review of P14, codex-2).
 */
async function park(ctx: LineContext, task: Task, change: StateChange): Promise<StationRefusal> {
  const refusal = parkRefusal({ ...ctx.state, attempts: change.attempts ?? ctx.state.attempts }, task);
  await recordDecision(
    { vault: ctx.components.vault, runId: ctx.run.id, taskId: task.id, station: ctx.state.station },
    { cause: 'station-refused', decidedBy: stationDecider(refusal), refusal },
  );
  parksRecorded(ctx).add(task.id);
  await commit(ctx, { ...change, tasks: { ...ctx.state.tasks, [task.id]: 'parked' } });
  return refusal;
}

/** Every violation the line finds is written through the Vault and then recorded as its decision, pointing at it (D-P14-08). */
async function recordViolation(ctx: LineContext, violation: IntegrityViolation): Promise<VaultRef> {
  const ref = await ctx.components.vault.recordViolation(violation);
  await recordDecision(
    { vault: ctx.components.vault, runId: ctx.run.id, taskId: violation.taskId, station: ctx.state.station },
    { cause: 'violation-recorded', decidedBy: 'line', violation: ref },
  );
  return ref;
}

/** Marks the first unspent grant for `key` used. A spent grant stays in run state: it is the record that a human approved. */
function spend(grants: readonly ApprovalGrant[], key: ApprovalKey | null): readonly ApprovalGrant[] {
  if (key === null) return grants;
  const at = grants.findIndex((grant) => grant.key === key && grant.usedAt === null);
  if (at === -1) return grants;
  const usedAt = new Date().toISOString();
  return grants.map((grant, i) => (i === at ? { ...grant, usedAt } : grant));
}

/** The runtime's own stations: lock what was admitted for them, then the station is exiting. */
async function work(ctx: LineContext, station: StationId): Promise<StationRefusal | undefined> {
  switch (station) {
    case 'spec': {
      const refusal = await lockAdmitted(ctx, 'spec', ctx.artifacts.spec);
      if (refusal !== undefined) return refusal;
      break;
    }
    case 'test-design': {
      const refusal = await lockAdmitted(ctx, 'test-design', [...ctx.artifacts.acceptanceTests, ctx.artifacts.verificationManifest]);
      if (refusal !== undefined) return refusal;
      break;
    }
    case 'plan': {
      const refusal = await lockAdmitted(ctx, 'plan', [ctx.artifacts.taskGraph]);
      if (refusal !== undefined) return refusal;
      const tasks: Record<TaskId, TaskStatus> = {};
      const attempts: Record<TaskId, TaskAttempts> = {};
      for (const task of ctx.graph.tasks) {
        tasks[task.id] = 'pending';
        attempts[task.id] = { iterations: 0, retries: 0, starts: 0 };
      }
      await commit(ctx, { phase: 'exiting', tasks, attempts });
      return undefined;
    }
    case 'intake':
      break;
    case 'integrate':
      await openAccepted(ctx);
      break;
    case 'build':
    case 'verify':
    case 'review':
    case 'observe':
    case 'learn':
      throw new Error(`line: ${station} is not a station the runtime works alone`);
  }
  await commit(ctx, { phase: 'exiting' });
  return undefined;
}

/**
 * Locks a station's admitted artifacts and holds the lock to admission: an
 * artifact whose bytes changed between admission and this lock is locked as it
 * now is, which the manifest alone would then call intact, so the difference
 * is caught here and recorded as the tamper it is (A-P4-03).
 */
async function lockAdmitted(ctx: LineContext, station: StationId, admitted: readonly AdmittedArtifact[]): Promise<StationRefusal | undefined> {
  const manifest = await ctx.components.vault.lock(ctx.run.id, admitted.map((a) => a.path), station);
  const tampered: TamperedPath[] = [];
  for (const artifact of admitted) {
    const entry = manifest.entries.find((e) => e.path === artifact.path);
    const actual = entry?.sha256 ?? 'missing';
    if (actual !== artifact.sha256) tampered.push({ path: artifact.path, expected: artifact.sha256, actual });
  }
  if (tampered.length === 0) return undefined;
  return recordTamper(ctx, station, null, tampered, { phase: 'lock' });
}

async function tamperedPaths(ctx: LineContext): Promise<TamperedPath[]> {
  const verdict = await ctx.components.vault.verifyLocks(ctx.run.id);
  return verdict.ok ? [] : verdict.tampered.map((t) => ({ ...t }));
}

/** The role a violation is attributed to: the suspect, else the last task that ran, else none. */
function suspectRole(ctx: LineContext, suspect: Task | null): RoleId {
  if (suspect !== null) return suspect.role;
  const ran = ctx.graph.tasks.filter((t) => Object.hasOwn(ctx.state.results, t.id));
  return ran.at(-1)?.role ?? UNATTRIBUTED;
}

/** The driver a station runs its tasks through. It is what found a mismatch there, and its provenance is the detector's. */
function driverAt(ctx: LineContext, station: StationId): Driver {
  return station === 'review' ? ctx.components.reviewer : ctx.components.driver;
}

/**
 * I3: a mismatch is a recorded violation and a refusal, never a warning. The
 * task in flight, if any, is failed with it. `extra` goes into the violation's
 * detail beside the tampered list, so a violation read back alone says when
 * it was found.
 *
 * `suspect` is the task whose role the mismatch is attributed to, and it is not
 * always the task being failed: a mismatch found *before* a task runs was not
 * that task's doing, and passing null there falls back to the last task that
 * actually ran, or to `unattributed` (D-P4-08). The provenance recorded is the
 * detector's — the driver of the station the mismatch was found at — not
 * always the build driver's (A-P4-05).
 */
async function recordTamper(
  ctx: LineContext, station: StationId, task: Task | null, tampered: TamperedPath[], extra: Record<string, unknown>,
  suspect: Task | null = task,
): Promise<StationRefusal> {
  const detector = driverAt(ctx, station);
  const violation: IntegrityViolation = {
    runId: ctx.run.id,
    taskId: task?.id ?? null,
    kind: 'lock-tamper',
    role: suspectRole(ctx, suspect),
    driverProvenanceId: detector.provenanceId(),
    contractVersion: detector.contractVersion,
    detectedAt: new Date().toISOString(),
    detail: { station, ...extra, tampered },
  };
  const ref = await recordViolation(ctx, violation);
  await commit(ctx, {
    violation: ref,
    ...(task === null ? {} : { tasks: { ...ctx.state.tasks, [task.id]: 'failed' } }),
  });
  const paths = tampered.map((t) => `${t.path} (expected ${t.expected}, actual ${t.actual})`).join(', ');
  return { ok: false, reason: 'lock-tamper', tampered, message: `a locked artifact changed at ${station}: ${paths}` };
}

const EMPTY_ATTEMPTS: TaskAttempts = { iterations: 0, retries: 0, starts: 0 };

function attemptsOf(state: RunState, task: Task): TaskAttempts {
  return Object.hasOwn(state.attempts, task.id) ? (state.attempts[task.id] ?? EMPTY_ATTEMPTS) : EMPTY_ATTEMPTS;
}

function statusOf(state: RunState, task: Task): TaskStatus {
  return Object.hasOwn(state.tasks, task.id) ? (state.tasks[task.id] ?? 'pending') : 'pending';
}

/**
 * Starts an attempt at a task, counted and committed before the driver is
 * called. A task already `running` was in flight when the run stopped: the
 * attempt is run again, so it costs no iteration — but it is another
 * invocation, and `starts` counts it. Past the station's invocation bound the
 * task parks rather than being replayed into the same attempt forever
 * (A-P4-06).
 */
async function startAttempt(ctx: LineContext, task: Task): Promise<StationRefusal | undefined> {
  const contract = STATION_CONTRACTS[ctx.state.station];
  const spent = attemptsOf(ctx.state, task);
  const replay = statusOf(ctx.state, task) === 'running';
  const attempt: TaskAttempts = replay
    ? { ...spent, starts: spent.starts + 1 }
    : { iterations: spent.iterations + 1, retries: 0, starts: spent.starts + 1 };
  if (attempt.starts > maxStarts(contract)) {
    return park(ctx, task, { attempts: { ...ctx.state.attempts, [task.id]: spent } });
  }
  // An escalation is a decision, recorded before the attempt that carries it is committed, as a park
  // is: a stop between the two leaves a record of an escalation that did not take effect, and the
  // resume decides it again from the same counts (A-R14-02, D-P14-07). A replay is the same iteration.
  const escalation = replay ? null : escalationAt(scopeFor(ctx, task), ctx.state.station, attempt);
  if (escalation !== null) {
    await recordDecision(
      { vault: ctx.components.vault, runId: ctx.run.id, taskId: task.id, station: ctx.state.station },
      { cause: 'tier-escalated', decidedBy: 'line', ...escalation },
    );
  }
  await commit(ctx, {
    tasks: { ...ctx.state.tasks, [task.id]: 'running' },
    attempts: { ...ctx.state.attempts, [task.id]: attempt },
  });
  return undefined;
}

/**
 * A driver or sandbox failure: one retry spent, committed before the next
 * attempt. Past the station's `retry.max` the task parks and the run stops.
 */
async function spendRetry(ctx: LineContext, task: Task): Promise<StationRefusal | undefined> {
  const contract = STATION_CONTRACTS[ctx.state.station];
  const spent = attemptsOf(ctx.state, task);
  const attempts = { ...ctx.state.attempts, [task.id]: { ...spent, retries: spent.retries + 1 } };
  if (spent.retries + 1 > contract.retry.max) {
    return park(ctx, task, { attempts });
  }
  await commit(ctx, { attempts });
  await new Promise((done) => setTimeout(done, contract.retry.backoffMs));
  return undefined;
}

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

interface ReadArtifacts {
  readonly text: string;
  /** Artifacts whose bytes, as read, do not hash to what was admitted. */
  readonly tampered: TamperedPath[];
}

/**
 * Reads admitted artifacts for a model's context and hashes the bytes it read,
 * not the path it read them from. `verifyLocks` is a point-in-time check of a
 * mutable path, so a swap between that check and this read would otherwise
 * reach the model with every lock comparison still intact; what is hashed here
 * is exactly what is handed over (A-P4-05).
 */
async function readText(ctx: LineContext, artifacts: readonly AdmittedArtifact[]): Promise<ReadArtifacts> {
  const texts: string[] = [];
  const tampered: TamperedPath[] = [];
  for (const artifact of artifacts) {
    let bytes: Uint8Array;
    try {
      bytes = await readFile(resolve(ctx.run.repo, artifact.path));
    } catch {
      tampered.push({ path: artifact.path, expected: artifact.sha256, actual: 'missing' });
      continue;
    }
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== artifact.sha256) tampered.push({ path: artifact.path, expected: artifact.sha256, actual });
    texts.push(decode(bytes));
  }
  return { text: texts.join('\n'), tampered };
}

/** A recorded TaskResult, read back and checked for the fields a later station reads. */
async function readResult(ctx: LineContext, task: Task): Promise<TaskResult> {
  const ref = Object.hasOwn(ctx.state.results, task.id) ? ctx.state.results[task.id] : undefined;
  if (ref === undefined) throw new Error(`line: task ${task.id} has no recorded result; the line ran out of order`);
  const parsed: unknown = JSON.parse(decode(await ctx.components.vault.read(ref)));
  const r = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Partial<TaskResult>;
  const claim = r.claim as Partial<AgentClaim> | undefined;
  const model = r.model as Partial<ModelIdentity> | undefined;
  const ok = r.taskId === task.id && typeof claim?.narrative === 'string' && Array.isArray(claim.filesChanged) && typeof model?.family === 'string';
  if (!ok) throw new Error(`line: the recorded result for task ${task.id} does not hold a claim and a model identity`);
  return r as TaskResult;
}

/** A grant of no hosts is no egress: `[]` is `deny-all`, never an empty allowlist the provider would refuse (D-P9-05). */
export function egressFor(network: { egress: 'none' | string[] }): EgressPolicy {
  if (network.egress === 'none' || network.egress.length === 0) return { mode: 'deny-all', allow: [] };
  return { mode: 'allowlist', allow: [...network.egress] };
}

/**
 * One runtime-owned tree and nothing else: rw where a task works, ro where
 * checks run or a reviewer reads, so the checks get a tree they cannot modify
 * (I3). The container runs as the user the store made the tree writable by.
 */
/**
 * A sandbox over one tree and nothing else: no other mount, so the Vault is
 * mounted nowhere (I1). The image and limits are the host's profile
 * (D-I1a-01); a graph built with none — the stub sandbox's — names no image,
 * and a provider that runs images refuses it.
 */
function workspaceOnly(ctx: LineContext, source: string, mode: 'rw' | 'ro', egress: EgressPolicy, image: 'build' | 'check', wallClockMs: number): SandboxSpec {
  const { profile } = ctx.components;
  return {
    image: profile === null ? 'none' : image === 'build' ? profile.buildImage : profile.checkImage,
    mounts: { workspace: { source, target: '/workspace', mode }, others: [] },
    egress,
    limits: profile === null ? { cpus: 0, memoryMb: 0, pids: 0, wallClockMs } : { ...profile.limits, wallClockMs },
    user: { ...ctx.components.workspaces.user },
  };
}

/** One check's sandbox: the verified tree read-only, no network, and the check's own timeout as its wall clock. */
function checkSandbox(ctx: LineContext, tree: string, check: CheckSpec): SandboxSpec {
  return workspaceOnly(ctx, tree, 'ro', { mode: 'deny-all', allow: [] }, 'check', check.timeoutMs);
}

function scopeFor(ctx: LineContext, task: Task) {
  const resolved = engine.resolveCapabilities(task.role, task.station, ctx.policy);
  // Admission resolved every role the graph schedules, against the same admitted policy.
  if (!resolved.ok) throw new Error(`line: role ${task.role} lost its scope at ${task.station}: ${resolved.detail}`);
  return resolved.scope;
}

/**
 * Runs one task through a driver in a fresh sandbox over `workspace`, or
 * reports why it could not. The tree is mounted as the station's contract
 * allows: a station whose `writeBoundary` grants no glob — `review` — gets a
 * tree it cannot write (A-P4-05). The sandbox is destroyed when the task
 * ends, and with it anything the task left running (I4).
 *
 * Once the driver was called, what the call cost is recorded whatever the
 * call returned, before the caller decides anything from it (D-P13-08). A
 * sandbox that cannot be destroyed and read stops the run: the call it served
 * spent an amount nothing recorded, and a retry would spend again on top of
 * it (I5, D-P13-15).
 */
async function runTask(
  ctx: LineContext, task: Task, driver: Driver, context: string, workspace: string,
): Promise<{ ok: true; result: TaskResult } | { ok: false; error: unknown }> {
  const { sandbox } = ctx.components;
  const scope = scopeFor(ctx, task);
  const mode = STATION_CONTRACTS[task.station].writeBoundary.workspaceGlobs.length === 0 ? 'ro' : 'rw';
  // The tier this call runs at: the scope's at this station, raised only by a granted escalation, from the counts run state keeps (I2, A-R14-01).
  const tier = tierFor(scope, task.station, attemptsOf(ctx.state, task));
  let handle: SandboxHandle;
  let model: ModelIdentity;
  try {
    // The runtime's resolution of that tier, taken before the call: the record's model is never the driver's account (I2, A-I1a-01).
    model = driver.resolveModel(tier);
    const spec = workspaceOnly(ctx, workspace, mode, egressFor(scope.network), 'build', scope.budget.maxWallClockMs);
    // The relay the driver asks for, bounded by the budget policy grants the role, never the driver's (I4, A-I1a-02),
    // and priced for the resolved model alone, so a request naming any other is refused before it is sent (D-R14-01).
    const relay = driver.relayRequest();
    handle = await sandbox.provision(relay === null ? spec : {
      ...spec,
      relay: { ...relay, meter: boundTo(relay.meter, model.model), budget: { maxTokens: scope.budget.maxTokens, maxCostUsd: scope.budget.maxCostUsd } },
    });
  } catch (error) {
    return { ok: false, error };
  }
  // The call is recorded before it is made: a process stop during it leaves this record and nothing after it, and a resume finds it (D-I1a-12).
  try {
    await recordPending(ctx, task, model);
  } catch (error) {
    await sandbox.destroy(handle).catch(() => undefined);
    throw error;
  }
  let outcome: { ok: true; result: TaskResult } | { ok: false; error: unknown };
  try {
    const request: TaskRequest = {
      taskId: task.id,
      role: task.role,
      stablePrefix: context,
      variableSuffix: task.id,
      tier,
      tools: [...scope.tools],
      sandbox: handle,
      timeoutMs: scope.budget.maxWallClockMs,
      budget: { ...scope.budget },
    };
    const result = await driver.runTask(request);
    if (result.taskId !== task.id) throw new Error(`the driver returned a result for task ${String(result.taskId)} when asked to run ${task.id}`);
    outcome = { ok: true, result };
  } catch (error) {
    outcome = { ok: false, error };
  }
  let teardown: Teardown;
  try {
    teardown = await sandbox.destroy(handle);
  } catch (error) {
    // The call was made and what it cost is unknown: recorded as lost before the run stops, so a resume finds it and refuses (D-P13-20).
    await recordUsage(ctx, task, { kind: 'lost', detail: `the sandbox could not be destroyed and read: ${describe(error)}` }, model);
    throw new Error(
      `line: the sandbox task ${task.id} ran in could not be destroyed and its cost read, so the call is unaccounted and the run stops: ${describe(error)}`,
      { cause: error },
    );
  }
  const site = { vault: ctx.components.vault, runId: ctx.run.id, taskId: task.id, station: ctx.state.station };
  await recordEgress(site, teardown.egress);
  const { meter } = teardown;
  const usage = await recordUsage(ctx, task, meter, model);
  // A call whose relay refused anything is a decision the relay made, recorded as a count against its usage record (D-P14-05).
  if (meter.kind === 'metered' && meter.refused > 0) {
    await recordDecision(site, { cause: 'relay-refused', decidedBy: 'model-relay', usage, refused: meter.refused, exhausted: meter.exhausted });
  }
  return outcome;
}

/**
 * The driver's price table cut to the one model the runtime resolved for the
 * call. The relay refuses a model it has no price for before forwarding it, so
 * this is what binds a sandbox to its tier: a task that names another model,
 * however it reaches the relay, is refused (I2, D-R14-01). A resolved model
 * the driver has no price for is refused here rather than sent unpriced.
 */
export function boundTo(meter: RelayMeter, model: string): RelayMeter {
  const price = Object.hasOwn(meter.prices, model) ? meter.prices[model] : undefined;
  if (price === undefined) {
    throw new Error(`line: the driver resolved the model ${JSON.stringify(model)}, which its relay has no price for, so the call could not be metered`);
  }
  return { dialect: meter.dialect, prices: { [model]: { ...price } } };
}

/** One driver call's cost, as the relay counted it, written through the Vault's named operation and referenced from run state. */
async function recordUsage(ctx: LineContext, task: Task, reading: UsageReading, model: ModelIdentity): Promise<VaultRef> {
  const ref = await ctx.components.vault.recordUsage(usageRecord(ctx, task, reading, model));
  await commit(ctx, { usage: ref });
  return ref;
}

/**
 * A call about to be made, stored and not referenced from run state: the
 * Vault lists it by run (A-I1a-05), and a state a resume can start from never
 * holds a call that has not begun (D-I1a-12).
 */
async function recordPending(ctx: LineContext, task: Task, model: ModelIdentity): Promise<void> {
  await ctx.components.vault.recordUsage(usageRecord(ctx, task, { kind: 'pending' }, model));
}

function usageRecord(ctx: LineContext, task: Task, reading: UsageReading, model: ModelIdentity): UsageRecord {
  return {
    runId: ctx.run.id,
    taskId: task.id,
    station: ctx.state.station,
    attempt: attemptsOf(ctx.state, task).starts,
    model,
    reading,
    collectedBy: 'runtime',
  };
}

function joinParts(parts: ReadonlyArray<{ grant: ContextGrant; text: string }>): string {
  return parts.map((p) => `[${p.grant}]\n${p.text}`).join('\n\n');
}

/** Every artifact the run was admitted with. Each is locked by its station, and none may appear in a task's diff. */
function admittedArtifacts(ctx: LineContext): AdmittedArtifact[] {
  const { spec, acceptanceTests, verificationManifest, taskGraph } = ctx.artifacts;
  return [...spec, ...acceptanceTests, verificationManifest, taskGraph];
}

/**
 * What escalates the `integrate` exit: the tamper reports of the accepted
 * work, and a test analysis that never ran. A stack with no test adapter gives
 * a report whose test fields are empty, the report a clean change gives, so
 * the admission record — read from the Vault, not restated by a caller — is
 * what says the analysis did not run (D-A-I1-06).
 */
export async function integrateEscalations(
  vault: Vault, state: RunState, bundleAt: (ref: VaultRef) => Promise<EvidenceBundle>,
): Promise<{ protectedPathsTouched: readonly string[]; tamperFindings: readonly string[] }> {
  const accepted = await acceptedEscalations(state, bundleAt);
  const record = JSON.parse(decode(await vault.read(state.admission))) as Partial<AdmissionRecord> | null;
  const controls: unknown = record?.unavailableControls;
  if (!Array.isArray(controls) || !controls.every((c) => typeof c === 'string')) {
    throw new Error(`line: the admission record of run ${state.runId} names no unavailable controls, so whether its tests were analysed is unknown`);
  }
  if (!controls.includes('test')) return accepted;
  return {
    protectedPathsTouched: accepted.protectedPathsTouched,
    tamperFindings: [...accepted.tamperFindings, UNANALYSED_TESTS],
  };
}

/** Every integration record of the run, read back from the Vault. */
export async function readIntegration(vault: Vault, runId: RunId): Promise<IntegrationRecord[]> {
  const records: IntegrationRecord[] = [];
  for (const ref of await vault.readIntegration(runId)) records.push(JSON.parse(decode(await vault.read(ref))) as IntegrationRecord);
  return records;
}

/**
 * `integrate`'s work: the accepted change pushed and opened as a pull request,
 * so the human approving the exit sees what will merge (D-I1b-01). Once per
 * run: a resume that finds the record does not open it again. With no
 * integrator, nothing: the run is at L1 or below, and a human merges. With no
 * accepted change, a throw: there is no pull request to open, and the run
 * halts at the work rather than wait on an approval of nothing (D-I1b-04).
 */
async function openAccepted(ctx: LineContext): Promise<void> {
  const { integrator, vault } = ctx.components;
  if (integrator === null) return;
  if ((await readIntegration(vault, ctx.run.id)).some((r) => r.kind === 'opened')) return;
  const { diff, tree } = await accepted(ctx);
  if (diff.length === 0) {
    // Refused here rather than at the merge: no human is asked to approve a merge of nothing, and no
    // approved exit stands with no integration record to say the run is unfinished (D-I1b-04).
    throw new Error(`line: run ${ctx.run.id} accepted no change, so there is nothing to merge, and a run that merged nothing is not done`);
  }
  const opened = await integrator.open({
    runId: ctx.run.id,
    baseCommit: ctx.run.baseCommit,
    base: basePath(ctx.components.workspaces, ctx.run.id),
    tree,
    diff,
    admittedAt: ctx.run.createdAt,
  });
  await vault.recordIntegration(opened);
}

/** After the integrate approval: the pull request `integrate` opened, merged by the runtime (D-I1b-01). A failure throws, and the run halts (D-I1b-04). */
async function mergeAccepted(ctx: LineContext): Promise<void> {
  const { integrator, vault } = ctx.components;
  if (integrator === null) return;
  const records = await readIntegration(vault, ctx.run.id);
  if (records.some((r) => r.kind === 'merged')) return;
  const opened = records.find((r): r is IntegrationOpened => r.kind === 'opened');
  if (opened === undefined) {
    throw new Error(`line: run ${ctx.run.id} reached the integrate exit with no pull request recorded: it accepted no change, so there is nothing to merge, and a run that merged nothing is not done`);
  }
  await vault.recordIntegration(await integrator.merge(opened));
}

/** The finding an unanalysed suite escalates under. */
export const UNANALYSED_TESTS = 'test analysis did not run: the adapter set has no test framework, so an empty tamper report is not a clean one (D-A-I1-06)';

/** A bundle read back from the Vault, checked for the fields the line builds on. */
async function readBundle(ctx: LineContext, ref: VaultRef): Promise<EvidenceBundle> {
  const bundle = JSON.parse(decode(await ctx.components.vault.read(ref))) as Partial<EvidenceBundle>;
  if (typeof bundle.taskId !== 'string' || !Array.isArray(bundle.diff) || typeof bundle.diffSha256 !== 'string') {
    throw new Error(`line: an evidence bundle in run ${ctx.run.id} does not hold a task and a diff`);
  }
  return bundle as EvidenceBundle;
}

interface Accepted {
  /** The cumulative diff, relative to base, of the latest task that passed; empty when none has. */
  readonly diff: readonly DiffEntry[];
  /** The tree that diff was verified over, where its bytes are read from; the base when no task has passed. */
  readonly tree: string;
}

/**
 * What the run has accepted so far, derived from the Vault: the last bundle
 * of each task, of the tasks run state records as passed, whichever was
 * written last. Diffs are cumulative, so the latest one names the whole
 * accepted tree.
 */
async function accepted(ctx: LineContext): Promise<Accepted> {
  const last = new Map<TaskId, { bundle: EvidenceBundle; at: number }>();
  for (const [at, ref] of ctx.state.evidenceRefs.entries()) {
    const bundle = await readBundle(ctx, ref);
    last.set(bundle.taskId, { bundle, at });
  }
  let latest: { bundle: EvidenceBundle; at: number } | undefined;
  for (const [taskId, entry] of last) {
    const passed = Object.hasOwn(ctx.state.tasks, taskId) && ctx.state.tasks[taskId] === 'passed';
    if (passed && (latest === undefined || entry.at > latest.at)) latest = entry;
  }
  const { workspaces } = ctx.components;
  if (latest === undefined) return { diff: [], tree: basePath(workspaces, ctx.run.id) };
  return { diff: latest.bundle.diff, tree: treePath(workspaces, ctx.run.id, latest.bundle.diffSha256) };
}

/** `build`: one attempt at one task. The result is recorded in the Vault before the task is handed to `verify`. */
async function build(ctx: LineContext, task: Task): Promise<StationRefusal | undefined> {
  const { driver, vault, workspaces } = ctx.components;
  const capability = capabilityRefusal(STATION_CONTRACTS.build, driver.capabilities());
  if (capability !== undefined) return capability;
  const tampered = await tamperedPaths(ctx);
  // The task has not run, so the mismatch is not its role's doing.
  if (tampered.length > 0) return recordTamper(ctx, 'build', task, tampered, { phase: 'before-build' }, null);

  const spec = await readText(ctx, ctx.artifacts.spec);
  const tests = await readText(ctx, ctx.artifacts.acceptanceTests);
  const drifted = [...spec.tampered, ...tests.tampered];
  // Read before the iteration is spent: context that changed under the check costs no budget.
  if (drifted.length > 0) return recordTamper(ctx, 'build', task, drifted, { phase: 'context' }, null);

  const started = await startAttempt(ctx, task);
  if (started !== undefined) return started;
  // A fresh pair for every invocation, a replayed one included: the tree the task is handed is
  // exactly base and what was accepted, never what an earlier attempt left behind.
  const { start, work } = attemptPaths(workspaces, ctx.run.id, task.id, attemptsOf(ctx.state, task).iterations);
  const base = await accepted(ctx);
  await materialize(workspaces, ctx.run.id, start, base.diff, () => base.tree);
  await copyTree(start, work);
  const offered: Partial<Record<ContextGrant, string>> = {
    'locked-spec': spec.text,
    'acceptance-tests': tests.text,
    'task-graph': JSON.stringify(ctx.graph.tasks.map(({ id, station, role, dependsOn }) => ({ id, station, role, dependsOn }))),
  };
  const ran = await runTask(ctx, task, driver, joinParts(grantedContext(STATION_CONTRACTS.build, offered)), work);
  if (!ran.ok) return spendRetry(ctx, task);
  // I2: a result is recorded only as the contract shapes it. A key it does not name, `status`
  // among them, is a driver speaking outside the contract; it is not recorded, and the run stops.
  const problems = taskResultProblems(ran.result);
  if (problems.length > 0) {
    throw new Error(`line: the driver's result for task ${task.id} does not match the TaskResult contract, so it was not recorded: ${problems.join('; ')}`);
  }
  const ref = await vault.recordTaskResult(ctx.run.id, ran.result);
  await commit(ctx, { tasks: { ...ctx.state.tasks, [task.id]: 'verifying' }, results: { ...ctx.state.results, [task.id]: ref } });
  return undefined;
}

/** Locked artifacts whose content in `tree` is not what was admitted. */
async function tamperedIn(ctx: LineContext, tree: string): Promise<TamperedPath[]> {
  const tampered: TamperedPath[] = [];
  for (const artifact of admittedArtifacts(ctx)) {
    const actual = (await hashAt(tree, artifact.path)) ?? 'missing';
    if (actual !== artifact.sha256) tampered.push({ path: artifact.path, expected: artifact.sha256, actual });
  }
  return tampered;
}

/**
 * I4: a change outside the task's grant is a capability the policy did not
 * give, collected from the runtime's own diff. It is recorded and the run
 * does not continue: the refusal rests on evidence, not on the claim.
 */
async function recordEscape(ctx: LineContext, task: Task, outside: string[]): Promise<StationRefusal> {
  const detector = driverAt(ctx, 'verify');
  const ref = await recordViolation(ctx, {
    runId: ctx.run.id,
    taskId: task.id,
    kind: 'capability-escape',
    role: task.role,
    driverProvenanceId: detector.provenanceId(),
    contractVersion: detector.contractVersion,
    detectedAt: new Date().toISOString(),
    detail: { station: 'verify', phase: 'diff', outsideGrant: outside },
  });
  await commit(ctx, { violation: ref, tasks: { ...ctx.state.tasks, [task.id]: 'failed' } });
  return {
    ok: false,
    reason: 'violation',
    violations: [ref],
    message: `task ${task.id} changed paths its grant does not cover: ${outside.join(', ')}`,
  };
}

/**
 * Where a pinned coverage check's report is. None has a channel yet: a check
 * runs over a read-only tree, so the report it would write reaches no path the
 * host reads, and a pinned coverage check is refused rather than read as
 * covering nothing or as not pinned (D-P7-05). M3 owns coverage the suite
 * cannot forge, and with it the channel.
 */
function coverageReport(ctx: LineContext): null {
  const pinned = ctx.checks.find((c) => c.kind === 'coverage');
  if (pinned !== undefined) {
    throw new Error(`line: check ${pinned.id} is a coverage check, and no report from a read-only check sandbox reaches the host, so its coverage cannot be read`);
  }
  return null;
}

/** Each kind of finding in a task's report, as a violation: recorded in the Vault, not entered in run state, which would halt the run. */
const FINDING_KINDS = [
  ['assertion-weakened', (r: TamperReport) => r.assertionsWeakened.length > 0 ? { assertionsWeakened: r.assertionsWeakened } : undefined],
  ['assertion-weakened', (r: TamperReport) => r.snapshotsRegenerated.length > 0 ? { snapshotsRegenerated: r.snapshotsRegenerated } : undefined],
  ['skip-marker', (r: TamperReport) => r.skipMarkersAdded.length > 0 ? { skipMarkersAdded: r.skipMarkersAdded } : undefined],
  ['suite-shrink', (r: TamperReport) => r.testsDeleted.length > 0 ? { testsDeleted: r.testsDeleted } : undefined],
  ['protected-path', (r: TamperReport) => r.protectedPathsTouched.length > 0 ? { protectedPathsTouched: r.protectedPathsTouched } : undefined],
] as const satisfies ReadonlyArray<readonly [IntegrityViolation['kind'], (r: TamperReport) => Record<string, unknown> | undefined]>;

async function recordFindings(ctx: LineContext, task: Task, report: TamperReport): Promise<void> {
  const detector = driverAt(ctx, 'verify');
  for (const [kind, detail] of FINDING_KINDS) {
    const found = detail(report);
    if (found === undefined) continue;
    // Deliberately not entered in run state: a test change can be legitimate, and the call on it
    // is the human's at integrate, with the report beside the evidence (D-P7-01).
    await recordViolation(ctx, {
      runId: ctx.run.id,
      taskId: task.id,
      kind,
      role: task.role,
      driverProvenanceId: detector.provenanceId(),
      contractVersion: detector.contractVersion,
      detectedAt: new Date().toISOString(),
      detail: { station: 'verify', phase: 'tamper', ...found },
    });
  }
}

/**
 * `verify`: the task's own diff, held to the locks and the grant; then the
 * checks, run over a tree built from base and the cumulative diff, where the
 * agent never ran, mounted read-only with no egress. The verdict follows the
 * check results and nothing else (I2).
 */
async function verify(ctx: LineContext, task: Task): Promise<StationRefusal | undefined> {
  const { sandbox, vault, driver, workspaces } = ctx.components;
  const before = await tamperedPaths(ctx);
  if (before.length > 0) return recordTamper(ctx, 'verify', task, before, { phase: 'before-checks' });
  const result = await readResult(ctx, task);

  const { start, work } = attemptPaths(workspaces, ctx.run.id, task.id, attemptsOf(ctx.state, task).iterations);
  const own = await ownDiff(start, work);

  // I3: the task's copy is not where the Vault checks the locks, so its diff is checked instead.
  // A locked path in it is the tamper the Vault's own check can no longer see.
  const admitted = new Map(admittedArtifacts(ctx).map((a) => [a.path, a.sha256]));
  const locked = own.filter((entry) => admitted.has(entry.path));
  if (locked.length > 0) {
    const tampered = locked.map((entry) => ({ path: entry.path, expected: admitted.get(entry.path) ?? 'missing', actual: entry.sha256 ?? 'missing' }));
    return recordTamper(ctx, 'verify', task, tampered, { phase: 'diff' });
  }
  const scope = scopeFor(ctx, task);
  const outside = writesOutsideGrant(own, scope.writableGlobs, STATION_CONTRACTS.build.writeBoundary.workspaceGlobs);
  if (outside.length > 0) return recordEscape(ctx, task, outside);

  const prior = await accepted(ctx);
  const diff = await composeDiff(basePath(workspaces, ctx.run.id), prior.diff, own);
  const diffSha256 = diffDigest(diff);
  const tree = treePath(workspaces, ctx.run.id, diffSha256);
  const fromTask = new Set(own.map((entry) => entry.path));
  await materialize(workspaces, ctx.run.id, tree, diff, (path) => (fromTask.has(path) ? work : prior.tree));
  const built = await tamperedIn(ctx, tree);
  if (built.length > 0) return recordTamper(ctx, 'verify', task, built, { phase: 'tree' });
  const counted = await countSuites(tree);
  const tamper = await analyzeTamper(prior.tree, tree, { protectedPaths: ctx.policy.protectedPaths, coverage: coverageReport(ctx), commands: ctx.checks.map((c) => c.command) });

  // Results stay aligned with the specs by position, never matched up by id afterwards.
  const specs = ctx.checks;
  const results: Array<CheckResult | undefined> = [];
  const unstarted: UnstartedCheck[] = [];
  // Each check gets a sandbox of its own, whose wall clock is the check's pinned timeout. A check
  // shares no container with the one before it, so nothing an earlier check did to the container
  // can change what a later one runs (codex-2); and a check that outruns its timeout is ended by
  // the provider and produces no result, recorded in `unstarted` like any other (codex-7).
  for (const check of specs) {
    let handle: SandboxHandle;
    try {
      handle = await sandbox.provision(checkSandbox(ctx, tree, check));
    } catch {
      return spendRetry(ctx, task);
    }
    try {
      const startedAt = new Date().toISOString();
      try {
        // The pinned argument vector, exactly: no shell, no splitting (A-P6-01).
        const exec = await sandbox.exec(handle, [...check.command]);
        results.push({
          checkId: check.id,
          exitCode: exec.exitCode,
          stdout: exec.stdout,
          stderr: exec.stderr,
          suiteCount: suiteCountFor(check, counted),
          expectation: null,
          durationMs: exec.durationMs,
          startedAt,
        });
      } catch (error) {
        // There is no exit code to record and none is invented; the bundle says why (A-P6-02).
        results.push(undefined);
        unstarted.push({ checkId: check.id, reason: describe(error) });
      }
    } finally {
      // A check's sandbox has no route out today, and whatever its proxy decided is recorded all the same (D-P14-04).
      const { egress } = await sandbox.destroy(handle);
      await recordEgress({ vault: ctx.components.vault, runId: ctx.run.id, taskId: task.id, station: ctx.state.station }, egress);
    }
  }
  const checks = results.filter((r): r is CheckResult => r !== undefined);

  // Evidence collected over a changed artifact is not evidence, whatever the provider claims about ro.
  const after = [...(await tamperedPaths(ctx)), ...(await tamperedIn(ctx, tree))];
  if (after.length > 0) return recordTamper(ctx, 'verify', task, after, { phase: 'after-checks', checks });

  const failed: FailedCheck[] = [];
  specs.forEach((check, i) => {
    const shortfall = requiredShortfall(check, results[i]);
    if (shortfall !== undefined) failed.push(shortfall);
  });
  const differences = claimEvidenceDiff(result.claim, own);
  if (differences.length > 0) {
    // Recorded, and deliberately not entered in run state: every entry there halts the run, and a
    // halt the claim could trigger would let the model's story decide the outcome (D-P6-03).
    await recordViolation(ctx, {
      runId: ctx.run.id,
      taskId: task.id,
      kind: 'claim-mismatch',
      role: task.role,
      driverProvenanceId: driver.provenanceId(),
      contractVersion: driver.contractVersion,
      detectedAt: new Date().toISOString(),
      detail: { station: 'verify', claimEvidenceDiff: differences },
    });
  }
  await recordFindings(ctx, task, tamper);
  const evidence: EvidenceBundle = {
    runId: ctx.run.id,
    taskId: task.id,
    baseCommit: ctx.run.baseCommit,
    baseTreeSha256: ctx.baseTreeSha256,
    diff,
    diffSha256,
    checks,
    unstarted,
    claim: result.claim,
    claimEvidenceDiff: differences,
    tamper,
    collectedBy: 'runtime',
    driverProvenanceId: driver.provenanceId(),
    contractVersion: driver.contractVersion,
  };
  const ref = await vault.writeEvidence(evidence);
  // The status follows the verdict and nothing else (I2). A failure with no iteration left parks the task.
  const spent = attemptsOf(ctx.state, task).iterations;
  const status: TaskStatus = failed.length === 0 ? 'passed' : spent >= STATION_CONTRACTS[task.station].maxIterations ? 'parked' : 'failed';
  // The station machine returns this park to the line on its next step; it is recorded here, first.
  if (status === 'parked') await park(ctx, task, { evidence: ref });
  else await commit(ctx, { tasks: { ...ctx.state.tasks, [task.id]: status }, evidence: ref });
  return undefined;
}

/**
 * The review seat's tree: the files its grants cover and nothing else. The
 * contract grants the locked spec, the acceptance tests, and the diff, so the
 * view holds those files as the accepted tree has them; the task graph, the
 * manifest, and every file the diff does not carry are absent, so a reviewer
 * with a read tool cannot open what its contract denies it (I6).
 */
async function reviewView(ctx: LineContext, task: Task): Promise<string> {
  const { workspaces } = ctx.components;
  const grants: readonly ContextGrant[] = STATION_CONTRACTS.review.allowedContext;
  const keep = new Set<string>();
  if (grants.includes('locked-spec')) for (const a of ctx.artifacts.spec) keep.add(a.path);
  if (grants.includes('acceptance-tests')) for (const a of ctx.artifacts.acceptanceTests) keep.add(a.path);
  const current = await accepted(ctx);
  if (grants.includes('diff')) for (const entry of current.diff) if (entry.sha256 !== null) keep.add(entry.path);
  const view = reviewPath(workspaces, ctx.run.id, task.id, attemptsOf(ctx.state, task).iterations);
  await copyOnly(current.tree, view, [...keep].sort());
  return view;
}

/**
 * The latest evidence bundle per reviewed task, as the runtime's facts only:
 * check ids, exit codes, whether an expectation held, the checks that never
 * started, and how many ways the claim and the diff disagree — never the
 * claim itself. A reviewer shown a behavioral check's exit code alone would
 * read the product's 0 as a pass the gate did not give (A-P8-01).
 */
async function evidenceFacts(ctx: LineContext, tasks: readonly TaskId[]): Promise<string> {
  const latest = new Map<TaskId, EvidenceBundle>();
  for (const ref of ctx.state.evidenceRefs) {
    const bundle = JSON.parse(decode(await ctx.components.vault.read(ref))) as EvidenceBundle;
    if (tasks.includes(bundle.taskId)) latest.set(bundle.taskId, bundle);
  }
  return JSON.stringify(
    [...latest.values()].map((b) => ({
      taskId: b.taskId,
      checks: b.checks.map(({ checkId, exitCode, suiteCount, expectation }) => ({ checkId, exitCode, suiteCount, expectationHeld: expectation === null ? null : expectation.held })),
      unstarted: b.unstarted.map((u) => u.checkId),
      // How many ways the claim and the diff disagree, and not the paths: a claimed path is a
      // string the author wrote, and the seat is given no author material (D-P6-03).
      claimMismatches: b.claimEvidenceDiff.length,
      // The runtime's reading of the diff: paths it collected and assertions it parsed, not author text.
      protectedPathsTouched: b.tamper.protectedPathsTouched,
      tamperFindings: tamperFindings(b.tamper),
    })),
  );
}

/**
 * `review`: one seat. The authors' families come from their recorded results;
 * the seat is checked before the reviewer runs, from the model it resolves, and
 * again after, from the model its result reports, so a driver that runs another
 * model than it resolved is held to the one that ran (I6). The stricter seat is
 * the one committed.
 */
async function review(ctx: LineContext, task: Task): Promise<StationRefusal | undefined> {
  const { reviewer, vault } = ctx.components;
  const contract = STATION_CONTRACTS.review;
  const capability = capabilityRefusal(contract, reviewer.capabilities());
  if (capability !== undefined) return capability;
  const tampered = await tamperedPaths(ctx);
  // The reviewer has not run; the mismatch is not the review seat's doing.
  if (tampered.length > 0) return recordTamper(ctx, 'review', task, tampered, { phase: 'before-review' }, null);

  const reviewed = ctx.graph.tasks.filter((t) => task.dependsOn.includes(t.id));
  const authored = await Promise.all(reviewed.map((t) => readResult(ctx, t)));
  const authors = await authorsOf(ctx, reviewed, authored);
  const level = ctx.run.requestedLevel;
  const planned = seatReviewer(task.id, authors, reviewer.resolveModel(tierFor(scopeFor(ctx, task), 'review', attemptsOf(ctx.state, task))), level);
  if (!planned.ok) return planned;

  const spec = await readText(ctx, ctx.artifacts.spec);
  const tests = await readText(ctx, ctx.artifacts.acceptanceTests);
  const drifted = [...spec.tampered, ...tests.tampered];
  if (drifted.length > 0) return recordTamper(ctx, 'review', task, drifted, { phase: 'context' }, null);

  const started = await startAttempt(ctx, task);
  if (started !== undefined) return started;
  // Everything the line has is offered, the author's narrative and the plan
  // included; grantedContext is what keeps a seat to its contract.
  // The seat's tree holds the files the diff left, and a removal leaves none; the listing is how
  // the seat sees one. It is the runtime's diff, never the claim's file list (codex-5).
  const current = await accepted(ctx);
  const offered: Partial<Record<ContextGrant, string>> = {
    'locked-spec': spec.text,
    'acceptance-tests': tests.text,
    diff: JSON.stringify(current.diff.map(({ path, change }) => ({ path, change }))),
    'evidence-bundle': await evidenceFacts(ctx, task.dependsOn),
    'author-narrative': authored.map((r) => r.claim.narrative).join('\n'),
    plan: JSON.stringify(ctx.graph.tasks),
  };
  const ran = await runTask(ctx, task, reviewer, joinParts(grantedContext(contract, offered)), await reviewView(ctx, task));
  if (!ran.ok) return spendRetry(ctx, task);
  // I2: the line receives a result here too, and holds it to the contract exactly as build does (codex-6).
  const problems = taskResultProblems(ran.result);
  if (problems.length > 0) {
    throw new Error(`line: the reviewer's result for task ${task.id} does not match the TaskResult contract, so it was not recorded: ${problems.join('; ')}`);
  }
  const seated = seatReviewer(task.id, authors, ran.result.model, level);
  if (!seated.ok) return seated;
  // The stricter of the two seats: what the reviewer reports never widens what the runtime resolved (I2, I6; codex-1, gemini-1).
  const seat = planned.seat.independence === 'reduced' ? planned.seat : seated.seat;
  const ref = await vault.recordTaskResult(ctx.run.id, ran.result);
  await commit(ctx, {
    tasks: { ...ctx.state.tasks, [task.id]: 'passed' },
    results: { ...ctx.state.results, [task.id]: ref },
    review: seat,
  });
  return undefined;
}

/**
 * Every model that built the reviewed tasks (I6, D-A-BR-01): the model each
 * recorded result names, and the model of every call the runtime made for
 * them, failed and escalated iterations included. After an escalation the
 * last result names only the last tier's model, and a model whose iteration
 * failed still worked the task the reviewer judges.
 */
async function authorsOf(ctx: LineContext, reviewed: readonly Task[], authored: readonly TaskResult[]): Promise<ModelIdentity[]> {
  const ids = new Set(reviewed.map((t) => t.id));
  const calls = (await readUsage(ctx.components.vault, ctx.state)).filter((r) => ids.has(r.taskId));
  // Each model once: a call replayed after a stop is the same model twice, and a seat taken on resume
  // lists the authors a run that never stopped would list (I2.resume-derives-state-from-the-vault).
  const distinct = new Map<string, ModelIdentity>();
  for (const model of [...authored.map((r) => r.model), ...calls.map((r) => r.model)]) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- read back from the Vault: the type is the writer's claim, not the bytes'.
    if (typeof model?.family !== 'string') throw new Error(`line: a call recorded for ${reviewed.map((t) => t.id).join(', ')} names no model family, so a reviewer of it cannot be seated`);
    distinct.set(JSON.stringify([model.provider, model.family, model.model, model.version]), model);
  }
  return [...distinct.values()];
}

interface StateChange {
  readonly station?: StationId;
  readonly phase?: RunState['phase'];
  readonly approvals?: RunState['approvals'];
  readonly tasks?: RunState['tasks'];
  readonly attempts?: RunState['attempts'];
  readonly results?: RunState['results'];
  readonly evidence?: VaultRef;
  readonly violation?: VaultRef;
  readonly review?: RunState['reviews'][number];
  readonly usage?: VaultRef;
  readonly cancelled?: RunCancellation;
}

/** Commits the next state through the Vault's version check and keeps what it stored. */
async function commit(ctx: LineContext, change: StateChange): Promise<void> {
  const { state } = ctx;
  ctx.state = await ctx.components.vault.commitRunState(
    {
      ...state,
      station: change.station ?? state.station,
      phase: change.phase ?? state.phase,
      approvals: change.approvals ?? state.approvals,
      tasks: change.tasks ?? state.tasks,
      attempts: change.attempts ?? state.attempts,
      results: change.results ?? state.results,
      evidenceRefs: change.evidence === undefined ? state.evidenceRefs : [...state.evidenceRefs, change.evidence],
      violations: change.violation === undefined ? state.violations : [...state.violations, change.violation],
      reviews: change.review === undefined ? state.reviews : [...state.reviews, change.review],
      usage: change.usage === undefined ? state.usage : [...state.usage, change.usage],
      cancelled: change.cancelled ?? state.cancelled,
    },
    state.version,
  );
  ctx.onCommit?.(ctx.state);
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'unknown error';
}
