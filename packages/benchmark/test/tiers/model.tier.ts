/**
 * The model tier (D-R7-02): the driver-alone arm over every item, and the
 * critic arm over the drafted items, with the Claude Code driver in the real
 * seats, under a cap.
 *
 * **This calls the model and spends money.** It needs a Docker daemon,
 * `ANTHROPIC_API_KEY`, and `BENCHMARK_CAP_USD`, the most the run may spend,
 * which the maintainer sets. It fails without them and is never skipped. It
 * writes `docs/benchmark/v1-model.json`, which is committed as the run's
 * result: a model's answers vary, so there is nothing to compare a rerun to.
 * `BENCHMARK_REPETITIONS` sets how many times each item runs (default 3).
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { compileRoles } from '@olympus-ai/compiler';
import { DEFAULT_LIMITS } from '@olympus-ai/api';
import { ClaudeCodeDriver, ensureImage, MODEL_CREDENTIAL } from '@olympus-ai/driver-claude-code';
import { loadCorpus, type Corpus } from '../../src/corpus.js';
import { openBench, type Bench } from '../../src/line.js';
import { modelTier } from '../../src/model.js';
import { serialize } from '../../src/result.js';

const RESULT = join(import.meta.dirname, '..', '..', '..', '..', 'docs', 'benchmark', 'v1-model.json');

let base: string;
let bench: Bench;
let corpus: Corpus;

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`the model tier needs ${name}; it is never skipped`);
  return value;
}

beforeAll(async () => {
  const key = required('ANTHROPIC_API_KEY');
  required('BENCHMARK_CAP_USD');
  base = await mkdtemp(join(tmpdir(), 'benchmark-model-'));
  bench = await openBench(base, { [MODEL_CREDENTIAL]: key });
  corpus = await loadCorpus('v1');
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

test('the model tier of corpus v1, under the cap', async () => {
  const roles = await compileRoles(join(corpus.root, 'roles'));
  if (!roles.ok) throw new Error(`the corpus's roles did not compile: ${JSON.stringify(roles.refused)}`);
  const role = roles.roles.find((r) => r.role === 'done-checker');
  if (role === undefined) throw new Error("the corpus has no 'done-checker' role");
  const driver = new ClaudeCodeDriver({ provider: bench.provider });
  const image = await ensureImage();
  const repetitions = Number(process.env.BENCHMARK_REPETITIONS ?? '3');
  const result = await modelTier({
    bench,
    corpus,
    driver,
    image,
    limits: DEFAULT_LIMITS,
    capUsd: Number(required('BENCHMARK_CAP_USD')),
    repetitions,
    alone: { role, tier: 'fast', tools: ['Read', 'Glob', 'Grep', 'Bash'], budget: { maxTokens: 400_000, maxCostUsd: 0.5, maxWallClockMs: 600_000 } },
    critic: { tier: 'fast', tools: ['Read', 'Glob', 'Grep'], budget: { maxTokens: 400_000, maxCostUsd: 0.5, maxWallClockMs: 600_000 } },
  });
  await writeFile(RESULT, serialize(result.result));
  expect(result.spentUsd).toBeLessThanOrEqual(Number(required('BENCHMARK_CAP_USD')));
});
