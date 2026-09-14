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
import type { ReviewSeat } from '../station/types.js';

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
  | 'admission' | 'task-result';

export interface VaultRef { runId: RunId; kind: VaultRefKind; hash: string; }

// Trigger references. The trigger envelope (packages/triggers) is where
// untrusted input lives; a run records only which kind of trigger started it
// and its lineage.

export type TriggerKind = 'human' | 'ci-failure' | 'review-feedback' | 'post-merge' | 'scheduled';
export type AuthorTrust = 'owner' | 'collaborator' | 'outside' | 'anonymous';

export interface TriggerLineage {
  depth: number;                      // maxTriggerDepth default 2
  chain: RunId[];
  windowStart: string;
}

export interface TriggerRef { kind: TriggerKind; eventId: string; lineage: TriggerLineage; }

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
 * How much of a task's budget of attempts is spent. Both counts are committed
 * before the attempt they count starts, so a resume can re-run an attempt that
 * was in flight but cannot run one uncounted.
 */
export interface TaskAttempts {
  /** Builds started. Bounded by the build contract's `maxIterations`. */
  readonly iterations: number;
  /** Driver or sandbox failures in the current iteration. Bounded by the station contract's `retry.max`; a new iteration starts at zero. */
  readonly retries: number;
}

/** A human's approval of one station exit at one level, recorded by the runtime (I4). */
export interface ApprovalGrant {
  readonly key: ApprovalKey;
  /** Who approved. The runtime records what its caller authenticated; P9 owns authentication. */
  readonly approvedBy: string;
  readonly approvedAt: string;
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
  readonly version: string;             // optimistic concurrency
}
