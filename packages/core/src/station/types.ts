/**
 * Station contracts: what each of the ten stations requires from a driver, what
 * context it may see, where it may write, and the gate it must pass to exit.
 */
import type { DriverCapability } from '../driver/contract.js';
import type { ApprovalOutcome } from '../policy/types.js';
import type { ModelTier, StationId, VaultRef } from '../run/types.js';

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

/** A locked artifact whose bytes no longer match the lock manifest (I3). */
export interface TamperedPath { path: string; expected: string; actual: string; }

/**
 * A refusal to advance. `reason` is a closed set and selects the payload a
 * machine reads; `message` says the same thing to a person. One string never
 * does both jobs, so a consumer reads fields and never parses prose.
 */
export type StationRefusal =
  | { ok: false; reason: 'gate-failed'; failed: FailedCheck[]; message: string }
  | { ok: false; reason: 'lock-tamper'; tampered: TamperedPath[]; message: string }
  | { ok: false; reason: 'violation'; violations: VaultRef[]; message: string }
  | { ok: false; reason: 'unsafe-above-l1'; components: string[]; message: string }
  | { ok: false; reason: 'capability-missing'; station: StationId; capability: DriverCapability; message: string }
  | { ok: false; reason: 'parked'; cause: string; retries: number; message: string };

export type StationTransition = { ok: true; next: StationId } | StationRefusal;
