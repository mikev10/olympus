/**
 * R5a's pure pieces: what a drafted graph is held to, the graph the bound's
 * worst case is read from, what an objective may be, and what a builder is
 * given of the graph. The line itself is driven end to end by the
 * conformance registry's R5a assertions.
 */
import { describe, expect, it } from 'vitest';
import { StrictPolicyEngine, type PolicyDocument, type RoleId, type RunId } from '@olympus-ai/core';
import { OBJECTIVE_MAX_BYTES, boundGraph, graphDraftPath, parseDraftedGraph, parseGraph, taskGraphGrant, worstCaseCost } from '../src/index.js';

const BIND = { runId: 'r' as RunId, baseCommit: 'c', workspace: '/w' };
const BOUND = { maxBuildTasks: 2, roles: ['builder' as RoleId, 'cheap' as RoleId] };

function task(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, station: 'build', role: 'builder', dependsOn: [], dependencySet: ['**'], objective: `deliver ${id}`, ...extra };
}

function codes(value: unknown): string[] {
  const parsed = parseDraftedGraph(value, BIND, BOUND);
  if (parsed.ok) throw new Error('expected the draft to be sent back');
  return parsed.problems.map((p) => `${p.path}: ${p.code}`);
}

describe('a drafted graph (R5a)', () => {
  it('is its build tasks, one review the runtime adds over all of them, and that review\'s security seat', () => {
    const parsed = parseDraftedGraph({ tasks: [task('a'), task('b', { dependsOn: ['a'] })] }, BIND, BOUND);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.problems));
    expect(parsed.graph.tasks.map((t) => [t.id, t.station, t.role, t.dependsOn, t.objective])).toEqual([
      ['a', 'build', 'builder', [], 'deliver a'],
      ['b', 'build', 'builder', ['a'], 'deliver b'],
      ['review', 'review', 'reviewer', ['a', 'b'], null],
      ['review.security', 'review', 'reviewer', ['a', 'b'], null],
    ]);
  });

  it('is written at one path under the run\'s drafts directory', () => {
    expect(graphDraftPath('run-1')).toBe('.drafts/run-1/graph.json');
  });

  it('goes back when it is not a list of tasks, or holds none', () => {
    for (const value of [null, 'x', {}, { tasks: 'a' }, { tasks: [] }]) expect(codes(value)).toEqual(['graph.tasks: missing']);
  });

  it('goes back naming a review task, whatever it reviews', () => {
    expect(codes({ tasks: [task('a'), { id: 'r', station: 'review', role: 'reviewer', dependsOn: ['a'], dependencySet: ['**'] }] })).toEqual(['graph.tasks[1].station: not-a-build-task']);
  });

  it('goes back using the id of the review the runtime adds', () => {
    expect(codes({ tasks: [task('review')] })).toContain('graph.tasks[0].id: reserved');
  });

  it('goes back naming a role outside the bound, a reviewing role among them', () => {
    expect(codes({ tasks: [task('a', { role: 'other' })] })).toEqual(['graph.tasks[0].role: role-not-granted']);
    expect(codes({ tasks: [task('a', { role: 'reviewer' })] })).toEqual(['graph.tasks[0].role: role-not-granted']);
  });

  it('goes back holding more build tasks than the bound', () => {
    expect(codes({ tasks: [task('a'), task('b'), task('c')] })).toEqual(['graph.tasks: over-bound']);
  });

  it('goes back when a task states no objective, a blank one, or one over the cap', () => {
    const { objective: _, ...bare } = task('a');
    expect(codes({ tasks: [bare] })).toEqual(['graph.tasks[0].objective: objective-missing']);
    expect(codes({ tasks: [task('a', { objective: null })] })).toEqual(['graph.tasks[0].objective: objective-missing']);
    expect(codes({ tasks: [task('a', { objective: '  ' })] })).toEqual(['graph.tasks[0].objective: objective-empty']);
    expect(codes({ tasks: [task('a', { objective: 7 })] })).toEqual(['graph.tasks[0].objective: objective-empty']);
    expect(codes({ tasks: [task('a', { objective: 'x'.repeat(OBJECTIVE_MAX_BYTES + 1) })] })).toEqual(['graph.tasks[0].objective: objective-too-long']);
    expect(parseDraftedGraph({ tasks: [task('a', { objective: 'x'.repeat(OBJECTIVE_MAX_BYTES) })] }, BIND, BOUND).ok).toBe(true);
  });

  it('goes back for everything a supplied graph is refused for, and says nothing of the task the runtime added', () => {
    expect(codes({ tasks: [task('a', { dependsOn: ['b'] }), task('b', { dependsOn: ['a'] })] })).toEqual(['graph.tasks: cycle']);
    expect(codes({ tasks: [task('a'), task('a')] })).toEqual(['graph.tasks[1].id: duplicate']);
    expect(codes({ tasks: [task('a', { dependsOn: ['nowhere'] })] })).toEqual(['graph.tasks[0].dependsOn[0]: bad-dependency']);
    expect(codes({ tasks: [task('a', { station: 'verify' })] })).toEqual(['graph.tasks[0].station: bad-station']);
    expect(codes({ tasks: [task('a', { dependencySet: [] })] })).toEqual(['graph.tasks[0].dependencySet: missing']);
    expect(codes({ tasks: [task('plan.drafter')] })).toEqual(['graph.tasks[0].id: reserved']);
    expect(codes({ tasks: ['not a task'] }).every((line) => line.startsWith('graph.tasks[0]'))).toBe(true);
  });
});

describe('an objective on a supplied graph (A-R5a-04)', () => {
  const review = { id: 'v', station: 'review', role: 'reviewer', dependsOn: ['a'], dependencySet: ['**'] };

  it('may be left out, and is then null', () => {
    const { objective: _, ...bare } = task('a');
    const parsed = parseGraph({ tasks: [bare, review] }, BIND);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.problems));
    expect(parsed.graph.tasks.map((t) => t.objective)).toEqual([null, null, null]);
  });

  it('is held to the same cap, and a review task states none', () => {
    const long = parseGraph({ tasks: [task('a', { objective: 'x'.repeat(OBJECTIVE_MAX_BYTES + 1) }), review] }, BIND);
    expect(long.ok ? [] : long.problems.map((p) => p.code)).toEqual(['objective-too-long']);
    const onReview = parseGraph({ tasks: [task('a'), { ...review, objective: 'review it well' }] }, BIND);
    expect(onReview.ok ? [] : onReview.problems.map((p) => p.code)).toEqual(['not-applicable']);
  });
});

describe('what a builder is given of the graph (A-R5a-04)', () => {
  it('holds every task\'s id, station, role and dependencies, and the objectives of its own task and its dependencies alone', () => {
    const parsed = parseDraftedGraph({ tasks: [task('a'), task('b')] }, BIND, BOUND);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.problems));
    const c = { id: 'c', dependsOn: ['a'] } as never;
    const given = JSON.parse(taskGraphGrant(parsed.graph, c)) as Array<Record<string, unknown>>;
    expect(given.map((t) => [t.id, t.objective])).toEqual([['a', 'deliver a'], ['b', undefined], ['review', undefined], ['review.security', undefined]]);
    expect(given.every((t) => Object.keys(t).every((key) => ['id', 'station', 'role', 'dependsOn', 'objective'].includes(key)))).toBe(true);
    const own = JSON.parse(taskGraphGrant(parsed.graph, { id: 'b', dependsOn: [] } as never)) as Array<Record<string, unknown>>;
    expect(own.map((t) => t.objective)).toEqual([undefined, 'deliver b', undefined, undefined]);
  });
});

describe('the bound\'s worst case (D-A-GD-02)', () => {
  const scope = (stations: string[], maxCostUsd: number) => ({
    stations, writableGlobs: ['**'], tools: [], network: { egress: 'none' }, tier: 'standard', tierByStation: {}, escalation: 'none', autonomyCeiling: 2, triggerKinds: ['human'],
    budget: { maxTokens: 1, maxCostUsd, maxWallClockMs: 1 }, sensitiveGrants: [], narrowed: null, repoInstructions: false,
  });
  const policy = new StrictPolicyEngine().resolvePolicy({
    globalCap: 2, stationCaps: {}, approvals: {}, protectedPaths: [], sensitivePaths: {},
    roles: { builder: scope(['build'], 1), cheap: scope(['build'], 0.25), reviewer: scope(['review'], 2), planner: scope(['plan'], 3), 'plan-critic': scope(['plan'], 3) },
    triggers: {
      enabled: ['human'], entryStation: { human: 'intake' }, taskTemplate: {}, maxAutonomy: { human: 2 }, minAuthorTrust: { human: 'owner' }, narrowBelow: {},
      maxTriggerDepth: 2, budgetPerWindow: { runs: 1, windowMs: 1 },
    },
    concurrency: { maxParallelTasks: 1, maxConflictRetries: 0 },
    planning: { maxBuildTasks: 2, roles: ['cheap', 'builder'] },
  } as unknown as PolicyDocument);

  it('is the most build tasks under the costliest allowed role, one review, and its security seat', () => {
    const graph = boundGraph({ maxBuildTasks: 2, roles: ['cheap' as RoleId, 'builder' as RoleId] }, policy, BIND);
    expect(graph.tasks.map((t) => [t.station, t.role])).toEqual([['build', 'builder'], ['build', 'builder'], ['review', 'reviewer'], ['review', 'reviewer']]);
  });

  it('is never below the worst case of a graph the bound admits', () => {
    const bound = { maxBuildTasks: 2, roles: ['cheap' as RoleId, 'builder' as RoleId] };
    const figure = worstCaseCost(boundGraph(bound, policy, BIND), policy, ['plan']).usd;
    for (const tasks of [[task('a')], [task('a', { role: 'cheap' })], [task('a'), task('b', { role: 'cheap' })], [task('a'), task('b')]]) {
      const parsed = parseDraftedGraph({ tasks }, BIND, bound);
      if (!parsed.ok) throw new Error(JSON.stringify(parsed.problems));
      expect(worstCaseCost(parsed.graph, policy, ['plan']).usd).toBeLessThanOrEqual(figure);
    }
    const full = parseDraftedGraph({ tasks: [task('a'), task('b')] }, BIND, bound);
    if (!full.ok) throw new Error('the full graph did not parse');
    expect(worstCaseCost(full.graph, policy, ['plan']).usd).toBe(figure);
  });

  it('counts the planner and the plan critic among its seats', () => {
    const bound = { maxBuildTasks: 1, roles: ['builder' as RoleId] };
    const seats = worstCaseCost(boundGraph(bound, policy, BIND), policy, ['plan']).tasks.filter((t) => t.station === 'plan');
    expect(seats.map((t) => [t.task, t.role])).toEqual([['plan.drafter', 'planner'], ['plan.critic', 'plan-critic']]);
  });
});
