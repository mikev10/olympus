/**
 * One model against another in the same seats (R54): what a model-tier run
 * is told to seat, and what two finished runs say about each other.
 *
 * The rule a comparison applies is fixed here, before either run exists, so
 * the numbers cannot choose their own reading. A candidate replaces a
 * baseline only when it is no worse in every arm and its run cost less. A
 * comparison that cannot be made is refused, never reported as a tie (I5).
 *
 * The benchmark seats a model as a judge of finished work, never as the
 * author of it (D-R7-02), so a comparison says nothing about iterations or
 * parks, and says so in `notMeasured`.
 */
import type { ModelTier } from '@olympus-ai/core';
import type { Proportion } from '@olympus-ai/api';
import type { Corpus, Item } from './corpus.js';
import { armResult, type ArmResult, type BenchmarkResult, type ItemOutcome, type ModelRun, type Verdict } from './result.js';

const TIERS: readonly ModelTier[] = ['fast', 'standard', 'deep'];
/** A model id, as it appears in a file name: nothing that could leave the results directory. */
const MODEL_ID = /^[a-z0-9][a-z0-9.-]*$/;
const CORPUS_VERSION = /^v[0-9]+$/;

export interface ModelRunPlan {
  readonly corpus: string;
  readonly tier: ModelTier;
  /** The model seated at `tier` in place of the driver's own, or null for the driver's. */
  readonly model: string | null;
  readonly repetitions: number;
  /** The most the whole run may spend. */
  readonly capUsd: number;
  /** The most one call may spend. */
  readonly callUsd: number;
  /** The file under `docs/benchmark/` the run writes, given the model the tier resolved to. */
  resultName(resolved: string): string;
}

type Environment = Readonly<Record<string, string | undefined>>;

function positive(env: Environment, name: string, fallback: string | null): number {
  const raw = env[name] ?? fallback;
  if (raw === null || raw === '') throw new Error(`the model tier needs ${name}; it is never skipped`);
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`the model tier needs ${name} to be a positive number, not '${raw}'`);
  return value;
}

/**
 * What the operator asked the model tier to run. With neither
 * `BENCHMARK_TIER` nor `BENCHMARK_MODEL` set it is the run R7 committed: the
 * `fast` tier's own model, written to `<corpus>-model.json`. With either set,
 * the result's name carries the tier and the model, so two models' runs
 * never share a file.
 */
export function modelRunPlan(env: Environment): ModelRunPlan {
  const corpus = env.BENCHMARK_CORPUS ?? 'v1';
  if (!CORPUS_VERSION.test(corpus)) throw new Error(`the model tier needs BENCHMARK_CORPUS to be a corpus version such as v2, not '${corpus}'`);
  const tier = (env.BENCHMARK_TIER ?? 'fast') as ModelTier;
  if (!TIERS.includes(tier)) throw new Error(`the model tier needs BENCHMARK_TIER to be one of ${TIERS.join(', ')}, not '${tier}'`);
  const model = env.BENCHMARK_MODEL ?? null;
  if (model !== null && !MODEL_ID.test(model)) throw new Error(`the model tier needs BENCHMARK_MODEL to be an exact model id, not '${model}'`);
  const repetitions = positive(env, 'BENCHMARK_REPETITIONS', '3');
  if (!Number.isSafeInteger(repetitions)) throw new Error(`the model tier needs BENCHMARK_REPETITIONS to be a positive integer, not '${String(env.BENCHMARK_REPETITIONS)}'`);
  const named = env.BENCHMARK_TIER !== undefined || env.BENCHMARK_MODEL !== undefined;
  return {
    corpus,
    tier,
    model,
    repetitions,
    capUsd: positive(env, 'BENCHMARK_CAP_USD', null),
    callUsd: positive(env, 'BENCHMARK_CALL_USD', '0.15'),
    resultName: (resolved) => {
      if (!MODEL_ID.test(resolved)) throw new Error(`the tier resolved to '${resolved}', which is not a model id a result can be named for`);
      return named ? `${corpus}-model-${tier}-${resolved}.json` : `${corpus}-model.json`;
    },
  };
}

/** One model's side of one arm, over every trial: an unreadable answer is a miss on a seeded item and a refusal on a control (D-R7-17). */
export interface ArmSide {
  /** Seeded false-dones the model let through, of every seeded trial. */
  readonly falseDone: { readonly count: number; readonly sample: number; readonly rate: number };
  readonly detection: Proportion;
  readonly falseRefusal: Proportion;
  readonly unreadable: { readonly seeded: number; readonly control: number };
}

export interface ArmComparison {
  readonly baseline: ArmSide;
  readonly candidate: ArmSide;
  /** The candidate let through no larger a share of seeded false-dones, and refused no larger a share of controls. */
  readonly noWorse: boolean;
}

export interface Comparison {
  readonly corpus: BenchmarkResult['corpus'];
  readonly repetitions: number;
  readonly baseline: { readonly result: string; readonly model: string; readonly spentUsd: number };
  readonly candidate: { readonly result: string; readonly model: string; readonly spentUsd: number };
  readonly arms: Readonly<Record<string, ArmComparison>>;
  readonly noWorse: boolean;
  readonly costsLess: boolean;
  /** The candidate replaces the baseline: no worse in every arm, and its run cost less. */
  readonly change: boolean;
  /** What the entry asked to compare and this benchmark cannot: it seats no model as the author of work. */
  readonly notMeasured: readonly string[];
}

const DECIMALS = 6;

const VERDICTS: readonly string[] = ['caught', 'passed', 'unreadable'];
const KINDS: readonly string[] = ['seeded', 'control'];

interface Named {
  readonly file: string;
  readonly result: BenchmarkResult;
}

/**
 * A result file as it was read from disk: nothing in it is what its type
 * says until it is checked here. Every arm's rates are counted again from
 * its own trials, and a file whose stored summary differs from that count is
 * refused, so a comparison is always over verdicts and never over a summary
 * somebody wrote (review: codex-2).
 */
function checked(named: Named): { readonly run: ModelRun; readonly arms: Readonly<Record<string, ArmResult>> } {
  const { file } = named;
  const refuse = (what: string): never => {
    throw new Error(`benchmark: ${file} ${what}`);
  };
  // Read as unknown: the type is a claim the file makes about itself.
  const result = named.result as unknown as {
    tier?: unknown;
    run?: { spentUsd?: unknown; repetitions?: unknown; capUsd?: unknown; model?: { provider?: unknown; family?: unknown; model?: unknown } | null } | null;
    arms?: Record<string, { overall?: unknown; groups?: unknown; items?: unknown } | undefined> | null;
  } | null;
  if (typeof result !== 'object' || result === null) return refuse('is not a result');
  const run = result.run;
  if (result.tier !== 'model' || typeof run !== 'object' || run === null) return refuse('is not a model-tier result, so it says nothing about a model');
  const { spentUsd, repetitions, capUsd, model } = run;
  if (typeof spentUsd !== 'number' || !Number.isFinite(spentUsd) || spentUsd < 0) return refuse('records a spentUsd that is not a non-negative number');
  if (typeof capUsd !== 'number' || !Number.isFinite(capUsd)) return refuse('records a capUsd that is not a number');
  if (typeof repetitions !== 'number' || !Number.isSafeInteger(repetitions) || repetitions < 1) return refuse('records repetitions that are not a positive integer');
  if (typeof model !== 'object' || model === null || typeof model.model !== 'string' || model.model === '' || typeof model.provider !== 'string' || typeof model.family !== 'string') return refuse('names no model');
  if (typeof result.arms !== 'object' || result.arms === null) return refuse('holds no arms');
  const arms: Record<string, ArmResult> = {};
  for (const name of Object.keys(result.arms).sort()) {
    const stored = result.arms[name];
    if (stored === undefined || !Array.isArray(stored.items)) return refuse(`has no trials in its '${name}' arm`);
    const seen = new Set<string>();
    const items = (stored.items as unknown[]).map((entry): ItemOutcome => {
      const item = entry as Partial<Record<keyof ItemOutcome, unknown>> | null;
      if (typeof item !== 'object' || item === null || typeof item.id !== 'string' || typeof item.group !== 'string' || typeof item.kind !== 'string' || !KINDS.includes(item.kind)) return refuse(`holds a malformed item in its '${name}' arm`);
      if (seen.has(item.id)) return refuse(`holds item '${item.id}' twice in its '${name}' arm`);
      seen.add(item.id);
      const verdicts = item.verdicts;
      if (!Array.isArray(verdicts) || !verdicts.every((v) => typeof v === 'string' && VERDICTS.includes(v))) return refuse(`holds a verdict nobody defined for item '${item.id}' in its '${name}' arm`);
      if (verdicts.length !== repetitions) return refuse(`ran item '${item.id}' ${String(verdicts.length)} time(s) in its '${name}' arm, not once per repetition (${String(repetitions)})`);
      return { id: item.id, kind: item.kind as ItemOutcome['kind'], group: item.group, verdicts: verdicts as Verdict[], detectorFired: [], causes: [] };
    });
    const fresh = armResult(items);
    if (JSON.stringify(fresh.overall) !== JSON.stringify(stored.overall) || JSON.stringify(fresh.groups) !== JSON.stringify(stored.groups)) {
      return refuse(`carries a summary for its '${name}' arm that does not match its own trials`);
    }
    arms[name] = fresh;
  }
  return { run: { model: { provider: model.provider, family: model.family, model: model.model }, repetitions, capUsd, spentUsd }, arms };
}

function side(arm: ArmResult, name: string, file: string): ArmSide {
  const { detection, falseRefusal } = arm.overall.everyTrial;
  if (detection.kind !== 'rate' || falseRefusal.kind !== 'rate') throw new Error(`benchmark: ${file}'s '${name}' arm has no sample, so there is nothing to compare`);
  const missed = detection.sample - detection.count;
  return {
    falseDone: { count: missed, sample: detection.sample, rate: Number((missed / detection.sample).toFixed(DECIMALS)) },
    detection,
    falseRefusal,
    unreadable: arm.overall.unreadable,
  };
}

/** How many clean trials a side refused; `side` has already refused a side with no sample. */
function refused(s: ArmSide): number {
  return s.falseRefusal.kind === 'rate' ? s.falseRefusal.count : Number.NaN;
}

/** An arm's items as what they are, without what was said of them: the tasks. */
function tasks(arm: ArmResult): string {
  return JSON.stringify(arm.items.map((i) => [i.id, i.kind, i.group]));
}

/**
 * `candidate` against `baseline`, each a committed model-tier result named
 * by its file. Refused unless both ran the same corpus, by digest, the same
 * number of times, over the same arms and the same items, with different
 * models: anything else is not the same tasks.
 */
export function compareRuns(baseline: Named, candidate: Named): Comparison {
  const b = checked(baseline);
  const c = checked(candidate);
  const bc = baseline.result.corpus;
  const cc = candidate.result.corpus;
  if (bc.version !== cc.version || bc.digest !== cc.digest) throw new Error(`benchmark: ${baseline.file} ran corpus ${bc.version} (${bc.digest}) and ${candidate.file} ran ${cc.version} (${cc.digest}); they are not the same tasks`);
  if (b.run.repetitions !== c.run.repetitions) throw new Error(`benchmark: ${baseline.file} ran each item ${String(b.run.repetitions)} time(s) and ${candidate.file} ${String(c.run.repetitions)}; they are not the same repetitions`);
  if (b.run.model.model === c.run.model.model) throw new Error(`benchmark: both results are ${b.run.model.model}'s; there is nothing to compare`);
  const names = Object.keys(b.arms);
  if (names.length === 0 || names.join() !== Object.keys(c.arms).join()) throw new Error(`benchmark: ${baseline.file} and ${candidate.file} do not hold the same arms`);
  const arms: Record<string, ArmComparison> = {};
  for (const name of names) {
    const left = b.arms[name];
    const right = c.arms[name];
    // Both are keys of maps whose key lists were just held equal.
    if (left === undefined || right === undefined) throw new Error(`benchmark: the '${name}' arm is missing`);
    if (tasks(left) !== tasks(right)) throw new Error(`benchmark: the '${name}' arms of ${baseline.file} and ${candidate.file} hold different items; they are not the same tasks`);
    const l = side(left, name, baseline.file);
    const r = side(right, name, candidate.file);
    // The same items the same number of times, so the samples are equal and counts compare as rates do.
    arms[name] = { baseline: l, candidate: r, noWorse: r.falseDone.count <= l.falseDone.count && refused(r) <= refused(l) };
  }
  const noWorse = Object.values(arms).every((arm) => arm.noWorse);
  const costsLess = c.run.spentUsd < b.run.spentUsd;
  return {
    corpus: { version: bc.version, digest: bc.digest },
    repetitions: b.run.repetitions,
    baseline: { result: baseline.file, model: b.run.model.model, spentUsd: b.run.spentUsd },
    candidate: { result: candidate.file, model: c.run.model.model, spentUsd: c.run.spentUsd },
    arms,
    noWorse,
    costsLess,
    change: noWorse && costsLess,
    notMeasured: ['iterations', 'parks'],
  };
}

/**
 * Whether a result holds its whole corpus: the corpus by digest, the two arms
 * of the model tier and no others, every item of the corpus in the
 * driver-alone arm, and every model-tier item in the critic arm, each as the
 * corpus names it. Two results that left the same arm or the same hard items
 * out would otherwise compare as equals (review: codex-3).
 */
export function coverage(corpus: Corpus, named: Named): void {
  const { file, result } = named;
  if (result.corpus.version !== corpus.version || result.corpus.digest !== corpus.digest) throw new Error(`benchmark: ${file} names corpus ${result.corpus.version} with digest ${result.corpus.digest}, and the committed corpus ${corpus.version} has ${corpus.digest}`);
  const arms = Object.keys(result.arms).sort();
  if (arms.join() !== 'alone,critic') throw new Error(`benchmark: ${file} holds the arms ${arms.join(', ') || 'none'}, and a model-tier result holds alone and critic`);
  const expected: Record<string, readonly Item[]> = { alone: corpus.items, critic: corpus.items.filter((i) => i.tier === 'model') };
  for (const name of arms) {
    const want = JSON.stringify((expected[name] ?? []).map((i) => [i.id, i.kind, i.group]).sort());
    const have = JSON.stringify((result.arms[name]?.items ?? []).map((i) => [i.id, i.kind, i.group]).sort());
    if (want !== have) throw new Error(`benchmark: ${file}'s '${name}' arm does not hold the items corpus ${corpus.version} gives that arm`);
  }
}

/**
 * The comparisons a decision about the tier map rests on. Each must be
 * committed: with none named, deleting a comparison would leave nothing to
 * hold, and the suite would pass over an empty directory (review: codex-5,
 * gemini-3).
 */
export const REQUIRED_COMPARISONS: readonly string[] = ['v2-comparison-claude-opus-5-5-claude-fable-5-2.json'];

/** The file under `docs/benchmark/` a comparison is committed as. */
export function comparisonName(comparison: Comparison): string {
  return `${comparison.corpus.version}-comparison-${comparison.baseline.model}-${comparison.candidate.model}.json`;
}

/** The comparison as it is committed: two-space JSON and a final newline. */
export function serializeComparison(comparison: Comparison): string {
  return `${JSON.stringify(comparison, null, 2)}\n`;
}
