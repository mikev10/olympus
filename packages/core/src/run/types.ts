/**
 * Run, task, and task-graph records. Every field here is written by the
 * runtime; nothing in this file is populated from a model's output.
 */
import type { TriggerRef } from '@olympus-ai/triggers';
import type { VaultRef } from '@olympus-ai/vault';

export type RunId = string & { readonly __brand: 'RunId' };
export type TaskId = string & { readonly __brand: 'TaskId' };
export type RoleId = string & { readonly __brand: 'RoleId' };

export type StationId =
  | 'intake' | 'spec' | 'test-design' | 'plan' | 'build'
  | 'verify' | 'review' | 'integrate' | 'observe' | 'learn';

export type AutonomyLevel = 0 | 1 | 2 | 3;
export type ModelTier = 'fast' | 'standard' | 'deep';

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
  status: TaskStatus;          // runtime-owned, never model-set (I2)
}

export type TaskStatus =
  | 'pending' | 'ready' | 'running' | 'verifying'
  | 'passed' | 'failed' | 'parked' | 'cancelled';

export interface TaskGraph {
  tasks: Task[];
  edges: Array<{ from: TaskId; to: TaskId }>;
}

export interface RunState {
  runId: RunId;
  station: StationId;
  tasks: Record<TaskId, TaskStatus>;
  evidenceRefs: VaultRef[];
  violations: VaultRef[];
  version: string;             // optimistic concurrency
}
