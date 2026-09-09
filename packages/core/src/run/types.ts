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
  | 'run-state' | 'rubric' | 'learning';

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
 * Read-only: a consumer holding a state cannot alter it. A new state is a
 * new record, committed through the Vault; that is the only way status or
 * station changes (I2).
 */
export interface RunState {
  readonly runId: RunId;
  readonly station: StationId;
  readonly tasks: Readonly<Record<TaskId, TaskStatus>>;   // the sole authority for task status (I2); Task holds none
  readonly evidenceRefs: readonly VaultRef[];
  readonly violations: readonly VaultRef[];
  readonly version: string;             // optimistic concurrency
}
