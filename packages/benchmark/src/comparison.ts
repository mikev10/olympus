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
import type { BenchmarkResult } from './result.js';

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

function side(result: BenchmarkResult, arm: string, file: string): ArmSide {
  const rates = result.arms[arm]?.overall;
  if (rates === undefined) throw new Error(`benchmark: ${file} has no '${arm}' arm to compare`);
  const { detection, falseRefusal } = rates.everyTrial;
  if (detection.kind !== 'rate' || falseRefusal.kind !== 'rate') throw new Error(`benchmark: ${file}'s '${arm}' arm has no sample, so there is nothing to compare`);
  const missed = detection.sample - detection.count;
  return {
    falseDone: { count: missed, sample: detection.sample, rate: Number((missed / detection.sample).toFixed(DECIMALS)) },
    detection,
    falseRefusal,
    unreadable: rates.unreadable,
  };
}

/** The sample behind a proportion `side` has already refused to read without one. */
function sample(p: Proportion): number {
  return p.kind === 'rate' ? p.sample : 0;
}

function rate(p: Proportion): number {
  return p.kind === 'rate' ? p.rate : Number.NaN;
}

/**
 * `candidate` against `baseline`, each a committed model-tier result named
 * by its file. Refused unless both ran the same corpus, by digest, the same
 * number of times, over the same arms and the same number of trials, with
 * different models: anything else is not the same tasks.
 */
export function compareRuns(baseline: { readonly file: string; readonly result: BenchmarkResult }, candidate: { readonly file: string; readonly result: BenchmarkResult }): Comparison {
  const b = baseline.result;
  const c = candidate.result;
  for (const [file, r] of [[baseline.file, b], [candidate.file, c]] as const) {
    if (r.tier !== 'model' || r.run === undefined) throw new Error(`benchmark: ${file} is not a model-tier result, so it says nothing about a model`);
  }
  // Both checked just above; the narrowing does not survive the loop.
  if (b.run === undefined || c.run === undefined) throw new Error('benchmark: a model-tier result without its run');
  if (b.corpus.version !== c.corpus.version || b.corpus.digest !== c.corpus.digest) throw new Error(`benchmark: ${baseline.file} ran corpus ${b.corpus.version} (${b.corpus.digest}) and ${candidate.file} ran ${c.corpus.version} (${c.corpus.digest}); they are not the same tasks`);
  if (b.run.repetitions !== c.run.repetitions) throw new Error(`benchmark: ${baseline.file} ran each item ${String(b.run.repetitions)} time(s) and ${candidate.file} ${String(c.run.repetitions)}; they are not the same repetitions`);
  if (b.run.model.model === c.run.model.model) throw new Error(`benchmark: both results are ${b.run.model.model}'s; there is nothing to compare`);
  const names = Object.keys(b.arms).sort();
  if (names.length === 0 || names.join() !== Object.keys(c.arms).sort().join()) throw new Error(`benchmark: ${baseline.file} and ${candidate.file} do not hold the same arms`);
  const arms: Record<string, ArmComparison> = {};
  for (const name of names) {
    const left = side(b, name, baseline.file);
    const right = side(c, name, candidate.file);
    if (left.falseDone.sample !== right.falseDone.sample || sample(left.falseRefusal) !== sample(right.falseRefusal)) {
      throw new Error(`benchmark: the '${name}' arms of ${baseline.file} and ${candidate.file} ran different numbers of trials; they are not the same tasks`);
    }
    arms[name] = { baseline: left, candidate: right, noWorse: right.falseDone.count <= left.falseDone.count && rate(right.falseRefusal) <= rate(left.falseRefusal) };
  }
  const noWorse = Object.values(arms).every((a) => a.noWorse);
  const costsLess = c.run.spentUsd < b.run.spentUsd;
  return {
    corpus: b.corpus,
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

/** The file under `docs/benchmark/` a comparison is committed as. */
export function comparisonName(comparison: Comparison): string {
  return `${comparison.corpus.version}-comparison-${comparison.baseline.model}-${comparison.candidate.model}.json`;
}

/** The comparison as it is committed: two-space JSON and a final newline. */
export function serializeComparison(comparison: Comparison): string {
  return `${JSON.stringify(comparison, null, 2)}\n`;
}
