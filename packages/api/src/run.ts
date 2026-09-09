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
  StationRefusal,
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
import { taskProblems, type RequestProblem } from './validate.js';

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
  /** Workspace-relative, inside it, no `..`; locked at `spec`, re-verified on the way into `build` and `verify` and again after the checks. */
  readonly lockedPaths: readonly string[];
  /** The verification manifest, run at `verify`. Ids are unique and at least one check is required. */
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

/**
 * Every way a run ends. The two refusals before the line carry what a caller
 * needs to act: the declarations that capped the level, or the request fields
 * that could not be trusted. A refusal inside the line carries the station's
 * own typed transition.
 */
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
  | { readonly ok: false; readonly reason: 'invalid-request'; readonly problems: readonly RequestProblem[] }
  | { readonly ok: false; readonly reason: 'refused'; readonly at: StationId; readonly transition: StationRefusal };

/** The one role in the skeleton. */
const BUILDER = 'builder' as RoleId;

/**
 * The line works from its own copy of the task. The caller's arrays are
 * mutable at run time whatever `readonly` says, and a manifest that can
 * shrink after the run starts is not a manifest.
 */
function snapshot(task: FixtureTask): FixtureTask {
  return {
    id: task.id,
    workspace: task.workspace,
    lockedPaths: [...task.lockedPaths],
    checks: task.checks.map((check) => ({ ...check })),
  };
}

/**
 * L0 and L1 both mean: run the three stations and return the gate verdict
 * to the caller, who is the supervising human; distinguishing them is the
 * policy engine's job (P3). L2 and L3 are refused while any component in
 * the graph declares itself unsafe, which in the skeleton is always.
 */
export async function startRun(req: RunRequest): Promise<RunOutcome> {
  // 1. Nothing has been provisioned, locked, or written when either refusal returns.
  const unsafe = unsafeComponents(req.components);
  if (unsafe.length > 0 && req.requestedLevel > 1) {
    return { ok: false, reason: 'unsafe-above-l1', requestedLevel: req.requestedLevel, unsafe };
  }
  const problems = taskProblems(req.task);
  if (problems.length > 0) return { ok: false, reason: 'invalid-request', problems };
  const fixture = snapshot(req.task);

  // 2. The run, its one task, and the initial state.
  const now = new Date().toISOString();
  const run: Run = {
    id: req.runId,
    repo: fixture.workspace,
    baseCommit: req.baseCommit,
    trigger: { kind: 'human', eventId: req.runId, lineage: { depth: 0, chain: [], windowStart: now } },
    requestedLevel: req.requestedLevel,
    station: 'spec',
    graph: null,
    createdAt: now,
  };
  const task: Task = {
    id: fixture.id,
    runId: req.runId,
    station: 'build',
    role: BUILDER,
    dependsOn: [],
    baseCommit: req.baseCommit,
    dependencySet: ['**'],
    worktreePath: fixture.workspace,
    attempt: 1,
  };
  const state = await req.components.vault.commitRunState(
    { runId: req.runId, station: 'spec', tasks: { [task.id]: 'pending' }, evidenceRefs: [], violations: [], version: '0' },
    '0',
  );

  // 3. The line.
  const ctx: LineContext = { run, task, fixture, components: req.components, state, locks: null, result: null };
  return runLine(ctx);
}
