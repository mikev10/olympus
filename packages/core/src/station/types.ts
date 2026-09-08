/**
 * Station contracts: what each of the ten stations requires from a driver, what
 * context it may see, where it may write, and the gate it must pass to exit.
 */
import type { DriverCapability } from '../driver/contract.js';
import type { ApprovalOutcome } from '../policy/types.js';
import type { ModelTier, StationId } from '../run/types.js';

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

export type StationTransition =
  | { ok: true; next: StationId }
  | { ok: false; reason: 'gate-failed' | 'lock-tamper' | 'violation' | 'parked'; detail: string };
