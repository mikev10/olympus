import { describe, expect, it } from 'vitest';
import type { ModelFamily, ModelIdentity, RunId, RunState, StationId, TaskId } from '@olympus-ai/core';
import { StubVault, type AdmissionRecord, type EnforcementDecision, type IntegrationMerged, type UsageRecord } from '@olympus-ai/vault';
import { deriveOutcomes, distribution, estimateCost, MIN_ESTIMATE_SAMPLE, failureRate, readRunRecords, successRate, type RunRecords, type TaskRecord } from '../src/index.js';

const MODEL: ModelIdentity = { provider: 'anthropic', family: 'claude' as ModelFamily, model: 'm-standard', version: '1' };

function usage(runId: string, taskId: string, station: StationId, attempt: number, model = MODEL, costUsd = 1): UsageRecord {
  return {
    runId: runId as RunId,
    taskId: taskId as TaskId,
    station,
    attempt,
    model,
    reading: { kind: 'metered', inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd, refused: 0, exhausted: null },
    collectedBy: 'runtime',
  } as unknown as UsageRecord;
}

function task(id: string, outcomes: ReadonlyArray<'passed' | 'failed'>, opts: { mismatch?: number; models?: string[]; station?: StationId } = {}): TaskRecord {
  const passed = outcomes.at(-1) === 'passed';
  return {
    taskId: id as TaskId,
    station: opts.station ?? 'build',
    status: passed ? 'passed' : 'failed',
    iterations: outcomes.length,
    attempts: outcomes.map((outcome, i) => ({ outcome, claimMismatch: i === opts.mismatch })),
    firstModel: opts.models?.[0] ?? 'anthropic/claude/m-standard',
    models: opts.models ?? ['anthropic/claude/m-standard'],
  };
}

function decision(runId: string, at: string, station: StationId | null, d: EnforcementDecision['decision']): EnforcementDecision {
  return { runId: runId as RunId, taskId: null, station, decidedAt: at, occurrence: at, decision: d, collectedBy: 'runtime' };
}

function run(id: string, over: Partial<RunRecords>): RunRecords {
  return {
    runId: id as RunId,
    ending: 'merged',
    requestedLevel: 2,
    stack: 'vitest@4',
    startedAt: '2026-10-01T00:00:00.000Z',
    mergedAt: '2026-10-01T01:00:00.000Z',
    approvalsSpent: 0,
    tasks: [],
    decisions: [],
    usage: [],
    cost: null,
    ...over,
  };
}

describe('bounds', () => {
  it('bounds zero failures in n at 1 - 0.05^(1/n), about 1% at 300', () => {
    const r = failureRate(0, 300);
    expect(r.kind).toBe('rate');
    if (r.kind !== 'rate') return;
    expect(r.bound.side).toBe('upper');
    expect(r.bound.value).toBeCloseTo(1 - 0.05 ** (1 / 300), 9);
    expect(r.bound.value).toBeCloseTo(0.00994, 5);
  });

  it('matches the published one-sided 95% Clopper–Pearson bound for 1 in 10', () => {
    const r = failureRate(1, 10);
    expect(r.kind === 'rate' && r.bound.value).toBeCloseTo(0.3942, 4);
  });

  it('bounds a success rate below, as the mirror of the failure bound', () => {
    const s = successRate(10, 10);
    expect(s.kind === 'rate' && s.bound.value).toBeCloseTo(0.05 ** (1 / 10), 9);
    const f = failureRate(3, 20);
    const m = successRate(17, 20);
    expect(f.kind === 'rate' && m.kind === 'rate' && f.bound.value + m.bound.value).toBeCloseTo(1, 9);
  });

  it('reports no sample as no-sample, never 0% or 100%', () => {
    expect(failureRate(0, 0)).toEqual({ kind: 'no-sample' });
    expect(successRate(0, 0)).toEqual({ kind: 'no-sample' });
    expect(distribution([])).toEqual({ kind: 'no-sample' });
  });

  it('refuses a count larger than its sample', () => {
    expect(() => failureRate(2, 1)).toThrow();
  });

  it('takes median and 90th percentile by nearest rank', () => {
    expect(distribution([5, 1, 3, 2, 4, 6, 7, 8, 9, 10])).toEqual({ kind: 'distribution', sample: 10, median: 5, p90: 9 });
  });
});

describe('deriveOutcomes', () => {
  it('counts a failed attempt and a passing attempt whose claim differed as caught false-dones, and not a passing, matching one', () => {
    const o = deriveOutcomes([run('r1', { tasks: [task('a', ['failed', 'passed']), task('b', ['passed'], { mismatch: 0 }), task('c', ['passed'])] })]);
    expect(o.safety.caughtFalseDone).toMatchObject({ kind: 'rate', count: 2, sample: 4 });
    expect(o.safety.escapedFalseDone).toBe('not-established');
  });

  it("keys a task's attempts under one model, or escalated when its calls ran on more than one", () => {
    const o = deriveOutcomes([run('r1', { tasks: [task('a', ['failed', 'passed'], { models: ['x/claude/deep', 'x/claude/std'] }), task('b', ['passed'])] })]);
    expect(Object.keys(o.safety.caughtFalseDoneByModel)).toEqual(['anthropic/claude/m-standard', 'escalated']);
    expect(o.safety.caughtFalseDoneByModel.escalated).toMatchObject({ count: 1, sample: 2 });
  });

  it('counts every ending, and leaves an unfinished run out of every run-level rate', () => {
    const o = deriveOutcomes([
      run('m', {}),
      run('p', { ending: 'parked', mergedAt: null }),
      run('h', { ending: 'halted', mergedAt: null }),
      run('u', { ending: 'unfinished', mergedAt: null }),
      run('x', { ending: 'refused', requestedLevel: null, mergedAt: null }),
    ]);
    expect(o.population).toMatchObject({ merged: 1, parked: 1, halted: 1, unfinished: 1, refused: 1, total: 5 });
    expect(o.throughput.autonomyRatio).toMatchObject({ kind: 'rate', count: 1, sample: 3 });
  });

  it('does not count a merge that spent an approval as autonomous', () => {
    const o = deriveOutcomes([run('m', { approvalsSpent: 1 }), run('n', {})]);
    expect(o.throughput.autonomyRatio).toMatchObject({ count: 1, sample: 2 });
    expect(o.throughput.autonomyRatioByLevel.L2).toMatchObject({ count: 1, sample: 2 });
  });

  it('pairs each grant with the first request it cleared, and counts a request with no grant as open', () => {
    const key = 'integrate:2' as const;
    const required = { cause: 'station-refused', decidedBy: 'station-machine', refusal: { ok: false, reason: 'approval-required', key, escalations: [], message: '' } } as const;
    const granted = { cause: 'approval-granted', decidedBy: 'approval', key, principal: 'p' } as const;
    const o = deriveOutcomes([
      run('a', {
        decisions: [
          decision('a', '2026-10-01T00:00:00.000Z', 'integrate', required as unknown as EnforcementDecision['decision']),
          // repeated by a resume before the grant: the same wait
          decision('a', '2026-10-01T00:05:00.000Z', 'integrate', required as unknown as EnforcementDecision['decision']),
          decision('a', '2026-10-01T00:10:00.000Z', 'integrate', granted),
        ],
      }),
      run('b', { ending: 'unfinished', mergedAt: null, decisions: [decision('b', '2026-10-01T00:00:00.000Z', 'integrate', required as unknown as EnforcementDecision['decision'])] }),
    ]);
    expect(o.throughput.approvalWait[key]).toEqual({ kind: 'distribution', sample: 1, median: 600_000, p90: 600_000 });
    expect(o.throughput.approvalsOpen[key]).toBe(1);
    expect(o.throughput.refusalsByReason['approval-required']).toBe(3);
  });

  it('takes cycle time from admission to the merge time GitHub reported', () => {
    const o = deriveOutcomes([run('a', {}), run('b', { mergedAt: '2026-10-01T03:00:00.000Z' })]);
    expect(o.throughput.cycleTime).toEqual({ kind: 'distribution', sample: 2, median: 3_600_000, p90: 10_800_000 });
  });

  it("charges an unmerged run's spend to the merges, and marks the figure a lower bound when a cost is unknown", () => {
    const total = (usd: number, bound: 'exact' | 'lower') => ({ calls: 1, unmetered: 0, lost: bound === 'lower' ? 1 : 0, metered: { calls: 1, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: usd, exhausted: 0, unreadable: 0 }, bound });
    const exact = deriveOutcomes([run('a', { cost: total(3, 'exact') }), run('b', { ending: 'parked', mergedAt: null, cost: total(1, 'exact') })]);
    expect(exact.throughput.costPerMergedChange).toEqual({ kind: 'cost', usd: 4, spentUsd: 4, merges: 1, bound: 'exact' });
    const lower = deriveOutcomes([run('a', { cost: total(3, 'lower') })]);
    expect(lower.throughput.costPerMergedChange).toMatchObject({ bound: 'lower' });
    expect(deriveOutcomes([run('p', { ending: 'parked', mergedAt: null, cost: total(2, 'exact') })]).throughput.costPerMergedChange).toEqual({ kind: 'no-sample', spentUsd: 2 });
  });

  it('counts a refused review exit as a return, but not a pending approval there', () => {
    const gate = { cause: 'station-refused', decidedBy: 'station-machine', refusal: { ok: false, reason: 'gate-failed', failed: [], message: '' } } as unknown as EnforcementDecision['decision'];
    const wait = { cause: 'station-refused', decidedBy: 'station-machine', refusal: { ok: false, reason: 'approval-required', key: 'review:2', escalations: [], message: '' } } as unknown as EnforcementDecision['decision'];
    const o = deriveOutcomes([
      run('a', { usage: [usage('a', 'r', 'review', 1)], decisions: [decision('a', '2026-10-01T00:00:00.000Z', 'review', gate)] }),
      run('b', { usage: [usage('b', 'r', 'review', 1)], decisions: [decision('b', '2026-10-01T00:00:00.000Z', 'review', wait)] }),
      run('c', {}),
    ]);
    expect(o.throughput.reviewExitRefused).toMatchObject({ kind: 'rate', count: 1, sample: 2 });
  });

  it('leaves a review on an unfinished run out of the review refusal rate', () => {
    const gate = { cause: 'station-refused', decidedBy: 'station-machine', refusal: { ok: false, reason: 'gate-failed', failed: [], message: '' } } as unknown as EnforcementDecision['decision'];
    const seatedOnly = (id: string): RunRecords => run(id, { ending: 'unfinished', mergedAt: null, usage: [usage(id, 'r', 'review', 1)] });
    const o = deriveOutcomes([
      run('a', { ending: 'halted', mergedAt: null, usage: [usage('a', 'r', 'review', 1)], decisions: [decision('a', '2026-10-01T00:00:00.000Z', 'review', gate)] }),
      seatedOnly('u1'), seatedOnly('u2'), seatedOnly('u3'),
    ]);
    expect(o.throughput.reviewExitRefused).toMatchObject({ kind: 'rate', count: 1, sample: 1 });
  });

  it('measures first-pass yield per station and per first model, and rolls it across stations', () => {
    const o = deriveOutcomes([run('a', { tasks: [task('a', ['passed']), task('b', ['failed', 'passed']), task('r', ['passed'], { station: 'review' })] })]);
    expect(o.throughput.firstPassYieldByStation.build).toMatchObject({ count: 1, sample: 2 });
    expect(o.throughput.rolledYield).toBeCloseTo(0.5, 9);
    expect(o.throughput.iterationsToGreen).toEqual({ kind: 'distribution', sample: 3, median: 1, p90: 2 });
  });

  it('yields no-sample everywhere over no runs, and lists what is not measured', () => {
    const o = deriveOutcomes([]);
    expect(o.safety.caughtFalseDone).toEqual({ kind: 'no-sample' });
    expect(o.throughput.autonomyRatio).toEqual({ kind: 'no-sample' });
    expect(o.throughput.cycleTime).toEqual({ kind: 'no-sample' });
    expect(o.throughput.rolledYield).toBeNull();
    expect(o.safety.caughtFalseDoneByStack).toEqual({});
    expect(o.notMeasured.some((n) => n.startsWith('stack'))).toBe(false);
  });

  it('keys every per-run and per-attempt rate by the stack admission recorded, and a run that names none as unrecorded (R18)', () => {
    const o = deriveOutcomes([
      run('a', { stack: 'vitest@4', tasks: [task('t', ['failed', 'passed'])] }),
      run('b', { stack: 'jest@29', approvalsSpent: 1, tasks: [task('t', ['passed'])] }),
      run('c', { stack: null, tasks: [task('t', ['passed'])] }),
    ]);
    expect(o.safety.caughtFalseDoneByStack).toEqual({
      'jest@29': failureRate(0, 1),
      unrecorded: failureRate(0, 1),
      'vitest@4': failureRate(1, 2),
    });
    expect(o.throughput.autonomyRatioByStack).toEqual({
      'jest@29': successRate(0, 1),
      unrecorded: successRate(1, 1),
      'vitest@4': successRate(1, 1),
    });
    expect(o.throughput.firstPassYieldByStack).toEqual({
      'jest@29': successRate(1, 1),
      unrecorded: successRate(1, 1),
      'vitest@4': successRate(0, 1),
    });
  });

});

describe('estimateCost', () => {
  /** One past run per cost, each with one build task whose single call read that cost. */
  async function history(costs: readonly number[], lost = false, status = 'passed'): Promise<StubVault> {
    const vault = new StubVault(process.cwd());
    for (const [i, usd] of costs.entries()) {
      const runId = `past-${String(i)}` as RunId;
      const admission = await vault.recordAdmission({ run: { id: runId, requestedLevel: 2, createdAt: '2026-10-01T00:00:00.000Z' }, stack: 'vitest@4' } as unknown as AdmissionRecord);
      const record = usage(runId, 't', 'build', 1, MODEL, usd);
      const ref = await vault.recordUsage(lost && i === 0 ? { ...record, reading: { kind: 'lost', detail: 'gone' } } : record);
      const state = {
        runId, admission, station: 'build', phase: 'working', tasks: { t: status }, attempts: {}, results: {}, evidenceRefs: [],
        violations: [], approvals: [], reviews: [], usage: [ref], cancelled: null, halted: null, version: '0',
      } as unknown as RunState;
      await vault.commitRunState(state, '0');
    }
    return vault;
  }

  it('prices each task at the median past cost of its station and model', async () => {
    const estimate = await estimateCost(await history([1, 2, 3, 4, 100]), [{ station: 'build', model: MODEL }, { station: 'build', model: MODEL }]);
    expect(estimate).toMatchObject({ kind: 'likely', usd: 6, cells: [{ station: 'build', medianUsd: 3, sample: 5 }] });
  });

  it('declines below five past tasks, and does not count a task whose cost was lost', async () => {
    expect(await estimateCost(await history([1, 2, 3, 4]), [{ station: 'build', model: MODEL }])).toMatchObject({ kind: 'insufficient-sample', needed: MIN_ESTIMATE_SAMPLE, short: [{ station: 'build', sample: 4 }] });
    expect(await estimateCost(await history([1, 2, 3, 4, 5], true), [{ station: 'build', model: MODEL }])).toMatchObject({ kind: 'insufficient-sample', short: [{ sample: 4 }] });
  });

  it('does not count a task that has not finished as a past task, a failed one awaiting its next build included', async () => {
    for (const status of ['running', 'failed']) {
      expect(await estimateCost(await history([1, 1, 1, 1, 1], false, status), [{ station: 'build', model: MODEL }])).toMatchObject({ kind: 'insufficient-sample', short: [{ sample: 0 }] });
    }
    expect(await estimateCost(await history([1, 1, 1, 1, 1], false, 'parked'), [{ station: 'build', model: MODEL }])).toMatchObject({ kind: 'likely' });
  });
});

describe('readRunRecords', () => {
  const runId = 'r' as RunId;
  async function admitted(vault: StubVault, approvals: RunState['approvals']): Promise<void> {
    const admission = await vault.recordAdmission({ run: { id: runId, requestedLevel: 2, createdAt: '2026-10-01T00:00:00.000Z' }, stack: 'vitest@4' } as unknown as AdmissionRecord);
    await vault.commitRunState({
      runId, admission, station: 'integrate', phase: 'awaiting-approval', tasks: {}, attempts: {}, results: {}, evidenceRefs: [],
      violations: [], approvals, reviews: [], usage: [], cancelled: null, halted: null, version: '0',
    } as unknown as RunState, '0');
  }

  it('does not read a merge whose integrate grant is not yet spent as autonomous', async () => {
    const vault = new StubVault(process.cwd());
    await admitted(vault, [{ key: 'integrate:2', approvedBy: 'maintainer', approvedAt: '2026-10-01T00:30:00.000Z', usedAt: null }] as unknown as RunState['approvals']);
    await vault.recordIntegration({ runId, kind: 'merged', mergedAt: '2026-10-01T01:00:00.000Z', collectedBy: 'runtime' } as unknown as IntegrationMerged);
    const records = await readRunRecords(vault, runId);
    expect(records).toMatchObject({ ending: 'merged', approvalsSpent: 1 });
    expect(deriveOutcomes([records]).throughput.autonomyRatio).toMatchObject({ count: 0, sample: 1 });
  });

  it('refuses a run whose state cannot be read, never reading it as a run with no state', async () => {
    class Torn extends StubVault {
      override readRunState(): Promise<RunState> {
        return Promise.reject(new SyntaxError('Unexpected end of JSON input'));
      }
    }
    const vault = new Torn(process.cwd());
    await admitted(vault, []);
    await expect(readRunRecords(vault, runId)).rejects.toThrow(/JSON/);
  });

  it('reads the stack the admission record names, and none from a record written before R18 or a run with no admission', async () => {
    const vault = new StubVault(process.cwd());
    await admitted(vault, []);
    expect((await readRunRecords(vault, runId)).stack).toBe('vitest@4');

    // A record written before R18 carries no stack; the store now refuses one, so the read is what changes.
    class Unstacked extends StubVault {
      override async read(ref: Parameters<StubVault['read']>[0]): Promise<Uint8Array> {
        const bytes = await super.read(ref);
        if (ref.kind !== 'admission') return bytes;
        const { stack: _dropped, ...before } = JSON.parse(new TextDecoder().decode(bytes)) as AdmissionRecord;
        return new TextEncoder().encode(JSON.stringify(before));
      }
    }
    const old = new Unstacked(process.cwd());
    await admitted(old, []);
    expect((await readRunRecords(old, runId)).stack).toBeNull();
    expect((await readRunRecords(new StubVault(process.cwd()), runId)).stack).toBeNull();
  });

  it('reads a run with no state yet as unfinished', async () => {
    await expect(readRunRecords(new StubVault(process.cwd()), runId)).resolves.toMatchObject({ ending: 'unfinished', tasks: [], usage: [] });
  });
});
