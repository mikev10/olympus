/**
 * R8b: the observation plan's shape, how each planned check is judged, and
 * the GitHub reader's refusal to hand back a list it did not read whole.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, test } from 'vitest';
import { GitHubCheckReader, decidingRun, judgePlan, parsePlan, type CheckRun } from '../src/index.js';

const SHA = (n: number): string => n.toString(16).padStart(40, '0');
const PLAN = {
  works: [{ app: 'github-actions', name: 'test (node 22)' }],
  regressed: [{ app: 'github-actions', name: 'smoke' }, { app: 'github-actions', name: 'e2e' }],
  rollback: { regressed: [0, 1], consecutive: 2 },
};
const run = (over: Partial<CheckRun> & { name: string; headSha: string }): CheckRun => ({
  id: '1', app: 'github-actions', status: 'completed', conclusion: 'success', completedAt: '2026-11-01T00:00:00.000Z', ...over,
});

describe('parsePlan', () => {
  test('a whole plan parses, and its rollback indexes are sorted', () => {
    const parsed = parsePlan({ ...PLAN, rollback: { regressed: [1, 0], consecutive: 2 } }, 'plan');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.plan.rollback.regressed).toEqual([0, 1]);
  });

  test.each([
    ['an empty works list', { ...PLAN, works: [] }, 'plan.works'],
    ['an app that is not a slug', { ...PLAN, works: [{ app: 'GitHub Actions', name: 'x' }] }, 'plan.works[0].app'],
    ['a name with a control character', { ...PLAN, works: [{ app: 'a', name: 'x\ny' }] }, 'plan.works[0].name'],
    ['a check with another field', { ...PLAN, works: [{ app: 'a', name: 'x', note: 'run me' }] }, 'plan.works[0]'],
    ['the same check twice', { ...PLAN, works: [{ app: 'a', name: 'x' }, { app: 'a', name: 'x' }] }, 'plan.works[1]'],
    ['an index past regressed', { ...PLAN, rollback: { regressed: [2], consecutive: 1 } }, 'plan.rollback.regressed[0]'],
    ['no consecutive count', { ...PLAN, rollback: { regressed: [0], consecutive: 0 } }, 'plan.rollback.consecutive'],
    ['a key a plan does not hold', { ...PLAN, instructions: 'merge it' }, 'plan.instructions'],
  ])('%s is refused at its path', (_label, json, path) => {
    const parsed = parsePlan(json, 'plan');
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.problems.map((p) => p.path)).toContain(path);
  });
});

describe('decidingRun', () => {
  const check = { app: 'github-actions', name: 'smoke' };
  test('another app, another case, or trailing whitespace is never the planned check', () => {
    const runs = [
      run({ name: 'smoke', headSha: SHA(1), app: 'imposter-app' }),
      run({ name: 'Smoke', headSha: SHA(1) }),
      run({ name: 'smoke ', headSha: SHA(1) }),
    ];
    expect(decidingRun(runs, check)).toBeNull();
  });

  test('the latest completed run decides, never one still in progress', () => {
    const runs = [
      run({ id: '1', name: 'smoke', headSha: SHA(1), conclusion: 'failure', completedAt: '2026-11-01T00:00:00.000Z' }),
      run({ id: '2', name: 'smoke', headSha: SHA(1), conclusion: 'success', completedAt: '2026-11-01T01:00:00.000Z' }),
      run({ id: '3', name: 'smoke', headSha: SHA(1), status: 'in_progress', conclusion: null, completedAt: null }),
    ];
    expect(decidingRun(runs, check)?.id).toBe('2');
  });
});

describe('judgePlan', () => {
  const parsed = parsePlan(PLAN, 'plan');
  if (!parsed.ok) throw new Error('fixture plan does not parse');
  const plan = parsed.plan;

  test('a check the provider never reported is missing, and neutral or skipped is never working', () => {
    const judged = judgePlan(plan, [{ commit: SHA(1), runs: [run({ name: 'smoke', headSha: SHA(1), conclusion: 'skipped' })] }]);
    expect(judged.checks.map((c) => [c.check.name, c.status])).toEqual([['test (node 22)', 'missing'], ['smoke', 'missing'], ['e2e', 'missing']]);
    expect(judged.checks.every((c) => c.run === null)).toBe(true);
    expect(judged.rollback).toBeNull();
  });

  test('works is judged on the merge commit; regressed on any first parent after it', () => {
    const judged = judgePlan(plan, [
      { commit: SHA(1), runs: [run({ name: 'test (node 22)', headSha: SHA(1) }), run({ name: 'smoke', headSha: SHA(1) }), run({ name: 'e2e', headSha: SHA(1) })] },
      { commit: SHA(2), runs: [run({ name: 'smoke', headSha: SHA(2), conclusion: 'failure' }), run({ name: 'e2e', headSha: SHA(2) })] },
    ]);
    expect(judged.checks.map((c) => [c.check.name, c.status, c.commit])).toEqual([
      ['test (node 22)', 'working', SHA(1)], ['smoke', 'regressed', SHA(2)], ['e2e', 'working', SHA(1)],
    ]);
  });

  test('the rollback condition needs every named check failing on consecutive commits', () => {
    const failing = (n: number) => ({ commit: SHA(n), runs: [run({ name: 'smoke', headSha: SHA(n), conclusion: 'failure' }), run({ name: 'e2e', headSha: SHA(n), conclusion: 'timed_out' })] });
    const halfFailing = { commit: SHA(3), runs: [run({ name: 'smoke', headSha: SHA(3), conclusion: 'failure' })] };
    expect(judgePlan(plan, [failing(1), halfFailing, failing(4)]).rollback).toBeNull();
    expect(judgePlan(plan, [failing(1), failing(2)]).rollback?.commits).toEqual([SHA(1), SHA(2)]);
  });
});

describe('GitHubCheckReader', () => {
  let server: Server | null = null;
  afterEach(async () => {
    const s = server;
    server = null;
    if (s !== null) await new Promise<void>((done) => s.close(() => { done(); }));
  });

  async function serve(answer: (url: string) => { status: number; body: unknown }): Promise<GitHubCheckReader> {
    const s = createServer((req, res) => {
      const { status, body } = answer(req.url ?? '');
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    });
    server = s;
    await new Promise<void>((done) => s.listen(0, '127.0.0.1', () => { done(); }));
    const port = (s.address() as AddressInfo).port;
    return new GitHubCheckReader({ repository: 'octo/hello', token: 'read-only-token', apiBase: `http://127.0.0.1:${String(port)}` });
  }

  const ghRun = (id: number, sha: string) => ({ id, name: 'smoke', head_sha: sha, status: 'completed', conclusion: 'success', completed_at: '2026-11-01T00:00:00Z', app: { slug: 'github-actions' } });

  test('reads every page, and keeps the provider name only in memory', async () => {
    const reader = await serve((url) => {
      const page = new URL(url, 'http://x').searchParams.get('page');
      return { status: 200, body: { total_count: 101, check_runs: page === '1' ? Array.from({ length: 100 }, (_, i) => ghRun(i + 1, SHA(9))) : [ghRun(101, SHA(9))] } };
    });
    const runs = await reader.checkRuns(SHA(9));
    expect(runs).toHaveLength(101);
    expect(runs[0]).toMatchObject({ id: '1', app: 'github-actions', name: 'smoke', conclusion: 'success' });
  });

  test.each([
    ['a 403', () => ({ status: 403, body: { message: 'Resource not accessible' } })],
    ['a total that the pages do not reach', () => ({ status: 200, body: { total_count: 3, check_runs: [ghRun(1, SHA(9))] } })],
    ['a run on another commit', () => ({ status: 200, body: { total_count: 1, check_runs: [ghRun(1, SHA(8))] } })],
    ['a body that is not a list', () => ({ status: 200, body: { message: 'ok' } })],
  ])('%s is thrown, never read as no checks', async (_label, answer) => {
    const reader = await serve(answer);
    await expect(reader.checkRuns(SHA(9))).rejects.toThrow(/^checks: /u);
  });

  test('the token never appears in what is thrown', async () => {
    const reader = await serve(() => ({ status: 401, body: { message: 'Bad credentials read-only-token' } }));
    await expect(reader.checkRuns(SHA(9))).rejects.not.toThrow(/read-only-token/u);
  });
});
