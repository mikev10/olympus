/**
 * Drafting at `plan` (R5a). A run admitted with `'draft'` for its task graph
 * seats a planner at `plan`, which proposes the build tasks and their order;
 * the proposal goes through the station's gate and is locked before any
 * builder is seated.
 *
 * What the planner writes is a graph in the shape a person supplies one,
 * held to build tasks alone. The runtime adds the one review task that
 * covers them all, so which work is reviewed is never the author's side's to
 * arrange (I3, D-A-GD-03), and the result goes through `parseGraph`, so
 * nothing a draft produces is a shape the line has not run.
 *
 * The bound is policy's `planning` grant as admission recorded it: the most
 * build tasks, and the roles they may be seated under (I4). Admission
 * approves the worst case of the bound, and no drafted graph inside it can
 * cost more (I5).
 */
import { DERIVED_REVIEW_TASK_ID, REVIEWER_ROLE, StrictPolicyEngine } from '@olympus-ai/core';
import type { Policy, RoleId, TaskGraph } from '@olympus-ai/core';
import type { AdmittedGraph } from '@olympus-ai/vault';
import { DRAFT_DIR } from './spec-parts.js';
import { parseGraph, type GraphBinding } from './validate.js';

/** What a drafted graph is held to: the policy's `planning` grant as the admission record pins it. */
export type GraphBound = Extract<AdmittedGraph, { source: 'drafted' }>['bound'];

/** Where a planner writes its graph, in its tree and in the artifact root alike. */
export function graphDraftPath(runId: string): string {
  return `${DRAFT_DIR}/${runId}/graph.json`;
}

/** A runtime problem with a drafted graph: where, a code, and the validator's own message. */
export interface GraphDraftProblem {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A drafted graph, bound to its run with the runtime's review task added, or
 * every problem that sends it back. Beyond what `parseGraph` refuses of any
 * graph: a task that is not a build task, a task named as the derived review
 * is, a role outside the bound, more build tasks than the bound, and a build
 * task with no objective.
 */
export function parseDraftedGraph(value: unknown, bind: GraphBinding, bound: GraphBound): { ok: true; graph: TaskGraph } | { ok: false; problems: GraphDraftProblem[] } {
  const raw = isRecord(value) ? value.tasks : undefined;
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, problems: [{ path: 'graph.tasks', code: 'missing', message: 'graph.tasks must hold at least one build task' }] };
  }
  const entries: readonly unknown[] = raw;
  const problems: GraphDraftProblem[] = [];
  if (entries.length > bound.maxBuildTasks) {
    problems.push({ path: 'graph.tasks', code: 'over-bound', message: `graph.tasks holds ${String(entries.length)} tasks, and policy allows a drafted graph at most ${String(bound.maxBuildTasks)}` });
  }
  entries.forEach((entry, i) => {
    const t = isRecord(entry) ? entry : {};
    const at = `graph.tasks[${String(i)}]`;
    if (t.station === 'review') {
      problems.push({ path: `${at}.station`, code: 'not-a-build-task', message: `${at} is a review task; a drafted graph holds build tasks only, and the runtime adds the review` });
      return;
    }
    if (t.id === DERIVED_REVIEW_TASK_ID) {
      problems.push({ path: `${at}.id`, code: 'reserved', message: `${at}.id '${DERIVED_REVIEW_TASK_ID}' is the review task the runtime adds; a drafted task may not use it` });
    }
    if (typeof t.role === 'string' && t.role !== '' && !bound.roles.includes(t.role as RoleId)) {
      problems.push({ path: `${at}.role`, code: 'role-not-granted', message: `${at}.role '${t.role}' is not a role policy lets a drafted graph seat; the roles are ${bound.roles.join(', ')}` });
    }
    if (t.objective === undefined || t.objective === null) {
      problems.push({ path: `${at}.objective`, code: 'objective-missing', message: `${at}.objective must say what the task delivers` });
    }
  });
  const ids = entries.flatMap((entry) => (isRecord(entry) && entry.station !== 'review' && typeof entry.id === 'string' && entry.id !== '' ? [entry.id] : []));
  const derivedAt = `graph.tasks[${String(entries.length)}]`;
  const derived = { id: DERIVED_REVIEW_TASK_ID, station: 'review', role: REVIEWER_ROLE, dependsOn: [...new Set(ids)], dependencySet: ['**'] };
  const parsed = parseGraph({ tasks: [...entries, derived] }, bind);
  if (!parsed.ok) {
    // What the parser says of the task the runtime added is the runtime's own, and follows from a problem already named.
    for (const p of parsed.problems) if (!p.path.startsWith(derivedAt) && !problems.some((q) => q.path === p.path)) problems.push(p);
  }
  if (problems.length > 0 || !parsed.ok) {
    return { ok: false, problems: problems.length > 0 ? problems : [{ path: 'graph.tasks', code: 'missing', message: 'graph.tasks holds no build task the runtime can review' }] };
  }
  return { ok: true, graph: parsed.graph };
}

const engine = new StrictPolicyEngine();

/**
 * The costliest graph the bound allows, as a graph: `maxBuildTasks` build
 * tasks under the allowed role whose call ceiling is highest, the one review
 * task, and its security seat (D-A-GD-02). Every build task makes the same
 * number of calls, so the role with the highest `budget.maxCostUsd` is the
 * costliest. Its worst case is the figure a person approves for a run that
 * drafts its graph. Admission resolved every allowed role's scope first.
 */
export function boundGraph(bound: GraphBound, policy: Policy, bind: GraphBinding): TaskGraph {
  let costliest: { role: RoleId; usd: number } | null = null;
  for (const role of bound.roles) {
    const resolved = engine.resolveCapabilities(role, 'build', policy);
    if (!resolved.ok) throw new Error(`planning: role ${role} has no scope at build: ${resolved.detail}`);
    if (costliest === null || resolved.scope.budget.maxCostUsd > costliest.usd) costliest = { role, usd: resolved.scope.budget.maxCostUsd };
  }
  if (costliest === null || !Number.isSafeInteger(bound.maxBuildTasks) || bound.maxBuildTasks < 1) {
    throw new Error('planning: the bound names no role or no task; policy validation refuses that');
  }
  const role = costliest.role;
  const tasks = Array.from({ length: bound.maxBuildTasks }, (_, i) => ({
    id: `build-${String(i + 1)}`, station: 'build', role, dependsOn: [], dependencySet: ['**'], objective: 'the worst case of one drafted build task',
  }));
  const parsed = parseDraftedGraph({ tasks }, bind, bound);
  if (!parsed.ok) throw new Error(`planning: the bound's own graph does not parse: ${JSON.stringify(parsed.problems)}`);
  return parsed.graph;
}

/** Every role a run seats at `build` and at `review`: those its graph names, or those its bound allows. */
export interface SeatedRoles {
  readonly build: readonly RoleId[];
  readonly review: readonly RoleId[];
}

export function seatedRolesOf(graph: TaskGraph | null, bound: GraphBound | null): SeatedRoles {
  if (graph === null) {
    if (bound === null) throw new Error('planning: a run holds a graph or the bound of a drafted one');
    return { build: [...bound.roles], review: [REVIEWER_ROLE] };
  }
  const at = (station: 'build' | 'review'): RoleId[] => [...new Set(graph.tasks.filter((t) => t.station === station).map((t) => t.role))];
  return { build: at('build'), review: at('review') };
}
