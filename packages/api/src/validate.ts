/**
 * Runtime validation of what a caller hands the runtime. `readonly`,
 * `boolean`, and `string` in the types say nothing about what arrives at run
 * time through a cast or from JavaScript, and the line reads these fields, so
 * a value it cannot trust is refused before anything is admitted, locked,
 * provisioned, or committed (I5). Each problem is a field path and a code a
 * machine reads, with a message for a person beside them.
 *
 * Two of the artifacts are parsed, not only hashed: the verification manifest
 * and the task graph. They are validated here, at admission, from the same
 * bytes whose hash the admission record keeps, and the station that locks each
 * refuses a lock whose hash differs (A-P4-03). So the manifest `verify` runs and
 * the graph `build` schedules are the ones validated here.
 */
import { isAbsolute, posix, win32 } from 'node:path';
import { isAutonomyLevel } from '@olympus-ai/core';
import type { RoleId, RunId, Task, TaskGraph, TaskId } from '@olympus-ai/core';
import type { CheckSpec } from '@olympus-ai/integrity';
import type { RequestedArtifacts } from './run.js';

export type RequestProblemCode =
  /** A required list has no entries. */
  | 'missing'
  /** A string that must have content is blank, or is not a string. */
  | 'empty'
  /** An id or a path is listed twice. */
  | 'duplicate'
  /** `workspace` must be an absolute path. */
  | 'not-absolute'
  /** An artifact path must be workspace-relative, not absolute. */
  | 'absolute'
  /** An artifact path contains a `..` segment and could leave the workspace. */
  | 'escapes'
  /** `CheckSpec.required` must be a boolean. */
  | 'not-boolean'
  /** `CheckSpec.expectedSuiteCount` must be a non-negative integer when present. */
  | 'not-integer'
  /** No check is required, so no check could fail the gate. */
  | 'none-required'
  /** `requestedLevel` is not one of 0, 1, 2, 3. */
  | 'not-a-level'
  /** An artifact could not be read from the workspace. */
  | 'unreadable'
  /** An artifact that must be JSON is not. */
  | 'not-json'
  /** A task names a station no task may be scheduled at. */
  | 'bad-station'
  /** A task depends on a task the graph does not hold, or on one it may not depend on. */
  | 'bad-dependency'
  /** The graph's dependencies form a cycle, so it cannot finish. */
  | 'cycle'
  /** A build task no review task covers, so its work would reach integrate unreviewed. */
  | 'unreviewed'
  /** The policy does not validate. */
  | 'invalid-policy'
  /** The run already has state: it was admitted once, and is resumed, not started again. */
  | 'already-admitted';

export interface RequestProblem {
  /** The field, as a path into the request or an artifact: `graph.tasks[1].dependsOn[0]`. */
  readonly path: string;
  readonly code: RequestProblemCode;
  readonly message: string;
}

type Report = (path: string, code: RequestProblemCode, message: string) => void;

function collector(): { problems: RequestProblem[]; report: Report } {
  const problems: RequestProblem[] = [];
  return { problems, report: (path, code, message) => problems.push({ path, code, message }) };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

export interface RequestFields {
  readonly runId: unknown;
  readonly baseCommit: unknown;
  readonly requestedLevel: unknown;
  readonly workspace: unknown;
  readonly artifacts: unknown;
}

/** Every reason the request's own fields cannot be admitted; empty when they can. The artifacts' contents are checked separately, once read. */
export function requestProblems(req: RequestFields): RequestProblem[] {
  const { problems, report } = collector();
  if (!isNonEmptyString(req.runId)) report('runId', 'empty', 'runId must be a non-empty string');
  if (!isNonEmptyString(req.baseCommit)) report('baseCommit', 'empty', 'baseCommit must be a non-empty string');
  if (!isAutonomyLevel(req.requestedLevel)) report('requestedLevel', 'not-a-level', 'requestedLevel must be one of 0, 1, 2, 3');
  if (!isNonEmptyString(req.workspace) || !isAbsolute(req.workspace)) {
    report('workspace', 'not-absolute', 'workspace must be an absolute path');
  }
  artifactProblems(req.artifacts, report);
  return problems;
}

/**
 * Artifact paths are workspace-relative and stay inside it. The Vault and
 * every station resolve them against the workspace; an absolute path or a
 * `..` segment would let the two name different files. A path listed under
 * two artifacts is a duplicate, since the second station's lock of it would
 * be refused.
 */
function artifactProblems(artifacts: unknown, report: Report): void {
  if (typeof artifacts !== 'object' || artifacts === null) {
    report('artifacts', 'missing', 'artifacts must name the spec, the acceptance tests, the verification manifest, and the task graph');
    return;
  }
  const a = artifacts as Partial<Record<keyof RequestedArtifacts, unknown>>;
  const seen = new Set<string>();
  const one = (at: string, path: unknown): void => {
    if (!isNonEmptyString(path)) {
      report(at, 'empty', `${at} must be a non-empty workspace-relative path`);
      return;
    }
    if (posix.isAbsolute(path) || win32.isAbsolute(path)) report(at, 'absolute', `${at}: '${path}' is absolute; artifact paths are workspace-relative`);
    if (path.split(/[\\/]/).includes('..')) report(at, 'escapes', `${at}: '${path}' contains a '..' segment and could leave the workspace`);
    if (seen.has(path)) report(at, 'duplicate', `${at}: '${path}' is listed twice`);
    seen.add(path);
  };
  for (const list of ['spec', 'acceptanceTests'] as const) {
    const paths = a[list];
    if (!Array.isArray(paths) || paths.length === 0) {
      report(`artifacts.${list}`, 'missing', `artifacts.${list} must name at least one file; nothing locked is not a lock`);
      continue;
    }
    const entries: readonly unknown[] = paths;
    entries.forEach((path, i) => {
      one(`artifacts.${list}[${String(i)}]`, path);
    });
  }
  one('artifacts.verificationManifest', a.verificationManifest);
  one('artifacts.taskGraph', a.taskGraph);
}

/** The manifest's checks, or the problems that keep it from being one. */
export function parseManifest(value: unknown): { ok: true; checks: CheckSpec[] } | { ok: false; problems: RequestProblem[] } {
  const { problems, report } = collector();
  const checks = typeof value === 'object' && value !== null && 'checks' in value ? value.checks : undefined;
  checkProblems(checks, report);
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, checks: (checks as CheckSpec[]).map((check) => ({ ...check })) };
}

/** The fields the verdict reads: id (unique), command, required (a boolean), expectedSuiteCount (an integer when present). */
function checkProblems(checks: unknown, report: Report): void {
  if (!Array.isArray(checks) || checks.length === 0) {
    report('manifest.checks', 'missing', 'manifest.checks must name at least one check; no check is not a verification');
    return;
  }
  const list: readonly unknown[] = checks;
  const seen = new Set<string>();
  let required = 0;
  list.forEach((check, i) => {
    const at = `manifest.checks[${String(i)}]`;
    if (typeof check !== 'object' || check === null) {
      report(at, 'empty', `${at} must be a CheckSpec`);
      return;
    }
    const c = check as Partial<Record<keyof CheckSpec, unknown>>;
    if (!isNonEmptyString(c.id)) report(`${at}.id`, 'empty', `${at}.id must be a non-empty string`);
    else if (seen.has(c.id)) {
      report(`${at}.id`, 'duplicate', `${at}.id '${c.id}' is listed twice; a duplicate id lets one result stand in for another`);
    } else seen.add(c.id);
    if (!isNonEmptyString(c.command)) report(`${at}.command`, 'empty', `${at}.command must be a non-empty string`);
    if (typeof c.required !== 'boolean') {
      report(`${at}.required`, 'not-boolean', `${at}.required must be a boolean, not ${typeof c.required}`);
    } else if (c.required) required += 1;
    const count = c.expectedSuiteCount;
    if (count !== undefined && !(typeof count === 'number' && Number.isInteger(count) && count >= 0)) {
      report(`${at}.expectedSuiteCount`, 'not-integer', `${at}.expectedSuiteCount must be a non-negative integer when present`);
    }
  });
  if (required === 0) {
    report('manifest.checks', 'none-required', 'manifest.checks: at least one check must be required; a gate no check can fail is not a gate');
  }
}

export interface GraphBinding {
  readonly runId: RunId;
  readonly baseCommit: string;
  readonly workspace: string;
}

/**
 * The task graph, bound to its run, or the problems that keep it from being
 * one. At M1 a graph schedules `build` and `review` tasks only. A build task
 * depends only on build tasks; a review task depends on at least one build
 * task and on nothing else; every build task is covered by a review task, so
 * no work reaches `integrate` unreviewed; and the dependencies are acyclic, so
 * the graph can finish.
 */
export function parseGraph(value: unknown, bind: GraphBinding): { ok: true; graph: TaskGraph } | { ok: false; problems: RequestProblem[] } {
  const { problems, report } = collector();
  const raw = typeof value === 'object' && value !== null && 'tasks' in value ? value.tasks : undefined;
  if (!Array.isArray(raw) || raw.length === 0) {
    report('graph.tasks', 'missing', 'graph.tasks must hold at least one task');
    return { ok: false, problems };
  }
  const entries: readonly unknown[] = raw;
  const ids = new Set<string>();
  const stationOf = new Map<string, string>();
  entries.forEach((entry, i) => {
    const t = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>;
    const at = `graph.tasks[${String(i)}]`;
    if (!isNonEmptyString(t.id)) report(`${at}.id`, 'empty', `${at}.id must be a non-empty string`);
    else if (ids.has(t.id)) report(`${at}.id`, 'duplicate', `${at}.id '${t.id}' is listed twice`);
    else {
      ids.add(t.id);
      if (typeof t.station === 'string') stationOf.set(t.id, t.station);
    }
    if (t.station !== 'build' && t.station !== 'review') {
      report(`${at}.station`, 'bad-station', `${at}.station must be 'build' or 'review'; M1 schedules tasks at no other station`);
    }
    if (!isNonEmptyString(t.role)) report(`${at}.role`, 'empty', `${at}.role must be a non-empty string`);
    if (!Array.isArray(t.dependsOn) || !t.dependsOn.every(isNonEmptyString)) {
      report(`${at}.dependsOn`, 'empty', `${at}.dependsOn must be a list of task ids`);
    }
    if (!Array.isArray(t.dependencySet) || t.dependencySet.length === 0 || !t.dependencySet.every(isNonEmptyString)) {
      report(`${at}.dependencySet`, 'missing', `${at}.dependencySet must name at least one glob`);
    }
  });
  if (problems.length > 0) return { ok: false, problems };

  const tasks = entries as ReadonlyArray<{ id: string; station: 'build' | 'review'; role: string; dependsOn: string[]; dependencySet: string[] }>;
  const reviewed = new Set<string>();
  tasks.forEach((t, i) => {
    const at = `graph.tasks[${String(i)}].dependsOn`;
    t.dependsOn.forEach((dep, j) => {
      const depStation = stationOf.get(dep);
      if (depStation === undefined) report(`${at}[${String(j)}]`, 'bad-dependency', `${at}[${String(j)}]: '${dep}' is not a task in the graph`);
      else if (depStation !== 'build') {
        report(`${at}[${String(j)}]`, 'bad-dependency', `${at}[${String(j)}]: '${dep}' is a ${depStation} task; tasks depend only on build tasks`);
      } else if (t.station === 'review') reviewed.add(dep);
    });
    if (t.station === 'review' && t.dependsOn.length === 0) {
      report(at, 'bad-dependency', `${at}: a review task must depend on the build task it reviews`);
    }
  });
  tasks.forEach((t, i) => {
    if (t.station === 'build' && !reviewed.has(t.id)) {
      report(`graph.tasks[${String(i)}]`, 'unreviewed', `graph.tasks[${String(i)}]: build task '${t.id}' is covered by no review task`);
    }
  });
  if (!tasks.some((t) => t.station === 'build')) report('graph.tasks', 'missing', 'graph.tasks must hold at least one build task');
  const cycle = findCycle(tasks);
  if (cycle !== undefined) report('graph.tasks', 'cycle', `graph.tasks: the dependencies cycle through ${cycle.join(' -> ')}`);
  if (problems.length > 0) return { ok: false, problems };

  const bound: Task[] = tasks.map((t) => ({
    id: t.id as TaskId,
    runId: bind.runId,
    station: t.station,
    role: t.role as RoleId,
    dependsOn: t.dependsOn.map((dep) => dep as TaskId),
    baseCommit: bind.baseCommit,
    dependencySet: [...t.dependencySet],
    worktreePath: bind.workspace,
    attempt: 1,
  }));
  const edges = bound.flatMap((task) => task.dependsOn.map((dep) => ({ from: dep, to: task.id })));
  return { ok: true, graph: { tasks: bound, edges } };
}

function findCycle(tasks: ReadonlyArray<{ id: string; dependsOn: readonly string[] }>): string[] | undefined {
  const deps = new Map(tasks.map((t) => [t.id, t.dependsOn]));
  const state = new Map<string, 'visiting' | 'done'>();
  const path: string[] = [];
  const visit = (id: string): string[] | undefined => {
    const mark = state.get(id);
    if (mark === 'done') return undefined;
    if (mark === 'visiting') return [...path.slice(path.indexOf(id)), id];
    state.set(id, 'visiting');
    path.push(id);
    for (const dep of deps.get(id) ?? []) {
      const found = visit(dep);
      if (found !== undefined) return found;
    }
    path.pop();
    state.set(id, 'done');
    return undefined;
  };
  for (const t of tasks) {
    const found = visit(t.id);
    if (found !== undefined) return found;
  }
  return undefined;
}
