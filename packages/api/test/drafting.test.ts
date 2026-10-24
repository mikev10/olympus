/**
 * R19's pure pieces: what a critic's result is read as, the two spec parts,
 * the request shape a drafting run takes, the worst case with its seats, and
 * the rates keyed by independence grade. The line itself is driven end to end
 * by the conformance registry's R19 assertions.
 */
import { describe, expect, it } from 'vitest';
import { StrictPolicyEngine, type PolicyDocument, type RoleId, type RunId, type TaskGraph, type TaskId } from '@olympus-ai/core';
import {
  deriveOutcomes,
  isDraftableDirectory,
  parseQuestions,
  parseRunRequirements,
  readCriticResult,
  requestProblems,
  worstCaseCost,
  type RunRecords,
} from '../src/index.js';

describe('a critic\'s result (D-A-DS-07)', () => {
  it('is a list of findings with no severity, and anything else is one finding', () => {
    expect(readCriticResult('{"findings": []}')).toEqual({ readable: true, findings: [] });
    expect(readCriticResult('```json\n{"findings": ["statement 2 is not testable"]}\n```')).toEqual({ readable: true, findings: ['statement 2 is not testable'] });
    for (const narrative of ['Looks good!', '{"findings": [], "severity": "low"}', '{"findings": [""]}', '{"findings": "none"}', '[]', '']) {
      const read = readCriticResult(narrative);
      expect(read.readable).toBe(false);
      expect(read.findings).toHaveLength(1);
    }
  });
});

describe('the spec parts R19 adds', () => {
  it('reads the run requirements, and refuses a test directory outside the tree or under the drafts', () => {
    const part = { testCommand: ['pnpm', 'test'], framework: 'vitest', testDirectory: 'test/acceptance/', publicInterface: 'add(a, b) from src/math.ts' };
    expect(parseRunRequirements(part, 'p')).toEqual({ ok: true, part: { ...part, testDirectory: 'test/acceptance' } });
    for (const testDirectory of ['../out', '/abs', '.', '.drafts/x', '.git/hooks', 'a\\b', '']) {
      expect(isDraftableDirectory(testDirectory)).toBe(false);
      expect(parseRunRequirements({ ...part, testDirectory }, 'p').ok).toBe(false);
    }
    expect(parseRunRequirements({ ...part, extra: 1 }, 'p').ok).toBe(false);
    expect(parseRunRequirements({ ...part, testCommand: [] }, 'p').ok).toBe(false);
  });

  it('reads the questions, an empty list of open questions saying there are none', () => {
    expect(parseQuestions({ assumptions: [{ point: 'p', chose: 'c' }], openQuestions: [] }, 'q')).toEqual({ ok: true, part: { assumptions: [{ point: 'p', chose: 'c' }], openQuestions: [] } });
    expect(parseQuestions({ assumptions: [{ point: 'p' }], openQuestions: [] }, 'q').ok).toBe(false);
    expect(parseQuestions({ assumptions: [], openQuestions: [''] }, 'q').ok).toBe(false);
  });
});

describe('a drafting run\'s request', () => {
  const base = { runId: 'r', baseCommit: 'c', requestedLevel: 1, workspace: process.cwd(), approvedCostUsd: null };
  const artifacts = { spec: ['spec.md'], acceptanceTests: ['t.md'], verificationManifest: 'v.json', taskGraph: 'g.json' };
  const codes = (a: unknown) => requestProblems({ ...base, artifacts: a }).map((p) => `${p.path}:${p.code}`);

  it('takes draft for the spec or the tests, explicitly, and never an empty list', () => {
    expect(codes({ ...artifacts, spec: 'draft' })).toEqual([]);
    expect(codes({ ...artifacts, spec: [] })).toEqual(['artifacts.spec:missing']);
  });

  it('names no parts for a drafted spec, needs the run requirements for drafted tests, and no supplied acceptance manifest beside them', () => {
    expect(codes({ ...artifacts, spec: 'draft', specParts: { security: 's.json' } })).toEqual(['artifacts.specParts.security:not-applicable']);
    expect(codes({ ...artifacts, acceptanceTests: 'draft' })).toEqual(['artifacts.specParts.runRequirements:missing']);
    expect(codes({ ...artifacts, acceptanceTests: 'draft', specParts: { runRequirements: 'r.json' } })).toEqual([]);
    expect(codes({ ...artifacts, spec: 'draft', acceptanceTests: 'draft' })).toEqual([]);
    expect(codes({ ...artifacts, acceptanceTests: 'draft', acceptanceManifest: 'a.json', specParts: { runRequirements: 'r.json' } })).toEqual(['artifacts.acceptanceManifest:not-applicable']);
  });
});

describe('the worst case with drafting seats (R19, D-P9-03)', () => {
  const scope = (stations: string[], maxCostUsd: number) => ({
    stations, writableGlobs: ['**'], tools: [], network: { egress: 'none' as const }, tier: 'standard' as const, tierByStation: {}, escalation: 'none' as const,
    autonomyCeiling: 2 as const, triggerKinds: ['human' as const], budget: { maxTokens: 1, maxCostUsd, maxWallClockMs: 1 },
  });
  const doc = {
    globalCap: 2, stationCaps: {}, approvals: {}, protectedPaths: [], concurrency: { maxParallelTasks: 1, maxConflictRetries: 0 },
    triggers: { enabled: ['human'], entryStation: { human: 'intake' }, taskTemplate: {}, maxAutonomy: { human: 2 }, minAuthorTrust: { human: 'owner' }, maxTriggerDepth: 2, budgetPerWindow: { runs: 1, windowMs: 1 } },
    roles: {
      builder: scope(['build'], 1), reviewer: scope(['review'], 1),
      'spec-drafter': scope(['spec'], 0.5), 'spec-critic': scope(['spec'], 0.25), 'test-drafter': scope(['test-design'], 0.5), 'test-critic': scope(['test-design'], 0.25),
    },
  } as unknown as PolicyDocument;
  const policy = new StrictPolicyEngine().resolvePolicy(doc);
  const graph: TaskGraph = {
    tasks: [
      { id: 'b' as TaskId, runId: 'r' as RunId, station: 'build', role: 'builder' as RoleId, dependsOn: [], baseCommit: 'c', dependencySet: ['**'], worktreePath: '', attempt: 1 },
      { id: 'v' as TaskId, runId: 'r' as RunId, station: 'review', role: 'reviewer' as RoleId, dependsOn: ['b' as TaskId], baseCommit: 'c', dependencySet: ['**'], worktreePath: '', attempt: 1 },
    ],
    edges: [],
  };

  it('counts every call each seat a drafted station holds may make, at its own budget, and none for a station not drafted', () => {
    const without = worstCaseCost(graph, policy);
    const spec = worstCaseCost(graph, policy, ['spec']);
    const both = worstCaseCost(graph, policy, ['spec', 'test-design']);
    // Three attempts, each with two retries: nine calls a seat.
    expect(spec.tasks.filter((t) => t.station === 'spec').map((t) => [t.task, t.calls, t.usd])).toEqual([['spec.drafter', 9, 4.5], ['spec.critic', 9, 2.25]]);
    expect(spec.usd).toBeCloseTo(without.usd + 6.75);
    expect(both.usd).toBeCloseTo(without.usd + 13.5);
  });
});

describe('rates keyed by independence grade (D-A-DS-06)', () => {
  const run = (id: string, reviewGrade: string, critiques: RunRecords['critiques'] = []): RunRecords => ({
    runId: id as RunId, ending: 'merged', requestedLevel: 2, stack: 's', startedAt: null, mergedAt: null, approvalsSpent: 0,
    tasks: [{ taskId: 't' as TaskId, station: 'build', status: 'passed', iterations: 1, attempts: [{ outcome: 'passed', claimMismatch: false }], firstModel: 'm', models: ['m'] }],
    decisions: [], usage: [], cost: null, reviewGrade, critiques,
  });

  it('keeps the false-done rate and the autonomy ratio per review grade, and critic findings per critic grade', () => {
    const o = deriveOutcomes([
      run('a', 'different-family', [{ grade: 'different-family', found: true }, { grade: 'different-family', found: false }]),
      run('b', 'same-model', [{ grade: 'different-model', found: false }]),
    ]);
    expect(Object.keys(o.safety.caughtFalseDoneByGrade)).toEqual(['different-family', 'same-model']);
    expect(Object.keys(o.throughput.autonomyRatioByGrade)).toEqual(['different-family', 'same-model']);
    expect(o.throughput.criticFindingsByGrade['different-family']).toMatchObject({ count: 1, sample: 2 });
    expect(o.throughput.criticFindingsByGrade['different-model']).toMatchObject({ count: 0, sample: 1 });
  });
});
