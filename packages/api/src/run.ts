/**
 * The programmatic entry point: the runtime as a service, of which an
 * in-process call is the first form. P9 adds the HTTP surface on top of it
 * and the CLI as a client. `startRun` never writes to a stream, reads argv,
 * or exits; it returns, and the caller decides what a verdict means (I9).
 */
import type {
  AutonomyLevel,
  Driver,
  RoleId,
  Run,
  RunId,
  RunState,
  StationId,
  StationTransition,
  Task,
  TaskId,
  VaultRef,
} from '@olympus-ai/core';
import type { CheckSpec, GateResult } from '@olympus-ai/integrity';
import type { SandboxProvider } from '@olympus-ai/sandbox';
import type { Vault } from '@olympus-ai/vault';
import { runLine, type LineContext } from './line.js';
import { unsafeComponents, type UnsafeDeclaration } from './safety.js';

export interface ComponentGraph {
  readonly vault: Vault;
  readonly sandbox: SandboxProvider;
  readonly driver: Driver;
}

/** One task, described completely by the caller. The plan station that would emit it does not exist. */
export interface FixtureTask {
  readonly id: TaskId;
  /** Absolute path: the Workspace mount source, and what lockedPaths resolve against. */
  readonly workspace: string;
  /** Workspace-relative; locked at `spec`, re-verified on the way into `build` and `verify`. */
  readonly lockedPaths: readonly string[];
  /** The verification manifest, run at `verify`. */
  readonly checks: readonly CheckSpec[];
}

export interface RunRequest {
  readonly runId: RunId;
  /** Evidence binds to it; a fixture supplies a literal. */
  readonly baseCommit: string;
  readonly requestedLevel: AutonomyLevel;
  readonly task: FixtureTask;
  readonly components: ComponentGraph;
}

export type StationRefusal = Extract<StationTransition, { ok: false }>;

export type RunOutcome =
  | {
      readonly ok: true;
      readonly gate: GateResult;
      readonly next: StationTransition;
      readonly state: RunState;
      readonly evidence: VaultRef;
    }
  | {
      readonly ok: false;
      readonly reason: 'unsafe-above-l1';
      readonly requestedLevel: AutonomyLevel;
      readonly unsafe: readonly UnsafeDeclaration[];
    }
  | { readonly ok: false; readonly reason: 'refused'; readonly at: StationId; readonly transition: StationRefusal };

/** The one role in the skeleton. */
const BUILDER = 'builder' as RoleId;

/**
 * L0 and L1 both mean: run the three stations and return the gate verdict
 * to the caller, who is the supervising human; distinguishing them is the
 * policy engine's job (P3). L2 and L3 are refused while any component in
 * the graph declares itself unsafe, which in the skeleton is always.
 */
export async function startRun(req: RunRequest): Promise<RunOutcome> {
  // 1. Nothing has been provisioned, locked, or written when this returns.
  const unsafe = unsafeComponents(req.components);
  if (unsafe.length > 0 && req.requestedLevel > 1) {
    return { ok: false, reason: 'unsafe-above-l1', requestedLevel: req.requestedLevel, unsafe };
  }

  // 2. The run, its one task, and the initial state.
  const now = new Date().toISOString();
  const run: Run = {
    id: req.runId,
    repo: req.task.workspace,
    baseCommit: req.baseCommit,
    trigger: { kind: 'human', eventId: req.runId, lineage: { depth: 0, chain: [], windowStart: now } },
    requestedLevel: req.requestedLevel,
    station: 'spec',
    graph: null,
    createdAt: now,
  };
  const task: Task = {
    id: req.task.id,
    runId: req.runId,
    station: 'build',
    role: BUILDER,
    dependsOn: [],
    baseCommit: req.baseCommit,
    dependencySet: ['**'],
    worktreePath: req.task.workspace,
    attempt: 1,
  };
  const state = await req.components.vault.commitRunState(
    { runId: req.runId, station: 'spec', tasks: { [task.id]: 'pending' }, evidenceRefs: [], violations: [], version: '0' },
    '0',
  );

  // 3. The line.
  const ctx: LineContext = { run, task, fixture: req.task, components: req.components, state, locks: null, result: null };
  return runLine(ctx);
}
