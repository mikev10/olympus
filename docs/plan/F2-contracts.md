# F2 — Contracts

> **Historical: the F2 build spec, as written for the F2 session.** The
> signatures below are what F2 was built to. They are not maintained and are
> already behind the code: the F2 review gate, the maintainer review, and the
> amendments surfaced by S1 each changed a contract without changing this
> file. The types under `packages/*/src` are authoritative; where this file
> and the code differ, the code is right. The amendment history, with what
> changed and why, is in `docs/decisions.md`.

**Unit:** F2 (Phase 0, foundation, maintainer-only)
**Depends on:** F1 Spine
**Blocks:** everything

Nine files. No implementation, no logic, no dependencies between packages beyond types. This is the single session that decides the architecture; the signatures below are the target, not a sketch.

**Two findings from writing this, both already applied below:**

1. **A ninth file was missing.** Runs, tasks, task graphs, and run state had no home — they were assumed by the station, policy, and integrity types without ever being defined. `core/src/run/types.ts` is new.
2. **`TaskResult` has no `status` field.** Invariant I2 was prose in the plan; here it becomes structural. There is no place for a model to report success, so no amount of prompting can produce one. Status is computed by the runtime from `CheckResult` exit codes alone.

---

## Session Scope

1. Create `v2` branch, freeze `main` with a deprecation note
2. Scaffold pnpm monorepo + changesets + TypeScript strict
3. Write the nine files below
4. **Stop.** Review all nine together before any implementation.

Out of scope: any function body, any test beyond type-level, any package that isn't in the list.

---

## 1. `packages/core/src/run/types.ts`

```ts
export type RunId = string & { readonly __brand: 'RunId' };
export type TaskId = string & { readonly __brand: 'TaskId' };
export type RoleId = string & { readonly __brand: 'RoleId' };

export type StationId =
  | 'intake' | 'spec' | 'test-design' | 'plan' | 'build'
  | 'verify' | 'review' | 'integrate' | 'observe' | 'learn';

export type AutonomyLevel = 0 | 1 | 2 | 3;
export type ModelTier = 'fast' | 'standard' | 'deep';

export interface Run {
  id: RunId;
  repo: string;
  baseCommit: string;          // immutable ref; evidence binds to this
  trigger: TriggerRef;         // from triggers/types.ts
  requestedLevel: AutonomyLevel;
  station: StationId;
  graph: TaskGraph | null;     // null before `plan`
  createdAt: string;
}

export interface Task {
  id: TaskId;
  runId: RunId;
  station: StationId;
  role: RoleId;
  dependsOn: TaskId[];
  baseCommit: string;          // may advance from Run.baseCommit after rebase
  dependencySet: string[];     // globs this task reads/writes; drives §10 invalidation
  worktreePath: string;
  attempt: number;
  status: TaskStatus;          // runtime-owned, never model-set
}

export type TaskStatus =
  | 'pending' | 'ready' | 'running' | 'verifying'
  | 'passed' | 'failed' | 'parked' | 'cancelled';

export interface TaskGraph {
  tasks: Task[];
  edges: Array<{ from: TaskId; to: TaskId }>;
}

export interface RunState {
  runId: RunId;
  station: StationId;
  tasks: Record<TaskId, TaskStatus>;
  evidenceRefs: VaultRef[];    // from vault/types.ts
  violations: VaultRef[];
  version: string;             // optimistic concurrency
}
```

**Note:** `Task.dependencySet` exists so a merge invalidates only tasks it actually affects. Without it, §10's scheduler is O(N²) and breaches the §16 budget on its own.

---

## 2. `packages/core/src/driver/contract.ts`

```ts
export const DRIVER_CONTRACT_VERSION = '1.0.0';

export interface ModelIdentity {
  provider: string;
  family: string;     // explicit. NEVER inferred from driver id — I6 depends on this
  model: string;
  version: string;
}

export interface DriverCapabilities {
  subagents: boolean;
  hooks: boolean;
  mcp: boolean;
  parallelism: number;
  computerUse: boolean;
  steering: boolean;          // supports steer()
  stablePrefixCaching: boolean;
}

export type DriverCapability = keyof DriverCapabilities;

/** Context is split so invariant material forms a cacheable prefix (§3, §16). */
export interface TaskRequest {
  taskId: TaskId;
  role: RoleId;
  stablePrefix: string;       // spec, rubric, conventions — identical across a run
  variableSuffix: string;     // this task only
  tier: ModelTier;
  tools: string[];            // policy-granted; default deny (I4)
  sandbox: SandboxHandle;
  timeoutMs: number;
  budget: Budget;
}

export interface Budget { maxTokens: number; maxCostUsd: number; maxWallClockMs: number; }

export interface AgentClaim {
  narrative: string;          // what the model says it did — a CLAIM, not evidence
  filesChanged: string[];
}

/**
 * I2: there is deliberately NO status field. The runtime computes status from
 * CheckResult exit codes (integrity/types.ts). A model cannot report success.
 */
export interface TaskResult {
  taskId: TaskId;
  claim: AgentClaim;
  events: DriverEvent[];
  usage: Usage;
  model: ModelIdentity;
  contractVersion: string;
}

export interface DriverEvent {
  at: string;
  kind: 'command' | 'file-write' | 'tool-call' | 'network' | 'subagent';
  detail: Record<string, unknown>;
}

export interface Usage {
  inputTokens: number; outputTokens: number;
  cacheReadTokens: number; cacheWriteTokens: number;   // §16 cache-hit metric
  costUsd: number; wallClockMs: number;
}

export interface Driver {
  readonly id: string;
  readonly contractVersion: string;
  provenanceId(): string;                       // stamped onto every evidence artifact
  capabilities(): DriverCapabilities;
  resolveModel(tier: ModelTier): ModelIdentity;
  runTask(req: TaskRequest): Promise<TaskResult>;
  spawnSubagent?(role: RoleId, req: TaskRequest): Promise<TaskResult>;
  steer?(taskId: TaskId, message: string): Promise<void>;   // runtime-only; never a human channel
  cancel(taskId: TaskId): Promise<void>;
  emitArtifacts(roles: CompiledRole[], targetDir: string): Promise<void>;
  on(kind: DriverEvent['kind'], handler: (e: DriverEvent) => void): void;
}
```

---

## 3. `packages/vault/src/types.ts`

```ts
export type VaultRefKind =
  | 'spec' | 'acceptance-tests' | 'task-graph' | 'lock-manifest'
  | 'policy' | 'verification-manifest' | 'evidence' | 'violation'
  | 'run-state' | 'rubric' | 'learning';

export interface VaultRef { runId: RunId; kind: VaultRefKind; hash: string; }

export interface LockEntry {
  path: string;
  sha256: string;
  lockedAt: string;
  lockedBy: StationId;        // 'spec' or 'test-design'
}

export interface LockManifest { runId: RunId; entries: LockEntry[]; }

export type LockVerdict =
  | { ok: true }
  | { ok: false; tampered: Array<{ path: string; expected: string; actual: string }> };

export interface EvidenceBundle {
  runId: RunId;
  taskId: TaskId;
  baseCommit: string;                 // evidence is void if the base moves
  checks: CheckResult[];              // integrity/types.ts
  claim: AgentClaim;                  // stored beside evidence, never merged into it
  claimEvidenceDiff: string[];        // I2: where the model's story and the facts differ
  collectedBy: 'runtime';             // literal type — an agent cannot construct one
  driverProvenanceId: string;
  contractVersion: string;
}

export interface IntegrityViolation {
  runId: RunId; taskId: TaskId | null;
  kind: 'lock-tamper' | 'vault-write-attempt' | 'protected-path'
      | 'claim-mismatch' | 'suite-shrink' | 'skip-marker'
      | 'assertion-weakened' | 'prompt-injection' | 'capability-escape';
  role: RoleId; driverProvenanceId: string; contractVersion: string;
  detectedAt: string; detail: Record<string, unknown>;
}

/**
 * I1: no generic write(). Every mutator is a named, audited operation the runtime
 * calls. No method on this interface is reachable from inside a Workspace.
 */
export interface Vault {
  read(ref: VaultRef): Promise<Buffer>;
  lock(runId: RunId, paths: string[], by: StationId): Promise<LockManifest>;
  verifyLocks(runId: RunId): Promise<LockVerdict>;
  writeEvidence(b: EvidenceBundle): Promise<VaultRef>;
  recordViolation(v: IntegrityViolation): Promise<VaultRef>;
  readRunState(runId: RunId): Promise<RunState>;
  commitRunState(s: RunState, ifVersion: string): Promise<RunState>;
}
```

---

## 4. `packages/core/src/policy/types.ts`

```ts
export interface CapabilityScope {
  stations: StationId[];              // where this role may act — nowhere else
  writableGlobs: string[];            // within the Workspace only
  tools: string[];                    // default deny (I4)
  network: { egress: 'none' | string[] };
  tier: ModelTier;
  autonomyCeiling: AutonomyLevel;
  triggerKinds: TriggerKind[];
  budget: Budget;
}

export type ApprovalOutcome = 'auto' | 'human-required' | 'blocked';

export interface Policy {
  globalCap: AutonomyLevel;                                    // ships as 2 (D10)
  stationCaps: Partial<Record<StationId, AutonomyLevel>>;
  approvals: Record<`${StationId}:${AutonomyLevel}`, ApprovalOutcome>;
  roles: Record<RoleId, CapabilityScope>;
  protectedPaths: string[];           // in-repo but escalating: CI, test config, package scripts
  triggers: TriggerPolicy;
  concurrency: { maxParallelTasks: number; maxConflictRetries: number };
}

export type PolicyResolution =
  | { ok: true; level: AutonomyLevel }
  | { ok: false; reason: 'exceeds-cap' | 'station-forbidden' | 'capability-missing'; detail: string };

/** I5: over-request is refused, never silently downgraded. */
export declare function resolveAutonomy(
  requested: AutonomyLevel, station: StationId, role: RoleId, policy: Policy
): PolicyResolution;

export declare function resolveCapabilities(
  role: RoleId, station: StationId, policy: Policy
): CapabilityScope | PolicyResolution;
```

---

## 5. `packages/core/src/station/types.ts`

```ts
export type ContextGrant =
  | 'locked-spec' | 'acceptance-tests' | 'task-graph' | 'plan'
  | 'base-repo-readonly' | 'diff' | 'evidence-bundle'
  | 'author-narrative' | 'conversation';

export interface WriteBoundary {
  workspaceGlobs: string[];
  vault: 'never';                     // literal — I1 is unrepresentable otherwise
  protectedPathPolicy: 'escalate';    // §4: escalates the Integrate gate, does not hard-fail
}

export interface StationContract {
  id: StationId;
  requires: DriverCapability[];       // I5: fail closed when a driver lacks one
  allowedContext: ContextGrant[];     // review seats: never 'author-narrative' or 'plan'
  tier: ModelTier;
  writeBoundary: WriteBoundary;
  maxIterations: number;              // Ascent bound, per task
  retry: { max: number; backoffMs: number };
  exitGate: ExitGate;
}

export interface ExitGate {
  requiredChecks: string[];           // CheckSpec ids
  requiresPanel: boolean;
  approval: ApprovalOutcome;
}

export type StationTransition =
  | { ok: true; next: StationId }
  | { ok: false; reason: 'gate-failed' | 'lock-tamper' | 'violation' | 'parked'; detail: string };
```

---

## 6. `packages/integrity/src/types.ts`

```ts
export type CheckKind =
  | 'compile' | 'typecheck' | 'lint' | 'unit'
  | 'acceptance' | 'behavioral' | 'coverage' | 'mutation';

export interface CheckSpec {
  id: string;
  kind: CheckKind;
  command: string;                    // pinned at test-design; lives in the Vault
  required: boolean;
  timeoutMs: number;
  expectedSuiteCount?: number;        // I5: a shrunken enumeration is a failure
}

export interface VerificationManifest {
  runId: RunId;
  lockedAt: string;
  checks: CheckSpec[];
}

/** Produced by the runtime executing CheckSpec in a fresh sandbox. Never by an agent. */
export interface CheckResult {
  checkId: string;
  exitCode: number;                   // the check's own process, not the agent session's
  stdout: string; stderr: string;
  suiteCount: number | null;
  durationMs: number;
  startedAt: string;
}

export interface TamperReport {
  assertionsWeakened: Array<{ file: string; before: string; after: string }>;
  skipMarkersAdded: Array<{ file: string; marker: string }>;
  testsDeleted: string[];             // renames, moves, case-set reduction all count
  snapshotsRegenerated: string[];
  coverageDelta: number;
  protectedPathsTouched: string[];
}

export interface GateResult {
  passed: boolean;
  checks: CheckResult[];
  tamper: TamperReport;
  violations: IntegrityViolation[];
  verdict: 'pass' | 'fail' | 'escalate';
}
```

---

## 7. `packages/sandbox/src/types.ts`

```ts
export type SandboxHandle = string & { readonly __brand: 'SandboxHandle' };

export interface MountEntry {
  source: string;
  target: string;
  mode: 'ro' | 'rw';
}

/**
 * I1 enforced at the substrate: exactly one rw mount, and it is the Workspace.
 * Implementations MUST reject any table that violates this, and MUST resolve
 * symlinks and path escapes before mounting.
 */
export interface MountTable {
  workspace: MountEntry & { mode: 'rw' };
  readonly others: Array<MountEntry & { mode: 'ro' }>;
}

export interface EgressPolicy { mode: 'deny-all' | 'allowlist'; allow: string[]; }

export interface SandboxSpec {
  image: string;
  mounts: MountTable;
  egress: EgressPolicy;
  limits: { cpus: number; memoryMb: number; pids: number; wallClockMs: number };
}

export interface ExecResult { exitCode: number; stdout: string; stderr: string; durationMs: number; }

export interface SandboxCapabilities {
  computerUse: boolean; gpu: boolean; os: 'linux' | 'macos'; persistent: boolean; remote: boolean;
}

export interface SandboxProvider {
  readonly id: string;
  provision(spec: SandboxSpec): Promise<SandboxHandle>;
  exec(h: SandboxHandle, cmd: string[]): Promise<ExecResult>;
  destroy(h: SandboxHandle): Promise<void>;
  capabilities(): SandboxCapabilities;
}
```

M1 implements `LocalDockerProvider` only. M4b adds remote workers and pools behind the same interface (D27).

---

## 8. `packages/triggers/src/types.ts`

```ts
export type TriggerKind = 'human' | 'ci-failure' | 'review-feedback' | 'post-merge' | 'scheduled';
export type AuthorTrust = 'owner' | 'collaborator' | 'outside' | 'anonymous';

/**
 * I7: branded so untrusted text cannot be passed where a prompt string is expected.
 * `raw` is NEVER concatenated into a system or role prompt — only `extracted` crosses in.
 */
export interface UntrustedPayload {
  readonly __brand: 'UntrustedPayload';
  raw: string;
  source: string;
  authorTrust: AuthorTrust;
}

export interface TriggerLineage {
  depth: number;                      // maxTriggerDepth default 2
  chain: RunId[];
  windowStart: string;
}

export interface TriggerEvent {
  kind: TriggerKind;
  payload: UntrustedPayload;
  extracted: Record<string, string>;  // typed fields only; the sole path into a run
  lineage: TriggerLineage;
}

export interface TriggerRef { kind: TriggerKind; eventId: string; lineage: TriggerLineage; }

export interface TriggerPolicy {
  enabled: TriggerKind[];             // ships as ['human'] only
  entryStation: Partial<Record<TriggerKind, StationId>>;
  taskTemplate: Partial<Record<TriggerKind, string>>;   // pre-declared; payload cannot name it
  maxAutonomy: Partial<Record<TriggerKind, AutonomyLevel>>;
  minAuthorTrust: Partial<Record<TriggerKind, AuthorTrust>>;
  maxTriggerDepth: number;
  budgetPerWindow: { runs: number; windowMs: number };
}
```

---

## 9. `packages/adapters/src/types.ts`

```ts
export interface TestFrameworkAdapter {
  readonly stack: string;
  enumerateSuites(dir: string): Promise<string[]>;
  parseAssertions(file: string): Promise<Assertion[]>;
  compareAssertions(before: Assertion[], after: Assertion[]): AssertionDelta;
  detectSkipMarkers(file: string): Promise<string[]>;
}

export interface Assertion { file: string; line: number; operator: string; args: string[]; tolerance?: number; }
export interface AssertionDelta { weakened: Assertion[]; removed: Assertion[]; toleranceWidened: Assertion[]; }

export interface CoverageAdapter { changedLineCoverage(base: string, head: string): Promise<number>; }

export interface MutationAdapter {
  run(files: string[], budgetMs: number): Promise<{ score: number; survived: string[]; equivalent: string[]; timedOut: string[] }>;
}

export interface BehavioralAdapter {
  kind: 'cli' | 'http' | 'browser';
  run(scenario: BehavioralScenario, h: SandboxHandle): Promise<CheckResult>;
}

export interface BehavioralScenario {
  id: string;
  input: unknown;
  expected: unknown;                  // from locked acceptance criteria, never from the implementation
}

export interface ManifestAdapter { detectConfigChanges(base: string, head: string): Promise<string[]>; }

/** I5: an unsupported stack disables controls loudly and refuses L3. */
export interface AdapterSet {
  stack: string;
  test: TestFrameworkAdapter | null;
  coverage: CoverageAdapter | null;
  mutation: MutationAdapter | null;
  behavioral: BehavioralAdapter[];
  manifest: ManifestAdapter | null;
  unavailableControls(): string[];
}
```

---

## Acceptance Criteria

- `pnpm -r typecheck` passes with `strict: true`; zero `any`
- No file imports from a sibling package's `src/` — only from its published types
- No implementation, no function bodies except `declare`
- Each invariant I1–I10 is either expressed in a type or annotated with the file that will enforce it
- Nine files reviewed together in one sitting before any Phase 1 work begins
