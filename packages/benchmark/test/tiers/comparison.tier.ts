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
import { compareRuns, comparisonName, coverage, serializeComparison } from '../../src/comparison.js';
import { loadCorpus } from '../../src/corpus.js';
import type { BenchmarkResult } from '../../src/result.js';

const DOCS = join(import.meta.dirname, '..', '..', '..', '..', 'docs', 'benchmark');

async function named(variable: string): Promise<{ file: string; result: BenchmarkResult }> {
  const file = process.env[variable];
  if (file === undefined || file === '' || basename(file) !== file) throw new Error(`the comparison needs ${variable}, the name of a result file in docs/benchmark/`);
  return { file, result: JSON.parse(await readFile(join(DOCS, file), 'utf8')) as BenchmarkResult };
}

test('the candidate against the baseline, by the rule fixed before either ran', async () => {
  const baseline = await named('BENCHMARK_BASELINE');
  const candidate = await named('BENCHMARK_CANDIDATE');
  // Each result is held to the committed corpus it names before anything is compared: both arms, every item.
  const corpus = await loadCorpus(baseline.result.corpus.version);
  coverage(corpus, baseline);
  coverage(corpus, candidate);
  const comparison = compareRuns(baseline, candidate);
  const path = join(DOCS, comparisonName(comparison));
  await writeFile(path, serializeComparison(comparison));
  // What is on disk is what was computed; the rule itself is held by the package's suite, not restated here.
  expect(await readFile(path, 'utf8')).toBe(serializeComparison(comparison));
});
