/**
 * The Vault: the runtime-only store for everything an agent must not be able
 * to alter. I1: no agent writes here, at every level, in every role. Enforced at
 * the mount layer (sandbox MountTable), not in application code.
 *
 * VaultRef and VaultRefKind live in core (run/types.ts) because run state
 * holds them; IntegrityViolation lives in integrity because it produces them.
 * The Vault stores both.
 */
import type { AgentClaim, Policy, Run, RunId, RunState, StationId, TaskId, TaskResult, VaultRef } from '@olympus-ai/core';
import type { CheckResult, IntegrityViolation } from '@olympus-ai/integrity';

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
  collectedBy: 'runtime';             // literal type: no other value is representable
  driverProvenanceId: string;
  contractVersion: string;
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
  readRunState(runId: RunId): Promise<RunState>;
  commitRunState(s: RunState, ifVersion: string): Promise<RunState>;
}
