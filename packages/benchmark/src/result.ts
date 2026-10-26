/**
 * The result: per arm and per group, the detection rate on seeded items and
 * the false-refusal rate on controls, each a proportion with its sample and
 * bound, never a point estimate alone (R2). Every item's outcome sits beside
 * the rates, so each number can be recounted from the rows under it.
 *
 * A result holds no time, path, or run id, so the same corpus through the
 * same line gives the same bytes, and CI can hold the committed result to a
 * fresh one (D-R7-06).
 */
import { failureRate, successRate, type Proportion } from '@olympus-ai/api';
import type { Corpus, Item } from './corpus.js';

/** What one arm made of one item. `unreadable` is a driver-alone verdict no one can read, counted beside a rate and never in it. */
export type Verdict = 'caught' | 'passed' | 'unreadable';

export interface ItemOutcome {
  readonly id: string;
  readonly kind: Item['kind'];
  readonly group: string;
  /** Repetitions of the item, in order. Deterministic items run once. */
  readonly verdicts: readonly Verdict[];
  /** Whether the group's own detector was among the causes, per repetition; null where the arm records no causes. */
  readonly detectorFired: ReadonlyArray<boolean | null>;
  /** Every cause recorded, across repetitions, sorted and deduplicated. */
  readonly causes: readonly string[];
}

export interface Rates {
  /** Seeded items caught: a success rate, bounded below. */
  readonly detection: Proportion;
  /** Controls caught: a failure rate, bounded above. */
  readonly falseRefusal: Proportion;
  readonly unreadable: { readonly seeded: number; readonly control: number };
}

export interface ArmResult {
  readonly overall: Rates;
  readonly groups: Readonly<Record<string, Rates>>;
  readonly items: readonly ItemOutcome[];
}

export interface BenchmarkResult {
  readonly corpus: { readonly version: string; readonly digest: string };
  readonly tier: Item['tier'];
  readonly arms: Readonly<Record<string, ArmResult>>;
  /** The model tier only: what ran and what it cost, so the result says what model its rates are a claim about. */
  readonly run?: ModelRun;
}

export interface ModelRun {
  readonly model: { readonly provider: string; readonly family: string; readonly model: string };
  readonly repetitions: number;
  readonly capUsd: number;
  readonly spentUsd: number;
}

/** The decimals a published rate or bound is rounded to, so the bytes do not depend on a platform's last bit. */
const DECIMALS = 6;

export function rates(items: readonly ItemOutcome[]): Rates {
  const count = (kind: Item['kind'], verdict: Verdict): number =>
    items.filter((i) => i.kind === kind).reduce((n, i) => n + i.verdicts.filter((v) => v === verdict).length, 0);
  const sample = (kind: Item['kind']): number => count(kind, 'caught') + count(kind, 'passed');
  return {
    detection: rounded(successRate(count('seeded', 'caught'), sample('seeded'))),
    falseRefusal: rounded(failureRate(count('control', 'caught'), sample('control'))),
    unreadable: { seeded: count('seeded', 'unreadable'), control: count('control', 'unreadable') },
  };
}

export function armResult(items: readonly ItemOutcome[]): ArmResult {
  const sorted = [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const groups: Record<string, Rates> = {};
  for (const group of [...new Set(sorted.map((i) => i.group))].sort()) groups[group] = rates(sorted.filter((i) => i.group === group));
  return { overall: rates(sorted), groups, items: sorted };
}

export function benchmarkResult(corpus: Corpus, tier: Item['tier'], arms: Readonly<Record<string, readonly ItemOutcome[]>>, run?: ModelRun): BenchmarkResult {
  const out: Record<string, ArmResult> = {};
  for (const name of Object.keys(arms).sort()) out[name] = armResult(arms[name] ?? []);
  return { corpus: { version: corpus.version, digest: corpus.digest }, tier, arms: out, ...(run === undefined ? {} : { run: { ...run, spentUsd: Number(run.spentUsd.toFixed(DECIMALS)) } }) };
}

/** The result as it is committed: two-space JSON and a final newline. */
export function serialize(result: BenchmarkResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

function rounded(p: Proportion): Proportion {
  if (p.kind === 'no-sample') return p;
  const r = (x: number): number => Number(x.toFixed(DECIMALS));
  return { ...p, rate: r(p.rate), bound: { ...p.bound, value: r(p.bound.value) } };
}

/**
 * Whether a group's detector is among the causes. A group names its
 * detector by the prefixes of the causes that are it, in the corpus
 * manifest, so what counts as the detector firing is versioned with the
 * corpus that relies on it.
 */
export function detectorFired(prefixes: readonly string[], causes: readonly string[]): boolean {
  return causes.some((cause) => prefixes.some((prefix) => cause === prefix || cause.startsWith(`${prefix}:`)));
}
