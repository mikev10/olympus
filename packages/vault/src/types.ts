/**
 * The Vault: the runtime-only store for everything an agent must not be able
 * to alter. I1: no agent writes here, at every level, in every role. Enforced at
 * the mount layer (sandbox MountTable), not in application code.
 *
 * VaultRef and VaultRefKind live in core (run/types.ts) because run state
 * holds them; IntegrityViolation lives in integrity because it produces them.
 * The Vault stores both.
 */
import type { AgentClaim, RunId, RunState, StationId, TaskId, VaultRef } from '@olympus-ai/core';
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

export interface EvidenceBundle {
  runId: RunId;
  taskId: TaskId;
  baseCommit: string;                 // evidence is void if the base moves
  checks: CheckResult[];
  claim: AgentClaim;                  // stored beside evidence, never merged into it
  claimEvidenceDiff: string[];        // I2: where the model's story and the facts differ
  collectedBy: 'runtime';             // literal type: no other value is representable
  driverProvenanceId: string;
  contractVersion: string;
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
  readRunState(runId: RunId): Promise<RunState>;
  commitRunState(s: RunState, ifVersion: string): Promise<RunState>;
}
