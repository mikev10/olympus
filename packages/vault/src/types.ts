/**
 * The Vault: the runtime-only store for everything an agent must not be able
 * to alter. I1: no agent writes here, at every level, in every role. Enforced at
 * the mount layer (sandbox MountTable), not in application code.
 *
 * VaultRef and VaultRefKind live in core (run/types.ts) because run state
 * holds them; IntegrityViolation lives in integrity because it produces them.
 * The Vault stores both.
 */
import type {
  AgentClaim, ApprovalKey, AutonomyLevel, Policy, PolicyRefusal, RoleId, Run, RunId, RunState, StationId, StationRefusal, TaskId, TaskResult, VaultRef,
} from '@olympus-ai/core';
import type { CheckResult, IntegrityViolation, TamperReport } from '@olympus-ai/integrity';
import type { EgressConnection, MeterReading } from '@olympus-ai/sandbox';

/**
 * I3: an agent may not be judged by an artifact it can write. Specs and
 * acceptance tests are hashed into a LockManifest before `build` and
 * re-verified at every station transition; a mismatch is a failing
 * LockVerdict, never a warning.
 */
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

/** A required or optional check that produced no result, and why. No exit code is invented for it (A-P6-02). */
export interface UnstartedCheck {
  readonly checkId: string;
  readonly reason: string;
}

/**
 * One path the task changed, as the runtime collected it by comparing the tree
 * it handed the task with the tree the task left. `sha256` is the content
 * after the change, or null for a removal (A-P6-03).
 */
export interface DiffEntry {
  readonly path: string;
  readonly change: 'added' | 'removed' | 'modified';
  readonly sha256: string | null;
}

export interface EvidenceBundle {
  runId: RunId;
  taskId: TaskId;
  baseCommit: string;                 // evidence is void if the base moves
  /** The digest of the tree admitted as base. `baseCommit` alone does not name it: a working copy can differ from its commit (A-P6-03). */
  baseTreeSha256: string;
  /** What the checks ran over: base, every diff accepted before this task, and this one. */
  diff: readonly DiffEntry[];
  diffSha256: string;
  checks: CheckResult[];
  /** Every check that produced no result. A required one here has failed the gate. */
  unstarted: readonly UnstartedCheck[];
  claim: AgentClaim;                  // stored beside evidence, never merged into it
  claimEvidenceDiff: string[];        // I2: where the model's story and the facts differ
  /**
   * The runtime's reading of this task's diff, over the tree it was handed and
   * the tree it was verified in. Every finding escalates the `integrate` exit;
   * none decides the task's status (A-P7-03).
   */
  tamper: TamperReport;
  collectedBy: 'runtime';             // literal type: no other value is representable
  driverProvenanceId: string;
  contractVersion: string;
}

/**
 * What one driver call cost, as the runtime collected it: the reading the
 * sandbox's relay took after the sandbox stopped (A-P13-03). One per call —
 * every build attempt, a failed one included, and every review seat — so a
 * call that spent money and produced nothing still appears.
 *
 * I2: never taken from the driver's `TaskResult.usage`, which is the CLI's own
 * account from inside the sandbox. `collectedBy` is a literal for the reason
 * `EvidenceBundle`'s is. A call whose sandbox had no relay is `unmetered`, and
 * a total over it says so rather than counting it as free.
 */
export interface UsageRecord {
  runId: RunId;
  taskId: TaskId;
  station: StationId;
  /** The task's `starts` count for this call: which invocation of the task it was. */
  attempt: number;
  reading: MeterReading;
  collectedBy: 'runtime';
}

/**
 * A refusal returned before a run's first state, as admission returned it
 * (A-P14-01). Each arm keeps the typed fields a reader counts by; nothing here
 * is text a caller sent. An invalid request keeps each problem's path and
 * code and not its message, because a message can quote the request
 * (D-P14-06).
 */
export type AdmissionRefusal =
  | { readonly reason: 'invalid-request'; readonly problems: ReadonlyArray<{ readonly path: string; readonly code: string }> }
  | { readonly reason: 'unsafe-above-l1'; readonly requestedLevel: AutonomyLevel; readonly components: readonly string[] }
  | { readonly reason: 'cost-unapproved'; readonly requestedLevel: AutonomyLevel; readonly worstCaseUsd: number; readonly approvedCostUsd: number | null }
  | { readonly reason: 'controls-unavailable'; readonly requestedLevel: AutonomyLevel; readonly unavailable: readonly string[] }
  | { readonly reason: 'policy-refused'; readonly station: StationId; readonly role: RoleId | null; readonly refusal: PolicyRefusal }
  | { readonly reason: 'refused'; readonly at: StationId; readonly refusal: StationRefusal };

/** The admission checks a resume repeats before the line runs, refused there (D-P14-11). */
export type ResumeRefusal = Extract<AdmissionRefusal, { reason: 'unsafe-above-l1' | 'refused' }>;

/**
 * What a control decided, and which control it was. `decidedBy` is fixed by
 * the cause wherever one component alone can make it, so a decision cannot
 * be attributed to a component that does not make it. The runtime writes
 * every one of them on the decider's behalf: the station machine is pure and
 * the proxy is a container with no route to the Vault (D-P14-09).
 */
export type DecisionCause =
  | { readonly cause: 'admission-refused'; readonly decidedBy: 'admission'; readonly refusal: AdmissionRefusal }
  | { readonly cause: 'resume-refused'; readonly decidedBy: 'admission'; readonly refusal: ResumeRefusal }
  /** `station-machine` for a refusal `nextStep` or a capability check returned, `line` for one the line made itself. */
  | { readonly cause: 'station-refused'; readonly decidedBy: 'station-machine' | 'line'; readonly refusal: StationRefusal }
  /** `principal` is what the caller authenticated, as `ApprovalGrant.approvedBy` records it. */
  | { readonly cause: 'approval-granted'; readonly decidedBy: 'approval'; readonly key: ApprovalKey; readonly principal: string }
  /** `key` is null when what the caller sent was not an approval key; it is not stored, since it is the caller's text. */
  | { readonly cause: 'approval-refused'; readonly decidedBy: 'approval'; readonly key: ApprovalKey | null; readonly reason: 'invalid-request' | 'not-awaiting' }
  /** One connection the egress proxy decided, read from its log after it stopped. `host` is the agent's choice: data, never a prompt (I7). */
  | { readonly cause: 'egress-connection'; readonly decidedBy: 'egress-proxy'; readonly connection: EgressConnection }
  /** A violation already recorded; the decision points at it rather than copying it (D-P14-08). */
  | { readonly cause: 'violation-recorded'; readonly decidedBy: 'line'; readonly violation: VaultRef }
  /** A driver call whose relay refused anything, pointing at its usage record (D-P14-05). */
  | {
      readonly cause: 'relay-refused';
      readonly decidedBy: 'model-relay';
      readonly usage: VaultRef;
      readonly refused: number;
      readonly exhausted: Extract<MeterReading, { kind: 'metered' }>['exhausted'];
    };

export type DecidingComponent = DecisionCause['decidedBy'];

/**
 * One decision a control made, recorded by the runtime beside run state and
 * never in it (A-P14-01, D-P14-02). Write-once and content-addressed like
 * evidence. I2: every field is the runtime's; nothing a model returned is an
 * input. `taskId` and `station` are null where the decision had none — an
 * admission refusal has neither.
 */
export interface EnforcementDecision {
  readonly runId: RunId;
  readonly taskId: TaskId | null;
  readonly station: StationId | null;
  readonly decidedAt: string;
  readonly decision: DecisionCause;
  readonly collectedBy: 'runtime';
}

/** An artifact as admitted: where it sits in the workspace, and the SHA-256 of its bytes at admission. */
export interface AdmittedArtifact {
  readonly path: string;
  readonly sha256: string;
}

/**
 * What a run was admitted as. Written once, before the run's first state, and
 * never again: a resume reads the requested level, the policy, and the
 * artifacts from here, so its caller has no way to restate them (I5).
 *
 * `policy` is the resolved Policy, not the document it came from, so an
 * auditor reads the effective table. Each artifact carries the hash it had at
 * admission; the station that locks it refuses a lock whose hash differs,
 * so what a station locks is what was admitted (I3).
 */
export interface AdmissionRecord {
  readonly run: Run;
  readonly policy: Policy;
  readonly artifacts: {
    readonly spec: readonly AdmittedArtifact[];
    readonly acceptanceTests: readonly AdmittedArtifact[];
    readonly verificationManifest: AdmittedArtifact;
    readonly taskGraph: AdmittedArtifact;
  };
  /** The digest of the base tree the runtime snapshotted at admission; every workspace is built from it (A-P6-03). */
  readonly baseTreeSha256: string;
  /**
   * The controls the run's adapter set lacks, recorded so a resume reads them
   * rather than having them restated. An L3 run is refused at admission while
   * this is non-empty (I5).
   */
  readonly unavailableControls: readonly string[];
}

/**
 * I1: no generic write(). Every mutator is a named, audited operation the runtime
 * calls. No method on this interface is reachable from inside a Workspace.
 */
export interface Vault {
  read(ref: VaultRef): Promise<Uint8Array>;
  lock(runId: RunId, paths: string[], by: StationId): Promise<LockManifest>;
  verifyLocks(runId: RunId): Promise<LockVerdict>;
  writeEvidence(b: EvidenceBundle): Promise<VaultRef>;
  recordViolation(v: IntegrityViolation): Promise<VaultRef>;
  /** Refused when the run already has an admission record. */
  recordAdmission(a: AdmissionRecord): Promise<VaultRef>;
  /** The result exactly as the driver returned it. A claim a later station reads comes from here, never from memory. */
  recordTaskResult(runId: RunId, r: TaskResult): Promise<VaultRef>;
  /** What one driver call cost, as the runtime read it from the relay. Refused unless `collectedBy` is `'runtime'`. */
  recordUsage(r: UsageRecord): Promise<VaultRef>;
  /**
   * One enforcement decision, as the runtime recorded it for the component
   * that made it. Refused unless `collectedBy` is `'runtime'`. Needs no run
   * state: a refused admission is recorded under the run id it asked for, and
   * nothing else is written for it (D-P14-01).
   */
  recordDecision(d: EnforcementDecision): Promise<VaultRef>;
  /** Every decision recorded for a run, in no promised order; empty for a run with none (D-P14-02). */
  readDecisions(runId: RunId): Promise<readonly VaultRef[]>;
  readRunState(runId: RunId): Promise<RunState>;
  commitRunState(s: RunState, ifVersion: string): Promise<RunState>;
}
