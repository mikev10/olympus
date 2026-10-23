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
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import {
  approvalKey,
  capabilityRefusal,
  contractTableProblems,
  CRITIC_CONTRACTS,
  criticContractProblems,
  DRAFT_ROLES,
  DRAFT_STATIONS,
  effectiveApproval,
  grantClears,
  isDraftStation,
  formatDefects,
  isAgentStation,
  isApprovalKey,
  isBackward,
  locksHeldLeaving,
  draftsRejected,
  M1_STATIONS,
  nextStep,
  STATION_CONTRACTS,
  stationCapRefusal,
  StrictPolicyEngine,
  tierFor,
  transition,
  validatePolicyDocument,
} from '@olympus-ai/core';
import type {
  ApprovalKey,
  AutonomyLevel,
  CompiledRole,
  DraftCondition,
  DraftRef,
  DraftStation,
  Driver,
  RejectionReason,
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
  TaskId,
  VaultRef,
} from '@olympus-ai/core';
import { adapterAdmission, buildAdapterSet, missingControls, type AdapterSet } from '@olympus-ai/adapters';
import { compileRoles, type RoleFileRefusal } from '@olympus-ai/compiler';
import type { CheckSpec } from '@olympus-ai/integrity';
import type { SandboxProvider } from '@olympus-ai/sandbox';
import type { AdmissionRecord, AdmissionRefusal, AdmittedArtifact, AdmittedManifest, AdmittedSet, CriticRecord, DraftLockRecord, DraftRecord, EvidenceBundle, IntentRecord, ResumeRefusal, RubricRecord, RubricVersion, Vault } from '@olympus-ai/vault';
import { readUsage, unsettledCalls, worstCaseCost, type WorstCaseCost } from './cost.js';
import { estimateCost, type CostEstimate, type EstimateCell } from './outcomes.js';
import { problemCodes, recordDecision } from './decisions.js';
import { integrateEscalations, readIntegration, REVIEWER_ROLE, runLine, type LineArtifacts, type LineContext } from './line.js';
import { draftFloorOf, lockedArtifacts, NOT_DRAFTING, seatDriver, settleBase, type DraftingContext, type DraftingDrivers } from './drafting.js';
import { readRubrics, rubricsProblems, type ReadRubric } from './rubrics.js';
import { DRAFT_DIR, parseQuestions, parseRunRequirements, type RunRequirements } from './spec-parts.js';
import type { BuiltGraph } from './graph.js';
import { reachesRemote, type Integrator } from './integrate.js';
import { unsafeComponents, type UnsafeDeclaration } from './safety.js';
import { parseSecurityPart, type SecurityPart, type SecurityScanners } from './security.js';
import { mergedCheckProblems, parseGraph, parseManifest, requestProblems, securityProblems, type RequestProblem } from './validate.js';
import { suiteBindingProblems } from './verification.js';
import { basePath, discardRun, existsIn, snapshotBase, treeDigest, within, type WorkspaceStore } from './workspace.js';

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
  /**
   * Opens and merges the run's pull request at `integrate` (D-I1b-01). Absent,
   * the line stops at the passed exit and a human merges; the graph builder
   * declares that, so no such run goes above L1 (D-I1b-05).
   */
  readonly integrator?: Integrator | null;
  /** The scanners security checks run (R17); the graph builder supplies the declared ones when omitted. */
  readonly scanners?: SecurityScanners;
  /**
   * The drivers that seat each drafter and each critic (R19). Required of a
   * run that drafts anything, and never inferred from `driver` or `reviewer`:
   * which seat runs on which model is what the independence grades compare.
   */
  readonly drafting?: DraftingDrivers | null;
}

/**
 * Workspace-relative paths. Each is hashed at admission and locked by its
 * station: `spec`, then `test-design` (tests and manifests), then `plan`
 * (graph). The spec and the acceptance tests may instead be `'draft'`: the
 * run drafts them on the line, and locks what is approved (R19).
 */
export interface RequestedArtifacts {
  readonly spec: readonly string[] | 'draft';
  readonly acceptanceTests: readonly string[] | 'draft';
  /**
   * JSON: `{ "checks": CheckSpec[] }`, the acceptance tests' checks beside the
   * verification manifest's, locked with the tests (R19). Optional with
   * supplied tests, whose checks may stay in the verification manifest; never
   * named with drafted tests, which draft their own.
   */
  readonly acceptanceManifest?: string;
  /** JSON: `{ "checks": CheckSpec[] }`. */
  readonly verificationManifest: string;
  /** JSON: `{ "tasks": [{ id, station, role, dependsOn, dependencySet }] }`. */
  readonly taskGraph: string;
  /**
   * The parts of a supplied spec, each a JSON file locked with it at `spec`.
   * The security part (R17): left out, it is admitted, and refused at the
   * `spec` exit, naming it. The run requirements and the questions (R19):
   * optional, except that drafted tests need the run requirements.
   */
  readonly specParts?: { readonly security?: string; readonly runRequirements?: string; readonly questions?: string };
}

/**
 * A person's intent for a run that drafts its spec: free text, from the
 * human principal's channel and nothing else (R19, I7). A trigger's payload
 * is never one; `from` says so in the type.
 */
export interface Intent {
  readonly text: string;
  readonly from: 'principal';
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
  /**
   * Absolute path of the roles directory on the host: one `<role-id>.md` per
   * role (D-A-RC-01). Read and compiled here, at admission, and pinned in the
   * admission record. No sandbox mounts it, and it may lie inside neither the
   * workspace nor the workspace store, so no agent edits its own
   * instructions or another's (I1).
   */
  readonly roles: string;
  /** Only a graph `buildGraph` made: provenance is read when it is built, never from a graph handed in (D-A-I1-05). */
  readonly components: BuiltGraph;
  /**
   * The intent a spec-less run is drafted from (R19). Required exactly when
   * `artifacts.spec` is `'draft'`: a run with neither a spec nor an intent,
   * or with both, is refused.
   */
  readonly intent?: Intent | null;
  /**
   * Absolute path of the rubrics directory on the host: `spec.md` and
   * `test-design.md`, each a person's rubric for that station's critic (R19).
   * Read at admission for each station the run drafts, held in the Vault, and
   * kept for the run. Like the roles directory, it may lie inside neither the
   * workspace nor the workspace store.
   */
  readonly rubrics?: string | null;
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
  readonly components: BuiltGraph;
}

export interface ApprovalRequest {
  readonly runId: RunId;
  readonly key: ApprovalKey;
  /**
   * The hash of the draft approved, at a drafted exit; absent or null at any
   * other. An approval naming another draft than the one waiting is refused,
   * so an approval of one draft never clears another (R19).
   */
  readonly draft?: string | null;
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
      /** What past runs say this one will likely cost, beside the bound and never in its place (R2). */
      readonly likely: CostEstimate;
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
  /** The roles directory did not compile: every entry the compiler refused, each named (D-A-RC-02). */
  | { readonly ok: false; readonly reason: 'roles-refused'; readonly refused: readonly RoleFileRefusal[] }
  /**
   * A seat with no role: the roles the task graph names, and `reviewer`, that
   * the directory does not define. The CLI's default prompt is never a
   * fallback (D-A-RC-06).
   */
  | { readonly ok: false; readonly reason: 'role-undefined'; readonly roles: readonly RoleId[] }
  | {
      readonly ok: false;
      readonly reason: 'refused';
      readonly at: StationId;
      readonly transition: StationRefusal;
      readonly state: RunState | null;
    }
  | {
      readonly ok: false;
      /** A resume only: a call was made and what it cost was lost, so the run is not driven on top of it (A-I1a-06). */
      readonly reason: 'meter-lost';
      readonly tasks: readonly TaskId[];
      readonly state: RunState;
    };

/** A run admitted and recorded, not yet driven. */
export interface AdmittedRun {
  readonly state: RunState;
  readonly worstCase: WorstCaseCost;
  drive(hooks?: DriveHooks): Promise<RunOutcome>;
}

export type AdmissionOutcome = { readonly ok: true; readonly admitted: AdmittedRun } | Exclude<RunOutcome, { ok: true } | { reason: 'meter-lost' }>;

export type ApprovalOutcome =
  | { readonly ok: true; readonly state: RunState }
  | { readonly ok: false; readonly reason: 'invalid-request'; readonly message: string }
  | { readonly ok: false; readonly reason: 'not-awaiting'; readonly message: string }
  /** The approval named another draft, or the draft waiting carries problems the runtime would refuse to lock (R19). */
  | { readonly ok: false; readonly reason: 'draft-mismatch' | 'draft-invalid'; readonly message: string };

/**
 * A person's rejection of the draft waiting at a drafting station's exit
 * (R19). At `spec` it may carry notes, which reach the next attempt as the
 * approver's words in its variable suffix; at `test-design` it carries a
 * reason from a fixed set and no text, since an approver who has read the
 * repository would otherwise be a channel around the black box (D-A-DS-02).
 */
export interface RejectionRequest {
  readonly runId: RunId;
  readonly key: ApprovalKey;
  readonly draft: string;
  readonly rejectedBy: string;
  readonly notes?: string | null;
  readonly reason?: RejectionReason | null;
  readonly vault: Vault;
}

export type RejectionOutcome =
  | { readonly ok: true; readonly state: RunState; readonly parked: boolean }
  | { readonly ok: false; readonly reason: 'invalid-request' | 'not-awaiting' | 'draft-mismatch'; readonly message: string };

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
  const problems = [...contractTableProblems(STATION_CONTRACTS), ...criticContractProblems(CRITIC_CONTRACTS)];
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
  /** The verification manifest's checks and a supplied acceptance manifest's. */
  readonly checks: CheckSpec[];
  readonly securityPart: SecurityPart | null;
  readonly requirements: RunRequirements | null;
  readonly drafted: Readonly<Record<DraftStation, boolean>>;
}

/** The parsed value of a JSON part, or the problems that keep it from being one. */
function parsedPart<T>(
  file: ReadArtifact | undefined, at: string, label: string, parse: (value: unknown) => { ok: true; part: T } | { ok: false; problems: RequestProblem[] }, problems: RequestProblem[],
): T | null {
  if (file === undefined) return null;
  const json = parseJson(file.bytes);
  if (json === undefined) {
    problems.push({ path: at, code: 'not-json', message: `the ${label} is not JSON` });
    return null;
  }
  const parsed = parse(json);
  if (!parsed.ok) {
    problems.push(...parsed.problems);
    return null;
  }
  return parsed.part;
}

/**
 * Reads and hashes every supplied artifact, and parses the ones the line
 * reads, from the same bytes. A drafted artifact is recorded as drafted and
 * read nothing (R19).
 */
async function admitArtifacts(req: RunRequest): Promise<{ ok: true; admitted: Admitted } | { ok: false; problems: RequestProblem[] }> {
  const problems: RequestProblem[] = [];
  const read = async (at: string, path: string): Promise<ReadArtifact | undefined> => {
    const artifact = await readArtifact(req.workspace, path);
    if (artifact === undefined) problems.push({ path: at, code: 'unreadable', message: `${at}: '${path}' cannot be read from the workspace` });
    return artifact;
  };
  const readSet = async (list: 'spec' | 'acceptanceTests'): Promise<ReadArtifact[] | 'drafted'> => {
    const paths = req.artifacts[list];
    if (paths === 'draft') return 'drafted';
    const files = await Promise.all(paths.map((path, i) => read(`artifacts.${list}[${String(i)}]`, path)));
    return files.flatMap((file) => (file === undefined ? [] : [file]));
  };
  const spec = await readSet('spec');
  const tests = await readSet('acceptanceTests');
  const manifestFile = await read('artifacts.verificationManifest', req.artifacts.verificationManifest);
  const graphFile = await read('artifacts.taskGraph', req.artifacts.taskGraph);
  const acceptancePath = req.artifacts.acceptanceManifest;
  const acceptanceFile = acceptancePath === undefined ? undefined : await read('artifacts.acceptanceManifest', acceptancePath);
  const parts = req.artifacts.specParts ?? {};
  const securityFile = parts.security === undefined ? undefined : await read('artifacts.specParts.security', parts.security);
  const requirementsFile = parts.runRequirements === undefined ? undefined : await read('artifacts.specParts.runRequirements', parts.runRequirements);
  const questionsFile = parts.questions === undefined ? undefined : await read('artifacts.specParts.questions', parts.questions);
  if (problems.length > 0 || manifestFile === undefined || graphFile === undefined) return { ok: false, problems };

  const securityPart = parsedPart(securityFile, 'artifacts.specParts.security', 'security part', parseSecurityPart, problems);
  const requirements = parsedPart(requirementsFile, 'artifacts.specParts.runRequirements', 'run-requirements part', (v) => parseRunRequirements(v, 'artifacts.specParts.runRequirements'), problems);
  parsedPart(questionsFile, 'artifacts.specParts.questions', 'questions part', (v) => parseQuestions(v, 'artifacts.specParts.questions'), problems);

  const manifestJson = parseJson(manifestFile.bytes);
  const graphJson = parseJson(graphFile.bytes);
  if (manifestJson === undefined) problems.push({ path: 'artifacts.verificationManifest', code: 'not-json', message: 'the verification manifest is not JSON' });
  if (graphJson === undefined) problems.push({ path: 'artifacts.taskGraph', code: 'not-json', message: 'the task graph is not JSON' });
  // Beside an acceptance manifest, supplied or drafted, the two are held to a reproduction together (R19).
  const alone = acceptanceFile === undefined && tests !== 'drafted';
  const manifest = parseManifest(manifestJson, { alone });
  const graph = parseGraph(graphJson, { runId: req.runId, baseCommit: req.baseCommit, workspace: req.workspace });
  if (manifestJson !== undefined && !manifest.ok) problems.push(...manifest.problems);
  if (graphJson !== undefined && !graph.ok) problems.push(...graph.problems);
  let acceptanceChecks: CheckSpec[] = [];
  if (acceptanceFile !== undefined) {
    const json = parseJson(acceptanceFile.bytes);
    const parsed = parseManifest(json, { alone: false });
    if (json === undefined) problems.push({ path: 'artifacts.acceptanceManifest', code: 'not-json', message: 'the acceptance manifest is not JSON' });
    else if (!parsed.ok) problems.push(...parsed.problems.map((p) => ({ ...p, path: p.path.replace(/^manifest/, 'acceptanceManifest') })));
    else acceptanceChecks = parsed.checks;
  }
  if (problems.length > 0 || !manifest.ok || !graph.ok) return { ok: false, problems };
  if (acceptanceFile !== undefined) {
    const merged = mergedCheckProblems(manifest.checks, acceptanceChecks);
    if (merged.length > 0) return { ok: false, problems: merged };
  }

  const set = (files: ReadArtifact[] | 'drafted'): AdmittedSet => (files === 'drafted' ? { source: 'drafted' } : { source: 'supplied', files: files.map((f) => f.admitted) });
  const acceptanceManifest: AdmittedManifest = tests === 'drafted' ? { source: 'drafted' } : acceptanceFile === undefined ? { source: 'none' } : { source: 'supplied', file: acceptanceFile.admitted };
  return {
    ok: true,
    admitted: {
      artifacts: {
        spec: set(spec),
        acceptanceTests: set(tests),
        acceptanceManifest,
        verificationManifest: manifestFile.admitted,
        taskGraph: graphFile.admitted,
        specParts: { security: securityFile?.admitted ?? null, runRequirements: requirementsFile?.admitted ?? null, questions: questionsFile?.admitted ?? null },
      },
      graph: graph.graph,
      checks: [...manifest.checks, ...acceptanceChecks],
      securityPart,
      requirements,
      drafted: { spec: spec === 'drafted', 'test-design': tests === 'drafted' },
    },
  };
}

/** The stations a run drafts at, in line order. */
function draftedStations(drafted: Readonly<Record<DraftStation, boolean>>): DraftStation[] {
  return DRAFT_STATIONS.filter((station) => drafted[station]);
}

/**
 * Why a run's drafting cannot be admitted (R19): an intent where none is
 * drafted from or none where one is, drafting drivers missing, a drafts
 * directory the workspace already holds, and a test drafter or critic
 * granted egress, which would let it reach what the black box keeps from it.
 */
function draftingProblems(req: RunRequest, drafted: Readonly<Record<DraftStation, boolean>>, policy: Policy): RequestProblem[] {
  const problems: RequestProblem[] = [];
  const intent: unknown = req.intent ?? null;
  if (drafted.spec) {
    const i = intent as Partial<Intent> | null;
    if (i === null) problems.push({ path: 'intent', code: 'missing', message: 'a run that drafts its spec is drafted from a person\'s intent, and none was given' });
    else if (typeof i !== 'object' || typeof i.text !== 'string' || i.text.trim() === '' || i.from !== 'principal' || Object.keys(i).length !== 2) {
      problems.push({ path: 'intent', code: 'not-an-intent', message: 'an intent is a person\'s text from the principal\'s channel: { text, from: \'principal\' }' });
    } else if (Buffer.byteLength(i.text, 'utf8') > INTENT_MAX_BYTES) {
      problems.push({ path: 'intent', code: 'not-an-intent', message: `an intent is at most ${String(INTENT_MAX_BYTES)} bytes` });
    }
  } else if (intent !== null) {
    problems.push({ path: 'intent', code: 'not-applicable', message: 'an intent is what a spec is drafted from; a run admitted with its spec takes none' });
  }
  const stations = draftedStations(drafted);
  if (stations.length > 0 && (req.components.drafting ?? null) === null) {
    problems.push({ path: 'components.drafting', code: 'unseated', message: 'a run that drafts needs the drivers that seat each drafter and each critic; none is inferred from the build or review driver' });
  }
  if (stations.length > 0 && (req.rubrics ?? null) === null) {
    problems.push({ path: 'rubrics', code: 'unseated', message: 'a run that drafts needs the rubrics its critics check drafts against' });
  }
  if (drafted['test-design']) {
    for (const seat of ['drafter', 'critic'] as const) {
      const role = DRAFT_ROLES['test-design'][seat];
      const scope = Object.hasOwn(policy.roles, role) ? policy.roles[role] : undefined;
      const egress = scope?.network.egress;
      if (egress !== undefined && egress !== 'none' && egress.length > 0) {
        problems.push({ path: `policy.roles.${role}.network.egress`, code: 'not-black-box', message: `the ${role} is black-box in fact: it reaches the model through its relay and nothing else, so its egress is none` });
      }
    }
  }
  return problems;
}

/** The most bytes an intent may hold: it reaches the spec drafter in its prompt. */
const INTENT_MAX_BYTES = 32 * 1024;

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
function unavailableControls(set: AdapterSet, level: AutonomyLevel): string[] {
  const unavailable = [...new Set([...set.unavailableControls(), ...missingControls(set)])].sort();
  const refusal = adapterAdmission(set, level);
  // The two derive from the same set; if they ever disagree the record would misstate the refusal.
  if (!refusal.ok && refusal.unavailable.join('\0') !== unavailable.join('\0')) {
    throw new Error('admission: the recorded controls and the adapters\' own refusal disagree');
  }
  return unavailable;
}

/** The base's adapter set, its static-analysis slot holding the graph's scanner where the stack has one. */
export async function adapterSetOf(base: string, components: BuiltGraph): Promise<AdapterSet> {
  return buildAdapterSet(base, { provider: null, coverage: null, staticAnalysis: components.scanners.staticAnalysis });
}

/** The workspace store's root may not overlap the workspace it snapshots: a task would then be handed a tree that holds its own history. */
function storeProblems(req: RunRequest): RequestProblem[] {
  const { root } = req.components.workspaces;
  if (!within(root, req.workspace) && !within(req.workspace, root)) return [];
  return [{ path: 'components.workspaces', code: 'overlaps', message: `the workspace store ${root} and the workspace ${req.workspace} overlap; each must lie outside the other` }];
}

/** `path` with every link resolved, or as given where it cannot be: a directory that does not exist is refused when it is compiled. */
async function resolved(path: string): Promise<string> {
  return realpath(path).catch(() => resolve(path));
}

/**
 * The roles directory may lie inside neither the workspace nor the workspace
 * store, nor hold either: a copy of what is there is what a sandbox mounts,
 * and a role there is one an agent could rewrite. Compared with every link
 * resolved, so a link is no way around it (I1, D-R20-04).
 */
async function rolesProblems(req: RunRequest): Promise<RequestProblem[]> {
  if (typeof req.roles !== 'string' || req.roles === '' || !isAbsolute(req.roles)) {
    return [{ path: 'roles', code: 'not-absolute', message: 'roles must be the absolute path of the roles directory' }];
  }
  const roles = await resolved(req.roles);
  const places = [['workspace', req.workspace], ['workspace store', req.components.workspaces.root]] as const;
  for (const [name, place] of places) {
    const outer = await resolved(place);
    if (within(outer, roles) || within(roles, outer)) {
      return [{ path: 'roles', code: 'overlaps', message: `the roles directory ${req.roles} and the ${name} ${place} overlap; roles are read from the host, outside every tree a sandbox mounts` }];
    }
  }
  return [];
}

/**
 * The roles directory compiled, and every seat the graph schedules given a
 * role, before any driver is invoked (D-A-RC-06). Every role the graph names
 * is checked, and `reviewer` as well, since every review seat runs under it.
 */
async function admitRoles(
  directory: string, graph: TaskGraph, drafted: readonly DraftStation[],
): Promise<{ ok: true; roles: readonly CompiledRole[] } | Extract<AdmissionOutcome, { reason: 'roles-refused' | 'role-undefined' }>> {
  const compiled = await compileRoles(directory);
  if (!compiled.ok) return { ok: false, reason: 'roles-refused', refused: compiled.refused };
  const defined = new Set<string>(compiled.roles.map((r) => r.role));
  // Each seat a drafting station holds runs under its fixed role, or the run is refused (D-A-RC-06, R19).
  const seats = drafted.flatMap((station) => [DRAFT_ROLES[station].drafter, DRAFT_ROLES[station].critic]);
  const needed = [...new Set([...graph.tasks.map((t) => t.role), REVIEWER_ROLE, ...seats])].sort();
  const missing = needed.filter((role) => !defined.has(role));
  if (missing.length > 0) return { ok: false, reason: 'role-undefined', roles: missing };
  return { ok: true, roles: compiled.roles };
}

/** The driver that runs a graph task at `build` or `review`. */
function driverAt(station: 'build' | 'review', components: ComponentGraph): Driver {
  return station === 'build' ? components.driver : components.reviewer;
}

/** The driver of a worst-case task: a graph task's station driver, or a drafting seat's (R19). */
function driverOfTask(task: { station: StationId; role: RoleId }, components: ComponentGraph): Driver | undefined {
  if (task.station === 'build' || task.station === 'review') return driverAt(task.station, components);
  const drivers = components.drafting ?? null;
  if (!isDraftStation(task.station) || drivers === null) return undefined;
  const seat = DRAFT_ROLES[task.station].drafter === task.role ? 'drafter' : 'critic';
  return seatDriver(drivers, task.station, seat);
}

/**
 * The likely figure beside the worst case (R2): each task the worst case
 * counts, priced at the model its station's driver resolves the task's
 * starting tier to, from past runs' usage. Escalation is not modelled.
 */
async function likelyCost(components: ComponentGraph, worstCase: WorstCaseCost, policy: Policy): Promise<CostEstimate> {
  const cells: EstimateCell[] = [];
  for (const task of worstCase.tasks) {
    if (!isAgentStation(task.station)) continue;
    const resolved = engine.resolveCapabilities(task.role, task.station, policy);
    // `worstCaseCost` resolved every one of these scopes, and throws where one does not.
    if (!resolved.ok) throw new Error(`likely cost: role ${task.role} has no scope at ${task.station}: ${resolved.detail}`);
    const tier = tierFor(resolved.scope, task.station, { iterations: 0, retries: 0, starts: 0, conflicts: [] });
    const driver = driverOfTask(task, components);
    if (driver !== undefined) cells.push({ station: task.station, model: driver.resolveModel(tier) });
  }
  return estimateCost(components.vault, cells);
}

/**
 * A capability refusal at any station the run seats a driver at, checked
 * before anything is admitted, locked, or run (I5): `build`, `review`, and
 * each seat a drafting station holds (R19).
 */
function capabilityRefusalFor(components: ComponentGraph, drafted: readonly DraftStation[] = []): { at: StationId; refusal: StationRefusal } | undefined {
  for (const station of ['build', 'review'] as const) {
    const refusal = capabilityRefusal(STATION_CONTRACTS[station], driverAt(station, components).capabilities());
    if (refusal !== undefined) return { at: station, refusal };
  }
  const drivers = components.drafting ?? null;
  if (drivers === null) return undefined;
  for (const station of drafted) {
    const drafter = capabilityRefusal(STATION_CONTRACTS[station], seatDriver(drivers, station, 'drafter').capabilities());
    if (drafter !== undefined) return { at: station, refusal: drafter };
    const critic = capabilityRefusal({ ...STATION_CONTRACTS[station], requires: CRITIC_CONTRACTS[station].requires }, seatDriver(drivers, station, 'critic').capabilities());
    if (critic !== undefined) return { at: station, refusal: critic };
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
function policyRefusal(level: AutonomyLevel, graph: TaskGraph, policy: Policy, drafted: readonly DraftStation[] = []): Extract<RunOutcome, { reason: 'policy-refused' }> | undefined {
  for (const station of M1_STATIONS) {
    // A drafting station a run does not draft at seats no role, and is bounded by its caps alone (R19).
    const seated = isDraftStation(station) ? drafted.includes(station) : isAgentStation(station);
    if (!seated) {
      const refusal = stationCapRefusal(level, station, policy);
      if (refusal !== undefined) return { ok: false, reason: 'policy-refused', station, role: null, refusal };
      continue;
    }
    const roles = isDraftStation(station)
      ? [DRAFT_ROLES[station].drafter, DRAFT_ROLES[station].critic]
      : [...new Set(graph.tasks.filter((task) => task.station === station).map((task) => task.role))];
    for (const role of roles) {
      const autonomy = engine.resolveAutonomy(level, station, role, policy);
      if (!autonomy.ok) return { ok: false, reason: 'policy-refused', station, role, refusal: autonomy };
      const scope = engine.resolveCapabilities(role, station, policy);
      if (!scope.ok) return { ok: false, reason: 'policy-refused', station, role, refusal: scope };
    }
  }
  return undefined;
}

/**
 * No sandbox the line provisions may reach the git remote: the merge is the
 * runtime's, from the host, and an agent that could reach the remote could
 * push its own change (D-A-I1-07, D-I1b-05). The remote's domains are the
 * integrator's; with none, the remote is GitHub's.
 */
function remoteEgress(policy: Policy, integrator: Integrator | null): RequestProblem[] {
  const domains = integrator?.remoteDomains ?? ['github.com', 'githubusercontent.com'];
  const problems: RequestProblem[] = [];
  for (const [role, scope] of Object.entries(policy.roles)) {
    const egress = scope.network.egress;
    if (egress === 'none') continue;
    egress.forEach((host, i) => {
      if (reachesRemote(host, domains)) {
        problems.push({
          path: `policy.roles.${role}.network.egress[${String(i)}]`,
          code: 'reaches-git-remote',
          message: `${host} reaches the git remote; no sandbox may, since the merge is the runtime's alone (D-I1b-05)`,
        });
      }
    });
  }
  return problems;
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
    case 'roles-refused':
      // Each entry is a name in the host's roles directory, which a person wrote; the message is left out, as an invalid request's is.
      return { reason: 'roles-refused', refused: outcome.refused.map(({ entry, code }) => ({ entry, code })) };
    case 'role-undefined':
      return { reason: 'role-undefined', roles: [...outcome.roles] };
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
  const drafted = draftedStations(admitted.admitted.drafted);
  const drafting = draftingProblems(req, admitted.admitted.drafted, policy.policy);
  if (drafting.length > 0) return { ok: false, reason: 'invalid-request', problems: drafting };
  // Where the run's drafts are written; a workspace that already holds it would have them mixed with what it holds (R19).
  if (drafted.length > 0 && (await existsIn(req.workspace, `${DRAFT_DIR}/${req.runId}`))) {
    return { ok: false, reason: 'invalid-request', problems: [{ path: 'workspace', code: 'exists', message: `the workspace already holds ${DRAFT_DIR}/${req.runId}, where this run's drafts are written` }] };
  }

  const capability = capabilityRefusalFor(req.components, drafted);
  if (capability !== undefined) return { ok: false, reason: 'refused', at: capability.at, transition: capability.refusal, state: null };
  const remote = remoteEgress(policy.policy, req.components.integrator ?? null);
  if (remote.length > 0) return { ok: false, reason: 'invalid-request', problems: remote };
  const refused = policyRefusal(req.requestedLevel, admitted.admitted.graph, policy.policy, drafted);
  if (refused !== undefined) return refused;
  const rolesAt = await rolesProblems(req);
  if (rolesAt.length > 0) return { ok: false, reason: 'invalid-request', problems: rolesAt };
  const roles = await admitRoles(req.roles, admitted.admitted.graph, drafted);
  if (!roles.ok) return roles;
  let rubrics: Partial<Record<DraftStation, ReadRubric>> = {};
  if (drafted.length > 0) {
    const directory = req.rubrics ?? null;
    const at = await rubricsProblems(directory, [['workspace', req.workspace], ['workspace store', req.components.workspaces.root]]);
    if (at.length > 0 || directory === null) return { ok: false, reason: 'invalid-request', problems: at };
    const read = await readRubrics(directory, drafted);
    if (!read.ok) return { ok: false, reason: 'invalid-request', problems: read.problems };
    rubrics = read.rubrics;
  }
  const worstCase = worstCaseCost(admitted.admitted.graph, policy.policy, drafted);
  if (req.requestedLevel > 0 && req.approvedCostUsd !== worstCase.usd) {
    const likely = await likelyCost(req.components, worstCase, policy.policy);
    return { ok: false, reason: 'cost-unapproved', requestedLevel: req.requestedLevel, worstCase, likely, approvedCostUsd: req.approvedCostUsd };
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
  // Drafted tests are bound at `test-design`, over the base with the draft in it (R19).
  const supplied = req.artifacts.acceptanceTests === 'draft' ? [] : req.artifacts.acceptanceTests;
  const unbound = await suiteBindingProblems(admitted.admitted.checks, basePath(workspaces, req.runId), supplied);
  if (unbound.length > 0) {
    await discardRun(workspaces, req.runId);
    return { ok: false, reason: 'invalid-request', problems: unbound };
  }
  // The security checks the base's stack must be scanned with, read from the base like the suite bindings (R17).
  const set = await adapterSetOf(basePath(workspaces, req.runId), req.components);
  const unscanned = securityProblems(admitted.admitted.checks, { secretScan: req.components.scanners.secretScan, staticAnalysis: set.staticAnalysis });
  if (unscanned.length > 0) {
    await discardRun(workspaces, req.runId);
    return { ok: false, reason: 'invalid-request', problems: unscanned };
  }
  const controls = unavailableControls(set, req.requestedLevel);

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
  // The intent and each rubric are recorded before the admission record that names them (R19).
  // `draftingProblems` refused a drafted spec with no intent, so a drafted spec has one here.
  const intentText = admitted.admitted.drafted.spec ? (req.intent?.text ?? null) : null;
  const draftingRecords = async (): Promise<{ intent: AdmissionRecord['intent']; rubrics: RubricVersion[] }> => {
    const intent = intentText === null ? null : await vault.recordIntent({ runId: req.runId, text: intentText, from: 'principal', collectedBy: 'runtime' } satisfies IntentRecord);
    const versions: RubricVersion[] = [];
    for (const station of drafted) {
      const rubric = rubrics[station];
      if (rubric === undefined) continue;
      const ref = await vault.recordRubric({ runId: req.runId, station, text: rubric.text, sha256: rubric.sha256, collectedBy: 'runtime' } satisfies RubricRecord);
      versions.push({ station, sha256: rubric.sha256, ref });
    }
    return { intent, rubrics: versions };
  };
  const unrecorded: AdmissionRecord = {
    run,
    policy: policy.policy,
    roles: roles.roles,
    artifacts: admitted.admitted.artifacts,
    intent: null,
    rubrics: [],
    baseTreeSha256,
    unavailableControls: controls,
    // The same detection the controls and the security checks were read from (R18).
    stack: set.stack,
  };
  const refusedControls = admissionRefusal(unrecorded);
  if (refusedControls !== undefined) {
    await discardRun(workspaces, req.runId);
    return refusedControls;
  }
  const record: AdmissionRecord = { ...unrecorded, ...(await draftingRecords()) };
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
      drafts: {},
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
        roles: record.roles,
        artifacts: lineArtifactsOf(record.artifacts),
        graph: admitted.admitted.graph,
        checks: admitted.admitted.checks,
        securityPart: admitted.admitted.securityPart,
        requirements: admitted.admitted.requirements,
        drafting: { drafted: admitted.admitted.drafted, intent: intentText, rubrics },
        components: req.components,
        baseTreeSha256,
        state,
        ...hooks,
      }),
    },
  };
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAdmittedArtifact(value: unknown): value is AdmittedArtifact {
  return isRecordLike(value) && typeof value.path === 'string' && typeof value.sha256 === 'string';
}

function nullableArtifact(value: unknown): AdmittedArtifact | null | undefined {
  if (value === null || value === undefined) return null;
  return isAdmittedArtifact(value) ? value : undefined;
}

/**
 * A record's artifacts in today's shape, or undefined where they are not
 * artifacts at all. Read from a record, so its type is not trusted. A record
 * written before R19 holds lists, read as supplied sets, no acceptance
 * manifest, and a spec with only its security part.
 */
function recordArtifacts(artifacts: unknown): AdmissionRecord['artifacts'] | undefined {
  if (!isRecordLike(artifacts)) return undefined;
  const set = (value: unknown): AdmittedSet | undefined => {
    if (Array.isArray(value)) return value.every(isAdmittedArtifact) ? { source: 'supplied', files: value } : undefined;
    if (isRecordLike(value) && value.source === 'drafted') return { source: 'drafted' };
    if (isRecordLike(value) && value.source === 'supplied' && Array.isArray(value.files) && value.files.every(isAdmittedArtifact)) return { source: 'supplied', files: value.files };
    return undefined;
  };
  const manifest = ((value: unknown): AdmittedManifest | undefined => {
    if (value === undefined) return { source: 'none' };
    if (isRecordLike(value) && (value.source === 'none' || value.source === 'drafted')) return { source: value.source };
    if (isRecordLike(value) && value.source === 'supplied' && isAdmittedArtifact(value.file)) return { source: 'supplied', file: value.file };
    return undefined;
  })(artifacts.acceptanceManifest);
  const spec = set(artifacts.spec);
  const tests = set(artifacts.acceptanceTests);
  const parts = artifacts.specParts;
  if (spec === undefined || tests === undefined || manifest === undefined || !isRecordLike(parts)) return undefined;
  const security = nullableArtifact(parts.security);
  const runRequirements = nullableArtifact(parts.runRequirements);
  const questions = nullableArtifact(parts.questions);
  if (!isAdmittedArtifact(artifacts.verificationManifest) || !isAdmittedArtifact(artifacts.taskGraph) || security === undefined || runRequirements === undefined || questions === undefined) return undefined;
  return {
    spec,
    acceptanceTests: tests,
    acceptanceManifest: manifest,
    verificationManifest: artifacts.verificationManifest,
    taskGraph: artifacts.taskGraph,
    specParts: { security, runRequirements, questions },
  };
}

/** The line's artifacts as admitted: supplied ones as they are, drafted ones empty until locked (R19). */
export function lineArtifactsOf(artifacts: AdmissionRecord['artifacts']): LineArtifacts {
  return {
    spec: artifacts.spec.source === 'supplied' ? artifacts.spec.files : [],
    acceptanceTests: artifacts.acceptanceTests.source === 'supplied' ? artifacts.acceptanceTests.files : [],
    acceptanceManifest: artifacts.acceptanceManifest.source === 'supplied' ? artifacts.acceptanceManifest.file : null,
    verificationManifest: artifacts.verificationManifest,
    taskGraph: artifacts.taskGraph,
    specParts: artifacts.specParts,
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
  const artifacts = recordArtifacts(r.artifacts);
  const shaped =
    typeof run === 'object' && run.id === state.runId && typeof run.repo === 'string' && typeof run.baseCommit === 'string' &&
    typeof run.requestedLevel === 'number' && artifacts !== undefined &&
    typeof r.baseTreeSha256 === 'string' && Array.isArray(r.unavailableControls) &&
    r.unavailableControls.every((control) => typeof control === 'string') &&
    // Absent on a run admitted before R18, which resumes as it did; present, it is a stack.
    (r.stack === undefined || (typeof r.stack === 'string' && r.stack !== '')) &&
    // Absent on a run admitted before R19, which drafts nothing.
    (r.intent === undefined || r.intent === null || isRecordLike(r.intent)) && (r.rubrics === undefined || Array.isArray(r.rubrics));
  if (!shaped) throw new Error(`run ${state.runId}: the admission record does not hold a run and its artifacts; refusing to resume from it`);
  // A run admitted before R20 pinned no roles, and its seats have none to run under; it is not resumed under today's files (D-A-RC-06).
  const roles = rolesProblem(r.roles);
  if (roles !== undefined) throw new Error(`run ${state.runId}: ${roles}; refusing to resume from it`);
  const policy = checkedPolicy(r.policy);
  if (!policy.ok) throw new Error(`run ${state.runId}: the admitted policy no longer validates; refusing to resume under it:\n${policy.message}`);
  const record = { ...(r as AdmissionRecord), artifacts, intent: (r.intent ?? null) as AdmissionRecord['intent'], rubrics: (r.rubrics ?? []) as AdmissionRecord['rubrics'] };
  return { record, policy: policy.policy };
}

/**
 * Why a record's `roles` is not a role set a resume can run, or undefined:
 * each role's hash is its instructions' hash, so the record holds the
 * versions it names, and `reviewer` is among them.
 */
function rolesProblem(roles: unknown): string | undefined {
  if (!Array.isArray(roles)) return 'the admission record pins no roles';
  for (const role of roles as unknown[]) {
    const r = (typeof role === 'object' && role !== null ? role : {}) as Partial<Record<keyof CompiledRole, unknown>>;
    if (typeof r.role !== 'string' || typeof r.instructions !== 'string' || typeof r.sha256 !== 'string') return 'a pinned role carries no id, instructions, and hash';
    if (createHash('sha256').update(r.instructions, 'utf8').digest('hex') !== r.sha256) return `the pinned role ${r.role}'s instructions do not hash to its version`;
  }
  if (!(roles as Array<{ role?: unknown }>).some((r) => r.role === REVIEWER_ROLE)) return 'the admission record pins no reviewer role';
  return undefined;
}

async function readVaultJson<T>(vault: Vault, ref: VaultRef): Promise<T> {
  return JSON.parse(new TextDecoder().decode(await vault.read(ref))) as T;
}

/** What a run drafts, its intent, and its rubrics, read from the records admission wrote (R19). */
async function draftingOf(vault: Vault, record: AdmissionRecord): Promise<DraftingContext> {
  const drafted = { spec: record.artifacts.spec.source === 'drafted', 'test-design': record.artifacts.acceptanceTests.source === 'drafted' };
  if (!drafted.spec && !drafted['test-design']) return NOT_DRAFTING;
  const intent = record.intent === null ? null : (await readVaultJson<IntentRecord>(vault, record.intent)).text;
  const rubrics: Partial<Record<DraftStation, ReadRubric>> = {};
  for (const version of record.rubrics) {
    const rubric = await readVaultJson<RubricRecord>(vault, version.ref);
    if (rubric.sha256 !== version.sha256) throw new Error(`run ${record.run.id}: the ${version.station} rubric recorded does not hash to the version admission pinned`);
    rubrics[version.station] = { text: rubric.text, sha256: rubric.sha256 };
  }
  return { drafted, intent, rubrics };
}

interface Loaded {
  readonly artifacts: LineArtifacts;
  readonly graph: TaskGraph;
  readonly checks: CheckSpec[];
  readonly securityPart: SecurityPart | null;
  readonly requirements: RunRequirements | null;
  readonly drafting: DraftingContext;
  /** Artifacts whose bytes no longer hash to what was admitted or locked. */
  readonly changed: Array<{ path: string; expected: string; actual: string }>;
}

/**
 * The line as the records hold it: the artifacts admitted, each drafted one
 * a committed lock wrote (R19), and the manifests, graph, and spec parts
 * re-read from the artifact root and checked against their hashes before
 * they are parsed.
 */
async function loadLine(vault: Vault, record: AdmissionRecord, state: RunState): Promise<Loaded> {
  let artifacts = lineArtifactsOf(record.artifacts);
  for (const station of DRAFT_STATIONS) {
    const locked = state.drafts[station]?.locked ?? null;
    if (locked === null) continue;
    const lock = await readVaultJson<DraftLockRecord>(vault, locked);
    artifacts = lockedArtifacts(artifacts, record.run.id, station, lock.files);
  }
  const drafting = await draftingOf(vault, record);
  const changed: Loaded['changed'] = [];
  const load = async (admitted: AdmittedArtifact | null): Promise<unknown> => {
    if (admitted === null) return undefined;
    const read = await readArtifact(record.run.repo, admitted.path);
    const actual = read === undefined ? 'missing' : read.admitted.sha256;
    if (actual !== admitted.sha256) changed.push({ path: admitted.path, expected: admitted.sha256, actual });
    return read === undefined ? undefined : parseJson(read.bytes);
  };
  const manifestJson = await load(artifacts.verificationManifest);
  const graphJson = await load(artifacts.taskGraph);
  const acceptanceJson = await load(artifacts.acceptanceManifest);
  const securityJson = await load(artifacts.specParts.security);
  const requirementsJson = await load(artifacts.specParts.runRequirements);
  const empty = { artifacts, graph: { tasks: [], edges: [] }, checks: [], securityPart: null, requirements: null, drafting, changed };
  if (changed.length > 0) return empty;
  const alone = artifacts.acceptanceManifest === null && !drafting.drafted['test-design'];
  const manifest = parseManifest(manifestJson, { alone });
  const graph = parseGraph(graphJson, { runId: record.run.id, baseCommit: record.run.baseCommit, workspace: record.run.repo });
  const acceptance = artifacts.acceptanceManifest === null ? null : parseManifest(acceptanceJson, { alone: false });
  // The bytes hash to what admission validated or a lock approved, so these cannot fail unless the validator itself changed.
  if (!manifest.ok || !graph.ok || acceptance?.ok === false) throw new Error(`run ${record.run.id}: the admitted manifests or graph no longer validate; refusing to resume`);
  const security = securityJson === undefined ? null : parseSecurityPart(securityJson);
  if (security !== null && !security.ok) throw new Error(`run ${record.run.id}: the security part no longer validates; refusing to resume`);
  const requirements = requirementsJson === undefined ? null : parseRunRequirements(requirementsJson, 'runRequirements');
  if (requirements !== null && !requirements.ok) throw new Error(`run ${record.run.id}: the run-requirements part no longer validates; refusing to resume`);
  return {
    artifacts,
    graph: graph.graph,
    checks: [...manifest.checks, ...(acceptance?.ok === true ? acceptance.checks : [])],
    securityPart: security === null ? null : security.part,
    requirements: requirements === null ? null : requirements.part,
    drafting,
    changed,
  };
}

/**
 * Drives an admitted run from its last committed state. The level, the
 * policy, and the artifacts come from the admission record, never from the
 * caller, so a resume can neither raise its level nor reset a bound; only the
 * components are the caller's, and they are held to the same safety and
 * capability checks as at admission.
 */
/**
 * The tasks with a call whose reading was lost, read from every usage record
 * the Vault holds for the run, referenced or not: a `lost` reading, or a
 * `pending` one no terminal reading followed (D-I1a-12).
 */
async function lostReadings(vault: Vault, state: RunState): Promise<TaskId[]> {
  const records = await readUsage(vault, state);
  const lost = [...records.filter((r) => r.reading.kind === 'lost'), ...unsettledCalls(records)];
  return [...new Set(lost.map((r) => r.taskId))].sort();
}

export async function resumeRun(req: ResumeRequest, hooks: DriveHooks = {}): Promise<RunOutcome> {
  requireContractTable();
  const { vault } = req.components;
  const state = await vault.readRunState(req.runId);
  const { record, policy } = await readAdmission(vault, state);
  const level = record.run.requestedLevel;
  const drafted = DRAFT_STATIONS.filter((station) => (station === 'spec' ? record.artifacts.spec : record.artifacts.acceptanceTests).source === 'drafted');

  // Admission's own checks, repeated: a refusal here is recorded as a resume refusal, by admission (D-P14-11).
  const resumeRefused = async (refusal: ResumeRefusal): Promise<void> => {
    await recordDecision({ vault, runId: req.runId, taskId: null, station: null }, { cause: 'resume-refused', decidedBy: 'admission', refusal });
  };
  const unsafe = unsafeComponents(req.components);
  if (unsafe.length > 0 && level > 1) {
    await resumeRefused({ reason: 'unsafe-above-l1', requestedLevel: level, components: unsafe.map((u) => u.component) });
    return { ok: false, reason: 'unsafe-above-l1', requestedLevel: level, unsafe };
  }
  // A call whose cost was lost is not replayed on top of it: a human cancels the run (D-P13-20, D-I1a-08).
  const lost = await lostReadings(vault, state);
  if (lost.length > 0) {
    await resumeRefused({ reason: 'meter-lost', tasks: lost });
    return { ok: false, reason: 'meter-lost', tasks: lost, state };
  }
  // Not recorded: admission refuses this record before any state exists, so no run reaches a resume with it.
  const controls = admissionRefusal(record);
  if (controls !== undefined) return controls;
  if (drafted.length > 0 && (req.components.drafting ?? null) === null) {
    throw new Error(`run ${req.runId}: the run drafts and the component graph names no drafting drivers; refusing to resume without them`);
  }
  const capability = capabilityRefusalFor(req.components, drafted);
  if (capability !== undefined) {
    await resumeRefused({ reason: 'refused', at: capability.at, refusal: capability.refusal });
    return { ok: false, reason: 'refused', at: capability.at, transition: capability.refusal, state };
  }
  // The base every workspace is built from must be the one admission recorded, or the one the last
  // locked draft wrote, whose files are written again first so a stop mid-write leaves no half of
  // it (R19). A store that lost it, or holds another run's, is refused rather than built on.
  const basedir = basePath(req.components.workspaces, req.runId);
  const expected = (await settleBase(vault, basedir, state)) ?? record.baseTreeSha256;
  const base = await treeDigest(basedir).catch(() => 'missing');
  if (base !== expected) {
    throw new Error(`run ${req.runId}: the workspace store's base is ${base}, not the ${expected} its records name; refusing to resume on it`);
  }

  const loaded = await loadLine(vault, record, state);
  const ctx: LineContext = {
    run: record.run,
    policy,
    roles: record.roles,
    artifacts: loaded.artifacts,
    graph: loaded.graph,
    checks: loaded.checks,
    securityPart: loaded.securityPart,
    requirements: loaded.requirements,
    drafting: loaded.drafting,
    components: req.components,
    baseTreeSha256: expected,
    state,
    ...hooks,
  };
  if (loaded.changed.length > 0) return runLine(ctx, loaded.changed);
  return runLine(ctx);
}

/** The drafted floor at the exit a run is waiting at, or undefined where that exit is not a drafted artifact's (R19). */
function floorAt(state: RunState, drafting: DraftingContext): ReturnType<typeof draftFloorOf> | undefined {
  const station = state.station;
  if (!isDraftStation(station) || !drafting.drafted[station] || state.phase !== 'exiting') return undefined;
  return draftFloorOf(state, station);
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
 *
 * At a drafted exit the approval names the draft's hash and is refused for
 * any other, and a draft carrying problems the runtime would refuse to lock
 * can be rejected and not approved (R19).
 */
export async function approveStation(req: ApprovalRequest): Promise<ApprovalOutcome> {
  // Every refusal and every grant is recorded before it takes effect (D-P14-07). The key is kept only when it is one:
  // anything else is the caller's text.
  const key = isApprovalKey(req.key) ? req.key : null;
  const refuse = async (reason: 'invalid-request' | 'not-awaiting' | 'draft-mismatch' | 'draft-invalid', message: string, station: StationId | null): Promise<ApprovalOutcome> => {
    // A run id that is not a non-empty string names nowhere to record the refusal.
    if (typeof req.runId === 'string' && req.runId !== '') {
      await recordDecision({ vault: req.vault, runId: req.runId, taskId: null, station }, { cause: 'approval-refused', decidedBy: 'approval', key, reason });
    }
    return { ok: false, reason, message };
  };
  if (typeof req.approvedBy !== 'string' || req.approvedBy.trim() === '') return refuse('invalid-request', 'approvedBy must name who approved', null);
  if (key === null) return refuse('invalid-request', `'${req.key}' is not a station:level approval key`, null);
  const named: unknown = req.draft ?? null;
  if (named !== null && typeof named !== 'string') return refuse('invalid-request', 'draft must be the hash of the draft approved, or null', null);
  const state = await req.vault.readRunState(req.runId);
  const { record, policy } = await readAdmission(req.vault, state);
  const level = record.run.requestedLevel;
  const { graph, changed, drafting } = await loadLine(req.vault, record, state);
  if (changed.length > 0) return refuse('not-awaiting', `run ${req.runId} has an admitted artifact that changed; it is not awaiting approval`, state.station);

  // The policy's own limits: this reads only whether the step is an exit, which the batch size does not change (D-R4-02).
  const step = nextStep(state, graph, policy.concurrency);
  const expected = approvalKey(state.station, level);
  const floor = step.kind === 'exit' ? floorAt(state, drafting) : undefined;
  const draft: DraftRef | null = floor?.draft ?? null;
  // A spent grant for the last exit is a run that passed; there is nothing left to approve.
  const passed = step.kind === 'exit' && !M1_STATIONS.includes(step.to) && state.approvals.some((grant) => grant.key === expected && grant.usedAt !== null);
  const awaiting =
    step.kind === 'exit' && !passed && !isBackward(step.from, step.to) && key === expected &&
    effectiveApproval(STATION_CONTRACTS[state.station], policy, level, [], floor) === 'human-required' &&
    !state.approvals.some((grant) => grantClears(grant, expected, draft));
  if (!awaiting) {
    return refuse('not-awaiting', `run ${req.runId} is not waiting for an approval of ${key}; it is ${state.phase} at ${state.station} at L${String(level)}`, state.station);
  }
  if ((draft?.sha256 ?? null) !== named) {
    return refuse('draft-mismatch', draft === null ? `the exit from ${state.station} approves no draft` : `the draft waiting at ${state.station} is ${draft.sha256}, not ${String(named)}`, state.station);
  }
  if (floor?.failed.includes('shape') === true) {
    return refuse('draft-invalid', `the draft waiting at ${state.station} carries problems the runtime would refuse to lock; it can be rejected, not approved`, state.station);
  }
  // Written before the grant is committed, so a grant never exists without its record; a write that fails throws and grants nothing.
  await recordDecision(
    { vault: req.vault, runId: req.runId, taskId: null, station: state.station },
    { cause: 'approval-granted', decidedBy: 'approval', key, principal: req.approvedBy, draft },
  );
  try {
    const next = await req.vault.commitRunState(
      { ...state, approvals: [...state.approvals, { key, approvedBy: req.approvedBy, approvedAt: new Date().toISOString(), usedAt: null, draft }] },
      state.version,
    );
    return { ok: true, state: next };
  } catch (error) {
    // The grant's record stands beside this refusal: it was decided, and did not take effect.
    return refuse('not-awaiting', `run ${req.runId} moved while the approval was recorded: ${describe(error)}`, state.station);
  }
}

const REJECTION_REASONS: readonly RejectionReason[] = ['not-black-box', 'does-not-follow-spec', 'not-runnable', 'misses-spec-cases'];

/**
 * Records a person's rejection of the draft waiting at a drafting station's
 * exit (R19). The draft goes back to the drafter with the notes at `spec` or
 * the reason at `test-design`; a rejection of the last allowed attempt parks
 * the run, terminally. Recorded before it takes effect, as an approval is
 * (D-P14-07).
 */
export async function rejectDraft(req: RejectionRequest): Promise<RejectionOutcome> {
  const key = isApprovalKey(req.key) ? req.key : null;
  const invalid = (message: string): RejectionOutcome => ({ ok: false, reason: 'invalid-request', message });
  if (typeof req.rejectedBy !== 'string' || req.rejectedBy.trim() === '') return invalid('rejectedBy must name who rejected');
  if (key === null) return invalid(`'${req.key}' is not a station:level approval key`);
  if (typeof req.draft !== 'string') return invalid('draft must be the hash of the draft rejected');
  const notes: unknown = req.notes ?? null;
  const reason: unknown = req.reason ?? null;
  const state = await req.vault.readRunState(req.runId);
  const { record, policy } = await readAdmission(req.vault, state);
  const level = record.run.requestedLevel;
  const { graph, changed, drafting } = await loadLine(req.vault, record, state);
  const station = state.station;
  if (changed.length > 0 || !isDraftStation(station)) return { ok: false, reason: 'not-awaiting', message: `run ${req.runId} is not waiting at a drafted exit` };
  const step = nextStep(state, graph, policy.concurrency);
  const floor = step.kind === 'exit' ? floorAt(state, drafting) : undefined;
  if (floor === undefined || key !== approvalKey(station, level) || effectiveApproval(STATION_CONTRACTS[station], policy, level, [], floor) !== 'human-required') {
    return { ok: false, reason: 'not-awaiting', message: `run ${req.runId} is not waiting for a person to decide a draft at ${key}` };
  }
  if (floor.draft.sha256 !== req.draft) return { ok: false, reason: 'draft-mismatch', message: `the draft waiting at ${station} is ${floor.draft.sha256}, not ${req.draft}` };
  // At `spec`, notes and no reason; at `test-design`, a reason from the fixed set and no text (D-A-DS-02).
  if (station === 'spec') {
    if (reason !== null) return invalid('a rejection at spec carries notes, not a reason');
    if (notes !== null && (typeof notes !== 'string' || notes.trim() === '' || Buffer.byteLength(notes, 'utf8') > INTENT_MAX_BYTES)) return invalid(`notes are the approver's text, at most ${String(INTENT_MAX_BYTES)} bytes`);
  } else {
    if (notes !== null) return invalid('a rejection at test-design carries no free text; an approver who has read the repository would otherwise be a channel around the black box');
    if (typeof reason !== 'string' || !REJECTION_REASONS.includes(reason as RejectionReason)) return invalid(`a rejection at test-design carries a reason: one of ${REJECTION_REASONS.join(', ')}`);
  }
  const drafts = state.drafts[station];
  const last = drafts?.attempts.at(-1);
  if (drafts === undefined || last === undefined) return { ok: false, reason: 'not-awaiting', message: `run ${req.runId} has no draft at ${station}` };
  const at = new Date().toISOString();
  const parks = last.attempt >= STATION_CONTRACTS[station].maxIterations;
  await recordDecision(
    { vault: req.vault, runId: req.runId, taskId: null, station },
    { cause: 'approval-rejected', decidedBy: 'approval', key, draft: floor.draft, principal: req.rejectedBy, reason: (reason as RejectionReason | null), notes: notes !== null },
  );
  // The last allowed draft rejected parks the run; the park is recorded with its cause before it is committed (D-P14-07).
  if (parks) {
    const parked = draftsRejected(station);
    await recordDecision({ vault: req.vault, runId: req.runId, taskId: null, station }, { cause: 'station-refused', decidedBy: 'line', refusal: parked });
  }
  const sentBack = { by: 'principal' as const, principal: req.rejectedBy, at, notes: notes, reason: reason as RejectionReason | null };
  try {
    const next = await req.vault.commitRunState(
      {
        ...state,
        // A draft sent back is drafted again: the station is working, until the last is rejected and the run parks.
        phase: parks ? state.phase : 'working',
        drafts: { ...state.drafts, [station]: { ...drafts, parked: parks, attempts: [...drafts.attempts.slice(0, -1), { ...last, sentBack }] } },
      },
      state.version,
    );
    return { ok: true, state: next, parked: parks };
  } catch (error) {
    return { ok: false, reason: 'not-awaiting', message: `run ${req.runId} moved while the rejection was recorded: ${describe(error)}` };
  }
}

/**
 * What a person deciding a draft is shown (R19): the draft's hash and
 * attempt, each condition the runtime found failed, the critic's findings and
 * grade (advisory ones included), and the runtime's own problems with it.
 */
export interface DraftStanding {
  readonly station: DraftStation;
  readonly draft: DraftRef;
  readonly failed: readonly DraftCondition[];
  readonly problems: ReadonlyArray<{ readonly path: string; readonly code: string }>;
  readonly critic: { readonly grade: CriticRecord['grade']; readonly binding: boolean; readonly findings: readonly string[] } | null;
  readonly attemptsLeft: number;
}

/**
 * Where a run stands, derived from its committed state by the rules the line
 * itself follows (I2). Nothing a model wrote is an input.
 *
 * - `passed`: every M1 exit gate is crossed; a resume would return at once.
 * - `stopped`: the line refuses to continue, and says why.
 * - `awaiting-approval`: the next exit needs a human's approval of `key`;
 *   `escalations` says what raised it beyond its floor, if anything (A-I1a-07),
 *   and `draft` what is being decided at a drafted exit (R19).
 * - `open`: there is work left, and a drive would do it.
 */
export type RunStanding =
  | { readonly standing: 'passed' }
  | { readonly standing: 'stopped'; readonly refusal: StationRefusal }
  | { readonly standing: 'awaiting-approval'; readonly key: ApprovalKey; readonly escalations: readonly string[]; readonly draft: DraftStanding | null }
  | { readonly standing: 'open' };

/**
 * Whether a standing was read from the Vault alone, or after re-hashing the
 * admitted artifacts in the working copy. A cancelled, halted, or passed run
 * reads `records`; every other run's standing includes a live lock check
 * (D-I1b-15), which a reader must not take for a recorded fact.
 */
export type StandingSource = 'records' | 'workspace';

/** The station whose exit ends an M1 run. */
const LAST_STATION: StationId = M1_STATIONS[M1_STATIONS.length - 1] ?? 'integrate';

async function draftStanding(vault: Vault, state: RunState, station: DraftStation, floor: NonNullable<ReturnType<typeof floorAt>>): Promise<DraftStanding> {
  const attempt = state.drafts[station]?.attempts.at(-1);
  const record = attempt?.draft == null ? null : await readVaultJson<DraftRecord>(vault, attempt.draft);
  const critic = attempt?.critic == null || attempt.critic === 'not-seated' ? null : await readVaultJson<CriticRecord>(vault, attempt.critic);
  return {
    station,
    draft: floor.draft,
    failed: floor.failed,
    problems: record?.problems ?? [],
    critic: critic === null ? null : { grade: critic.grade, binding: critic.binding, findings: critic.findings },
    attemptsLeft: STATION_CONTRACTS[station].maxIterations - floor.draft.attempt,
  };
}

export async function runStanding(vault: Vault, runId: RunId): Promise<{ state: RunState; standing: RunStanding; source: StandingSource }> {
  const state = await vault.readRunState(runId);
  const { record, policy } = await readAdmission(vault, state);
  // What was committed is read before what the workspace holds now. A cancellation, a halt, and the grant
  // spent in the commit that ended a passed run, are records an artifact edited afterwards does not
  // undo; re-hashed first, a later edit would report either run as tampered (P9 review, codex-3).
  if (state.cancelled !== null || state.halted !== null) {
    // `nextStep` refuses a cancelled or halted run before any other check, so no graph is needed to read why (A-P9-01, A-P9-02).
    const ended = nextStep(state, { tasks: [], edges: [] }, policy.concurrency);
    if (ended.kind === 'refuse') return { state, standing: { standing: 'stopped', refusal: ended.refusal }, source: 'records' };
  }
  // The last exit is crossed only by a run that passed, and when it needs an approval the line
  // spends the grant in the commit that ends the run. A spent grant for it is that record; the
  // gate re-evaluated would ask for a second approval of an exit already crossed (D-P9-08).
  const last = approvalKey(LAST_STATION, record.run.requestedLevel);
  if (state.approvals.some((grant) => grant.key === last && grant.usedAt !== null)) return { state, standing: { standing: 'passed' }, source: 'records' };
  const { graph, changed, drafting } = await loadLine(vault, record, state);
  if (changed.length > 0) {
    const paths = changed.map((c) => c.path).join(', ');
    return { state, standing: { standing: 'stopped', refusal: { ok: false, reason: 'lock-tamper', tampered: changed, message: `an admitted artifact changed: ${paths}` } }, source: 'workspace' };
  }
  // The policy's own limits: the standing reads only a refusal or an exit, which the batch size does not change (D-R4-02).
  const step = nextStep(state, graph, policy.concurrency);
  if (step.kind === 'refuse') return { state, standing: { standing: 'stopped', refusal: step.refusal }, source: 'workspace' };
  if (step.kind !== 'exit') return { state, standing: { standing: 'open' }, source: 'workspace' };
  const floor = floorAt(state, drafting);
  const held = locksHeldLeaving(step.from) && (await vault.readLocks(runId)) !== null;
  const verdict = held ? await vault.verifyLocks(runId) : { ok: true as const };
  // The same escalation the line applies, from the same bundles, so the standing and a drive agree.
  const escalations = step.from === 'integrate'
    ? await integrateEscalations(vault, state, async (ref) => JSON.parse(new TextDecoder().decode(await vault.read(ref))) as EvidenceBundle)
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
    ...(floor === undefined ? {} : { draft: floor }),
  });
  if (!next.ok) {
    if (next.reason !== 'approval-required') return { state, standing: { standing: 'stopped', refusal: next }, source: 'workspace' };
    const draft = floor === undefined || !isDraftStation(step.from) ? null : await draftStanding(vault, state, step.from, floor);
    return { state, standing: { standing: 'awaiting-approval', key: next.key, escalations: next.escalations, draft }, source: 'workspace' };
  }
  if (M1_STATIONS.includes(next.next)) return { state, standing: { standing: 'open' }, source: 'workspace' };
  // Approved, and a pull request opened that is not yet merged: a drive merges it before the run is done (D-I1b-01).
  const integration = await readIntegration(vault, runId);
  if (integration.some((r) => r.kind === 'opened') && !integration.some((r) => r.kind === 'merged')) return { state, standing: { standing: 'open' }, source: 'workspace' };
  return { state, standing: { standing: 'passed' }, source: 'workspace' };
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
