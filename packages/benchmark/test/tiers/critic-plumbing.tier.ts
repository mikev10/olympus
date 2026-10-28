/**
 * The critic arm's composition on the real line, with no model: a scripted
 * critic of another family than the scripted drafter's, so it is seated and
 * binding, answering a fixed result. It shows each drafted item is admitted,
 * drafted, and read back, before a paid run relies on the same path.
 *
 * Needs a Docker daemon and the registry, as the deterministic tier does.
 * Run with `TIER=critic-plumbing pnpm run deterministic`.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { BASE_IMAGE } from '@olympus-ai/driver-claude-code';
import { StubDriver, type ModelFamily, type ModelIdentity, type ModelTier, type TaskRequest, type TaskResult } from '@olympus-ai/core';
import { throughTheCritic } from '../../src/critic.js';
import { loadCorpus, type Corpus } from '../../src/corpus.js';
import { openBench, type Bench } from '../../src/line.js';

/** A critic that answers `findings`, under a family no drafter has. */
class FixedCritic extends StubDriver {
  constructor(private readonly findings: readonly string[]) {
    super();
  }

  override resolveModel(tier: ModelTier): ModelIdentity {
    return { ...super.resolveModel(tier), family: 'fixed-critic' as ModelFamily };
  }

  override async runTask(req: TaskRequest): Promise<TaskResult> {
    const result = await super.runTask(req);
    return { ...result, claim: { narrative: JSON.stringify({ findings: this.findings }), filesChanged: [] }, model: this.resolveModel(req.tier) };
  }
}

let base: string;
let bench: Bench;
let corpus: Corpus;

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'benchmark-critic-'));
  bench = await openBench(base);
  corpus = await loadCorpus('v1');
});

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

const seat = (findings: readonly string[]) => ({
  driver: new FixedCritic(findings),
  image: BASE_IMAGE,
  tier: 'fast' as const,
  tools: ['read'],
  budget: { maxTokens: 1000, maxCostUsd: 1, maxWallClockMs: 600_000 },
});

test('every drafted item reaches its critic, and the arm reads its findings, or their absence, from the record', async () => {
  for (const item of corpus.items.filter((i) => i.tier === 'model')) {
    const clean = await throughTheCritic(bench, corpus, item, seat([]));
    expect(clean, item.id).toEqual({ verdict: 'passed', causes: [], costUsd: 0 });
    const found = await throughTheCritic(bench, corpus, item, seat(['a fixed finding']));
    expect(found.verdict, item.id).toBe('caught');
    expect(found.causes, item.id).toEqual(['critic:findings', 'sent-back:critic']);
  }
});
