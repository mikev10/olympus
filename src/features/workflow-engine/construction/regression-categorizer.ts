/**
 * Regression Categorizer
 *
 * Pure logic module (no I/O) for classifying test failures into one of four
 * RegressionCategory values and computing summary counts for ConstructionUnitProgress.
 */

import type { RegressionCategory } from '../phase-types.js';

/**
 * Classify a single failing test into one of four regression categories.
 *
 * Decision tree (evaluated in this exact order):
 * 1. pre_existing_failure — baseline had the test already failing
 * 2. flaky               — at least one re-run passed without code changes
 * 3. intentional_change  — test did not exist in the baseline (new test)
 * 4. legitimate_regression — baseline was passing/skipped, all re-runs also failed
 *
 * @param testName      - The failing test name (used for traceability only).
 * @param baselineEntry - Baseline snapshot entry, or null if the test is new.
 * @param rerunResults  - Results from up to 2 re-runs without code changes.
 */
export function categorizeFailure(
  _testName: string,
  baselineEntry: { status: 'passed' | 'failed' | 'skipped' } | null,
  rerunResults: Array<{ status: 'passed' | 'failed' | 'skipped' }>
): RegressionCategory {
  if (baselineEntry !== null && baselineEntry.status === 'failed') {
    return 'pre_existing_failure';
  }

  if (rerunResults.some(r => r.status === 'passed')) {
    return 'flaky';
  }

  if (baselineEntry === null) {
    return 'intentional_change';
  }

  return 'legitimate_regression';
}

export function checkFlakyThreshold(
  categorizedFailures: RegressionCategory[],
  warnThresholdPct = 0.2
): boolean {
  const total = categorizedFailures.length;
  if (total === 0) return false;
  const flakyCount = categorizedFailures.filter(c => c === 'flaky').length;
  return flakyCount / total > warnThresholdPct;
}

/**
 * Compute the regressions_count and flaky_count values for ConstructionUnitProgress.
 *
 * Only `legitimate_regression` contributes to regressions_count.
 * Only `flaky` contributes to flaky_count.
 * `pre_existing_failure` and `intentional_change` are excluded from both.
 *
 * @param failures   - Newly failing tests (parallel to categories).
 * @param categories - RegressionCategory for each failure entry.
 */
export function buildRegressionSummary(
  _failures: Array<{ test_name: string; file_path: string }>,
  categories: RegressionCategory[]
): { regressions_count: number; flaky_count: number } {
  const regressions_count = categories.filter(c => c === 'legitimate_regression').length;
  const flaky_count = categories.filter(c => c === 'flaky').length;
  return { regressions_count, flaky_count };
}
