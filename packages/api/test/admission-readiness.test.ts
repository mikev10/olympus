/**
 * The host's side of R40: the server hands its scanner to admission, so a run
 * above its base commit's ceiling is refused before its cost is asked for
 * (D-R40-05); and a cached report stands only while branch protection still
 * reads as it recorded (D-R40-04).
 */
import { cp, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { hashedLockfile } from '@olympus-ai/adapters';
import { commitFixture } from '@olympus-ai/conformance/git';
import type { ProbeResult, ReadinessReport } from '@olympus-ai/readiness';
import { createApiServer, SCANNERS, type ApiServer, type ReadinessScanner } from '../src/index.js';
import { protectionStands, remember } from '../src/readiness-scan.js';
import { removeWorkspace, stubComponents } from './harness.js';

const EXAMPLES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'examples');
const TOKEN = 't'.repeat(40);

describe('the server enforces its scanner\'s ceiling at admission', () => {
  let workspace: string;
  let server: ApiServer | undefined;
  let url: string;
  const asked: string[] = [];

  beforeEach(async () => {
    asked.length = 0;
    workspace = await mkdtemp(join(tmpdir(), 'r40-admission-'));
    await cp(join(EXAMPLES, 'run'), workspace, { recursive: true });
    await writeFile(join(workspace, 'package.json'), JSON.stringify({ name: 'user-repo', private: true }));
    await writeFile(join(workspace, 'package-lock.json'), hashedLockfile('user-repo', []));
    const readiness: ReadinessScanner = {
      resolve: () => Promise.reject(new Error('the route is not under test')),
      scan: () => Promise.reject(new Error('the route is not under test')),
      ceilingAt: (_checkout, commit) => {
        asked.push(commit);
        return Promise.resolve({ kind: 'scanned', level: 0, heldBy: { kind: 'probe', probe: 'testing.adapter' }, commit });
      },
    };
    server = createApiServer({
      components: stubComponents(workspace, { scanners: SCANNERS }), token: TOKEN, principal: 'local',
      policyFile: join(EXAMPLES, 'policy.yaml'), rolesDirectory: join(EXAMPLES, 'roles'), rubricsDirectory: join(EXAMPLES, 'rubrics'), readiness,
    });
    url = await server.listen(0, '127.0.0.1');
  });

  afterEach(async () => {
    await server?.close();
    server = undefined;
    await removeWorkspace(workspace);
  });

  test('an L1 run over an L0 ceiling is refused as readiness-refused, before its cost is asked for', async () => {
    const res = await fetch(`${url}/runs`, {
      method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        workspace, baseCommit: commitFixture(workspace), requestedLevel: 1, approvedCostUsd: null,
        artifacts: { spec: ['spec.md'], acceptanceTests: ['acceptance.md'], verificationManifest: 'verify.json', taskGraph: 'graph.json', specParts: { security: 'security.json' } },
      }),
    });
    const body = (await res.json()) as { refusal?: { reason?: string; ceiling?: number; heldBy?: unknown } };
    expect(res.status, JSON.stringify(body)).toBe(422);
    expect(body.refusal).toMatchObject({ reason: 'readiness-refused', ceiling: 0, heldBy: { kind: 'probe', probe: 'testing.adapter' } });
    expect(asked).toHaveLength(1);
  });
});

function reportWith(outcome: ProbeResult['outcome'] | null): ReadinessReport {
  const probes: ProbeResult[] = outcome === null ? [] : [{
    probe: 'integrate.branch-protection', pillar: 'security-and-governance', ceilingBearing: true, outcome,
    detail: 'recorded', evidence: { via: 'checker', checker: 'fixture' }, collectedBy: 'runtime',
  }];
  return { commit: 'c'.repeat(40), ceiling: { kind: 'scanned', level: 2, heldBy: { kind: 'scan-limit' }, commit: 'c'.repeat(40) }, probes, skipped: [], collectedBy: 'runtime' };
}

const answers = (isProtected: boolean) => ({ name: 'fixture', check: () => Promise.resolve({ protected: isProtected, detail: '' }) });

describe('a cached report stands only while branch protection reads as it recorded', () => {
  test('the same answer stands', async () => {
    await expect(protectionStands(reportWith('supported'), answers(true))).resolves.toBe(true);
    await expect(protectionStands(reportWith('absent'), answers(false))).resolves.toBe(true);
  });

  test('protection removed since the scan does not stand: the commit is scanned again', async () => {
    await expect(protectionStands(reportWith('supported'), answers(false))).resolves.toBe(false);
    await expect(protectionStands(reportWith('absent'), answers(true))).resolves.toBe(false);
  });

  test('a checker that fails, an indeterminate probe, or no probe does not stand', async () => {
    await expect(protectionStands(reportWith('supported'), { name: 'fixture', check: () => Promise.reject(new Error('GitHub answered 502')) })).resolves.toBe(false);
    await expect(protectionStands(reportWith('indeterminate'), answers(true))).resolves.toBe(false);
    await expect(protectionStands(reportWith(null), answers(true))).resolves.toBe(false);
  });

  test('with no checker, only the indeterminate answer a scan without one records stands', async () => {
    await expect(protectionStands(reportWith('indeterminate'), null)).resolves.toBe(true);
    await expect(protectionStands(reportWith('supported'), null)).resolves.toBe(false);
  });
});

describe('the report cache is bounded (gemini-4)', () => {
  test('keeps at most max entries, dropping the oldest, and a key set again is the newest', () => {
    const map = new Map<string, number>();
    for (const key of ['a', 'b', 'c']) remember(map, key, 1, 2);
    expect([...map.keys()]).toEqual(['b', 'c']);
    remember(map, 'b', 2, 2);
    remember(map, 'd', 1, 2);
    expect([...map.entries()]).toEqual([['b', 2], ['d', 1]]);
  });
});
