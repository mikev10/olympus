/**
 * The composed line, run for real: `composeHost`'s graph — `LocalVault`,
 * `LocalDockerProvider`, `ClaudeCodeDriver` in both seats — carries one L2
 * run over a repository with no test framework from admission to the
 * `integrate` approval.
 *
 * **These assertions call the model, so they cost money, and they need a
 * Docker daemon and `ANTHROPIC_API_KEY`.** They fail without either and are
 * never skipped: a skipped assertion is refused by the registry exactly as a
 * failing one is. CI runs them only under the `run-driver` label, once per
 * tree (D-I1a-07). One build call and one review call, both on the fast tier.
 */
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { invariantTest } from '@olympus-ai/conformance/vitest';
import type { CapabilityScope, ModelTier, RunId, RunState } from '@olympus-ai/core';
import type { UsageRecord } from '@olympus-ai/vault';
import { afterAll, beforeAll, expect } from 'vitest';
import { composeHost, readUsage, runStanding, startRun, UNANALYSED_TESTS, type BuiltGraph, type RunOutcome } from '../../src/index.js';
import { ARTIFACTS, BASE_COMMIT, BUILDER, HELLO, policy, REVIEWER } from '../harness.js';

const runId = 'paid-line' as RunId;
const TIER: ModelTier = 'fast';

/** A role the real driver can serve: the driver's own tool names, the cheapest tier, and room for the CLI's system prompt. */
function paidScope(stations: CapabilityScope['stations'], tools: string[]): CapabilityScope {
  return {
    stations,
    writableGlobs: ['**'],
    tools,
    network: { egress: 'none' },
    tier: TIER,
    autonomyCeiling: 2,
    triggerKinds: ['human'],
    budget: { maxTokens: 400_000, maxCostUsd: 0.5, maxWallClockMs: 300_000 },
  };
}

/** Every exit at L2 `auto`, so the only thing holding the run at `integrate` is what the line found there and the station's own floor. */
const L2_AUTO = Object.fromEntries(
  ['intake', 'spec', 'test-design', 'plan', 'build', 'verify', 'review', 'integrate'].map((station) => [`${station}:2`, 'auto']),
);

let base: string;
let components: BuiltGraph;
let outcome: RunOutcome;
let state: RunState;
let usage: UsageRecord[];

beforeAll(async () => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (key === undefined || key === '') throw new Error('the paid line suite needs ANTHROPIC_API_KEY; it is never skipped');
  base = await mkdtemp(join(tmpdir(), 'paid-line-'));
  const repository = join(base, 'repository');
  // The hello fixture declares no package.json, so neither vitest nor jest: its tests cannot be analysed.
  await cp(HELLO, repository, { recursive: true });
  await mkdir(join(base, 'store'), { recursive: true });
  components = await composeHost({ store: join(base, 'store'), repository, trees: join(base, 'trees'), modelKey: key });
  const request = {
    runId,
    baseCommit: BASE_COMMIT,
    requestedLevel: 2 as const,
    workspace: repository,
    artifacts: ARTIFACTS,
    policy: policy({
      approvals: { ...policy().approvals, ...L2_AUTO },
      roles: { [BUILDER]: paidScope(['build', 'verify'], ['Read', 'Edit', 'Write']), [REVIEWER]: paidScope(['review'], ['Read']) },
    }),
    components,
    approvedCostUsd: null,
  };
  const { worstCaseCost } = await import('../../src/index.js');
  const { readFile } = await import('node:fs/promises');
  const graph = JSON.parse(await readFile(join(repository, ARTIFACTS.taskGraph), 'utf8')) as Parameters<typeof worstCaseCost>[0];
  outcome = await startRun({ ...request, approvedCostUsd: worstCaseCost({ tasks: graph.tasks, edges: [] }, request.policy).usd });
  state = await components.vault.readRunState(runId);
  usage = await readUsage(components.vault, state);
}, 1_200_000);

afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

invariantTest(
  'I5.unanalysed-tests-are-not-reported-clean',
  'an L2 run on the composed host over a repository with no vitest or jest stops at the integrate approval for the unanalysed suite, which escalates an exit that would otherwise advance; paid, one build and one review call',
  async () => {
    expect(outcome).toMatchObject({ ok: false, reason: 'refused', at: 'integrate', transition: { reason: 'approval-required', key: 'integrate:2' } });
    if (outcome.ok || outcome.reason !== 'refused' || outcome.transition.reason !== 'approval-required') return;
    expect(outcome.transition.escalations).toContain(UNANALYSED_TESTS);
    expect((await runStanding(components.vault, runId)).standing).toMatchObject({ standing: 'awaiting-approval', escalations: expect.arrayContaining([UNANALYSED_TESTS]) as unknown });
  },
);

invariantTest(
  'I2.line-usage-is-metered-and-names-its-model',
  "every usage record of a real driver call on the composed host is metered by the relay the line provisioned, and names the model the runtime resolved the scope's tier to, never the driver's own account",
  () => {
    const stations = usage.map((r) => r.station);
    expect(stations).toContain('build');
    expect(stations).toContain('review');
    const expected = components.driver.resolveModel(TIER);
    for (const record of usage) {
      expect(record.collectedBy).toBe('runtime');
      expect(record.reading).toMatchObject({ kind: 'metered', exhausted: 'none' });
      if (record.reading.kind === 'metered') {
        expect(record.reading.calls).toBeGreaterThan(0);
        expect(record.reading.costUsd).toBeGreaterThan(0);
      }
      expect(record.model).toStrictEqual(expected);
    }
  },
);
