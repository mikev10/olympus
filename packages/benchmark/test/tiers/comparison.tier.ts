/**
 * Two committed model-tier results, compared (R54). It calls no model and
 * spends nothing. `BENCHMARK_BASELINE` and `BENCHMARK_CANDIDATE` name the two
 * files under `docs/benchmark/`; the comparison is written beside them, and
 * the package's own suite then holds it to those two files byte for byte.
 *
 * `TIER=comparison pnpm --filter @olympus-ai/benchmark run deterministic`
 */
import { readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { expect, test } from 'vitest';
import { compareRuns, comparisonName, serializeComparison } from '../../src/comparison.js';
import type { BenchmarkResult } from '../../src/result.js';

const DOCS = join(import.meta.dirname, '..', '..', '..', '..', 'docs', 'benchmark');

async function named(variable: string): Promise<{ file: string; result: BenchmarkResult }> {
  const file = process.env[variable];
  if (file === undefined || file === '' || basename(file) !== file) throw new Error(`the comparison needs ${variable}, the name of a result file in docs/benchmark/`);
  return { file, result: JSON.parse(await readFile(join(DOCS, file), 'utf8')) as BenchmarkResult };
}

test('the candidate against the baseline, by the rule fixed before either ran', async () => {
  const comparison = compareRuns(await named('BENCHMARK_BASELINE'), await named('BENCHMARK_CANDIDATE'));
  await writeFile(join(DOCS, comparisonName(comparison)), serializeComparison(comparison));
  expect(comparison.change).toBe(comparison.noWorse && comparison.costsLess);
});
