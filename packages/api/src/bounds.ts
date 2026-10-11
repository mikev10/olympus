/**
 * A rate with its sample and its bound, never a point estimate alone (R2).
 * Bounds are one-sided 95% Clopper–Pearson: exact, from the binomial
 * distribution itself, and conservative at every sample size, including the
 * small ones a young line has (D-R2-01).
 */

/** The confidence every published bound is taken at. */
export const CONFIDENCE = 0.95;

/**
 * A proportion over a sample, or `no-sample` where there was none. A rate
 * over nothing is not 0% or 100%: it is not a rate (I5).
 */
export type Proportion =
  | { readonly kind: 'no-sample' }
  | {
      readonly kind: 'rate';
      readonly count: number;
      readonly sample: number;
      readonly rate: number;
      /**
       * `upper` for a failure rate, the side a reader must not underestimate;
       * `lower` for a success rate, the side a reader must not overstate.
       */
      readonly bound: { readonly side: 'upper' | 'lower'; readonly confidence: number; readonly value: number };
    };

/** A distribution of durations or counts: its median and 90th percentile, nearest rank, with its sample. */
export type Distribution =
  | { readonly kind: 'no-sample' }
  | { readonly kind: 'distribution'; readonly sample: number; readonly median: number; readonly p90: number };

/** `count` failures in `sample`, bounded above. */
export function failureRate(count: number, sample: number): Proportion {
  return proportion(count, sample, 'upper');
}

/** `count` successes in `sample`, bounded below. */
export function successRate(count: number, sample: number): Proportion {
  return proportion(count, sample, 'lower');
}

function proportion(count: number, sample: number, side: 'upper' | 'lower'): Proportion {
  if (!Number.isSafeInteger(sample) || sample < 0 || !Number.isSafeInteger(count) || count < 0 || count > sample) {
    throw new Error(`bounds: ${String(count)} of ${String(sample)} is not a count over a sample`);
  }
  if (sample === 0) return { kind: 'no-sample' };
  const alpha = 1 - CONFIDENCE;
  const value = side === 'upper' ? upperBound(count, sample, alpha) : 1 - upperBound(sample - count, sample, alpha);
  return { kind: 'rate', count, sample, rate: count / sample, bound: { side, confidence: CONFIDENCE, value } };
}

/**
 * The p at which seeing `k` or fewer in `n` has probability `alpha`: the
 * one-sided Clopper–Pearson upper bound. Found by bisection on the binomial
 * CDF, which falls as p rises.
 */
function upperBound(k: number, n: number, alpha: number): number {
  if (k === n) return 1;
  const logs = logFactorials(n);
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 200 && hi - lo > 1e-12; i += 1) {
    const mid = (lo + hi) / 2;
    if (binomialCdf(k, n, mid, logs) > alpha) lo = mid;
    else hi = mid;
  }
  return hi;
}

function binomialCdf(k: number, n: number, p: number, logs: readonly number[]): number {
  const lp = Math.log(p);
  const lq = Math.log1p(-p);
  let sum = 0;
  for (let i = 0; i <= k; i += 1) {
    sum += Math.exp((logs[n] ?? 0) - (logs[i] ?? 0) - (logs[n - i] ?? 0) + i * lp + (n - i) * lq);
  }
  return sum;
}

function logFactorials(n: number): number[] {
  const logs = [0];
  for (let i = 1; i <= n; i += 1) logs.push((logs[i - 1] ?? 0) + Math.log(i));
  return logs;
}

/** Median and 90th percentile by nearest rank, so each is a value that was observed. */
export function distribution(values: readonly number[]): Distribution {
  if (values.length === 0) return { kind: 'no-sample' };
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (q: number): number => sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)] ?? Number.NaN;
  return { kind: 'distribution', sample: sorted.length, median: rank(0.5), p90: rank(0.9) };
}
