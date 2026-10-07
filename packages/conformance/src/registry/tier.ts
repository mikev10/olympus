/**
 * R14: the tier a call runs at follows policy per station, rises only under a
 * granted escalation and only from the failed gates run state counts, binds
 * the relay to the model it resolved, and counts every model that built a
 * task as its author (A-R14-01, A-R14-02, D-A-BR-01).
 *
 * The drivers here resolve each tier to its own model, `stub-<tier>`, so the
 * tier a call ran at can be read from the model the runtime recorded for it.
 */
import type { CapabilityScope, ModelFamily, ModelIdentity, ModelTier, RoleId, TaskRequest, TaskResult } from '@olympus-ai/core';
import type { RelaySpec, SandboxProvider, SandboxSpec } from '@olympus-ai/sandbox';
import type { EnforcementDecision, UsageRecord, Vault } from '@olympus-ai/vault';
import { runtime } from '../kit/assert.js';
import type { LocalAssertion } from '../kit/types.js';
import { HELLO_TASK, lineScope, linePolicy, readRecord, refusalOf, stubDriver, withLine, writeManifest, type DriverOptions, type LineRig, type ObservedDriver } from './line.js';
import { inTask, writes } from './verification.js';

const api = async () => import('@olympus-ai/api');

const BUILDER = 'builder' as RoleId;
const REVIEWER = 'reviewer' as RoleId;

const ALWAYS_FAILS = [{ id: 'always-fails', kind: 'unit', command: ['node', '-e', 'process.exit(1)'], required: true, timeoutMs: 10_000 }];
/** Passes once the task has written `pass.txt`, which the drivers below do on their second build. */
const PASSES_ONCE_WRITTEN = [
  { id: 'passes-once-written', kind: 'compile', command: ['node', '-e', "process.exit(require('node:fs').existsSync('pass.txt') ? 0 : 1)"], required: true, timeoutMs: 10_000 },
];

const PRICE = { inputPerMTok: 1, outputPerMTok: 5, cacheReadPerMTok: 0.1, cacheWritePerMTok: 1.25, cacheWrite1hPerMTok: 2 };

/** A relay pricing every tier's model, as a driver whose CLI could call any of them would ask for. */
const RELAY: Omit<RelaySpec, 'budget'> = {
  upstream: 'https://models.example',
  paths: ['/v1/messages'],
  header: 'x-api-key',
  credential: 'model',
  urlVariable: 'MODEL_URL',
  meter: { dialect: 'anthropic-messages', prices: { 'stub-fast': PRICE, 'stub-standard': PRICE, 'stub-deep': PRICE } },
};

interface TierOptions extends DriverOptions {
  /** The family each tier's model belongs to. A tier not named is `stub`. */
  readonly families?: Partial<Record<ModelTier, string>>;
  /** The model every result claims to have run on, whatever the request's tier: what a model says is never an input. */
  readonly claims?: ModelIdentity;
  readonly relay?: boolean;
}

/** A stub driver whose tiers resolve to distinct models, so the runtime's record names the tier each call ran at. */
async function tieredDriver(options: TierOptions = {}): Promise<ObservedDriver> {
  const inner = await stubDriver(options);
  const resolveModel = (tier: ModelTier): ModelIdentity => ({
    provider: 'stub',
    family: (options.families?.[tier] ?? 'stub') as ModelFamily,
    model: `stub-${tier}`,
    version: '0',
  });
  return {
    ...inner,
    resolveModel,
    relayRequest: () => (options.relay === true ? { ...RELAY, paths: [...RELAY.paths] } : null),
    runTask: async (req: TaskRequest): Promise<TaskResult> => ({ ...(await inner.runTask(req)), model: options.claims ?? resolveModel(req.tier) }),
  };
}

function builderScope(overrides: Partial<CapabilityScope>): CapabilityScope {
  return { ...lineScope(['build', 'verify'], 'standard'), ...overrides };
}

async function policyWith(builder: Partial<CapabilityScope>, reviewer: Partial<CapabilityScope> = {}) {
  return linePolicy({}, { roles: { [BUILDER]: builderScope(builder), [REVIEWER]: { ...lineScope(['review'], 'deep'), ...reviewer } } });
}

async function usageOf(rig: LineRig, vault: Vault): Promise<UsageRecord[]> {
  const { readUsage } = await api();
  return (await readUsage(vault, await rig.state())).filter((r) => r.reading.kind !== 'pending');
}

export async function escalations(rig: LineRig, vault: Vault): Promise<EnforcementDecision[]> {
  const decisions: EnforcementDecision[] = [];
  for (const ref of await vault.readDecisions(rig.runId)) decisions.push(await readRecord<EnforcementDecision>(vault, ref));
  return decisions.filter((d) => d.decision.cause === 'tier-escalated');
}

/** The tier of each build call, read from the model the runtime recorded for it. */
function buildTiers(records: readonly UsageRecord[]): string[] {
  return records.filter((r) => r.station === 'build').map((r) => r.model.model.replace(/^stub-/, ''));
}

/**
 * A run whose gate always fails, under the given builder scope, to the park.
 * Returns the tiers the builds ran at and the escalations recorded.
 */
export async function failingRun(
  rig: LineRig, builder: Partial<CapabilityScope>, options: TierOptions = {}, sandbox?: SandboxProvider,
): Promise<{ requested: ModelTier[]; recorded: string[]; decisions: EnforcementDecision[] }> {
  const { startRun } = await api();
  await writeManifest(rig.dirs, ALWAYS_FAILS);
  const driver = await tieredDriver(options);
  const components = await rig.components({ driver, reviewer: driver, ...(sandbox === undefined ? {} : { sandbox }) });
  refusalOf(await startRun(await rig.request(components, { policy: await policyWith(builder) })), 'R14 failing run');
  return {
    requested: driver.requests.map((r) => r.tier),
    recorded: buildTiers(await usageOf(rig, components.vault)),
    decisions: await escalations(rig, components.vault),
  };
}

export const TIER_PER_STATION_FOLLOWS_POLICY: LocalAssertion = runtime({
  id: 'I4.tier-per-station-follows-policy',
  title:
    "a call runs at the tier its role's scope names for the station, where the scope names one, and at the role's tier where it does not: a builder at fast with build at deep builds at deep, and a reviewer at deep with review at standard reviews at standard, each recorded on its usage record as the model the runtime resolved",
  run: async () => {
    await withLine('r14-i4-station-', async (rig) => {
      const { startRun } = await api();
      const driver = await tieredDriver({ families: { deep: 'builder-family' } });
      const reviewer = await tieredDriver({ families: { standard: 'reviewer-family' } });
      const components = await rig.components({ driver, reviewer });
      const policy = await policyWith({ tier: 'fast', tierByStation: { build: 'deep' } }, { tierByStation: { review: 'standard' } });
      await startRun(await rig.request(components, { policy }));
      const built = driver.requests.map((r) => r.tier);
      const reviewed = reviewer.requests.map((r) => r.tier);
      if (JSON.stringify(built) !== '["deep"]' || JSON.stringify(reviewed) !== '["standard"]') {
        throw new Error(`I4: the builder ran at ${JSON.stringify(built)} and the reviewer at ${JSON.stringify(reviewed)}; policy names deep and standard for those stations`);
      }
      const models = (await usageOf(rig, components.vault)).map((r) => `${r.station}:${r.model.model}`);
      if (JSON.stringify(models) !== '["build:stub-deep","review:stub-standard"]') {
        throw new Error(`I4: the usage records name ${JSON.stringify(models)}, not the models the station tiers resolve to`);
      }
    });
  },
});

export const ESCALATION_ONLY_UNDER_A_GRANT: LocalAssertion = runtime({
  id: 'I4.escalation-only-under-a-grant',
  title:
    "a task whose gate fails on every iteration, under a scope whose escalation is 'none', runs every iteration at the tier it started on and leaves no tier-escalated decision: a stronger model is a grant, absent unless policy gives it",
  run: async () => {
    await withLine('r14-i4-grant-', async (rig) => {
      const { STATION_CONTRACTS } = await import('@olympus-ai/core');
      const run = await failingRun(rig, { tier: 'standard', escalation: 'none' });
      const expected = Array.from({ length: STATION_CONTRACTS.build.maxIterations }, () => 'standard');
      if (JSON.stringify(run.requested) !== JSON.stringify(expected) || JSON.stringify(run.recorded) !== JSON.stringify(expected)) {
        throw new Error(`I4: with no grant the builds ran at ${JSON.stringify(run.requested)} and were recorded at ${JSON.stringify(run.recorded)}`);
      }
      if (run.decisions.length !== 0) throw new Error(`I4: with no grant ${String(run.decisions.length)} escalations were recorded`);
    });
  },
});

export const ESCALATION_DECIDED_FROM_FAILED_GATES: LocalAssertion = runtime({
  id: 'I2.escalation-decided-from-failed-gates',
  title:
    "under a granted escalation the line raises a task's tier one step for every afterFailedGates failed gates and never past the ceiling, decided from the iterations run state counts while every result claims the deepest model; each step is one tier-escalated decision by the line, naming the task, the station, both tiers, and the failures it was decided on",
  run: async () => {
    const deepest: ModelIdentity = { provider: 'stub', family: 'stub' as ModelFamily, model: 'stub-deep', version: '0' };
    const cases: ReadonlyArray<{ grant: CapabilityScope['escalation']; tiers: string[]; steps: Array<[ModelTier, ModelTier, number]> }> = [
      { grant: { afterFailedGates: 1, ceiling: 'deep' }, tiers: ['fast', 'standard', 'deep'], steps: [['fast', 'standard', 1], ['standard', 'deep', 2]] },
      { grant: { afterFailedGates: 1, ceiling: 'standard' }, tiers: ['fast', 'standard', 'standard'], steps: [['fast', 'standard', 1]] },
      { grant: { afterFailedGates: 2, ceiling: 'deep' }, tiers: ['fast', 'fast', 'standard'], steps: [['fast', 'standard', 2]] },
    ];
    for (const [i, c] of cases.entries()) {
      await withLine(`r14-i2-escalate-${String(i)}-`, async (rig) => {
        const run = await failingRun(rig, { tier: 'fast', escalation: c.grant }, { claims: deepest });
        if (JSON.stringify(run.requested) !== JSON.stringify(c.tiers) || JSON.stringify(run.recorded) !== JSON.stringify(c.tiers)) {
          throw new Error(`I2: under ${JSON.stringify(c.grant)} the builds ran at ${JSON.stringify(run.requested)}, recorded at ${JSON.stringify(run.recorded)}; expected ${JSON.stringify(c.tiers)}`);
        }
        const steps = run.decisions.map((d) => {
          if (d.decision.cause !== 'tier-escalated' || d.taskId !== HELLO_TASK || d.station !== 'build') {
            throw new Error(`I2: an escalation was recorded as ${JSON.stringify(d)}`);
          }
          return [d.decision.from, d.decision.to, d.decision.failedGates];
        });
        const sorted = (xs: readonly unknown[]): string => JSON.stringify(xs.map((x) => JSON.stringify(x)).sort());
        if (sorted(steps) !== sorted(c.steps)) {
          throw new Error(`I2: under ${JSON.stringify(c.grant)} the escalations recorded were ${JSON.stringify(steps)}; expected ${JSON.stringify(c.steps)}`);
        }
      });
    }
  },
});

export const EVERY_MODEL_THAT_BUILT_IS_AN_AUTHOR: LocalAssertion = runtime({
  id: 'I6.every-model-that-built-is-an-author',
  title:
    "a task built at fast, failed, and escalated to standard, where the two tiers' models are of different families, is reviewed against both: the seat lists every model that built the task and records reduced independence for a reviewer of the first family, which the last result alone would call independent",
  run: async () => {
    await withLine('r14-i6-authors-', async (rig) => {
      const { startRun } = await api();
      const { StubSandboxProvider } = await import('@olympus-ai/sandbox');
      const sandbox = new StubSandboxProvider();
      await writeManifest(rig.dirs, PASSES_ONCE_WRITTEN);
      let builds = 0;
      const driver = await tieredDriver({
        families: { fast: 'first-family', standard: 'second-family' },
        during: async (req) => {
          if (req.taskId !== HELLO_TASK) return;
          builds += 1;
          if (builds === 2) await inTask(sandbox, req, writes({ 'pass.txt': 'passed' }));
        },
      });
      const reviewer = await tieredDriver({ families: { deep: 'first-family' } });
      const components = await rig.components({ sandbox, driver, reviewer });
      await startRun(await rig.request(components, { policy: await policyWith({ tier: 'fast', escalation: { afterFailedGates: 1, ceiling: 'standard' } }) }));
      const [seat] = (await rig.state()).reviews;
      if (seat === undefined) throw new Error(`I6: no review seat was recorded after ${String(builds)} builds`);
      const families = [...new Set(seat.authors.map((a) => a.family))].sort();
      if (JSON.stringify(families) !== '["first-family","second-family"]') {
        throw new Error(`I6: the seat's authors are of ${JSON.stringify(families)}; both models that built the task are authors`);
      }
      if (seat.independence !== 'reduced') throw new Error(`I6: a reviewer sharing the first builder's family was seated as ${seat.independence}`);
    });
    // The reviewer resolves to an author's family and reports a third: what it reports never widens the seat (codex-1, gemini-1).
    await withLine('r14-i6-claims-', async (rig) => {
      const { startRun } = await api();
      const { StubSandboxProvider } = await import('@olympus-ai/sandbox');
      const sandbox = new StubSandboxProvider();
      await writeManifest(rig.dirs, PASSES_ONCE_WRITTEN);
      const driver = await tieredDriver({
        families: { fast: 'first-family' },
        during: async (req) => {
          if (req.taskId === HELLO_TASK) await inTask(sandbox, req, writes({ 'pass.txt': 'passed' }));
        },
      });
      const claims: ModelIdentity = { provider: 'stub', family: 'third-family' as ModelFamily, model: 'stub-claimed', version: '0' };
      const reviewer = await tieredDriver({ families: { deep: 'first-family' }, claims });
      const components = await rig.components({ sandbox, driver, reviewer });
      await startRun(await rig.request(components, { policy: await policyWith({ tier: 'fast', escalation: 'none' }) }));
      const [seat] = (await rig.state()).reviews;
      if (seat === undefined) throw new Error('I6: no review seat was recorded');
      if (seat.independence !== 'reduced') {
        throw new Error(`I6: a reviewer resolved to an author's family that reported '${seat.reviewer.family}' was seated as ${seat.independence}`);
      }
    });
  },
});

export const RELAY_BOUND_TO_TIER_MODEL: LocalAssertion = runtime({
  id: 'I2.relay-bound-to-tier-model',
  title:
    "every call's relay is priced for the model the runtime resolved for that call and no other, through an escalation from fast to deep, so the relay — which refuses a model it has no price for before the upstream sees it (I5.model-relay-fails-closed-on-unmetered-usage) — refuses a request naming any model outside the call's tier; which model served a call is the runtime's, not the request's",
  run: async () => {
    await withLine('r14-i2-relay-', async (rig) => {
      const { StubSandboxProvider } = await import('@olympus-ai/sandbox');
      const inner = new StubSandboxProvider();
      const specs: SandboxSpec[] = [];
      const sandbox: SandboxProvider = {
        id: inner.id,
        capabilities: () => inner.capabilities(),
        // Recorded as the line asked for it, then provisioned without the relay, which the stub refuses to run.
        provision: (spec) => {
          specs.push(spec);
          const { relay: _relay, ...unrelayed } = spec;
          return inner.provision(unrelayed);
        },
        exec: (handle, cmd, options) => inner.exec(handle, cmd, options),
        destroy: (handle) => inner.destroy(handle),
      };
      const run = await failingRun(rig, { tier: 'fast', escalation: { afterFailedGates: 1, ceiling: 'deep' } }, { relay: true }, sandbox);
      const priced = specs.filter((s) => s.relay !== undefined).map((s) => Object.keys(s.relay?.meter.prices ?? {}));
      const expected = run.recorded.map((tier) => [`stub-${tier}`]);
      if (run.recorded.length !== 3 || JSON.stringify(priced) !== JSON.stringify(expected)) {
        throw new Error(`I2: the builds' relays priced ${JSON.stringify(priced)}; each should price only its own call's model, ${JSON.stringify(expected)}`);
      }
    });
  },
});
