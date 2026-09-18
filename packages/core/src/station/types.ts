/**
 * Station contracts: what each of the ten stations requires from a driver, what
 * context it may see, where it may write, and the gate it must pass to exit.
 */
import type { DriverCapability, ModelFamily, ModelIdentity } from '../driver/contract.js';
import type { ApprovalKey, ApprovalOutcome } from '../policy/types.js';
import type { ModelTier, StationId, TaskId, VaultRef } from '../run/types.js';

export type ContextGrant =
  | 'locked-spec' | 'acceptance-tests' | 'task-graph' | 'plan'
  | 'base-repo-readonly' | 'diff' | 'evidence-bundle'
  | 'author-narrative' | 'conversation';

export interface WriteBoundary {
  workspaceGlobs: string[];
  vault: 'never';                     // literal - I1 is unrepresentable otherwise
  protectedPathPolicy: 'escalate';    // escalates the integrate gate, does not hard-fail
}

export interface StationContract {
  id: StationId;
  requires: DriverCapability[];       // I5: fail closed when a driver lacks one
  allowedContext: ContextGrant[];     // review seats: never 'author-narrative' or 'plan'
  tier: ModelTier;
  writeBoundary: WriteBoundary;
  maxIterations: number;              // per-task iteration bound
  retry: { max: number; backoffMs: number };
  exitGate: ExitGate;
}

export interface ExitGate {
  requiredChecks: string[];           // CheckSpec ids
  requiresPanel: boolean;
  approval: ApprovalOutcome;
}

/** A check that failed the gate, in the runtime's own terms; the driver's claim has no way in (I2). */
export interface FailedCheck {
  checkId: string;
  /** The check's own exit code, or null when it produced no result because it could not be started. */
  exitCode: number | null;
  /** What fails it: a non-zero exit, no result at all, or a suite count that is unknown or below what was expected (I5). */
  cause: 'exit-code' | 'no-result' | 'suite-count';
}

/**
 * One review seat as the runtime assembled it (I6). `authors` are the model
 * identities recorded with the results of the tasks under review, read from
 * the Vault; `reviewer` is the identity recorded with the review task's own
 * result. `reduced` means the reviewer's family is an author's: reportable at
 * L0-L2, never at L3, where the seat is refused instead.
 */
export interface ReviewSeat {
  readonly task: TaskId;
  readonly authors: readonly ModelIdentity[];
  readonly reviewer: ModelIdentity;
  readonly independence: 'independent' | 'reduced';
}

/** A locked artifact whose bytes no longer match the lock manifest (I3). */
export interface TamperedPath { path: string; expected: string; actual: string; }

/**
 * Why a task stopped being attempted. `iterations-exhausted`: its gate failed
 * on every one of the contract's `maxIterations` builds. `retries-exhausted`:
 * its driver or sandbox failed more times than the contract's `retry.max`.
 * `starts-exhausted`: the driver was invoked more times than any uninterrupted
 * run of the station could invoke it, which is a run being replayed into the
 * same attempt rather than making progress (A-P4-06).
 */
export type ParkCause = 'iterations-exhausted' | 'retries-exhausted' | 'starts-exhausted';

/**
 * A refusal to advance. `reason` is a closed set and selects the payload a
 * machine reads; `message` says the same thing to a person. One string never
 * does both jobs, so a consumer reads fields and never parses prose.
 *
 * The three approval and seat arms are I4 and I6 made refusals: a `blocked`
 * approval cell, a `human-required` cell with no recorded grant, and, at L3
 * only, a reviewer whose model family is an author's. None of them is a
 * warning the run may continue past.
 */
export type StationRefusal =
  | { ok: false; reason: 'gate-failed'; failed: FailedCheck[]; message: string }
  | { ok: false; reason: 'lock-tamper'; tampered: TamperedPath[]; message: string }
  | { ok: false; reason: 'violation'; violations: VaultRef[]; message: string }
  | { ok: false; reason: 'unsafe-above-l1'; components: string[]; message: string }
  | { ok: false; reason: 'capability-missing'; station: StationId; capability: DriverCapability; message: string }
  | { ok: false; reason: 'approval-blocked'; key: ApprovalKey; message: string }
  | { ok: false; reason: 'approval-required'; key: ApprovalKey; message: string }
  | { ok: false; reason: 'same-family-reviewer'; task: TaskId; family: ModelFamily; message: string }
  | { ok: false; reason: 'parked'; task: TaskId; cause: ParkCause; limit: number; message: string };

/**
 * `spends` names the approval grant the advance consumes, or null when the
 * exit needed none. The line marks that grant used in the same commit as the
 * station move, so one human approval crosses one exit (A-P4-04).
 */
export type StationTransition = { ok: true; next: StationId; spends: ApprovalKey | null } | StationRefusal;
