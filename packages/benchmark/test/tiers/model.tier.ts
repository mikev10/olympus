/**
 * The model tier (D-R7-02): the driver-alone arm over every item, and the
 * critic arm over the drafted items, with the Claude Code driver in the real
 * seats, under a cap.
 *
 * **This calls the model and spends money.** It needs a Docker daemon,
 * `ANTHROPIC_API_KEY`, and `BENCHMARK_CAP_USD`, the most the run may spend,
 * which the maintainer sets. It fails without them and is never skipped. It
 * writes its result under `docs/benchmark/`, which is committed as the run's
 * result: a model's answers vary, so there is nothing to compare a rerun to.
 * `BENCHMARK_REPETITIONS` sets how many times each item runs (default 3).
 *
 * `BENCHMARK_CORPUS` names the corpus (default `v1`), `BENCHMARK_TIER` the
 * tier both seats run at (default `fast`), `BENCHMARK_MODEL` a model to seat
 * at that tier in place of the driver's own, and `BENCHMARK_CALL_USD` the
 * most one call may spend (default 0.15). With a tier or a model named, the
 * result's file name carries both (R54, `src/comparison.ts`).
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { compileRoles } from '@olympus-ai/compiler';
import { DEFAULT_LIMITS } from '@olympus-ai/api';
import { ClaudeCodeDriver, ensureImage, MODEL_CREDENTIAL } from '@olympus-ai/driver-claude-code';
import { modelRunPlan, type ModelRunPlan } from '../../src/comparison.js';
import { loadCorpus, type Corpus } from '../../src/corpus.js';
import { openBench, type Bench } from '../../src/line.js';
import { modelTier } from '../../src/model.js';
import { serialize } from '../../src/result.js';

const DOCS = join(import.meta.dirname, '..', '..', '..', '..', 'docs', 'benchmark');

let base: string;
let bench: Bench;
let corpus: Corpus;
let plan: ModelRunPlan;

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`the model tier needs ${name}; it is never skipped`);
  return value;
}

beforeAll(async () => {
  const key = required('ANTHROPIC_API_KEY');
  // Every setting is read and refused here, before a container starts or a call is made (I5).
  plan = modelRunPlan(process.env);
  base = await mkdtemp(join(tmpdir(), 'benchmark-model-'));
  bench = await openBench(base, { [MODEL_CREDENTIAL]: key });
  corpus = await loadCorpus(plan.corpus);
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

test('the model tier of the corpus, under the cap', async () => {
  const roles = await compileRoles(join(corpus.root, 'roles'));
  if (!roles.ok) throw new Error(`the corpus's roles did not compile: ${JSON.stringify(roles.refused)}`);
  const role = roles.roles.find((r) => r.role === 'done-checker');
  if (role === undefined) throw new Error("the corpus has no 'done-checker' role");
  const own = new ClaudeCodeDriver({ provider: bench.provider });
  // The driver's own tier map with one tier reseated: every other tier keeps the model the driver ships.
  const shipped = { fast: own.resolveModel('fast').model, standard: own.resolveModel('standard').model, deep: own.resolveModel('deep').model };
  const driver = plan.model === null ? own : new ClaudeCodeDriver({ provider: bench.provider, models: { ...shipped, [plan.tier]: plan.model } });
  const image = await ensureImage();
  const budget = { maxTokens: 400_000, maxCostUsd: plan.callUsd, maxWallClockMs: 600_000 };
  const result = await modelTier({
    bench,
    corpus,
    driver,
    image,
    limits: DEFAULT_LIMITS,
    capUsd: plan.capUsd,
    repetitions: plan.repetitions,
    alone: { role, tier: plan.tier, tools: ['Read', 'Bash'], budget },
    critic: { tier: plan.tier, tools: ['Read'], budget },
  });
  await writeFile(join(DOCS, plan.resultName(driver.resolveModel(plan.tier).model)), serialize(result.result));
  expect(result.spentUsd).toBeLessThanOrEqual(plan.capUsd);
});
