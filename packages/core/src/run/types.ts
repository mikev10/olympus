/**
 * Run, task, and task-graph records, plus the reference types that run state
 * and policy point at. Every field here is written by the runtime; nothing in
 * this file is populated from a model's output.
 *
 * This file is the root of the package graph. Every other package depends on
 * core, and core depends only on sandbox. Types that policy or run state refer
 * to live here for that reason, even where another package owns their
 * implementation.
 */
import type { ApprovalKey } from '../policy/types.js';
import type { DraftCondition, DraftStation, ParkCause, RejectionReason, ReviewSeat } from '../station/types.js';

export type RunId = string & { readonly __brand: 'RunId' };
export type TaskId = string & { readonly __brand: 'TaskId' };
export type RoleId = string & { readonly __brand: 'RoleId' };

export type StationId =
  | 'intake' | 'spec' | 'test-design' | 'plan' | 'build'
  | 'verify' | 'review' | 'integrate' | 'observe' | 'learn';

export type AutonomyLevel = 0 | 1 | 2 | 3;
export type ModelTier = 'fast' | 'standard' | 'deep';

// Vault references. The Vault (packages/vault) stores the artifacts; run state
// holds only references to them.

export type VaultRefKind =
  | 'spec' | 'acceptance-tests' | 'task-graph' | 'lock-manifest'
  | 'policy' | 'verification-manifest' | 'evidence' | 'violation'
  | 'run-state' | 'rubric' | 'learning'
  | 'admission' | 'task-result' | 'usage' | 'decision' | 'integration' | 'base-run'
  | 'intent' | 'draft' | 'critic-result' | 'draft-lock';

export interface VaultRef { runId: RunId; kind: VaultRefKind; hash: string; }

// Trigger references. The trigger envelope (packages/triggers) is where
// untrusted input lives; a run records only which kind of trigger started it
// and its lineage.

export type TriggerKind = 'human' | 'ci-failure' | 'review-feedback' | 'post-merge' | 'scheduled' | 'issue';
export type AuthorTrust = 'owner' | 'collaborator' | 'outside' | 'anonymous';

export interface TriggerLineage {
  depth: number;                      // maxTriggerDepth default 2
  chain: RunId[];
  windowStart: string;
}

export interface TriggerRef { kind: TriggerKind; eventId: string; lineage: TriggerLineage; }

/** A recorded intake candidate, by the id the runtime gave it (A-R22-04). */
export type CandidateId = string & { readonly __brand: 'CandidateId' };

export interface Run {
  id: RunId;
  repo: string;
  baseCommit: string;          // immutable ref; evidence binds to this
  trigger: TriggerRef;
  requestedLevel: AutonomyLevel;
  station: StationId;
  graph: TaskGraph | null;     // null before `plan`
  createdAt: string;
}

/**
 * The static definition of one task, as emitted by `plan`. It carries no
 * mutable state: status lives only in RunState.tasks, so there is exactly one
 * place it can be read from (I2) and a RunState alone is enough to resume a
 * run.
 */
export interface Task {
  id: TaskId;
  runId: RunId;
  station: StationId;
  role: RoleId;
  dependsOn: TaskId[];
  baseCommit: string;          // may advance from Run.baseCommit after rebase
  /**
   * Globs this task reads and writes. A merge invalidates only the tasks whose
   * dependency set it touches; without this the scheduler is O(N^2) and blows
   * the cost budget on its own.
   */
  dependencySet: string[];
  worktreePath: string;
  attempt: number;
}

export type TaskStatus =
  | 'pending' | 'ready' | 'running' | 'verifying'
  | 'passed' | 'failed' | 'parked' | 'cancelled';

export interface TaskGraph {
  tasks: Task[];
  edges: Array<{ from: TaskId; to: TaskId }>;
}

/**
 * `working`: the station's own work is not finished. `exiting`: it is, and
 * only the exit gate remains. A resume that finds `exiting` evaluates the gate
 * and does not redo the work.
 */
export type StationPhase = 'working' | 'exiting';

/**
 * How much of a task's budget is spent. Every count is committed before the
 * attempt it counts begins, so no attempt runs uncounted.
 *
 * `iterations` and `retries` measure work: what the model was asked to do, and
 * how often the machinery under it failed. `starts` measures invocations, and
 * the two are not the same number. A run stopped between the commit that marks
 * a task `running` and the commit that records its result leaves an attempt in
 * flight; the resume runs the driver again, which costs money and spends no
 * iteration. `starts` is what makes that replay visible and bounded (A-P4-06).
 */
export interface TaskAttempts {
  /** Builds the model was asked for. Bounded by the build contract's `maxIterations`. */
  readonly iterations: number;
  /** Driver or sandbox failures in the current iteration. Bounded by the station contract's `retry.max`; a new iteration starts at zero. */
  readonly retries: number;
  /**
   * Times the driver was actually invoked for this task, including every
   * replay of an attempt a stop left in flight. Never lower than `iterations`;
   * the gap between them is how often the run was interrupted mid-attempt.
   * Bounded by `maxStarts` for the station.
   */
  readonly starts: number;
  /**
   * Each time `verify` found that a path this task changed was also changed by
   * a sibling's accepted work after the task started, in the order found
   * (A-R4-01). A conflict sends the task back to `build` and spends an
   * iteration that no gate judged, so the gates failed so far are
   * `iterations - 1 - conflicts.length`. Bounded by the policy's
   * `concurrency.maxConflictRetries`.
   */
  readonly conflicts: readonly TaskConflict[];
  /**
   * Why the task was parked, recorded by the park itself in the commit that
   * parks it. The counts cannot always say: the last iteration replayed to the
   * start bound, and every iteration spending every retry, leave the same
   * numbers (A-R4-05). Absent on a task that is not parked, and on a park
   * committed before the cause was recorded, which is read from its counts.
   */
  readonly parkedFor?: ParkCause;
}

/**
 * One conflict: the siblings whose accepted change touched a path this task
 * also changed, and those paths. A conflict is a whole path changed by both;
 * nothing is merged inside a file, and no side is picked (I5, D-R4-04).
 */
export interface TaskConflict {
  readonly with: readonly [TaskId, ...TaskId[]];
  readonly paths: readonly [string, ...string[]];
}

/** A human's approval of one station exit at one level, recorded by the runtime (I4). */
export interface ApprovalGrant {
  readonly key: ApprovalKey;
  /** Who approved. The runtime records what its caller authenticated; P9 owns authentication. */
  readonly approvedBy: string;
  readonly approvedAt: string;
  /**
   * When the exit this grant authorised was crossed, or null while it is
   * unspent. A grant authorises one exit, not the station: a run that comes
   * back to `build` after a failed verify meets the gate again with this one
   * already spent, and waits for a second human (A-P4-04). Spent grants stay
   * in run state, because they are the record that a human approved.
   */
  readonly usedAt: string | null;
  /**
   * The draft this grant approved, at a drafting station's exit, or null at
   * any other. A grant clears only the draft and attempt it names, so an
   * approval of one draft never clears another (R19). The Vault reads a grant
   * recorded before R19 as null.
   */
  readonly draft: DraftRef | null;
}

/** One draft: the hash the runtime computed over the bytes it read, and the attempt that produced it. */
export interface DraftRef {
  readonly sha256: string;
  readonly attempt: number;
}

/**
 * Why a draft went back, recorded with the attempt it ended (R19). `runtime`:
 * the runtime's own problems with it, as paths and codes. `critic`: an
 * independent critic's findings, held in the critic record. `base-run`: its
 * checks did not do on the base what they declared, held in the base record.
 * `principal`: a person rejected it, with notes at `spec` or a reason from a
 * fixed set at `test-design`, never both (D-A-DS-02).
 */
export type DraftSendBack =
  | { readonly by: 'runtime'; readonly problems: ReadonlyArray<{ readonly path: string; readonly code: string }> }
  | { readonly by: 'critic' }
  | { readonly by: 'base-run' }
  | {
      readonly by: 'principal';
      readonly principal: string;
      readonly at: string;
      readonly notes: string | null;
      readonly reason: RejectionReason | null;
    };

/**
 * One attempt at a drafting station, filled in as the runtime does each part
 * of it, so a resume does only what is not recorded. Every reference is to a
 * record the runtime wrote (I2).
 */
export interface DraftAttempt {
  readonly attempt: number;
  /** The recorded draft, or null while the drafter has not produced one. */
  readonly draft: VaultRef | null;
  readonly sha256: string | null;
  /** The critic's recorded result, `not-seated` where no model but the drafter's was available, or null before it ran. */
  readonly critic: VaultRef | 'not-seated' | null;
  /** `test-design` only: the base record for this draft's hash. */
  readonly baseRun: VaultRef | null;
  /** The drafted floor's failed conditions, evaluated by the runtime when the draft reached the gate; null before. */
  readonly failed: readonly DraftCondition[] | null;
  readonly sentBack: DraftSendBack | null;
}

/**
 * A drafting station's record in run state: every attempt in order, the
 * draft lock once its draft was approved and locked, and whether a person's
 * rejection of the last allowed attempt parked the run (R19).
 */
export interface DraftState {
  readonly attempts: readonly DraftAttempt[];
  readonly locked: VaultRef | null;
  readonly parked: boolean;
}

/**
 * A human's stop of the whole run, recorded by the runtime. `by` is what the
 * caller authenticated, as `ApprovalGrant.approvedBy` is (A-P9-01).
 */
export interface RunCancellation {
  readonly by: string;
  readonly at: string;
}

/**
 * A drive of the run that ended in an error rather than a refusal, recorded
 * by the runtime that drove it. The line stopped without committing why, so
 * this is that record: `message` is the runtime's own account of the error,
 * never a field a driver returned (A-P9-02).
 */
export interface RunHalt {
  readonly at: string;
  readonly message: string;
}

/**
 * One station the run entered, and when, by the runtime's clock (A-R12-02).
 */
export interface StationEntry {
  readonly station: StationId;
  readonly enteredAt: string;
}

/**
 * Read-only: a consumer holding a state cannot alter it. A new state is a
 * new record, committed through the Vault; that is the only way status or
 * station changes (I2).
 *
 * A RunState and the Vault records it references are enough to resume a run.
 * Nothing a resume needs comes from its caller: the level, the policy, and the
 * artifacts are in the admission record, the attempt counts and approvals are
 * here, and every result a later station reads is recorded in the Vault.
 */
export interface RunState {
  readonly runId: RunId;
  /** The write-once admission record: the Run, the resolved Policy, and the artifacts each station locks. */
  readonly admission: VaultRef;
  readonly station: StationId;
  /**
   * Every station the run entered, in order, the first written at admission
   * (A-R12-02). The Vault reads a state committed before R12 as empty, so an
   * empty list means the entries were not recorded, never that none was entered.
   */
  readonly stations: readonly StationEntry[];
  readonly phase: StationPhase;
  readonly tasks: Readonly<Record<TaskId, TaskStatus>>;   // the sole authority for task status (I2); Task holds none
  readonly attempts: Readonly<Record<TaskId, TaskAttempts>>;
  /** The latest recorded TaskResult for each task that has run. */
  readonly results: Readonly<Record<TaskId, VaultRef>>;
  readonly evidenceRefs: readonly VaultRef[];
  readonly violations: readonly VaultRef[];
  readonly approvals: readonly ApprovalGrant[];
  /** Every review seat assembled, with its independence (I6). */
  readonly reviews: readonly ReviewSeat[];
  /**
   * Each drafting station's attempts, for a run admitted without that
   * station's artifact; empty for a run admitted with every artifact (R19).
   * The Vault reads a state committed before R19 as empty.
   */
  readonly drafts: Readonly<Partial<Record<DraftStation, DraftState>>>;
  /**
   * One `UsageRecord` per driver call, failed attempts and review seats
   * included, in the order the calls ended (A-P13-04). No total is stored:
   * a total is derived from these records, so it cannot disagree with them.
   */
  readonly usage: readonly VaultRef[];
  /**
   * Null while the run may continue. Once set it is never cleared: the
   * station machine refuses every step of a cancelled run, so a resume
   * cannot carry it on (A-P9-01).
   */
  readonly cancelled: RunCancellation | null;
  /**
   * Null while the run may continue. Set when a drive ended in an error, and
   * never cleared: the station machine refuses every step of a halted run, so
   * its status reads stopped and a cancel cannot relabel it (A-P9-02).
   */
  readonly halted: RunHalt | null;
  readonly version: string;             // optimistic concurrency
}
