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
  M1_STATIONS,
  nextStep,
  STATION_CONTRACTS,
  stationCapRefusal,
  StrictPolicyEngine,
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
  RunId,
  RunState,
  StationId,
  StationRefusal,
  TaskGraph,
} from '@olympus-ai/core';
import type { CheckSpec } from '@olympus-ai/integrity';
import type { SandboxProvider } from '@olympus-ai/sandbox';
import type { AdmissionRecord, AdmittedArtifact, Vault } from '@olympus-ai/vault';
import { runLine, type LineContext } from './line.js';
import { unsafeComponents, type UnsafeDeclaration } from './safety.js';
import { parseGraph, parseManifest, requestProblems, type RequestProblem } from './validate.js';

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
  /** A resolved Policy. This unit reads no policy file (P9 loads one); the value is validated again here all the same. */
  readonly policy: Policy;
  readonly components: ComponentGraph;
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
  requireContractTable();
  const problems = requestProblems(req);
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

  const { vault } = req.components;
  if (await hasState(vault, req.runId)) {
    return {
      ok: false,
      reason: 'invalid-request',
      problems: [{ path: 'runId', code: 'already-admitted', message: `run ${req.runId} was admitted before; resume it, do not start it again` }],
    };
  }

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
  const record: AdmissionRecord = { run, policy: policy.policy, artifacts: admitted.admitted.artifacts };
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
      version: '0',
    },
    '0',
  );
  return runLine({
    run,
    policy: policy.policy,
    artifacts: record.artifacts,
    graph: admitted.admitted.graph,
    checks: admitted.admitted.checks,
    components: req.components,
    state,
  });
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
    typeof artifacts.verificationManifest === 'object' && typeof artifacts.taskGraph === 'object';
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
export async function resumeRun(req: ResumeRequest): Promise<RunOutcome> {
  requireContractTable();
  const { vault } = req.components;
  const state = await vault.readRunState(req.runId);
  const { record, policy } = await readAdmission(vault, state);
  const level = record.run.requestedLevel;

  const unsafe = unsafeComponents(req.components);
  if (unsafe.length > 0 && level > 1) return { ok: false, reason: 'unsafe-above-l1', requestedLevel: level, unsafe };
  const capability = capabilityRefusalFor(req.components);
  if (capability !== undefined) return { ok: false, reason: 'refused', at: capability.at, transition: capability.refusal, state };

  const reloaded = await reloadExecuted(record);
  const ctx: LineContext = {
    run: record.run,
    policy,
    artifacts: record.artifacts,
    graph: reloaded.graph,
    checks: reloaded.checks,
    components: req.components,
    state,
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
 * approval of something nobody has seen yet.
 */
export async function approveStation(req: ApprovalRequest): Promise<ApprovalOutcome> {
  if (typeof req.approvedBy !== 'string' || req.approvedBy.trim() === '') {
    return { ok: false, reason: 'invalid-request', message: 'approvedBy must name who approved' };
  }
  if (!isApprovalKey(req.key)) return { ok: false, reason: 'invalid-request', message: `'${String(req.key)}' is not a station:level approval key` };
  const state = await req.vault.readRunState(req.runId);
  const { record, policy } = await readAdmission(req.vault, state);
  const level = record.run.requestedLevel;
  const { graph, changed } = await reloadExecuted(record);
  if (changed.length > 0) return { ok: false, reason: 'not-awaiting', message: `run ${req.runId} has an admitted artifact that changed; it is not awaiting approval` };

  const step = nextStep(state, graph);
  const expected = approvalKey(state.station, level);
  const awaiting =
    step.kind === 'exit' && !isBackward(step.from, step.to) && req.key === expected &&
    effectiveApproval(STATION_CONTRACTS[state.station], policy, level, []) === 'human-required' &&
    !state.approvals.some((grant) => grant.key === expected);
  if (!awaiting) {
    return {
      ok: false,
      reason: 'not-awaiting',
      message: `run ${req.runId} is not waiting for an approval of ${req.key}; it is ${state.phase} at ${state.station} at L${String(level)}`,
    };
  }
  try {
    const next = await req.vault.commitRunState(
      { ...state, approvals: [...state.approvals, { key: req.key, approvedBy: req.approvedBy, approvedAt: new Date().toISOString() }] },
      state.version,
    );
    return { ok: true, state: next };
  } catch (error) {
    return { ok: false, reason: 'not-awaiting', message: `run ${req.runId} moved while the approval was recorded: ${describe(error)}` };
  }
}
