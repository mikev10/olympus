/**
 * One model against another (R54), with no model behind it: what a run is
 * told to seat, the rule two runs are compared by, and every committed
 * comparison held to the results it names.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { ClaudeCodeDriver } from '@olympus-ai/driver-claude-code';
import type { SandboxProvider } from '@olympus-ai/sandbox';
import { compareRuns, comparisonName, coverage, modelRunPlan, REQUIRED_COMPARISONS, serializeComparison, type Comparison } from '../src/comparison.js';
import { benchmarkResult, type BenchmarkResult, type ItemOutcome, type Verdict } from '../src/result.js';
import { loadCorpus, type Corpus } from '../src/corpus.js';

const DOCS = join(import.meta.dirname, '..', '..', '..', 'docs', 'benchmark');
const CORPUS = { version: 'v9', digest: 'd'.repeat(64) } as Corpus;

function outcomes(seeded: readonly Verdict[], control: readonly Verdict[]): ItemOutcome[] {
  return [
    { id: 'seeded', kind: 'seeded', group: 'g', verdicts: seeded, detectorFired: seeded.map(() => null), causes: [] },
    { id: 'control', kind: 'control', group: 'g', verdicts: control, detectorFired: control.map(() => null), causes: [] },
  ];
}

interface Shape {
  readonly model: string;
  readonly spentUsd: number;
  readonly seeded?: readonly Verdict[];
  readonly control?: readonly Verdict[];
  readonly corpus?: Corpus;
  readonly repetitions?: number;
}

function run(shape: Shape): BenchmarkResult {
  const items = outcomes(shape.seeded ?? ['caught', 'caught', 'passed'], shape.control ?? ['passed', 'passed', 'caught']);
  return benchmarkResult(shape.corpus ?? CORPUS, 'model', { alone: items, critic: items }, {
    model: { provider: 'anthropic', family: 'claude', model: shape.model },
    repetitions: shape.repetitions ?? 3,
    capUsd: 50,
    spentUsd: shape.spentUsd,
  });
}

const compare = (baseline: Shape, candidate: Shape): Comparison =>
  compareRuns({ file: 'baseline.json', result: run(baseline) }, { file: 'candidate.json', result: run(candidate) });

describe('modelRunPlan', () => {
  test('with no tier and no model named it is the run R7 committed', () => {
    const plan = modelRunPlan({ BENCHMARK_CAP_USD: '7' });
    expect(plan).toMatchObject({ corpus: 'v1', tier: 'fast', model: null, repetitions: 3, capUsd: 7, callUsd: 0.15 });
    expect(plan.resultName('claude-haiku-4-5')).toBe('v1-model.json');
  });

  test('a named tier or model puts both in the name of the result, so two models never share a file', () => {
    const env = { BENCHMARK_CAP_USD: '20', BENCHMARK_CORPUS: 'v2', BENCHMARK_TIER: 'deep', BENCHMARK_CALL_USD: '1' };
    expect(modelRunPlan(env).resultName('claude-opus-5-5')).toBe('v2-model-deep-claude-opus-5-5.json');
    const seated = modelRunPlan({ ...env, BENCHMARK_MODEL: 'claude-fable-5-2' });
    expect(seated).toMatchObject({ tier: 'deep', model: 'claude-fable-5-2', callUsd: 1 });
    expect(seated.resultName('claude-fable-5-2')).toBe('v2-model-deep-claude-fable-5-2.json');
  });

  test.each([
    [{}, 'BENCHMARK_CAP_USD'],
    [{ BENCHMARK_CAP_USD: '0' }, 'BENCHMARK_CAP_USD'],
    [{ BENCHMARK_CAP_USD: '5', BENCHMARK_CALL_USD: 'lots' }, 'BENCHMARK_CALL_USD'],
    [{ BENCHMARK_CAP_USD: '5', BENCHMARK_REPETITIONS: '1.5' }, 'BENCHMARK_REPETITIONS'],
    [{ BENCHMARK_CAP_USD: '5', BENCHMARK_TIER: 'deepest' }, 'BENCHMARK_TIER'],
    [{ BENCHMARK_CAP_USD: '5', BENCHMARK_CORPUS: '../v2' }, 'BENCHMARK_CORPUS'],
    [{ BENCHMARK_CAP_USD: '5', BENCHMARK_MODEL: '../../etc/passwd' }, 'BENCHMARK_MODEL'],
    [{ BENCHMARK_CAP_USD: '5', BENCHMARK_MODEL: '' }, 'BENCHMARK_MODEL'],
  ])('refuses %j, naming %s', (env, name) => {
    expect(() => modelRunPlan(env)).toThrow(name);
  });

  test('refuses to name a result for a model id that could leave the results directory', () => {
    expect(() => modelRunPlan({ BENCHMARK_CAP_USD: '5', BENCHMARK_TIER: 'deep' }).resultName('a/b')).toThrow('not a model id');
  });
});

describe('compareRuns', () => {
  test('a candidate that is no worse in every arm and cost less replaces the baseline', () => {
    const c = compare({ model: 'old', spentUsd: 10 }, { model: 'new', spentUsd: 6 });
    expect(c).toMatchObject({ noWorse: true, costsLess: true, change: true, notMeasured: ['iterations', 'parks'] });
    expect(c.arms.alone?.baseline.falseDone).toEqual({ count: 1, sample: 3, rate: 0.333333 });
    expect(comparisonName(c)).toBe('v9-comparison-old-new.json');
  });

  test('a candidate that cost the same or more does not, however well it judged', () => {
    const better = { seeded: ['caught', 'caught', 'caught'] as const, control: ['passed', 'passed', 'passed'] as const };
    expect(compare({ model: 'old', spentUsd: 10 }, { model: 'new', spentUsd: 10, ...better })).toMatchObject({ noWorse: true, costsLess: false, change: false });
    expect(compare({ model: 'old', spentUsd: 10 }, { model: 'new', spentUsd: 12, ...better })).toMatchObject({ change: false });
  });

  test('a candidate that let one more seeded false-done through does not, however little it cost', () => {
    const c = compare({ model: 'old', spentUsd: 10 }, { model: 'new', spentUsd: 1, seeded: ['caught', 'passed', 'passed'] });
    expect(c).toMatchObject({ noWorse: false, costsLess: true, change: false });
  });

  test('an unreadable answer on a seeded item is a false-done let through', () => {
    const c = compare({ model: 'old', spentUsd: 10 }, { model: 'new', spentUsd: 1, seeded: ['caught', 'caught', 'unreadable'] });
    expect(c.arms.alone?.candidate.falseDone.count).toBe(1);
    expect(c.change).toBe(true);
    expect(compare({ model: 'old', spentUsd: 10 }, { model: 'new', spentUsd: 1, seeded: ['caught', 'unreadable', 'unreadable'] }).change).toBe(false);
  });

  test('a candidate that catches everything by refusing more clean work does not', () => {
    const c = compare({ model: 'old', spentUsd: 10 }, { model: 'new', spentUsd: 1, seeded: ['caught', 'caught', 'caught'], control: ['caught', 'caught', 'passed'] });
    expect(c).toMatchObject({ noWorse: false, change: false });
  });

  test.each<[string, Shape, Shape, string]>([
    ['another corpus', { model: 'old', spentUsd: 1 }, { model: 'new', spentUsd: 1, corpus: { version: 'v9', digest: 'e'.repeat(64) } as Corpus }, 'not the same tasks'],
    ['other repetitions', { model: 'old', spentUsd: 1 }, { model: 'new', spentUsd: 1, repetitions: 2, seeded: ['caught', 'passed'], control: ['passed', 'caught'] }, 'not the same repetitions'],
    ['the same model', { model: 'old', spentUsd: 1 }, { model: 'old', spentUsd: 1 }, 'nothing to compare'],
  ])('refuses %s', (_, baseline, candidate, message) => {
    expect(() => compare(baseline, candidate)).toThrow(message);
  });

  test('refuses a result that is not a model-tier one, and results that hold different arms', () => {
    const model = run({ model: 'new', spentUsd: 1 });
    const deterministic = benchmarkResult(CORPUS, 'deterministic', { line: outcomes(['caught'], ['passed']) });
    expect(() => compareRuns({ file: 'a.json', result: deterministic }, { file: 'b.json', result: model })).toThrow('a.json is not a model-tier result');
    const { critic: _critic, ...alone } = model.arms;
    expect(() => compareRuns({ file: 'a.json', result: run({ model: 'old', spentUsd: 1 }) }, { file: 'b.json', result: { ...model, arms: alone } })).toThrow('same arms');
  });
});

describe('the committed comparisons', () => {
  test('each is what its two named results give, byte for byte', async () => {
    const read = async (file: string): Promise<BenchmarkResult> => JSON.parse(await readFile(join(DOCS, file), 'utf8')) as BenchmarkResult;
    for (const file of (await readdir(DOCS)).filter((f) => f.includes('-comparison-'))) {
      const committed = await readFile(join(DOCS, file), 'utf8');
      const named = JSON.parse(committed) as Comparison;
      const fresh = compareRuns({ file: named.baseline.result, result: await read(named.baseline.result) }, { file: named.candidate.result, result: await read(named.candidate.result) });
      expect(comparisonName(fresh), file).toBe(file);
      expect(serializeComparison(fresh), file).toBe(committed);
    }
  });
});

describe('compareRuns reads the trials, not the summary a file carries (review: codex-2, codex-3, gemini-4)', () => {
  const edited = (result: BenchmarkResult, edit: (r: { arms: Record<string, { overall: { everyTrial: { detection: { count: number; rate: number }; falseRefusal: { rate: number } } }; items: Array<{ id: string }> }>; run: { spentUsd: unknown } }) => void): BenchmarkResult => {
    const copy = JSON.parse(JSON.stringify(result)) as BenchmarkResult;
    edit(copy as never);
    return copy;
  };
  const baseline = { file: 'baseline.json', result: run({ model: 'old', spentUsd: 10 }) };

  test('a summary that claims more than its own trials show is refused', () => {
    const worse = run({ model: 'new', spentUsd: 1, seeded: ['passed', 'passed', 'passed'] });
    const dressed = edited(worse, (r) => {
      for (const arm of Object.values(r.arms)) Object.assign(arm.overall.everyTrial.detection, { count: 3, rate: 1 });
    });
    expect(() => compareRuns(baseline, { file: 'candidate.json', result: dressed })).toThrow('does not match its own trials');
  });

  test('a stored false-refusal rate that disagrees with its count is refused', () => {
    const refusing = run({ model: 'new', spentUsd: 1, control: ['caught', 'caught', 'caught'] });
    const dressed = edited(refusing, (r) => {
      for (const arm of Object.values(r.arms)) arm.overall.everyTrial.falseRefusal.rate = 0;
    });
    expect(() => compareRuns(baseline, { file: 'candidate.json', result: dressed })).toThrow('does not match its own trials');
  });

  test('a cost that is not a number is refused, never compared as text', () => {
    const texted = edited(run({ model: 'new', spentUsd: 100 }), (r) => {
      r.run.spentUsd = '100';
    });
    expect(() => compareRuns({ file: 'baseline.json', result: run({ model: 'old', spentUsd: 20 }) }, { file: 'candidate.json', result: texted })).toThrow('spentUsd');
  });

  test('the same totals over other items are not the same tasks', () => {
    const renamed = edited(run({ model: 'new', spentUsd: 1 }), (r) => {
      for (const arm of Object.values(r.arms)) for (const item of arm.items) if (item.id === 'seeded') item.id = 'an-easier-item';
    });
    expect(() => compareRuns(baseline, { file: 'candidate.json', result: renamed })).toThrow('not the same tasks');
  });

  test('an item that did not run once per repetition is refused', () => {
    expect(() => compare({ model: 'old', spentUsd: 1 }, { model: 'new', spentUsd: 1, seeded: ['caught', 'caught'] })).toThrow('repetition');
  });
});

describe('coverage: a result holds every item of its corpus in both arms (review: codex-3)', () => {
  test('the committed results cover corpus v2, and one with an arm or an item removed does not', async () => {
    const corpus = await loadCorpus('v2');
    const file = 'v2-model-deep-claude-opus-5-5.json';
    const result = JSON.parse(await readFile(join(DOCS, file), 'utf8')) as BenchmarkResult;
    expect(() => { coverage(corpus, { file, result }); }).not.toThrow();
    const { critic: _critic, ...alone } = result.arms;
    expect(() => { coverage(corpus, { file, result: { ...result, arms: alone } }); }).toThrow('arms');
    const first = result.arms.alone;
    if (first === undefined) throw new Error('no alone arm');
    expect(() => { coverage(corpus, { file, result: { ...result, arms: { ...result.arms, alone: { ...first, items: first.items.slice(1) } } } }); }).toThrow('alone');
    expect(() => { coverage(corpus, { file, result: { ...result, corpus: { ...result.corpus, digest: '0'.repeat(64) } } }); }).toThrow('digest');
  });
});

describe('the tier map and its evidence (review: codex-5, gemini-3)', () => {
  test('the comparison this unit decided on is committed, and covers its corpus', async () => {
    const names = (await readdir(DOCS)).filter((f) => f.includes('-comparison-'));
    for (const required of REQUIRED_COMPARISONS) expect(names, required).toContain(required);
    for (const name of names) {
      const named = JSON.parse(await readFile(join(DOCS, name), 'utf8')) as Comparison;
      const corpus = await loadCorpus(named.corpus.version);
      for (const file of [named.baseline.result, named.candidate.result]) coverage(corpus, { file, result: JSON.parse(await readFile(join(DOCS, file), 'utf8')) as BenchmarkResult });
    }
  });

  test('the deep tier holds a compared candidate only where its comparison says change', async () => {
    const deep = new ClaudeCodeDriver({ provider: {} as SandboxProvider }).resolveModel('deep').model;
    for (const name of (await readdir(DOCS)).filter((f) => f.includes('-comparison-'))) {
      const named = JSON.parse(await readFile(join(DOCS, name), 'utf8')) as Comparison;
      if (named.candidate.model === deep) expect(named.change, `${name} seats ${deep} at deep`).toBe(true);
    }
  });
});
