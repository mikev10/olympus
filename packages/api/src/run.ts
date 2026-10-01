/**
 * The programmatic entry points: the runtime as a service, of which an
 * in-process call is the first form. P9 puts HTTP in front of them and the CLI
 * behind that. Nothing here writes to a stream, reads argv, or exits; each
 * call returns, and the caller decides what an outcome means (I9).
 *
 * `startRun` admits a run and drives it. `resumeRun` drives an admitted run
 * from its last committed state. `approveStation` records a human's approval
 * of the station exit a run is waiting at. All three read the station machine
 * in `@olympus-ai/core`; the line itself is in `line.ts`.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  approvalKey,
  capabilityRefusal,
  contractTableProblems,
  effectiveApproval,
  formatDefects,
  isAgentStation,
  isApprovalKey,
  isBackward,
  locksHeldLeaving,
  M1_STATIONS,
  nextStep,
  STATION_CONTRACTS,
  stationCapRefusal,
  StrictPolicyEngine,
  transition,
  validatePolicyDocument,
} from '@olympus-ai/core';
import type {
  ApprovalKey,
  AutonomyLevel,
  Driver,
  Policy,
  PolicyRefusal,
  RoleId,
  Run,
  RunCancellation,
  RunId,
  RunState,
  StationId,
  StationRefusal,
  TaskGraph,
} from '@olympus-ai/core';
import { adapterAdmission, buildAdapterSet, missingControls } from '@olympus-ai/adapters';
import type { CheckSpec } from '@olympus-ai/integrity';
import type { SandboxProvider } from '@olympus-ai/sandbox';
import type { AdmissionRecord, AdmissionRefusal, AdmittedArtifact, EvidenceBundle, ResumeRefusal, Vault } from '@olympus-ai/vault';
import { worstCaseCost, type WorstCaseCost } from './cost.js';
import { problemCodes, recordDecision } from './decisions.js';
import { runLine, type LineContext } from './line.js';
import { unsafeComponents, type UnsafeDeclaration } from './safety.js';
import { acceptedEscalations } from './tamper.js';
import { parseGraph, parseManifest, requestProblems, type RequestProblem } from './validate.js';
import { basePath, discardRun, snapshotBase, treeDigest, within, type WorkspaceStore } from './workspace.js';

export interface ComponentGraph {
  readonly vault: Vault;
  readonly sandbox: SandboxProvider;
  /** Runs build tasks. */
  readonly driver: Driver;
  /**
   * Runs review tasks. At L3 its model family must differ from every
   * author's, or the seat is refused (I6). Below L3 it may be the same driver,
   * and run state records the seat's independence as reduced.
   */
  readonly reviewer: Driver;
  /**
   * Where the run's trees live: its base, each task's copies, and the trees
   * the checks run over. Runtime-owned and never mounted except as one task's
   * workspace or one verification's read-only tree (D-P6-02).
   */
  readonly workspaces: WorkspaceStore;
}

/** Workspace-relative paths. Each is hashed at admission and locked by its station: `spec`, then `test-design` (tests and manifest), then `plan` (graph). */
export interface RequestedArtifacts {
  readonly spec: readonly string[];
  readonly acceptanceTests: readonly string[];
  /** JSON: `{ "checks": CheckSpec[] }`. */
  readonly verificationManifest: string;
  /** JSON: `{ "tasks": [{ id, station, role, dependsOn, dependencySet }] }`. */
  readonly taskGraph: string;
}

export interface RunRequest {
  readonly runId: RunId;
  /** Evidence binds to it; a fixture supplies a literal. */
  readonly baseCommit: string;
  readonly requestedLevel: AutonomyLevel;
  /** Absolute path: the Workspace mount source, and the tree the Vault resolves locked paths against. */
  readonly workspace: string;
  readonly artifacts: RequestedArtifacts;
  /** A resolved Policy, validated again here all the same. `loadPolicyFile` is how a service reads one from disk. */
  readonly policy: Policy;
  readonly components: ComponentGraph;
  /**
   * The worst-case cost a person approved, in dollars, or null. Above L0 it
   * must equal the figure admission computes, or the run is refused before
   * anything is written; the refusal carries the figure to approve (D-P9-03).
   */
  readonly approvedCostUsd: number | null;
}

/** What a caller of the line may observe and ask of it while it drives. Neither can change what is committed. */
export interface DriveHooks {
  /** Asked between steps; a cancellation returned is committed by the line and the run stops (A-P9-01). */
  readonly cancelRequested?: () => RunCancellation | null;
  /** Told of every committed state, in order. */
  readonly onCommit?: (state: RunState) => void;
}

/** Deliberately no level, policy, or artifacts: a resume reads them from the run's admission record (A-P4-03). */
export interface ResumeRequest {
  readonly runId: RunId;
  readonly components: ComponentGraph;
}

export interface ApprovalRequest {
  readonly runId: RunId;
  readonly key: ApprovalKey;
  /** Recorded as given. Authenticating who this is belongs to the API that calls this function (P9). */
  readonly approvedBy: string;
  readonly vault: Vault;
}

/**
 * Every way a call to drive a run ends. The refusals before the line carry
 * what a caller needs to act on. A refusal on the line carries the machine's
 * own typed transition and the state the run was left in, or null when it was
 * refused before its first state.
 */
export type RunOutcome =
  /** The run has passed every M1 station's exit gate. */
  | { readonly ok: true; readonly state: RunState }
  | {
      readonly ok: false;
      readonly reason: 'unsafe-above-l1';
      readonly requestedLevel: AutonomyLevel;
      readonly unsafe: readonly UnsafeDeclaration[];
    }
  | { readonly ok: false; readonly reason: 'invalid-request'; readonly problems: readonly RequestProblem[] }
  | {
      readonly ok: false;
      readonly reason: 'cost-unapproved';
      readonly requestedLevel: AutonomyLevel;
      /** The figure to approve, and what makes it up. */
      readonly worstCase: WorstCaseCost;
      readonly approvedCostUsd: number | null;
    }
  | {
      readonly ok: false;
      readonly reason: 'controls-unavailable';
      readonly requestedLevel: AutonomyLevel;
      /** Every control the run's adapter set lacks, as the admission record holds them. */
      readonly unavailable: readonly string[];
    }
  | {
      readonly ok: false;
      readonly reason: 'policy-refused';
      readonly station: StationId;
      /** The role resolved at the station, or null at a station no role acts at. */
      readonly role: RoleId | null;
      readonly refusal: PolicyRefusal;
    }
  | {
      readonly ok: false;
      readonly reason: 'refused';
      readonly at: StationId;
      readonly transition: StationRefusal;
      readonly state: RunState | null;
    };

/** A run admitted and recorded, not yet driven. */
export interface AdmittedRun {
  readonly state: RunState;
  readonly worstCase: WorstCaseCost;
  drive(hooks?: DriveHooks): Promise<RunOutcome>;
}

export type AdmissionOutcome = { readonly ok: true; readonly admitted: AdmittedRun } | Exclude<RunOutcome, { ok: true }>;

export type ApprovalOutcome =
  | { readonly ok: true; readonly state: RunState }
  | { readonly ok: false; readonly reason: 'invalid-request'; readonly message: string }
  | { readonly ok: false; readonly reason: 'not-awaiting'; readonly message: string };

const engine = new StrictPolicyEngine();

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'unknown error';
}

/** The contract table is code, not input; a table that breaks its own rules is a defect, and nothing runs on it. */
function requireContractTable(): void {
  const problems = contractTableProblems(STATION_CONTRACTS);
  if (problems.length > 0) {
    throw new Error(`station contracts: ${problems.map((p) => `${p.station}: ${p.message}`).join('; ')}`);
  }
}

/** The policy as the runtime will use it: validated and re-resolved, never the caller's object (D-P3-09). */
function checkedPolicy(value: unknown): { ok: true; policy: Policy } | { ok: false; message: string } {
  const checked = validatePolicyDocument(value);
  if (!checked.ok) return { ok: false, message: formatDefects(checked.defects) };
  return { ok: true, policy: engine.resolvePolicy(checked.document) };
}

interface ReadArtifact {
  readonly admitted: AdmittedArtifact;
  readonly bytes: Uint8Array;
}

async function readArtifact(workspace: string, path: string): Promise<ReadArtifact | undefined> {
  try {
    const bytes = await readFile(resolve(workspace, path));
    return { admitted: { path, sha256: sha256(bytes) }, bytes };
  } catch {
    return undefined;
  }
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return parsed;
  } catch {
    return undefined;
  }
}

interface Admitted {
  readonly artifacts: AdmissionRecord['artifacts'];
  readonly graph: TaskGraph;
  readonly checks: CheckSpec[];
}

/** Reads and hashes every artifact, and parses the two the line executes, from the same bytes. */
async function admitArtifacts(req: RunRequest): Promise<{ ok: true; admitted: Admitted } | { ok: false; problems: RequestProblem[] }> {
  const problems: RequestProblem[] = [];
  const read = async (at: string, path: string): Promise<ReadArtifact | undefined> => {
    const artifact = await readArtifact(req.workspace, path);
    if (artifact === undefined) problems.push({ path: at, code: 'unreadable', message: `${at}: '${path}' cannot be read from the workspace` });
    return artifact;
  };
  const spec = await Promise.all(req.artifacts.spec.map((path, i) => read(`artifacts.spec[${String(i)}]`, path)));
  const tests = await Promise.all(req.artifacts.acceptanceTests.map((path, i) => read(`artifacts.acceptanceTests[${String(i)}]`, path)));
  const manifestFile = await read('artifacts.verificationManifest', req.artifacts.verificationManifest);
  const graphFile = await read('artifacts.taskGraph', req.artifacts.taskGraph);
  if (problems.length > 0 || manifestFile === undefined || graphFile === undefined) return { ok: false, problems };

  const manifestJson = parseJson(manifestFile.bytes);
  const graphJson = parseJson(graphFile.bytes);
  if (manifestJson === undefined) problems.push({ path: 'artifacts.verificationManifest', code: 'not-json', message: 'the verification manifest is not JSON' });
  if (graphJson === undefined) problems.push({ path: 'artifacts.taskGraph', code: 'not-json', message: 'the task graph is not JSON' });
  const manifest = parseManifest(manifestJson);
  const graph = parseGraph(graphJson, { runId: req.runId, baseCommit: req.baseCommit, workspace: req.workspace });
  if (manifestJson !== undefined && !manifest.ok) problems.push(...manifest.problems);
  if (graphJson !== undefined && !graph.ok) problems.push(...graph.problems);
  if (problems.length > 0 || !manifest.ok || !graph.ok) return { ok: false, problems };

  const admittedOf = (files: ReadonlyArray<ReadArtifact | undefined>): AdmittedArtifact[] =>
    files.flatMap((file) => (file === undefined ? [] : [file.admitted]));
  return {
    ok: true,
    admitted: {
      artifacts: {
        spec: admittedOf(spec),
        acceptanceTests: admittedOf(tests),
        verificationManifest: manifestFile.admitted,
        taskGraph: graphFile.admitted,
      },
      graph: graph.graph,
      checks: manifest.checks,
    },
  };
}

/**
 * I5: an L3 run is refused while any control is unavailable, naming each one,
 * and a run below L3 is not refused here. Read from the admission record, so
 * a resume holds the run to what admission found rather than to what its
 * caller says now (D-P8-03).
 */
export function admissionRefusal(record: AdmissionRecord): Extract<RunOutcome, { reason: 'controls-unavailable' }> | undefined {
  const level = record.run.requestedLevel;
  if (level < 3 || record.unavailableControls.length === 0) return undefined;
  return { ok: false, reason: 'controls-unavailable', requestedLevel: level, unavailable: [...record.unavailableControls] };
}

/**
 * The controls the base's adapter set lacks: what the set reports, and what
 * its empty slots show whether it reports them or not. The same union the
 * adapters' own refusal takes, so what is recorded is what that refusal
 * would name (D-P8-03).
 */
async function unavailableControls(base: string, level: AutonomyLevel): Promise<string[]> {
  const set = await buildAdapterSet(base, { provider: null, coverage: null });
  const unavailable = [...new Set([...set.unavailableControls(), ...missingControls(set)])].sort();
  const refusal = adapterAdmission(set, level);
  // The two derive from the same set; if they ever disagree the record would misstate the refusal.
  if (!refusal.ok && refusal.unavailable.join('\0') !== unavailable.join('\0')) {
    throw new Error('admission: the recorded controls and the adapters\' own refusal disagree');
  }
  return unavailable;
}

/** The workspace store's root may not overlap the workspace it snapshots: a task would then be handed a tree that holds its own history. */
function storeProblems(req: RunRequest): RequestProblem[] {
  const { root } = req.components.workspaces;
  if (!within(root, req.workspace) && !within(req.workspace, root)) return [];
  return [{ path: 'components.workspaces', code: 'overlaps', message: `the workspace store ${root} and the workspace ${req.workspace} overlap; each must lie outside the other` }];
}

/** The driver that runs a task at an agent station. */
function driverAt(station: 'build' | 'review', components: ComponentGraph): Driver {
  return station === 'build' ? components.driver : components.reviewer;
}

/** A capability refusal at either agent station, checked before anything is admitted, locked, or run (I5). */
function capabilityRefusalFor(components: ComponentGraph): { at: StationId; refusal: StationRefusal } | undefined {
  for (const station of ['build', 'review'] as const) {
    const refusal = capabilityRefusal(STATION_CONTRACTS[station], driverAt(station, components).capabilities());
    if (refusal !== undefined) return { at: station, refusal };
  }
  return undefined;
}

/**
 * I5: an over-request at any station the run will enter is refused at
 * admission, before anything is written. A station a role acts at is resolved
 * for every role the graph schedules there, which also refuses a role the
 * policy does not define or does not grant that station; a station no role
 * acts at is bounded by the global and station caps.
 */
function policyRefusal(level: AutonomyLevel, graph: TaskGraph, policy: Policy): Extract<RunOutcome, { reason: 'policy-refused' }> | undefined {
  for (const station of M1_STATIONS) {
    if (!isAgentStation(station)) {
      const refusal = stationCapRefusal(level, station, policy);
      if (refusal !== undefined) return { ok: false, reason: 'policy-refused', station, role: null, refusal };
      continue;
    }
    const roles = [...new Set(graph.tasks.filter((task) => task.station === station).map((task) => task.role))];
    for (const role of roles) {
      const autonomy = engine.resolveAutonomy(level, station, role, policy);
      if (!autonomy.ok) return { ok: false, reason: 'policy-refused', station, role, refusal: autonomy };
      const scope = engine.resolveCapabilities(role, station, policy);
      if (!scope.ok) return { ok: false, reason: 'policy-refused', station, role, refusal: scope };
    }
  }
  return undefined;
}

async function hasState(vault: Vault, runId: RunId): Promise<boolean> {
  try {
    await vault.readRunState(runId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Admits a run and drives it. Every refusal before the admission record is
 * written leaves nothing behind: no record, no state, no lock, no sandbox.
 */
export async function startRun(req: RunRequest): Promise<RunOutcome> {
  const admission = await admitRun(req);
  return admission.ok ? admission.admitted.drive() : admission;
}

/**
 * Admission alone: every check `startRun` makes, the record and the first
 * state written, and the line not yet started. A service answers its caller
 * here and drives the run after (D-P9-02).
 */
export async function admitRun(req: RunRequest): Promise<AdmissionOutcome> {
  requireContractTable();
  const outcome = await admission(req);
  if (outcome.ok) return outcome;
  // Recorded under the run id asked for, before the refusal is returned (D-P14-01, D-P14-07). A run id
  // that is not a non-empty string names nowhere to record it, and is refused with nothing recorded.
  if (!requestProblems(req).some((p) => p.path === 'runId')) {
    await recordDecision(
      { vault: req.components.vault, runId: req.runId, taskId: null, station: null },
      { cause: 'admission-refused', decidedBy: 'admission', refusal: admissionRefusalOf(outcome) },
    );
  }
  return outcome;
}

/** A refused admission as the enforcement record holds it: the typed fields a reader counts by, and no caller text. */
function admissionRefusalOf(outcome: Exclude<AdmissionOutcome, { ok: true }>): AdmissionRefusal {
  switch (outcome.reason) {
    case 'invalid-request':
      return problemCodes(outcome.problems);
    case 'unsafe-above-l1':
      return { reason: 'unsafe-above-l1', requestedLevel: outcome.requestedLevel, components: outcome.unsafe.map((u) => u.component) };
    case 'cost-unapproved':
      return { reason: 'cost-unapproved', requestedLevel: outcome.requestedLevel, worstCaseUsd: outcome.worstCase.usd, approvedCostUsd: outcome.approvedCostUsd };
    case 'controls-unavailable':
      return { reason: 'controls-unavailable', requestedLevel: outcome.requestedLevel, unavailable: outcome.unavailable };
    case 'policy-refused':
      return { reason: 'policy-refused', station: outcome.station, role: outcome.role, refusal: outcome.refusal };
    case 'refused':
      return { reason: 'refused', at: outcome.at, refusal: outcome.transition };
  }
}

/** Every check admission makes, in order; `admitRun` records whichever refuses. */
async function admission(req: RunRequest): Promise<AdmissionOutcome> {
  const problems = [...requestProblems(req), ...storeProblems(req)];
  if (problems.length > 0) return { ok: false, reason: 'invalid-request', problems };

  const unsafe = unsafeComponents(req.components);
  if (unsafe.length > 0 && req.requestedLevel > 1) {
    return { ok: false, reason: 'unsafe-above-l1', requestedLevel: req.requestedLevel, unsafe };
  }
  const policy = checkedPolicy(req.policy);
  if (!policy.ok) return { ok: false, reason: 'invalid-request', problems: [{ path: 'policy', code: 'invalid-policy', message: policy.message }] };
  const admitted = await admitArtifacts(req);
  if (!admitted.ok) return { ok: false, reason: 'invalid-request', problems: admitted.problems };

  const capability = capabilityRefusalFor(req.components);
  if (capability !== undefined) return { ok: false, reason: 'refused', at: capability.at, transition: capability.refusal, state: null };
  const refused = policyRefusal(req.requestedLevel, admitted.admitted.graph, policy.policy);
  if (refused !== undefined) return refused;
  const worstCase = worstCaseCost(admitted.admitted.graph, policy.policy);
  if (req.requestedLevel > 0 && req.approvedCostUsd !== worstCase.usd) {
    return { ok: false, reason: 'cost-unapproved', requestedLevel: req.requestedLevel, worstCase, approvedCostUsd: req.approvedCostUsd };
  }

  const { vault } = req.components;
  if (await hasState(vault, req.runId)) {
    return {
      ok: false,
      reason: 'invalid-request',
      problems: [{ path: 'runId', code: 'already-admitted', message: `run ${req.runId} was admitted before; resume it, do not start it again` }],
    };
  }

  // The base is what every workspace is built from, so it is taken before anything is recorded,
  // and discarded if admission refuses after it: a refusal leaves nothing behind.
  const { workspaces } = req.components;
  const baseTreeSha256 = await snapshotBase(workspaces, req.runId, req.workspace);
  const controls = await unavailableControls(basePath(workspaces, req.runId), req.requestedLevel);

  const now = new Date().toISOString();
  const run: Run = {
    id: req.runId,
    repo: req.workspace,
    baseCommit: req.baseCommit,
    trigger: { kind: 'human', eventId: req.runId, lineage: { depth: 0, chain: [], windowStart: now } },
    requestedLevel: req.requestedLevel,
    station: 'intake',
    graph: null,
    createdAt: now,
  };
  const record: AdmissionRecord = {
    run,
    policy: policy.policy,
    artifacts: admitted.admitted.artifacts,
    baseTreeSha256,
    unavailableControls: controls,
  };
  const refusedControls = admissionRefusal(record);
  if (refusedControls !== undefined) {
    await discardRun(workspaces, req.runId);
    return refusedControls;
  }
  const admission = await vault.recordAdmission(record);
  const state = await vault.commitRunState(
    {
      runId: req.runId,
      admission,
      station: 'intake',
      phase: 'working',
      tasks: {},
      attempts: {},
      results: {},
      evidenceRefs: [],
      violations: [],
      approvals: [],
      reviews: [],
      usage: [],
      cancelled: null,
      halted: null,
      version: '0',
    },
    '0',
  );
  return {
    ok: true,
    admitted: {
      state,
      worstCase,
      drive: (hooks: DriveHooks = {}) => runLine({
        run,
        policy: policy.policy,
        artifacts: record.artifacts,
        graph: admitted.admitted.graph,
        checks: admitted.admitted.checks,
        components: req.components,
        baseTreeSha256,
        state,
        ...hooks,
      }),
    },
  };
}

/**
 * The admission record, read back and checked in full: a record that does not
 * hold what the line reads is refused, not trusted (D-P1-12).
 */
async function readAdmission(vault: Vault, state: RunState): Promise<{ record: AdmissionRecord; policy: Policy }> {
  const parsed = parseJson(await vault.read(state.admission));
  const r = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Partial<Record<keyof AdmissionRecord, unknown>>;
  const run = r.run as Partial<Run> | undefined;
  const artifacts = r.artifacts as Partial<AdmissionRecord['artifacts']> | undefined;
  const shaped =
    typeof run === 'object' && run.id === state.runId && typeof run.repo === 'string' && typeof run.baseCommit === 'string' &&
    typeof run.requestedLevel === 'number' && typeof artifacts === 'object' &&
    Array.isArray(artifacts.spec) && Array.isArray(artifacts.acceptanceTests) &&
    typeof artifacts.verificationManifest === 'object' && typeof artifacts.taskGraph === 'object' &&
    typeof r.baseTreeSha256 === 'string' && Array.isArray(r.unavailableControls) &&
    r.unavailableControls.every((control) => typeof control === 'string');
  if (!shaped) throw new Error(`run ${state.runId}: the admission record does not hold a run and its artifacts; refusing to resume from it`);
  const policy = checkedPolicy(r.policy);
  if (!policy.ok) throw new Error(`run ${state.runId}: the admitted policy no longer validates; refusing to resume under it:\n${policy.message}`);
  return { record: r as AdmissionRecord, policy: policy.policy };
}

interface Reloaded {
  readonly graph: TaskGraph;
  readonly checks: CheckSpec[];
  /** Artifacts whose bytes no longer hash to what was admitted. */
  readonly changed: Array<{ path: string; expected: string; actual: string }>;
}

/** Re-reads the manifest and the graph from the workspace and checks each against its admission hash before parsing it. */
async function reloadExecuted(record: AdmissionRecord): Promise<Reloaded> {
  const changed: Reloaded['changed'] = [];
  const load = async (admitted: AdmittedArtifact): Promise<unknown> => {
    const read = await readArtifact(record.run.repo, admitted.path);
    const actual = read === undefined ? 'missing' : read.admitted.sha256;
    if (actual !== admitted.sha256) changed.push({ path: admitted.path, expected: admitted.sha256, actual });
    return read === undefined ? undefined : parseJson(read.bytes);
  };
  const manifestJson = await load(record.artifacts.verificationManifest);
  const graphJson = await load(record.artifacts.taskGraph);
  if (changed.length > 0) return { graph: { tasks: [], edges: [] }, checks: [], changed };
  const manifest = parseManifest(manifestJson);
  const graph = parseGraph(graphJson, { runId: record.run.id, baseCommit: record.run.baseCommit, workspace: record.run.repo });
  // The bytes hash to what admission validated, so these cannot fail unless the validator itself changed.
  if (!manifest.ok || !graph.ok) throw new Error(`run ${record.run.id}: the admitted manifest or graph no longer validates; refusing to resume`);
  return { graph: graph.graph, checks: manifest.checks, changed };
}

/**
 * Drives an admitted run from its last committed state. The level, the
 * policy, and the artifacts come from the admission record, never from the
 * caller, so a resume can neither raise its level nor reset a bound; only the
 * components are the caller's, and they are held to the same safety and
 * capability checks as at admission.
 */
export async function resumeRun(req: ResumeRequest, hooks: DriveHooks = {}): Promise<RunOutcome> {
  requireContractTable();
  const { vault } = req.components;
  const state = await vault.readRunState(req.runId);
  const { record, policy } = await readAdmission(vault, state);
  const level = record.run.requestedLevel;

  // Admission's own checks, repeated: a refusal here is recorded as a resume refusal, by admission (D-P14-11).
  const resumeRefused = async (refusal: ResumeRefusal): Promise<void> => {
    await recordDecision({ vault, runId: req.runId, taskId: null, station: null }, { cause: 'resume-refused', decidedBy: 'admission', refusal });
  };
  const unsafe = unsafeComponents(req.components);
  if (unsafe.length > 0 && level > 1) {
    await resumeRefused({ reason: 'unsafe-above-l1', requestedLevel: level, components: unsafe.map((u) => u.component) });
    return { ok: false, reason: 'unsafe-above-l1', requestedLevel: level, unsafe };
  }
  // Not recorded: admission refuses this record before any state exists, so no run reaches a resume with it.
  const controls = admissionRefusal(record);
  if (controls !== undefined) return controls;
  const capability = capabilityRefusalFor(req.components);
  if (capability !== undefined) {
    await resumeRefused({ reason: 'refused', at: capability.at, refusal: capability.refusal });
    return { ok: false, reason: 'refused', at: capability.at, transition: capability.refusal, state };
  }
  // The base every workspace is built from must be the one admission recorded. A store that lost
  // it, or holds another run's, is refused rather than built on.
  const base = await treeDigest(basePath(req.components.workspaces, req.runId)).catch(() => 'missing');
  if (base !== record.baseTreeSha256) {
    throw new Error(`run ${req.runId}: the workspace store's base is ${base}, not the ${record.baseTreeSha256} admission recorded; refusing to resume on it`);
  }

  const reloaded = await reloadExecuted(record);
  const ctx: LineContext = {
    run: record.run,
    policy,
    artifacts: record.artifacts,
    graph: reloaded.graph,
    checks: reloaded.checks,
    components: req.components,
    baseTreeSha256: record.baseTreeSha256,
    state,
    ...hooks,
  };
  if (reloaded.changed.length > 0) return runLine(ctx, reloaded.changed);
  return runLine(ctx);
}

/**
 * Records a human's approval of the exit the run is waiting at, and nothing
 * else. The key must be exactly the station the run is exiting and the level
 * it was admitted at, and the effective approval there must be
 * `human-required`: a `blocked` exit cannot be approved, an `auto` one needs no
 * approval, and a grant for any other station or level would be a standing
 * approval of something nobody has seen yet. A grant already recorded and not
 * yet spent is not duplicated; one already spent does not stand in for the
 * visit now waiting, so a rebuild is approved in its own right (A-P4-04).
 */
export async function approveStation(req: ApprovalRequest): Promise<ApprovalOutcome> {
  // Every refusal and every grant is recorded before it takes effect (D-P14-07). The key is kept only when it is one:
  // anything else is the caller's text.
  const key = isApprovalKey(req.key) ? req.key : null;
  const refuse = async (reason: 'invalid-request' | 'not-awaiting', message: string, station: StationId | null): Promise<ApprovalOutcome> => {
    // A run id that is not a non-empty string names nowhere to record the refusal.
    if (typeof req.runId === 'string' && req.runId !== '') {
      await recordDecision({ vault: req.vault, runId: req.runId, taskId: null, station }, { cause: 'approval-refused', decidedBy: 'approval', key, reason });
    }
    return { ok: false, reason, message };
  };
  if (typeof req.approvedBy !== 'string' || req.approvedBy.trim() === '') return refuse('invalid-request', 'approvedBy must name who approved', null);
  if (key === null) return refuse('invalid-request', `'${req.key}' is not a station:level approval key`, null);
  const state = await req.vault.readRunState(req.runId);
  const { record, policy } = await readAdmission(req.vault, state);
  const level = record.run.requestedLevel;
  const { graph, changed } = await reloadExecuted(record);
  if (changed.length > 0) return refuse('not-awaiting', `run ${req.runId} has an admitted artifact that changed; it is not awaiting approval`, state.station);

  const step = nextStep(state, graph);
  const expected = approvalKey(state.station, level);
  // A spent grant for the last exit is a run that passed; there is nothing left to approve.
  const passed = step.kind === 'exit' && !M1_STATIONS.includes(step.to) && state.approvals.some((grant) => grant.key === expected && grant.usedAt !== null);
  const awaiting =
    step.kind === 'exit' && !passed && !isBackward(step.from, step.to) && key === expected &&
    effectiveApproval(STATION_CONTRACTS[state.station], policy, level, []) === 'human-required' &&
    !state.approvals.some((grant) => grant.key === expected && grant.usedAt === null);
  if (!awaiting) {
    return refuse('not-awaiting', `run ${req.runId} is not waiting for an approval of ${key}; it is ${state.phase} at ${state.station} at L${String(level)}`, state.station);
  }
  // Written before the grant is committed, so a grant never exists without its record; a write that fails throws and grants nothing.
  await recordDecision(
    { vault: req.vault, runId: req.runId, taskId: null, station: state.station },
    { cause: 'approval-granted', decidedBy: 'approval', key, principal: req.approvedBy },
  );
  try {
    const next = await req.vault.commitRunState(
      { ...state, approvals: [...state.approvals, { key, approvedBy: req.approvedBy, approvedAt: new Date().toISOString(), usedAt: null }] },
      state.version,
    );
    return { ok: true, state: next };
  } catch (error) {
    // The grant's record stands beside this refusal: it was decided, and did not take effect.
    return refuse('not-awaiting', `run ${req.runId} moved while the approval was recorded: ${describe(error)}`, state.station);
  }
}

/**
 * Where a run stands, derived from its committed state by the rules the line
 * itself follows (I2). Nothing a model wrote is an input.
 *
 * - `passed`: every M1 exit gate is crossed; a resume would return at once.
 * - `stopped`: the line refuses to continue, and says why.
 * - `awaiting-approval`: the next exit needs a human's approval of `key`.
 * - `open`: there is work left, and a drive would do it.
 */
export type RunStanding =
  | { readonly standing: 'passed' }
  | { readonly standing: 'stopped'; readonly refusal: StationRefusal }
  | { readonly standing: 'awaiting-approval'; readonly key: ApprovalKey }
  | { readonly standing: 'open' };

/** The station whose exit ends an M1 run. */
const LAST_STATION: StationId = M1_STATIONS[M1_STATIONS.length - 1] ?? 'integrate';

export async function runStanding(vault: Vault, runId: RunId): Promise<{ state: RunState; standing: RunStanding }> {
  const state = await vault.readRunState(runId);
  const { record, policy } = await readAdmission(vault, state);
  // What was committed is read before what the workspace holds now. A cancellation, a halt, and the grant
  // spent in the commit that ended a passed run, are records an artifact edited afterwards does not
  // undo; re-hashed first, a later edit would report either run as tampered (P9 review, codex-3).
  if (state.cancelled !== null || state.halted !== null) {
    // `nextStep` refuses a cancelled or halted run before any other check, so no graph is needed to read why (A-P9-01, A-P9-02).
    const ended = nextStep(state, { tasks: [], edges: [] });
    if (ended.kind === 'refuse') return { state, standing: { standing: 'stopped', refusal: ended.refusal } };
  }
  // The last exit is crossed only by a run that passed, and when it needs an approval the line
  // spends the grant in the commit that ends the run. A spent grant for it is that record; the
  // gate re-evaluated would ask for a second approval of an exit already crossed (D-P9-08).
  const last = approvalKey(LAST_STATION, record.run.requestedLevel);
  if (state.approvals.some((grant) => grant.key === last && grant.usedAt !== null)) return { state, standing: { standing: 'passed' } };
  const { graph, changed } = await reloadExecuted(record);
  if (changed.length > 0) {
    const paths = changed.map((c) => c.path).join(', ');
    return { state, standing: { standing: 'stopped', refusal: { ok: false, reason: 'lock-tamper', tampered: changed, message: `an admitted artifact changed: ${paths}` } } };
  }
  const step = nextStep(state, graph);
  if (step.kind === 'refuse') return { state, standing: { standing: 'stopped', refusal: step.refusal } };
  if (step.kind !== 'exit') return { state, standing: { standing: 'open' } };
  const verdict = locksHeldLeaving(step.from) ? await vault.verifyLocks(runId) : { ok: true as const };
  // The same escalation the line applies, from the same bundles, so the standing and a drive agree.
  const escalations = step.from === 'integrate'
    ? await acceptedEscalations(state, async (ref) => JSON.parse(new TextDecoder().decode(await vault.read(ref))) as EvidenceBundle)
    : { protectedPathsTouched: [], tamperFindings: [] };
  const next = transition({
    from: step.from,
    to: step.to,
    level: record.run.requestedLevel,
    policy,
    tampered: verdict.ok ? [] : verdict.tampered.map((t) => ({ ...t })),
    grants: state.approvals,
    protectedPathsTouched: escalations.protectedPathsTouched,
    tamperFindings: escalations.tamperFindings,
  });
  if (!next.ok) {
    return { state, standing: next.reason === 'approval-required' ? { standing: 'awaiting-approval', key: next.key } : { standing: 'stopped', refusal: next } };
  }
  return { state, standing: M1_STATIONS.includes(next.next) ? { standing: 'open' } : { standing: 'passed' } };
}

export interface CancelRequest {
  readonly runId: RunId;
  /** Recorded as given; the service that calls this authenticated it (D-P9-06). */
  readonly by: string;
  readonly vault: Vault;
}

export type CancelOutcome =
  | { readonly ok: true; readonly state: RunState }
  | { readonly ok: false; readonly reason: 'invalid-request'; readonly message: string }
  | { readonly ok: false; readonly reason: 'finished'; readonly standing: RunStanding; readonly message: string };

/**
 * Cancels a run nothing is driving, by committing the record the station
 * machine refuses on (A-P9-01). A run that has passed or stopped is refused,
 * not reported cancelled: there is nothing left to stop, and a success would
 * say otherwise. A run being driven is cancelled through `DriveHooks`, by the
 * line, never by a second writer racing it.
 */
export async function cancelRun(req: CancelRequest): Promise<CancelOutcome> {
  if (typeof req.by !== 'string' || req.by.trim() === '') return { ok: false, reason: 'invalid-request', message: 'by must name who cancelled' };
  const { state, standing } = await runStanding(req.vault, req.runId);
  if (standing.standing === 'passed' || standing.standing === 'stopped') {
    return { ok: false, reason: 'finished', standing, message: `run ${req.runId} is ${standing.standing}; there is nothing to cancel` };
  }
  try {
    const next = await req.vault.commitRunState({ ...state, cancelled: { by: req.by, at: new Date().toISOString() } }, state.version);
    return { ok: true, state: next };
  } catch (error) {
    return { ok: false, reason: 'invalid-request', message: `run ${req.runId} moved while the cancellation was recorded: ${describe(error)}` };
  }
}
