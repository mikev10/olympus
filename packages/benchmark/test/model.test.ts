/**
 * The model tier held to its rules with no model behind it: every call is a
 * scripted one, so nothing here spends anything. The cap refuses a call whose
 * worst case would pass it, before the call; a verdict nobody can read is
 * counted apart; and a drafted item's critic is admitted against every
 * attempt its station may seat it for.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { StubDriver, type CompiledRole, type RoleId } from '@olympus-ai/core';
import type { AloneCall, AloneOutcome } from '../src/alone.js';
import type { CriticOutcome } from '../src/critic.js';
import { loadCorpus, type Corpus } from '../src/corpus.js';
import type { Bench } from '../src/line.js';
import { DRAFT_ATTEMPTS, modelTier, Spend, type ModelTierOptions } from '../src/model.js';

let base: string;
let corpus: Corpus;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'model-tier-'));
  corpus = await loadCorpus();
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

/** A bench whose repositories are already "installed": the corpus copy itself, uncommitted, so no container is started. */
function bench(): Bench {
  const installed = new Map<string, { dir: string; commit: string }>();
  for (const repo of Object.keys(corpus.repos)) installed.set(repo, { dir: join(corpus.root, 'repos', repo), commit: '0'.repeat(40) });
  return { provider: {} as Bench['provider'], base, user: { uid: 1000, gid: 1000 }, installed };
}

const ROLE: CompiledRole = { role: 'done-checker' as RoleId, instructions: '', sha256: '0'.repeat(64) };
const BUDGET = { maxTokens: 1000, maxCostUsd: 0.1, maxWallClockMs: 1000 };

function options(over: Partial<ModelTierOptions>): ModelTierOptions {
  return {
    bench: bench(),
    corpus,
    driver: new StubDriver(),
    image: 'none',
    limits: { cpus: 1, memoryMb: 1, pids: 1 },
    capUsd: 100,
    repetitions: 1,
    alone: { role: ROLE, tier: 'fast', tools: [], budget: BUDGET },
    critic: { tier: 'fast', tools: [], budget: BUDGET },
    ...over,
  };
}

const critic = (verdict: CriticOutcome['verdict'], costUsd = 0.01) => (): Promise<CriticOutcome> => Promise.resolve({ verdict, causes: verdict === 'caught' ? ['critic:findings'] : [], costUsd });

describe('Spend', () => {
  test('refuses a call whose worst case would pass the cap, and admits one that reaches it exactly', () => {
    const spend = new Spend(1);
    spend.charge(0.75);
    expect(() => { spend.admit(0.3, 'a call'); }).toThrow(/stops rather than report part of the corpus/);
    expect(() => { spend.admit(0.25, 'a call'); }).not.toThrow();
  });

  test('refuses a cap that is not a positive number', () => {
    expect(() => new Spend(0)).toThrow(/positive/);
    expect(() => new Spend(Number.NaN)).toThrow(/positive/);
  });
});

describe('modelTier', () => {
  test('runs every item alone and every drafted item past its critic, and counts what each said', async () => {
    const seen: string[] = [];
    const alone = (call: AloneCall): Promise<AloneOutcome> => {
      seen.push(call.asked);
      return Promise.resolve({ verdict: { kind: 'verdict', done: true, reasons: [] }, costUsd: 0.01 });
    };
    const { result, spentUsd } = await modelTier(options({ repetitions: 2, calls: { alone, critic: critic('caught') } }));
    const drafted = corpus.items.filter((i) => i.tier === 'model');
    expect(seen).toHaveLength(corpus.items.length * 2);
    expect(result.arms.alone?.items).toHaveLength(corpus.items.length);
    expect(result.arms.critic?.items.map((i) => i.id)).toEqual(drafted.map((i) => i.id).sort());
    expect(result.arms.alone?.overall.detection).toMatchObject({ kind: 'rate', count: 0 });
    expect(spentUsd).toBeCloseTo((corpus.items.length + drafted.length) * 2 * 0.01);
    expect(result.run).toMatchObject({ repetitions: 2, capUsd: 100 });
  });

  test('a verdict nobody can read is counted apart from the rate', async () => {
    const alone = (): Promise<AloneOutcome> => Promise.resolve({ verdict: { kind: 'unreadable' }, costUsd: 0 });
    const { result } = await modelTier(options({ calls: { alone, critic: critic('passed') } }));
    const overall = result.arms.alone?.overall;
    if (overall === undefined) throw new Error('the alone arm is missing');
    expect(overall.detection).toEqual({ kind: 'no-sample' });
    expect(overall.unreadable.seeded + overall.unreadable.control).toBe(corpus.items.length);
  });

  test('a drafted run is admitted against every attempt its station may seat the critic for', async () => {
    let critics = 0;
    const counting = (): Promise<CriticOutcome> => {
      critics += 1;
      return Promise.resolve({ verdict: 'passed', causes: [], costUsd: 0 });
    };
    // Room for one attempt's worth and not the station's limit: refused before the first critic runs.
    await expect(modelTier(options({ capUsd: BUDGET.maxCostUsd * (DRAFT_ATTEMPTS - 1), calls: { critic: counting } }))).rejects.toThrow(/drafted run/);
    expect(critics).toBe(0);
  });

  test('the alone arm stops at the cap instead of reporting part of the corpus', async () => {
    let calls = 0;
    const alone = (): Promise<AloneOutcome> => {
      calls += 1;
      return Promise.resolve({ verdict: { kind: 'verdict', done: false, reasons: ['x'] }, costUsd: BUDGET.maxCostUsd });
    };
    const drafted = corpus.items.filter((i) => i.tier === 'model').length;
    const cap = drafted * DRAFT_ATTEMPTS * BUDGET.maxCostUsd + 2.5 * BUDGET.maxCostUsd;
    await expect(modelTier(options({ capUsd: cap, calls: { alone, critic: critic('passed', DRAFT_ATTEMPTS * BUDGET.maxCostUsd) } }))).rejects.toThrow(/cap/);
    expect(calls).toBe(2);
  });
});

describe('the grants', () => {
  test('a tool the driver does not declare is refused before any call is made', async () => {
    let calls = 0;
    const counting = (): Promise<CriticOutcome> => {
      calls += 1;
      return Promise.resolve({ verdict: 'passed', causes: [], costUsd: 0 });
    };
    // The stub declares no tools at all.
    await expect(modelTier(options({ critic: { tier: 'fast', tools: ['Grep'], budget: BUDGET }, calls: { critic: counting } }))).rejects.toThrow(/grants Grep, which the driver does not declare; nothing was run/);
    expect(calls).toBe(0);
  });
});
