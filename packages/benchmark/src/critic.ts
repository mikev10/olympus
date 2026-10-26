/**
 * The critic arm of the model tier: a drafted item through the line's
 * drafting station, behind a scripted drafter, with a real critic seated
 * (R19). The draft is the item's change; what judges it is the runtime's own
 * reading of the draft and the critic's findings, recorded in the Vault.
 *
 * A seeded draft the critic finds fault with goes back, and the scripted
 * drafter writes the same draft again, so a station may seat its critic up
 * to its attempt limit. The verdict is read from the first attempt alone;
 * the later ones cost money and change nothing a reader is told (D-R7-08).
 */
import { cp, mkdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { buildGraph, DEFAULT_LIMITS, DEFAULT_RUBRICS_DIRECTORY, costTotals, localWorkspaceStore, readUsage, startRun, unsettledCalls, worstCaseCost, type RunRequest } from '@olympus-ai/api';
import { DEFAULT_ROLES_DIRECTORY } from '@olympus-ai/compiler';
import {
  StrictPolicyEngine,
  StubDriver,
  type CapabilityScope,
  type Driver,
  type Policy,
  type PolicyDocument,
  type RoleId,
  type RunId,
  type TaskGraph,
} from '@olympus-ai/core';
import { BASE_IMAGE } from '@olympus-ai/driver-claude-code';
import { LocalVault, type CriticRecord, type DraftRecord } from '@olympus-ai/vault';
import type { Corpus, Item } from './corpus.js';
import { benchPolicyDocument, installed, type Bench } from './line.js';
import { ScriptedSeat } from './seats.js';

export interface CriticOutcome {
  readonly verdict: 'caught' | 'passed';
  readonly causes: readonly string[];
  readonly costUsd: number;
}

export interface CriticSeat {
  readonly driver: Driver;
  /** The image the critic's tasks run in. */
  readonly image: string;
  readonly tier: CapabilityScope['tier'];
  readonly tools: readonly string[];
  readonly budget: CapabilityScope['budget'];
}

/** The drafting station a drafted item's seat works at. */
function stationOf(item: Item): 'spec' | 'test-design' {
  if (item.seat === 'spec-drafter') return 'spec';
  if (item.seat === 'test-drafter') return 'test-design';
  throw new Error(`benchmark: item '${item.id}' is a build item, which the critic arm does not run`);
}

/** The artifacts a drafted run of a corpus repository is admitted with: the drafted station's artifact as `'draft'`, every other supplied. */
export function draftedArtifacts(station: 'spec' | 'test-design'): RunRequest['artifacts'] {
  return station === 'spec'
    ? { spec: 'draft', acceptanceTests: ['test/acceptance/multiply.test.ts'], verificationManifest: 'verify.json', taskGraph: 'graph.json' }
    : {
        spec: ['spec.md'],
        acceptanceTests: 'draft',
        verificationManifest: 'verify-drafted.json',
        taskGraph: 'graph.json',
        specParts: { security: 'security.json', runRequirements: 'run-requirements.json' },
      };
}

/** The bench policy with the drafting seats granted: the drafter writes, the critic is the real driver's scope. */
export function draftingPolicy(corpus: Corpus, item: Item, critic: CriticSeat): Policy {
  const repo = corpus.repos[item.repo];
  if (repo === undefined) throw new Error(`benchmark: item '${item.id}' names repository '${item.repo}', which the corpus does not hold`);
  const station = stationOf(item);
  const base: PolicyDocument = benchPolicyDocument(repo);
  const builder = base.roles['builder' as RoleId];
  if (builder === undefined) throw new Error('benchmark: the bench policy grants no builder to model a drafter on');
  const drafter: CapabilityScope = { ...builder, stations: [station], writableGlobs: ['**'] };
  const seat: CapabilityScope = {
    ...drafter,
    tools: [...critic.tools],
    tier: critic.tier,
    budget: { ...critic.budget },
  };
  const prefix = station === 'spec' ? 'spec' : 'test';
  return new StrictPolicyEngine().resolvePolicy({
    ...base,
    roles: { ...base.roles, [`${prefix}-drafter`]: drafter, [`${prefix}-critic`]: seat },
  });
}

/** One drafted item through the drafting station, with `critic` seated. */
export async function throughTheCritic(bench: Bench, corpus: Corpus, item: Item, critic: CriticSeat): Promise<CriticOutcome> {
  const station = stationOf(item);
  const source = await installed(bench, corpus, item.repo);
  const name = randomUUID();
  const root = join(bench.base, 'runs', name);
  const repository = join(root, 'repository');
  await cp(source.dir, repository, { recursive: true });
  await mkdir(join(root, 'store'), { recursive: true });
  await mkdir(join(root, 'trees'), { recursive: true });
  const vault = new LocalVault({ store: join(root, 'store'), artifacts: repository });
  const runId = name as RunId;
  const drafter = new ScriptedSeat(bench.provider, (station === 'spec' ? 'spec-drafter' : 'test-drafter') as RoleId, item.change, item.claim, name);
  const idle = new StubDriver();
  const components = buildGraph({
    vault,
    sandbox: bench.provider,
    driver: idle,
    reviewer: idle,
    drafting: station === 'spec'
      ? { specDrafter: drafter, specCritic: critic.driver, testDrafter: idle, testCritic: idle }
      : { specDrafter: idle, specCritic: idle, testDrafter: drafter, testCritic: critic.driver },
    workspaces: localWorkspaceStore({ root: join(root, 'trees'), user: bench.user }),
    integrator: null,
    profile: { buildImage: critic.image, checkImage: BASE_IMAGE, limits: DEFAULT_LIMITS },
  });
  const policy = draftingPolicy(corpus, item, critic);
  const artifacts = draftedArtifacts(station);
  const graph = JSON.parse(await readFile(join(repository, artifacts.taskGraph), 'utf8')) as { tasks: TaskGraph['tasks'] };
  if (item.asked === null) throw new Error(`benchmark: drafted item '${item.id}' carries no request`);
  const outcome = await startRun({
    runId,
    baseCommit: source.commit,
    requestedLevel: 1,
    workspace: repository,
    artifacts,
    policy,
    roles: DEFAULT_ROLES_DIRECTORY,
    components,
    intent: station === 'spec' ? { text: item.asked, from: 'principal' } : null,
    rubrics: DEFAULT_RUBRICS_DIRECTORY,
    approvedCostUsd: worstCaseCost({ tasks: graph.tasks, edges: [] }, policy, [station]).usd,
  });
  if (!outcome.ok && outcome.reason !== 'refused') {
    throw new Error(`benchmark: the drafted run was refused before the line started (${outcome.reason}); the corpus or the bench is broken: ${JSON.stringify(outcome)}`);
  }
  const state = await vault.readRunState(runId);
  const usage = await readUsage(vault, state);
  // A call whose cost was lost or never read cannot be charged against the cap, so the run stops (I5); an unmetered one is the scripted seat's and cost nothing.
  const totals = costTotals(usage).run;
  const unsettled = unsettledCalls(usage).length;
  if (unsettled > 0 || totals.lost > 0) throw new Error(`benchmark: ${String(unsettled + totals.lost)} call(s) of the drafted run have no known cost, so the spend cannot be held to the cap`);
  const costUsd = totals.metered.costUsd;
  const first = state.drafts[station]?.attempts[0];
  if (first?.draft === null || first === undefined) throw new Error(`benchmark: the drafted run for an item recorded no first draft at ${station}`);
  const causes: string[] = [];
  const record = JSON.parse(new TextDecoder().decode(await vault.read(first.draft))) as DraftRecord;
  for (const p of record.problems) causes.push(`runtime:${p.code}`);
  if (first.critic === null || first.critic === 'not-seated') {
    // The runtime sent the draft back before a critic read it; the catch is the runtime's.
    if (causes.length === 0) throw new Error(`benchmark: the critic was ${String(first.critic)} on a draft the runtime did not send back; the arm measured nothing. The run stopped with: ${outcome.ok ? 'no refusal' : JSON.stringify({ at: outcome.at, transition: outcome.transition })}`);
  } else {
    const verdict = JSON.parse(new TextDecoder().decode(await vault.read(first.critic))) as CriticRecord;
    if (!verdict.binding) throw new Error('benchmark: the critic seated was not binding: its family is the drafter\'s, so its findings send nothing back');
    if (verdict.findings.length > 0) causes.push(verdict.readable ? 'critic:findings' : 'critic:unreadable');
  }
  if (first.sentBack !== null) causes.push(`sent-back:${first.sentBack.by}`);
  return { verdict: causes.length > 0 ? 'caught' : 'passed', causes: [...new Set(causes)].sort(), costUsd };
}
