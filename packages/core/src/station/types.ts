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
  /**
   * What fails it: a non-zero exit, no result at all, a suite count that is
   * unknown or below what was expected (I5), or an expectation the runtime's
   * comparison found did not hold, whatever the exit code (A-P8-01). A
   * security check fails on a finding the base did not have, `new-finding`,
   * or on a suppression marker the diff added, `suppression-added`, whatever
   * its scanner's exit code (D-A-SC-02, D-R17-04).
   */
  cause: 'exit-code' | 'no-result' | 'suite-count' | 'expectation' | 'new-finding' | 'suppression-added';
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

/**
 * One declared check that did not do on the base what the locked manifest
 * declared (D-A-BF-01). `contrary`: it exited 0 where it was declared to
 * fail, or non-zero where it was declared to pass. `no-result`: it did not
 * start, which is never counted as a failure. `suite-count`: the base's
 * suites could not be counted, or counted below `expectedSuiteCount`, so the
 * runner may never have loaded the test (I5).
 */
export interface BaseMismatch {
  checkId: string;
  /** `null` for a security check, which declares nothing: it runs over the base for its findings, and one with none readable there is `no-result` (D-R17-01). */
  declared: 'fails' | 'passes' | null;
  /** The check's own exit code on the base, or null when it produced no result. */
  exitCode: number | null;
  cause: 'contrary' | 'no-result' | 'suite-count';
}

/** A part the runtime requires of every spec, whatever its template; the security part is the only one today. */
export type SpecPart = 'security';

/** A locked artifact whose bytes no longer match the lock manifest (I3). */
export interface TamperedPath { path: string; expected: string; actual: string; }

/**
 * Why a task stopped being attempted. `iterations-exhausted`: its gate failed
 * on every one of the contract's `maxIterations` builds. `retries-exhausted`:
 * its driver or sandbox failed more times than the contract's `retry.max`.
 * `starts-exhausted`: the driver was invoked more times than any uninterrupted
 * run of the station could invoke it, which is a run being replayed into the
 * same attempt rather than making progress (A-P4-06). `conflicts-exhausted`:
 * a sibling's accepted change collided with the task's own more times than the
 * policy's `concurrency.maxConflictRetries` allows (A-R4-02).
 */
export type ParkCause = 'iterations-exhausted' | 'retries-exhausted' | 'starts-exhausted' | 'conflicts-exhausted';

/**
 * A refusal to advance. `reason` is a closed set and selects the payload a
 * machine reads; `message` says the same thing to a person. One string never
 * does both jobs, so a consumer reads fields and never parses prose.
 *
 * The three approval and seat arms are I4 and I6 made refusals: a `blocked`
 * approval cell, a `human-required` cell with no recorded grant, and, at L3
 * only, a reviewer whose model family is an author's. None of them is a
 * warning the run may continue past.
 *
 * `cancelled` is a human's stop, recorded in run state: the run does not
 * continue, and a resume reads the record and refuses (A-P9-01).
 */
export type StationRefusal =
  | { ok: false; reason: 'gate-failed'; failed: FailedCheck[]; message: string }
  | { ok: false; reason: 'lock-tamper'; tampered: TamperedPath[]; message: string }
  /**
   * The declared checks run over the base at the `test-design` exit did not
   * do what the manifest declared (D-A-BF-01). `baseRun` is the record the
   * runtime wrote of that run; `mismatched` is never empty.
   */
  | { ok: false; reason: 'base-mismatch'; mismatched: [BaseMismatch, ...BaseMismatch[]]; baseRun: VaultRef; message: string }
  /** A part every spec must carry was not admitted, refused at the `spec` exit (R17). */
  | { ok: false; reason: 'spec-part-missing'; part: SpecPart; message: string }
  /**
   * Authorization rules the spec's security part names with no locked
   * acceptance or behavioral check naming them, refused at the `test-design`
   * exit (R17). Never empty.
   */
  | { ok: false; reason: 'denial-check-missing'; rules: [string, ...string[]]; message: string }
  | { ok: false; reason: 'violation'; violations: VaultRef[]; message: string }
  | { ok: false; reason: 'unsafe-above-l1'; components: string[]; message: string }
  | { ok: false; reason: 'capability-missing'; station: StationId; capability: DriverCapability; message: string }
  | { ok: false; reason: 'approval-blocked'; key: ApprovalKey; message: string }
  /**
   * `escalations`: what raised the exit to a human beyond its own floor and
   * the policy cell — each protected path touched and each tamper finding —
   * so the person approving is told why (A-I1a-07). Empty when nothing did.
   */
  | { ok: false; reason: 'approval-required'; key: ApprovalKey; escalations: string[]; message: string }
  | { ok: false; reason: 'same-family-reviewer'; task: TaskId; family: ModelFamily; message: string }
  | { ok: false; reason: 'parked'; task: TaskId; cause: Exclude<ParkCause, 'conflicts-exhausted'>; limit: number; message: string }
  /**
   * A conflict past the policy's bound: the siblings and the paths of the last
   * one, read from run state, so the refusal names both sides (A-R4-02).
   */
  | {
    ok: false; reason: 'parked'; task: TaskId; cause: 'conflicts-exhausted'; limit: number;
    conflictsWith: readonly [TaskId, ...TaskId[]]; paths: readonly [string, ...string[]]; message: string;
  }
  | { ok: false; reason: 'cancelled'; cancelledBy: string; cancelledAt: string; message: string }
  | { ok: false; reason: 'halted'; haltedAt: string; message: string };

/**
 * `spends` names the approval grant the advance consumes, or null when the
 * exit needed none. The line marks that grant used in the same commit as the
 * station move, so one human approval crosses one exit (A-P4-04).
 */
export type StationTransition = { ok: true; next: StationId; spends: ApprovalKey | null } | StationRefusal;
