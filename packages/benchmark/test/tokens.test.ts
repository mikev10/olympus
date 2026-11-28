/**
 * Tokens held to a recorded baseline (R59), with no model behind it: every
 * result here is written by hand, so nothing spends anything. A run is held
 * only where its result is listed; a held run fails on growth past the
 * margin, on a figure nobody could read in full, and on an item with no
 * baseline; and a baseline that is missing or is other work is refused
 * before the run starts.
 */
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { loadCorpus } from '../src/corpus.js';
import { coverage } from '../src/comparison.js';
import { armResult, type ArmResult, type BenchmarkResult, type ItemTokens, type TaskTokens } from '../src/result.js';
import { baselineFor, committedResult, figure, holdTokens, TOKEN_BASELINES, tokenFailures, tokenHold, type RunShape } from '../src/tokens.js';

const CORPUS = { version: 'v9', digest: 'a'.repeat(64) };
const SHAPE: RunShape = { corpus: CORPUS, repetitions: 2, model: 'scripted-1' };

const RUN = { model: { provider: 'test', family: 'claude', model: 'scripted-1' }, repetitions: 2, capUsd: 1, spentUsd: 0 };

const task = (over: Partial<TaskTokens> = {}): TaskTokens => ({ calls: 1, inputTokens: 100, outputTokens: 10, cacheReadTokens: 300, cacheWriteTokens: 90, exhausted: 0, bound: 'exact', ...over });

/** An item that ran twice, one task each time. */
const item = (id: string, name: string, over: Partial<TaskTokens> = {}): ItemTokens => ({ id, repetitions: [{ [name]: task(over) }, { [name]: task(over) }] });

/** An arm whose outcomes name `ids`; the rates are not read by anything here. */
const arm = (ids: readonly string[]): ArmResult => armResult(ids.map((id) => ({ id, kind: 'seeded', group: 'g', verdicts: ['caught', 'caught'], detectorFired: [null, null], causes: [] })));

/** A model-tier result whose arms name exactly the items its tokens count, unless `over` says otherwise. */
function result(tokens: BenchmarkResult['tokens'], over: Partial<BenchmarkResult> = {}): BenchmarkResult {
  return {
    corpus: CORPUS,
    tier: 'model',
    arms: Object.fromEntries(Object.entries(tokens ?? {}).map(([name, items]) => [name, arm(items.map((i) => i.id))])),
    run: RUN,
    ...(tokens === undefined ? {} : { tokens }),
    ...over,
  };
}

const BASELINE = { file: 'then.json', result: result({ alone: [item('a', 'done-check'), item('b', 'done-check')], critic: [item('c', 'spec.critic')] }) };
const fresh = (tokens: BenchmarkResult['tokens'], over: Partial<BenchmarkResult> = {}) => ({ file: 'now.json', result: result(tokens, over) });

describe('figure', () => {
  test('is every token the model was sent or wrote, over the driver calls they were spent in', () => {
    expect(figure(item('a', 'done-check'))).toStrictEqual({ tokens: 1000, calls: 2, perCall: 500, bound: 'exact' });
    // A critic seated three times in one repetition read three times as much, and per call the same.
    expect(figure({ id: 'c', repetitions: [{ 'spec.critic': task({ calls: 3, inputTokens: 300, outputTokens: 30, cacheReadTokens: 900, cacheWriteTokens: 270 }) }, { 'spec.critic': task() }] }).perCall).toBe(500);
  });

  test('an item no model read has no figure, and one unreadable call makes the item a lower bound', () => {
    expect(figure({ id: 'd', repetitions: [{}, {}] })).toStrictEqual({ tokens: 0, calls: 0, perCall: null, bound: 'exact' });
    expect(figure({ id: 'e', repetitions: [{ t: task() }, { t: task({ bound: 'lower' }) }] }).bound).toBe('lower');
  });
});

describe('holdTokens', () => {
  test('an item at its limit is within it, and one token per call past it grew', () => {
    // The baseline is 500 tokens per call; a quarter more is 625.
    const at = holdTokens(BASELINE, fresh({ alone: [item('a', 'done-check', { cacheReadTokens: 425 }), item('b', 'done-check')], critic: [item('c', 'spec.critic')] }), 0.25);
    expect(at.map((h) => [h.arm, h.id, h.fresh.perCall, h.limit, h.held])).toStrictEqual([['alone', 'a', 625, 625, 'within'], ['alone', 'b', 500, 625, 'within'], ['critic', 'c', 500, 625, 'within']]);
    expect(tokenFailures(at)).toStrictEqual([]);

    const past = holdTokens(BASELINE, fresh({ alone: [item('a', 'done-check', { cacheReadTokens: 426 }), item('b', 'done-check')], critic: [item('c', 'spec.critic')] }), 0.25);
    expect(tokenFailures(past).map((h) => [h.arm, h.id, h.held])).toStrictEqual([['alone', 'a', 'grew']]);
  });

  test('more driver calls at the same tokens per call is not growth', () => {
    const again = { id: 'c', repetitions: [{ 'spec.critic': task({ calls: 3, inputTokens: 300, outputTokens: 30, cacheReadTokens: 900, cacheWriteTokens: 270 }) }, { 'spec.critic': task() }] };
    expect(tokenFailures(holdTokens(BASELINE, fresh({ alone: [item('a', 'done-check'), item('b', 'done-check')], critic: [again] }), 0.25))).toStrictEqual([]);
  });

  test('a figure under the limit that is only a lower bound is unmeasured, never within; past the limit it grew', () => {
    const under = holdTokens(BASELINE, fresh({ alone: [item('a', 'done-check', { bound: 'lower' }), item('b', 'done-check', { bound: 'lower', inputTokens: 900 })], critic: [item('c', 'spec.critic')] }), 0.25);
    expect(tokenFailures(under).map((h) => [h.id, h.held])).toStrictEqual([['a', 'unmeasured'], ['b', 'grew']]);
  });

  test('an item only one side metered a call for was not compared, and fails; one neither side metered spent nothing on either', () => {
    const none = (id: string): ItemTokens => ({ id, repetitions: [{}, {}] });
    const then = { file: 'then.json', result: result({ alone: [none('a'), item('b', 'done-check'), none('c')] }) };
    const held = holdTokens(then, fresh({ alone: [item('a', 'done-check'), none('b'), none('c')] }), 0.25);
    expect(held.map((h) => [h.id, h.held])).toStrictEqual([['a', 'no-baseline'], ['b', 'no-sample'], ['c', 'no-calls']]);
    // Only the item neither side made a call for passes: nothing was spent, then or now.
    expect(tokenFailures(held).map((h) => h.id)).toStrictEqual(['a', 'b']);
  });

  test('refuses a task recorded with no call, and tokens that do not cover the items the result itself names', () => {
    const now = fresh(BASELINE.result.tokens);
    // A task is recorded for the calls a relay read: one with none, and tokens counted, is not a record the tier wrote.
    const ghost = { alone: [item('a', 'done-check', { calls: 0, bound: 'lower' }), item('b', 'done-check')], critic: [item('c', 'spec.critic')] };
    expect(() => holdTokens(BASELINE, fresh(ghost), 0.25)).toThrow("now.json holds a count that is not one for item 'a'");
    // Matching metadata and no items: nothing would be compared, and nothing would fail.
    expect(() => holdTokens({ file: 'then.json', result: result({ alone: [] }) }, fresh({ alone: [] }), 0.25)).toThrow('now.json counts tokens for no item');
    // Tokens for fewer items, or other arms, than the result's own outcomes.
    const outcomes = { alone: arm(['a', 'b']), critic: arm(['c']) };
    expect(() => holdTokens(BASELINE, fresh({ alone: [item('a', 'done-check')], critic: [item('c', 'spec.critic')] }, { arms: outcomes }), 0.25)).toThrow("now.json does not count tokens for the items of its own 'alone' arm");
    expect(() => holdTokens(BASELINE, fresh({ alone: [item('a', 'done-check'), item('b', 'done-check')] }, { arms: outcomes }), 0.25)).toThrow('now.json does not count tokens for the arms it holds');
    expect(() => holdTokens({ file: 'then.json', result: result(BASELINE.result.tokens, { arms: { alone: arm(['a', 'b', 'z']), critic: arm(['c']) } }) }, now, 0.25)).toThrow("then.json does not count tokens for the items of its own 'alone' arm");
  });

  test('refuses a baseline that is not the same work, and a margin that is not a positive number', () => {
    const now = fresh(BASELINE.result.tokens);
    const then = (over: Partial<BenchmarkResult>, tokens: BenchmarkResult['tokens'] | 'recorded' = 'recorded') => ({ file: 'then.json', result: result(tokens === 'recorded' ? BASELINE.result.tokens : tokens, over) });
    expect(() => holdTokens({ file: 'then.json', result: result(undefined) }, now, 0.25)).toThrow('then.json records no tokens');
    expect(() => holdTokens(then({ tier: 'deterministic' }), now, 0.25)).toThrow('then.json is not a model-tier result');
    expect(() => holdTokens(then({ corpus: { ...CORPUS, digest: 'b'.repeat(64) } }), now, 0.25)).toThrow('then.json ran another corpus');
    expect(() => holdTokens(then({ run: { ...RUN, repetitions: 3 } }), now, 0.25)).toThrow('then.json did not run each item 2 time(s)');
    expect(() => holdTokens(then({ run: { ...RUN, model: { ...RUN.model, model: 'other' } } }), now, 0.25)).toThrow("then.json is not scripted-1's result");
    expect(() => holdTokens(then({}, { alone: BASELINE.result.tokens?.alone ?? [] }), now, 0.25)).toThrow('do not count tokens for the same arms');
    expect(() => holdTokens(then({}, { alone: [item('a', 'done-check')], critic: [item('c', 'spec.critic')] }), now, 0.25)).toThrow("the 'alone' arms of then.json and now.json count tokens for different items");
    expect(() => holdTokens(then({}, { alone: [item('a', 'done-check'), { id: 'b', repetitions: [{}] }], critic: [item('c', 'spec.critic')] }), now, 0.25)).toThrow("does not count item 'b' once per repetition");
    expect(() => holdTokens(then({}, { alone: [] }), fresh({ alone: [] }), 0.25)).toThrow('counts tokens for no item');
    expect(() => holdTokens(then({}, { alone: [item('a', 'done-check', { inputTokens: -1 }), item('b', 'done-check')], critic: [item('c', 'spec.critic')] }), now, 0.25)).toThrow("holds a count that is not one for item 'a'");
    expect(() => holdTokens(BASELINE, fresh(undefined), 0.25)).toThrow('now.json records no tokens');
    for (const margin of [0, -0.1, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => holdTokens(BASELINE, now, margin)).toThrow('is not a positive number');
  });
});

describe('baselineFor', () => {
  test('a result is held only when it is listed, once, with a positive margin', () => {
    const listed = [{ result: 'a.json', margin: 0.25 }, { result: 'twice.json', margin: 0.1 }, { result: 'twice.json', margin: 0.2 }, { result: 'zero.json', margin: 0 }];
    expect(baselineFor('a.json', listed)).toStrictEqual({ result: 'a.json', margin: 0.25 });
    expect(baselineFor('b.json', listed)).toBeNull();
    expect(() => baselineFor('twice.json', listed)).toThrow('listed as a token baseline 2 times');
    expect(() => baselineFor('zero.json', listed)).toThrow('not a positive number');
  });

  test('every result listed in the source is committed, covers its corpus, and can hold a run of its own shape', async () => {
    // Empty until a paid run is committed with its tokens (D-R59-04); each entry added is held here from then on.
    const repository = join(import.meta.dirname, '..', '..', '..');
    for (const entry of TOKEN_BASELINES) {
      expect(baselineFor(entry.result)).toStrictEqual(entry);
      const named = await committedResult(entry.result, repository);
      coverage(await loadCorpus(named.result.corpus.version), named);
      // Held to itself, every item is within its limit, and every item of the corpus is held.
      const held = holdTokens(named, named, entry.margin);
      expect(tokenFailures(held)).toStrictEqual([]);
      expect(held.length).toBeGreaterThan(0);
    }
  });
});

describe('tokenHold', () => {
  let repository: string;
  const git = (...args: string[]): void => {
    execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: repository, stdio: 'ignore' });
  };
  const commit = async (file: string, content: BenchmarkResult): Promise<void> => {
    await mkdir(join(repository, 'docs', 'benchmark'), { recursive: true });
    await writeFile(join(repository, 'docs', 'benchmark', file), JSON.stringify(content));
    git('add', '.');
    git('commit', '-m', 'a result');
  };

  beforeEach(async () => {
    repository = await mkdtemp(join(tmpdir(), 'token-hold-'));
    git('init', '-q');
  });

  afterEach(async () => {
    await rm(repository, { recursive: true, force: true });
  });

  const LISTED = [{ result: 'held.json', margin: 0.25 }];

  test('a result that is not listed is held to nothing, and says so as null', async () => {
    await commit('held.json', BASELINE.result);
    expect(await tokenHold('other.json', repository, SHAPE, LISTED)).toBeNull();
  });

  test('a listed result is held to what HEAD holds, not to the file a run has just overwritten', async () => {
    await commit('held.json', BASELINE.result);
    const grown = result({ alone: [item('a', 'done-check', { cacheReadTokens: 3000 }), item('b', 'done-check')], critic: [item('c', 'spec.critic')] });
    const hold = await tokenHold('held.json', repository, SHAPE, LISTED);
    if (hold === null) throw new Error('a listed result was held to nothing');
    // The regressed run's own result is on disk and staged, not committed; a second run is still held to the committed one.
    await writeFile(join(repository, 'docs', 'benchmark', 'held.json'), JSON.stringify(grown));
    git('add', '.');
    const again = await tokenHold('held.json', repository, SHAPE, LISTED);
    for (const check of [hold, again]) {
      expect(() => check?.(grown)).toThrow(/1 item\(s\) are not within it:\nalone\/a: grew, 3200 tokens per call against a baseline of 500 and a limit of 625/);
      expect(() => check?.(BASELINE.result)).not.toThrow();
    }
  });

  test('a listed baseline that is not committed, records no tokens, or is other work is refused before the run', async () => {
    await commit('unrelated.json', BASELINE.result);
    await expect(tokenHold('held.json', repository, SHAPE, LISTED)).rejects.toThrow('held.json is not committed at HEAD');
    await commit('held.json', result(undefined));
    await expect(tokenHold('held.json', repository, SHAPE, LISTED)).rejects.toThrow('held.json records no tokens, so no run can be held to it');
    await commit('held.json', BASELINE.result);
    await expect(tokenHold('held.json', repository, { ...SHAPE, repetitions: 3 }, LISTED)).rejects.toThrow('did not run each item 3 time(s)');
    await expect(tokenHold('held.json', repository, { ...SHAPE, model: 'other' }, LISTED)).rejects.toThrow("is not other's result");
    await expect(tokenHold('../held.json', repository, SHAPE, [{ result: '../held.json', margin: 0.25 }])).rejects.toThrow('is not the name of a result');
  });
});
