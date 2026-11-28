/**
 * Tokens held to a recorded baseline (R59): a model-tier run fails when an
 * item's tokens per driver call grow past a set margin over what the
 * committed result of the same name recorded.
 *
 * Which results are held, and by what margin, is `TOKEN_BASELINES` below: an
 * edit to this file, reviewed in a diff, and never a setting of whoever
 * runs the tier (D-R59-04). The baseline is read from `HEAD`, not from the
 * working tree, where a failed run has just written its own result.
 *
 * The figure compared is tokens per driver call. A drafted item's critic is
 * seated once per attempt, and how many attempts there are follows the
 * verdict, so a total would move with what the critic said and not with
 * what it read.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { BenchmarkResult, ItemTokens } from './result.js';

export interface TokenBaseline {
  /** A model-tier result under `docs/benchmark/`, committed with its tokens. */
  readonly result: string;
  /** How far past the baseline an item's tokens per call may grow: 0.25 is a quarter more. */
  readonly margin: number;
}

/**
 * The results a model-tier run is held to. Empty until a paid run's result
 * is committed with its tokens: a baseline nobody recorded is not one. Add a
 * result here in the pull request that commits it, with a margin chosen from
 * the spread its own repetitions show.
 */
export const TOKEN_BASELINES: readonly TokenBaseline[] = [];

/** The baseline a run that writes `result` is held to, or null when the result is not listed. A margin that is not a positive number is refused. */
export function baselineFor(result: string, baselines: readonly TokenBaseline[] = TOKEN_BASELINES): TokenBaseline | null {
  const listed = baselines.filter((b) => b.result === result);
  if (listed.length > 1) throw new Error(`benchmark: ${result} is listed as a token baseline ${String(listed.length)} times; one margin holds a result`);
  const [entry] = listed;
  if (entry === undefined) return null;
  if (!Number.isFinite(entry.margin) || entry.margin <= 0) throw new Error(`benchmark: the token baseline ${result} is listed with the margin ${String(entry.margin)}, which is not a positive number`);
  return entry;
}

interface Named {
  readonly file: string;
  readonly result: BenchmarkResult;
}

/** What a result must be for another run to be held to it, or to be held: named so a refusal can say which side it is. */
export interface RunShape {
  readonly corpus: BenchmarkResult['corpus'];
  readonly repetitions: number;
  readonly model: string;
}

type Counted = Readonly<Record<string, readonly ItemTokens[]>>;

const COUNTS = ['calls', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'exhausted'] as const;

/**
 * A result's tokens as a file gave them: nothing in it is what its type says
 * until it is checked here. Refused unless it is a model-tier result of
 * `shape`'s corpus, repetitions, and model, with a count for every
 * repetition of every item it names.
 */
function counted(named: Named, shape: RunShape): Counted {
  const { file } = named;
  const refuse = (what: string): never => {
    throw new Error(`benchmark: ${file} ${what}, so no run can be held to it`);
  };
  const result = named.result as unknown as {
    tier?: unknown;
    corpus?: { version?: unknown; digest?: unknown } | null;
    run?: { repetitions?: unknown; model?: { model?: unknown } | null } | null;
    tokens?: Record<string, unknown> | null;
    arms?: Record<string, { items?: unknown } | undefined> | null;
  } | null;
  if (typeof result !== 'object' || result === null) return refuse('is not a result');
  if (result.tier !== 'model') return refuse('is not a model-tier result');
  if (result.corpus?.version !== shape.corpus.version || result.corpus.digest !== shape.corpus.digest) return refuse(`ran another corpus than ${shape.corpus.version} (${shape.corpus.digest})`);
  if (result.run?.repetitions !== shape.repetitions) return refuse(`did not run each item ${String(shape.repetitions)} time(s)`);
  if (result.run.model?.model !== shape.model) return refuse(`is not ${shape.model}'s result`);
  const tokens = result.tokens;
  if (typeof tokens !== 'object' || tokens === null || Object.keys(tokens).length === 0) return refuse('records no tokens');
  // The tokens must cover the result's own outcomes: every arm it holds, and every item of each. Fewer would be compared as if they were all.
  const arms = result.arms;
  if (typeof arms !== 'object' || arms === null || Object.keys(arms).sort().join() !== Object.keys(tokens).sort().join()) return refuse('does not count tokens for the arms it holds');
  let items = 0;
  for (const [arm, outcomes] of Object.entries(arms)) {
    const named = outcomes?.items;
    const counts = tokens[arm];
    if (!Array.isArray(named) || !Array.isArray(counts)) return refuse(`holds no items in its '${arm}' arm`);
    const ids = (list: unknown[]): string => JSON.stringify(list.map((i) => (i as { id?: unknown } | null)?.id).sort());
    if (ids(named) !== ids(counts)) return refuse(`does not count tokens for the items of its own '${arm}' arm`);
    items += named.length;
  }
  if (items === 0) return refuse('counts tokens for no item');
  for (const [arm, items] of Object.entries(tokens)) {
    if (!Array.isArray(items)) return refuse(`holds no items in the tokens of its '${arm}' arm`);
    const seen = new Set<string>();
    for (const entry of items as unknown[]) {
      const item = entry as { id?: unknown; repetitions?: unknown } | null;
      if (typeof item !== 'object' || item === null || typeof item.id !== 'string' || seen.has(item.id)) return refuse(`holds a malformed or repeated item in the tokens of its '${arm}' arm`);
      seen.add(item.id);
      if (!Array.isArray(item.repetitions) || item.repetitions.length !== shape.repetitions) return refuse(`does not count item '${item.id}' once per repetition in its '${arm}' arm`);
      for (const repetition of item.repetitions as unknown[]) {
        if (typeof repetition !== 'object' || repetition === null) return refuse(`holds a malformed repetition of item '${item.id}'`);
        for (const task of Object.values(repetition) as unknown[]) {
          const t = task as Record<string, unknown> | null;
          // A task is recorded for the calls a relay read, so one recorded with no call is not a record the tier wrote.
          if (typeof t !== 'object' || t === null || (t.bound !== 'exact' && t.bound !== 'lower') || COUNTS.some((k) => !Number.isSafeInteger(t[k]) || (t[k] as number) < 0) || t.calls === 0) {
            return refuse(`holds a count that is not one for item '${item.id}'`);
          }
        }
      }
    }
  }
  return tokens as Counted;
}

/** Refuses a baseline a run of `shape` could not be held to. Called before any call is paid for (I5). */
export function checkBaseline(baseline: Named, shape: RunShape): void {
  counted(baseline, shape);
}

/** One item's tokens over all its repetitions and tasks: every token the model was sent or wrote, and the driver calls they were spent in. */
export interface ItemFigure {
  readonly tokens: number;
  readonly calls: number;
  /** Null when no call was metered: the runtime sent the draft back before any model read it. */
  readonly perCall: number | null;
  readonly bound: 'exact' | 'lower';
}

export function figure(item: ItemTokens): ItemFigure {
  let tokens = 0;
  let calls = 0;
  let bound: ItemFigure['bound'] = 'exact';
  for (const repetition of item.repetitions) {
    for (const t of Object.values(repetition)) {
      tokens += t.inputTokens + t.outputTokens + t.cacheReadTokens + t.cacheWriteTokens;
      calls += t.calls;
      if (t.bound === 'lower') bound = 'lower';
    }
  }
  return { tokens, calls, perCall: calls === 0 ? null : tokens / calls, bound };
}

/**
 * `within`: no more than the limit. `no-calls`: neither side metered a call
 * for the item, so nothing was spent on it then or now. Those two pass.
 * `grew`: past the limit. `unmeasured`: under the limit, but only a lower
 * bound, so nothing says it did not grow. `no-baseline`: the baseline
 * metered no call for the item and the run did. `no-sample`: the baseline
 * metered calls and the run metered none, so the item was not compared. A
 * comparison that was not made is never `within` (I5).
 */
export type Held = 'within' | 'no-calls' | 'grew' | 'unmeasured' | 'no-baseline' | 'no-sample';

export interface ItemHeld {
  readonly arm: string;
  readonly id: string;
  readonly baseline: ItemFigure;
  readonly fresh: ItemFigure;
  /** The most tokens per call the item may use: the baseline's, times one plus the margin. Null when the baseline has none. */
  readonly limit: number | null;
  readonly held: Held;
}

function verdict(baseline: ItemFigure, fresh: ItemFigure, margin: number): { limit: number | null; held: Held } {
  if (fresh.perCall === null && baseline.perCall === null) return { limit: null, held: 'no-calls' };
  if (baseline.perCall === null) return { limit: null, held: 'no-baseline' };
  if (fresh.perCall === null) return { limit: baseline.perCall * (1 + margin), held: 'no-sample' };
  const limit = baseline.perCall * (1 + margin);
  if (fresh.perCall > limit) return { limit, held: 'grew' };
  return { limit, held: fresh.bound === 'lower' ? 'unmeasured' : 'within' };
}

/**
 * `fresh` held to `baseline`, item by item, in every arm. Refused unless
 * both are model-tier results of the same corpus by digest, the same
 * repetitions, and the same model, over the same arms and items: anything
 * else is not the same work, and a comparison that cannot be made is never
 * reported as held (I5).
 */
export function holdTokens(baseline: Named, fresh: Named, margin: number): ItemHeld[] {
  if (!Number.isFinite(margin) || margin <= 0) throw new Error(`benchmark: the margin ${String(margin)} is not a positive number`);
  const run = fresh.result.run;
  if (run === undefined) throw new Error(`benchmark: ${fresh.file} is not a model-tier result, so it has no tokens to hold`);
  const shape: RunShape = { corpus: fresh.result.corpus, repetitions: run.repetitions, model: run.model.model };
  const now = counted(fresh, shape);
  const then = counted(baseline, shape);
  const arms = Object.keys(now).sort();
  if (arms.join() !== Object.keys(then).sort().join()) throw new Error(`benchmark: ${baseline.file} and ${fresh.file} do not count tokens for the same arms`);
  const held: ItemHeld[] = [];
  for (const arm of arms) {
    const before = new Map((then[arm] ?? []).map((i) => [i.id, i]));
    const after = now[arm] ?? [];
    if (before.size !== after.length || after.some((i) => !before.has(i.id))) throw new Error(`benchmark: the '${arm}' arms of ${baseline.file} and ${fresh.file} count tokens for different items`);
    for (const item of [...after].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
      const was = before.get(item.id);
      // The two id sets were just held equal.
      if (was === undefined) throw new Error(`benchmark: item '${item.id}' is missing from ${baseline.file}`);
      const b = figure(was);
      const f = figure(item);
      held.push({ arm, id: item.id, baseline: b, fresh: f, ...verdict(b, f, margin) });
    }
  }
  return held;
}

/** The items a run failed on: every one that was not compared and found within its limit, but for those neither side spent a token on. */
export function tokenFailures(held: readonly ItemHeld[]): ItemHeld[] {
  return held.filter((h) => h.held !== 'within' && h.held !== 'no-calls');
}

/** The failures as a person reads them, one line each. */
export function describeFailures(failures: readonly ItemHeld[]): string {
  const n = (x: number | null): string => (x === null ? 'none' : String(Math.round(x)));
  return failures
    .map((f) => `${f.arm}/${f.id}: ${f.held}, ${n(f.fresh.perCall)} tokens per call against a baseline of ${n(f.baseline.perCall)} and a limit of ${n(f.limit)}`)
    .join('\n');
}

/**
 * A result as `HEAD` holds it under `docs/benchmark/`. A result that is not
 * committed is refused: a listed baseline that is missing is a missing
 * check, never a run with nothing to be held to (I5).
 */
export async function committedResult(file: string, repository: string): Promise<Named> {
  if (!/^[a-z0-9][a-z0-9.-]*\.json$/.test(file)) throw new Error(`benchmark: '${file}' is not the name of a result under docs/benchmark/`);
  let text: string;
  try {
    ({ stdout: text } = await promisify(execFile)('git', ['show', `HEAD:docs/benchmark/${file}`], { cwd: repository, maxBuffer: 64 * 1024 * 1024 }));
  } catch (error) {
    throw new Error(`benchmark: the token baseline ${file} is not committed at HEAD, so nothing can be held to it`, { cause: error });
  }
  return { file, result: JSON.parse(text) as BenchmarkResult };
}

/**
 * What a model-tier run that writes `file` owes its baseline, settled before
 * any call is paid for: null when the result is not listed, and otherwise
 * the check to run on the fresh result, which throws naming every item that
 * is not within its limit. A listed baseline that is not committed, or that
 * a run of `shape` cannot be held to, is refused here (I5).
 */
export async function tokenHold(
  file: string,
  repository: string,
  shape: RunShape,
  baselines: readonly TokenBaseline[] = TOKEN_BASELINES,
): Promise<((fresh: BenchmarkResult) => void) | null> {
  const listed = baselineFor(file, baselines);
  if (listed === null) return null;
  const baseline = await committedResult(file, repository);
  checkBaseline(baseline, shape);
  return (fresh) => {
    const failures = tokenFailures(holdTokens(baseline, { file, result: fresh }, listed.margin));
    if (failures.length > 0) throw new Error(`benchmark: ${file} is held to its committed tokens with a margin of ${String(listed.margin)}, and ${String(failures.length)} item(s) are not within it:\n${describeFailures(failures)}`);
  };
}
