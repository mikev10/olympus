/**
 * Station contracts: what each of the ten stations requires from a driver, what
 * context it may see, where it may write, and the gate it must pass to exit.
 */
import type { DriverCapability, ModelFamily, ModelIdentity } from '../driver/contract.js';
import type { ApprovalKey, ApprovalOutcome } from '../policy/types.js';
import type { ModelTier, StationId, TaskId, VaultRef } from '../run/types.js';

/**
 * `intent` is the person's text a spec-less run was admitted with, `draft`
 * the bytes of a recorded draft, and `rubric` the person's rubric a critic
 * checks a draft against (R19).
 */
export type ContextGrant =
  | 'locked-spec' | 'acceptance-tests' | 'task-graph' | 'plan'
  | 'base-repo-readonly' | 'diff' | 'evidence-bundle'
  | 'author-narrative' | 'conversation'
  | 'intent' | 'draft' | 'rubric';

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
 * How independent two seats are, from the models the runtime resolved for
 * them (D-A-DS-06): another family, another model in the same family, or the
 * same model. Only `different-family` is independent (I6); the other two are
 * recorded so a rate can be kept per grade, and satisfy nothing.
 */
export type IndependenceGrade = 'different-family' | 'different-model' | 'same-model';

/**
 * One review seat as the runtime assembled it (I6). `authors` are the model
 * identities recorded with the results of the tasks under review, read from
 * the Vault; `reviewer` is the identity recorded with the review task's own
 * result. `independence` is the weakest grade between the reviewer and any
 * author. Anything but `different-family` is reportable at L0-L2, and refused
 * at L3 where the reviewer shares an author's family.
 */
export interface ReviewSeat {
  readonly task: TaskId;
  readonly authors: readonly ModelIdentity[];
  readonly reviewer: ModelIdentity;
  readonly independence: IndependenceGrade;
}

/** The stations a drafter may be seated at (R19). */
export type DraftStation = 'spec' | 'test-design';

/** The two seats a drafting station holds. */
export type DraftSeat = 'drafter' | 'critic';

/**
 * A condition the drafted floor requires for `auto` at L2, named so a failed
 * one is recorded by name (D-A-DS-04). At `spec`: the parts parse, no open
 * question, a clean independent critic. At `test-design`: the base run
 * passed for the draft, a clean independent critic, and a test drafter of
 * another family than every model the build driver can resolve.
 */
export type DraftCondition =
  | 'shape'
  | 'no-open-question'
  | 'independent-critic-clean'
  | 'base-run-passed'
  | 'drafter-independent-of-builder';

/**
 * Why a person rejected a test draft: a fixed set and nothing else, since an
 * approver who has read the repository would otherwise be a channel around
 * the black box (D-A-DS-02).
 */
export type RejectionReason = 'not-black-box' | 'does-not-follow-spec' | 'not-runnable' | 'misses-spec-cases';

/**
 * What a check did on the base that refused a test draft, as the next
 * attempt learns it: the check's id, its declaration, and either its exit
 * code or a cause from a fixed set. Never its output, which carries the
 * repository (I7, D-A-DS-01).
 */
export type BaseRefusalPart =
  | { readonly checkId: string; readonly declared: 'fails' | 'passes' | null; readonly exitCode: number }
  | { readonly checkId: string; readonly declared: 'fails' | 'passes' | null; readonly cause: 'did-not-start' | 'suite-short' };

/**
 * A typed part of a drafter's retry, carried in the request's variable
 * suffix and never in its stable prefix or role (D-A-DS-02). The runtime's
 * own problems with a draft are paths and codes; `notes` exist at `spec`
 * alone, and a `test-design` rejection carries a reason and no text.
 */
export type RetryPart =
  | { readonly kind: 'critic-findings'; readonly findings: readonly string[] }
  | { readonly kind: 'runtime-problems'; readonly problems: ReadonlyArray<{ readonly path: string; readonly code: string }> }
  | { readonly kind: 'base-refusal'; readonly checks: readonly BaseRefusalPart[] }
  | { readonly kind: 'rejection-reason'; readonly reason: RejectionReason }
  | { readonly kind: 'notes'; readonly notes: string };

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

/**
 * A part of a spec, each a JSON file locked with it. The runtime requires the
 * security part of every spec (R17). A drafted spec carries all three: what
 * the acceptance checks need to run, and its assumptions and open questions
 * (R19); a supplied spec may.
 */
export type SpecPart = 'security' | 'run-requirements' | 'questions';

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
 * `drafts-rejected`: a person rejected a drafting station's last allowed
 * draft, which parks the run terminally (R19, D-A-DS-02).
 */
export type ParkCause = 'iterations-exhausted' | 'retries-exhausted' | 'starts-exhausted' | 'conflicts-exhausted' | 'drafts-rejected';

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
  /** At L3, a test drafter of a family the build driver can resolve: refused as a same-family reviewer is (R19, R9). */
  | { ok: false; reason: 'same-family-drafter'; station: 'test-design'; family: ModelFamily; message: string }
  | { ok: false; reason: 'parked'; task: TaskId; cause: Exclude<ParkCause, 'conflicts-exhausted' | 'drafts-rejected'>; limit: number; message: string }
  /**
   * A drafting station's last allowed draft rejected by a person. A draft has
   * no graph task, so the arm names the station (R19).
   */
  | { ok: false; reason: 'parked'; task: null; station: DraftStation; cause: 'drafts-rejected'; limit: number; message: string }
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

/**
 * A critic's seat at a drafting station (R19): the drafter's grants, the
 * recorded draft, and the rubric, and nothing writable. One call per draft,
 * retried on a driver failure like any seat.
 */
export interface CriticContract {
  readonly station: DraftStation;
  readonly requires: DriverCapability[];
  readonly allowedContext: ContextGrant[];
  readonly writeBoundary: WriteBoundary & { readonly workspaceGlobs: [] };
  readonly retry: { readonly max: number; readonly backoffMs: number };
}
