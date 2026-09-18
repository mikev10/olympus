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
 * - `build`: runs each task through the driver and records the result in the
 *   Vault before anything reads it.
 * - `verify`: runs every check in a fresh sandbox over a read-only workspace and
 *   derives the verdict from exit codes alone (I2). No tamper analysis and no
 *   claim/evidence diff; SKELETON_LINE says so.
 * - `review`: seats a reviewer against the authors' recorded model families
 *   (I6) and runs it on context its contract grants.
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
  grantedContext,
  locksHeldLeaving,
  M1_STATIONS,
  maxStarts,
  nextStep,
  parkRefusal,
  seatReviewer,
  STATION_CONTRACTS,
  StrictPolicyEngine,
  transition,
} from '@olympus-ai/core';
import type {
  AgentClaim,
  ApprovalGrant,
  ApprovalKey,
  ContextGrant,
  Driver,
  FailedCheck,
  ModelIdentity,
  Policy,
  RoleId,
  Run,
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
import type { CheckResult, CheckSpec, IntegrityViolation } from '@olympus-ai/integrity';
import type { EgressPolicy, SandboxHandle, SandboxSpec } from '@olympus-ai/sandbox';
import type { AdmissionRecord, AdmittedArtifact, EvidenceBundle } from '@olympus-ai/vault';
import type { ComponentGraph, RunOutcome } from './run.js';

export interface LineContext {
  readonly run: Run;
  readonly policy: Policy;
  readonly artifacts: AdmissionRecord['artifacts'];
  readonly graph: TaskGraph;
  readonly checks: readonly CheckSpec[];
  readonly components: ComponentGraph;
  /** Replaced by every commit. */
  state: RunState;
}

const engine = new StrictPolicyEngine();

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
    return refused(ctx, ctx.state.station, await recordTamper(ctx, ctx.state.station, null, [...changed], { phase: 'resume' }));
  }
  for (;;) {
    const step = nextStep(ctx.state, ctx.graph);
    let refusal: StationRefusal | undefined;
    switch (step.kind) {
      case 'refuse':
        return refused(ctx, ctx.state.station, step.refusal);
      case 'work':
        refusal = await work(ctx, step.station);
        break;
      case 'build':
        refusal = await build(ctx, step.task);
        break;
      case 'verify':
        refusal = await verify(ctx, step.task);
        break;
      case 'review':
        refusal = await review(ctx, step.task);
        break;
      case 'finish':
        await commit(ctx, { phase: 'exiting' });
        break;
      case 'exit': {
        const tampered = locksHeldLeaving(step.from) ? await tamperedPaths(ctx) : [];
        const next = transition({
          from: step.from,
          to: step.to,
          level: ctx.run.requestedLevel,
          policy: ctx.policy,
          tampered,
          grants: ctx.state.approvals,
          protectedPathsTouched: [],
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
          if (next.spends !== null) await commit(ctx, { approvals });
          return { ok: true, state: ctx.state };
        }
        await commit(ctx, { station: next.next, phase: 'working', approvals });
        break;
      }
    }
    if (refusal !== undefined) return refused(ctx, ctx.state.station, refusal);
  }
}

function refused(ctx: LineContext, at: StationId, transition: StationRefusal): RunOutcome {
  return { ok: false, reason: 'refused', at, transition, state: ctx.state };
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
    case 'integrate':
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
  const { vault } = ctx.components;
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
  const ref = await vault.recordViolation(violation);
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
    await commit(ctx, { tasks: { ...ctx.state.tasks, [task.id]: 'parked' }, attempts: { ...ctx.state.attempts, [task.id]: spent } });
    return parkRefusal(ctx.state, task);
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
    await commit(ctx, { tasks: { ...ctx.state.tasks, [task.id]: 'parked' }, attempts });
    return parkRefusal(ctx.state, task);
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

function egressFor(network: { egress: 'none' | string[] }): EgressPolicy {
  return network.egress === 'none' ? { mode: 'deny-all', allow: [] } : { mode: 'allowlist', allow: [...network.egress] };
}

/** The workspace alone: rw where a task works, ro where checks run, so the checks get a tree they cannot modify (I3). */
function workspaceOnly(ctx: LineContext, mode: 'rw' | 'ro', egress: EgressPolicy): SandboxSpec {
  return {
    image: 'none',
    mounts: { workspace: { source: ctx.run.repo, target: '/workspace', mode }, others: [] },
    egress,
    limits: { cpus: 0, memoryMb: 0, pids: 0, wallClockMs: 0 },
  };
}

function scopeFor(ctx: LineContext, task: Task) {
  const resolved = engine.resolveCapabilities(task.role, task.station, ctx.policy);
  // Admission resolved every role the graph schedules, against the same admitted policy.
  if (!resolved.ok) throw new Error(`line: role ${task.role} lost its scope at ${task.station}: ${resolved.detail}`);
  return resolved.scope;
}

/**
 * Runs one task through a driver in a fresh sandbox, or reports why it could
 * not. The workspace is mounted as the station's contract allows: a station
 * whose `writeBoundary` grants no glob — `review` — gets a tree it cannot
 * write, rather than the author's own working copy (A-P4-05).
 */
async function runTask(ctx: LineContext, task: Task, driver: Driver, context: string): Promise<{ ok: true; result: TaskResult } | { ok: false; error: unknown }> {
  const { sandbox } = ctx.components;
  const scope = scopeFor(ctx, task);
  const mode = STATION_CONTRACTS[task.station].writeBoundary.workspaceGlobs.length === 0 ? 'ro' : 'rw';
  try {
    const handle = await sandbox.provision(workspaceOnly(ctx, mode, egressFor(scope.network)));
    try {
      const request: TaskRequest = {
        taskId: task.id,
        role: task.role,
        stablePrefix: context,
        variableSuffix: task.id,
        tier: scope.tier,
        tools: [...scope.tools],
        sandbox: handle,
        timeoutMs: scope.budget.maxWallClockMs,
        budget: { ...scope.budget },
      };
      const result = await driver.runTask(request);
      if (result.taskId !== task.id) throw new Error(`the driver returned a result for task ${String(result.taskId)} when asked to run ${task.id}`);
      return { ok: true, result };
    } finally {
      await sandbox.destroy(handle);
    }
  } catch (error) {
    return { ok: false, error };
  }
}

function joinParts(parts: ReadonlyArray<{ grant: ContextGrant; text: string }>): string {
  return parts.map((p) => `[${p.grant}]\n${p.text}`).join('\n\n');
}

/** `build`: one attempt at one task. The result is recorded in the Vault before the task is handed to `verify`. */
async function build(ctx: LineContext, task: Task): Promise<StationRefusal | undefined> {
  const { driver, vault } = ctx.components;
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
  const offered: Partial<Record<ContextGrant, string>> = {
    'locked-spec': spec.text,
    'acceptance-tests': tests.text,
    'task-graph': JSON.stringify(ctx.graph.tasks.map(({ id, station, role, dependsOn }) => ({ id, station, role, dependsOn }))),
  };
  const ran = await runTask(ctx, task, driver, joinParts(grantedContext(STATION_CONTRACTS.build, offered)));
  if (!ran.ok) return spendRetry(ctx, task);
  const ref = await vault.recordTaskResult(ctx.run.id, ran.result);
  await commit(ctx, { tasks: { ...ctx.state.tasks, [task.id]: 'verifying' }, results: { ...ctx.state.results, [task.id]: ref } });
  return undefined;
}

/** `verify`: the checks, run where the agent never ran, over a workspace mounted read-only; the verdict follows their exit codes and nothing else (I2). */
async function verify(ctx: LineContext, task: Task): Promise<StationRefusal | undefined> {
  const { sandbox, vault, driver } = ctx.components;
  const before = await tamperedPaths(ctx);
  if (before.length > 0) return recordTamper(ctx, 'verify', task, before, { phase: 'before-checks' });
  const result = await readResult(ctx, task);

  // Results stay aligned with the specs by position, never matched up by id afterwards.
  const specs = ctx.checks;
  const results: Array<CheckResult | undefined> = [];
  const unstarted: Array<string | undefined> = [];
  let handle: SandboxHandle;
  try {
    handle = await sandbox.provision(workspaceOnly(ctx, 'ro', { mode: 'deny-all', allow: [] }));
  } catch {
    return spendRetry(ctx, task);
  }
  try {
    for (const check of specs) {
      const startedAt = new Date().toISOString();
      try {
        // Whitespace split and no shell is the whole command grammar until P6 declares one.
        const exec = await sandbox.exec(handle, check.command.split(/\s+/));
        results.push({ checkId: check.id, exitCode: exec.exitCode, stdout: exec.stdout, stderr: exec.stderr, suiteCount: null, durationMs: exec.durationMs, startedAt });
        unstarted.push(undefined);
      } catch (error) {
        // There is no exit code to record and none is invented; a required check with no result fails the gate.
        results.push(undefined);
        unstarted.push(describe(error));
      }
    }
  } finally {
    await sandbox.destroy(handle);
  }
  const checks = results.filter((r): r is CheckResult => r !== undefined);

  // Evidence collected over a changed artifact is not evidence, whatever the provider claims about ro.
  const after = await tamperedPaths(ctx);
  if (after.length > 0) return recordTamper(ctx, 'verify', task, after, { phase: 'after-checks', checks });

  const failed: FailedCheck[] = [];
  specs.forEach((check, i) => {
    const shortfall = requiredShortfall(check, results[i]);
    if (shortfall !== undefined) failed.push(shortfall);
  });
  const evidence: EvidenceBundle = {
    runId: ctx.run.id,
    taskId: task.id,
    baseCommit: ctx.run.baseCommit,
    checks,
    claim: result.claim,
    claimEvidenceDiff: [],
    collectedBy: 'runtime',
    driverProvenanceId: driver.provenanceId(),
    contractVersion: driver.contractVersion,
  };
  const ref = await vault.writeEvidence(evidence);
  // The status follows the verdict and nothing else (I2). A failure with no iteration left parks the task.
  const spent = attemptsOf(ctx.state, task).iterations;
  const status: TaskStatus = failed.length === 0 ? 'passed' : spent >= STATION_CONTRACTS[task.station].maxIterations ? 'parked' : 'failed';
  await commit(ctx, { tasks: { ...ctx.state.tasks, [task.id]: status }, evidence: ref });
  return undefined;
}

/** Why a required check fails the gate, in the runtime's terms, or undefined when it does not. */
function requiredShortfall(check: CheckSpec, result: CheckResult | undefined): FailedCheck | undefined {
  if (!check.required) return undefined;
  if (result === undefined) return { checkId: check.id, exitCode: null, cause: 'no-result' };
  if (result.exitCode !== 0) return { checkId: check.id, exitCode: result.exitCode, cause: 'exit-code' };
  if (check.expectedSuiteCount !== undefined && (result.suiteCount === null || result.suiteCount < check.expectedSuiteCount)) {
    return { checkId: check.id, exitCode: result.exitCode, cause: 'suite-count' };
  }
  return undefined;
}

/** The latest evidence bundle per reviewed task, as the runtime's facts only: check ids and exit codes, never the claim beside them. */
async function evidenceFacts(ctx: LineContext, tasks: readonly TaskId[]): Promise<string> {
  const latest = new Map<TaskId, EvidenceBundle>();
  for (const ref of ctx.state.evidenceRefs) {
    const bundle = JSON.parse(decode(await ctx.components.vault.read(ref))) as EvidenceBundle;
    if (tasks.includes(bundle.taskId)) latest.set(bundle.taskId, bundle);
  }
  return JSON.stringify(
    [...latest.values()].map((b) => ({ taskId: b.taskId, checks: b.checks.map(({ checkId, exitCode, suiteCount }) => ({ checkId, exitCode, suiteCount })) })),
  );
}

/**
 * `review`: one seat. The authors' families come from their recorded results;
 * the seat is checked before the reviewer runs, from the model it resolves, and
 * again after, from the model its result reports, so a driver that runs another
 * model than it resolved is held to the one that ran (I6).
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
  const authors = authored.map((r) => r.model);
  const level = ctx.run.requestedLevel;
  const planned = seatReviewer(task.id, authors, reviewer.resolveModel(scopeFor(ctx, task).tier), level);
  if (!planned.ok) return planned;

  const spec = await readText(ctx, ctx.artifacts.spec);
  const tests = await readText(ctx, ctx.artifacts.acceptanceTests);
  const drifted = [...spec.tampered, ...tests.tampered];
  if (drifted.length > 0) return recordTamper(ctx, 'review', task, drifted, { phase: 'context' }, null);

  const started = await startAttempt(ctx, task);
  if (started !== undefined) return started;
  // Everything the line has is offered, the author's narrative and the plan
  // included; grantedContext is what keeps a seat to its contract.
  const offered: Partial<Record<ContextGrant, string>> = {
    'locked-spec': spec.text,
    'acceptance-tests': tests.text,
    'evidence-bundle': await evidenceFacts(ctx, task.dependsOn),
    'author-narrative': authored.map((r) => r.claim.narrative).join('\n'),
    plan: JSON.stringify(ctx.graph.tasks),
  };
  const ran = await runTask(ctx, task, reviewer, joinParts(grantedContext(contract, offered)));
  if (!ran.ok) return spendRetry(ctx, task);
  const seated = seatReviewer(task.id, authors, ran.result.model, level);
  if (!seated.ok) return seated;
  const ref = await vault.recordTaskResult(ctx.run.id, ran.result);
  await commit(ctx, {
    tasks: { ...ctx.state.tasks, [task.id]: 'passed' },
    results: { ...ctx.state.results, [task.id]: ref },
    review: seated.seat,
  });
  return undefined;
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
    },
    state.version,
  );
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'unknown error';
}
