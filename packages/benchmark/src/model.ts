/**
 * The model tier: the arms that need a real model (D-R7-02). The
 * driver-alone arm runs every item of the corpus: the same real driver, in
 * one seat, handed the item's work and what was asked. The critic arm runs
 * the drafted items through R19's critic seat behind a scripted drafter.
 *
 * Every call is charged against a cap the operator passes. An item whose
 * worst case would take the spend past the cap is refused before it starts,
 * and the run stops there: a result over part of a corpus is not a result
 * (I5).
 */
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { STATION_CONTRACTS, type CompiledRole, type Driver, type ModelTier, type TaskRequest } from '@olympus-ai/core';
import type { SandboxSpec } from '@olympus-ai/sandbox';
import { aloneCall, type AloneOutcome } from './alone.js';
import { render, type Corpus, type Item } from './corpus.js';
import { installed, type Bench } from './line.js';
import { throughTheCritic } from './critic.js';
import { benchmarkResult, detectorFired, type BenchmarkResult, type ItemOutcome, type Verdict } from './result.js';

/** The spend so far against the cap, shared by every arm of one run. */
export class Spend {
  private spent = 0;

  constructor(readonly capUsd: number) {
    if (!Number.isFinite(capUsd) || capUsd <= 0) throw new Error(`benchmark: the cap must be a positive number of US dollars, not ${String(capUsd)}`);
  }

  get usd(): number {
    return this.spent;
  }

  /** Refuses a call whose worst case would take the spend past the cap. */
  admit(worstCaseUsd: number, what: string): void {
    if (this.spent + worstCaseUsd > this.capUsd) {
      throw new Error(`benchmark: ${what} could cost up to $${worstCaseUsd.toFixed(4)}, and $${this.spent.toFixed(4)} of the $${this.capUsd.toFixed(2)} cap is spent; the run stops rather than report part of the corpus`);
    }
  }

  charge(usd: number): void {
    this.spent += usd;
  }
}

export interface AloneArm {
  readonly bench: Bench;
  readonly corpus: Corpus;
  readonly driver: Driver;
  readonly role: CompiledRole;
  readonly image: string;
  readonly limits: Omit<SandboxSpec['limits'], 'wallClockMs'>;
  readonly tier: ModelTier;
  readonly tools: readonly string[];
  readonly budget: TaskRequest['budget'];
  readonly repetitions: number;
  readonly spend: Spend;
  /** One call, replaceable so the arm can be held to its rules with no model behind it. */
  readonly call?: typeof aloneCall;
}

/** What was asked of an item's work, as the driver alone is told it: the repository's spec, or a drafted item's request. */
export async function askedOf(item: Item, tree: string): Promise<string> {
  if (item.seat === 'build') return `What was asked:\n\n${await readFile(join(tree, 'spec.md'), 'utf8')}\nThe work is the repository in your working directory.`;
  if (item.asked === null) throw new Error(`benchmark: drafted item '${item.id}' carries no request to judge its draft against`);
  const what = item.seat === 'spec-drafter' ? 'a spec drafted from it' : 'acceptance tests drafted from the spec in spec.md';
  return `What was asked:\n\n${item.asked}\n\nThe work is ${what}, in your working directory at ${Object.keys(item.change.write).sort().join(', ')}.`;
}

/** The driver-alone arm over every item, `repetitions` times each. */
export async function aloneArm(arm: AloneArm): Promise<Map<string, Verdict[]>> {
  if (!Number.isSafeInteger(arm.repetitions) || arm.repetitions < 1) throw new Error('benchmark: repetitions must be a positive integer');
  const call = arm.call ?? aloneCall;
  const verdicts = new Map<string, Verdict[]>();
  for (const item of arm.corpus.items) {
    const seen: Verdict[] = [];
    for (let r = 0; r < arm.repetitions; r += 1) {
      arm.spend.admit(arm.budget.maxCostUsd, `the driver-alone call for an item`);
      const tree = await workTree(arm.bench, arm.corpus, item);
      const outcome: AloneOutcome = await call({
        provider: arm.bench.provider,
        driver: arm.driver,
        role: arm.role,
        image: arm.image,
        user: arm.bench.user,
        limits: arm.limits,
        tree,
        asked: await askedOf(item, tree),
        tier: arm.tier,
        tools: arm.tools,
        budget: arm.budget,
      });
      arm.spend.charge(outcome.costUsd);
      // A driver that says not done has caught the item; one that says done has passed it (D-R7-05's verdicts, from a model's claim).
      seen.push(outcome.verdict.kind === 'unreadable' ? 'unreadable' : outcome.verdict.done ? 'passed' : 'caught');
    }
    verdicts.set(item.id, seen);
  }
  return verdicts;
}

/** A fresh copy of the item's installed repository with its change applied, under a name that says nothing about the item (I3). */
async function workTree(bench: Bench, corpus: Corpus, item: Item): Promise<string> {
  const source = await installed(bench, corpus, item.repo);
  const tree = join(bench.base, 'alone', randomUUID());
  await mkdir(dirname(tree), { recursive: true });
  // With its history, so the driver can see the change as a diff against the base, as an agent checking its own work would.
  await cp(source.dir, tree, { recursive: true });
  for (const [file, content] of Object.entries(item.change.write)) {
    await mkdir(dirname(join(tree, file)), { recursive: true });
    await writeFile(join(tree, file), render(content));
  }
  for (const file of item.change.remove) await rm(join(tree, file), { force: true });
  return tree;
}

export interface ModelTierOptions {
  readonly bench: Bench;
  readonly corpus: Corpus;
  /** The real driver, in the driver-alone seat and the critic seat both. */
  readonly driver: Driver;
  readonly image: string;
  readonly limits: Omit<SandboxSpec['limits'], 'wallClockMs'>;
  readonly capUsd: number;
  readonly repetitions: number;
  readonly alone: { readonly role: CompiledRole; readonly tier: ModelTier; readonly tools: readonly string[]; readonly budget: TaskRequest['budget'] };
  readonly critic: { readonly tier: ModelTier; readonly tools: readonly string[]; readonly budget: TaskRequest['budget'] };
  /** Replaceable, so the tier can be held to its rules with no model behind it. */
  readonly calls?: { readonly alone?: typeof aloneCall; readonly critic?: typeof throughTheCritic };
}

/**
 * Both arms of the model tier under one cap. The critic arm runs first: a
 * drafted station may seat its critic once per attempt, so its worst case is
 * the station's attempt limit times the critic's budget, and it is admitted
 * against the cap on that.
 */
export async function modelTier(options: ModelTierOptions): Promise<{ result: BenchmarkResult; spentUsd: number }> {
  const spend = new Spend(options.capUsd);
  const { corpus } = options;
  const criticCall = options.calls?.critic ?? throughTheCritic;
  const criticOutcomes: ItemOutcome[] = [];
  for (const item of corpus.items.filter((i) => i.tier === 'model')) {
    const prefixes = corpus.groups[item.group] ?? [];
    const verdicts: Verdict[] = [];
    const fired: boolean[] = [];
    const causes = new Set<string>();
    for (let r = 0; r < options.repetitions; r += 1) {
      spend.admit(DRAFT_ATTEMPTS * options.critic.budget.maxCostUsd, 'a drafted run with its critic seated');
      const outcome = await criticCall(options.bench, corpus, item, { driver: options.driver, image: options.image, ...options.critic });
      spend.charge(outcome.costUsd);
      verdicts.push(outcome.verdict);
      fired.push(detectorFired(prefixes, outcome.causes));
      for (const c of outcome.causes) causes.add(c);
    }
    criticOutcomes.push({ id: item.id, kind: item.kind, group: item.group, verdicts, detectorFired: fired, causes: [...causes].sort() });
  }
  const alone = await aloneArm({
    bench: options.bench,
    corpus,
    driver: options.driver,
    image: options.image,
    limits: options.limits,
    repetitions: options.repetitions,
    spend,
    ...options.alone,
    ...(options.calls?.alone === undefined ? {} : { call: options.calls.alone }),
  });
  const aloneOutcomes: ItemOutcome[] = corpus.items.map((item) => {
    const verdicts = alone.get(item.id) ?? [];
    return { id: item.id, kind: item.kind, group: item.group, verdicts, detectorFired: verdicts.map(() => null), causes: [] };
  });
  const model = options.driver.resolveModel(options.alone.tier);
  const result = benchmarkResult(corpus, 'model', { alone: aloneOutcomes, critic: criticOutcomes }, {
    model: { provider: model.provider, family: model.family, model: model.model },
    repetitions: options.repetitions,
    capUsd: options.capUsd,
    spentUsd: spend.usd,
  });
  return { result, spentUsd: spend.usd };
}

/** The most attempts a drafting station allows, so the most times it may seat its critic. */
export const DRAFT_ATTEMPTS = Math.max(STATION_CONTRACTS.spec.maxIterations, STATION_CONTRACTS['test-design'].maxIterations);
