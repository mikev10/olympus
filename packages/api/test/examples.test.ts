/**
 * The shipped examples admit a run (R35, #124, #126), so they cannot rot: the
 * policy, roles, and rubrics under `examples/`, and the run files a user
 * copies into their repository, exactly as shipped. Two runs, the two the
 * README's "First run" names: one with every file supplied, and the smallest,
 * which drafts its spec from an intent. Both at L1, each approving the
 * worst-case cost the first create was refused with.
 */
import { cp, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createApiServer, SCANNERS, type ApiServer } from '../src/index.js';
import { StrictPolicyEngine, StubDriver, type RoleId } from '@olympus-ai/core';
import { loadPolicyFile } from '../src/policy-file.js';
import { BASE_COMMIT, removeWorkspace, stubComponents } from './harness.js';

const EXAMPLES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'examples');
const TOKEN = 't'.repeat(40);

let workspace: string;
let server: ApiServer | undefined;
let url: string;

beforeEach(async () => {
  // The user's repository: the run files copied in, as the README says to.
  workspace = await mkdtemp(join(tmpdir(), 'r35-examples-'));
  await cp(join(EXAMPLES, 'run'), workspace, { recursive: true });
  server = createApiServer({
    // The host's own scanners, so the manifest's pinned secret-scan image is the one checked; stub drivers in the
    // drafting seats, since the host seats real ones and this proves the files, not the models.
    components: stubComponents(workspace, { scanners: SCANNERS, drafting: { specDrafter: new StubDriver(), specCritic: new StubDriver(), testDrafter: new StubDriver(), testCritic: new StubDriver() } }), token: TOKEN, principal: 'local',
    policyFile: join(EXAMPLES, 'policy.yaml'), rolesDirectory: join(EXAMPLES, 'roles'), rubricsDirectory: join(EXAMPLES, 'rubrics'),
  });
  url = await server.listen(0, '127.0.0.1');
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  await removeWorkspace(workspace);
});

async function create(body: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${url}/runs`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** Creates once without approval, reads the worst case it was refused with, and creates again approving exactly that. */
async function admit(body: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  const refused = await create({ ...body, approvedCostUsd: null });
  expect(refused.status, JSON.stringify(refused.body)).toBe(422);
  const refusal = refused.body.refusal as { reason?: string; worstCase?: { usd?: number } };
  expect(refusal.reason).toBe('cost-unapproved');
  return create({ ...body, approvedCostUsd: refusal.worstCase?.usd });
}

describe('the shipped examples', () => {
  test('admit an L1 run with every file supplied', async () => {
    const created = await admit({
      workspace, baseCommit: BASE_COMMIT, requestedLevel: 1,
      artifacts: { spec: ['spec.md'], acceptanceTests: ['acceptance.md'], verificationManifest: 'verify.json', taskGraph: 'graph.json', specParts: { security: 'security.json' } },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
  });

  test('admit the smallest L1 run: the spec drafted from an intent', async () => {
    const created = await admit({
      workspace, baseCommit: BASE_COMMIT, requestedLevel: 1, intent: 'Add hello.txt at the repository root, saying hello.',
      artifacts: { spec: 'draft', acceptanceTests: ['acceptance.md'], verificationManifest: 'verify.json', taskGraph: 'graph.json' },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
  });

  // The stub graph refuses every run above L1 for its own components, so an L2 create here would be refused
  // whatever the policy said (review: codex-7, gemini-3). The policy's cap is checked where it is enforced.
  test('cap every seated role at L1, refusing L2 for the policy\'s own cap', async () => {
    const loaded = await loadPolicyFile(join(EXAMPLES, 'policy.yaml'));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const engine = new StrictPolicyEngine();
    const seats = [['build', 'builder'], ['review', 'reviewer'], ['spec', 'spec-drafter'], ['spec', 'spec-critic'], ['test-design', 'test-drafter'], ['test-design', 'test-critic']] as const;
    for (const [station, role] of seats) {
      expect(engine.resolveAutonomy(1, station, role as RoleId, loaded.policy), `${role} at ${station}, L1`).toEqual({ ok: true, level: 1 });
      expect(engine.resolveAutonomy(2, station, role as RoleId, loaded.policy), `${role} at ${station}, L2`).toMatchObject({ ok: false, reason: 'exceeds-cap' });
    }
  });
});
