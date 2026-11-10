/**
 * Readiness reachable (R35, #125): `GET /readiness` runs the scanner it is
 * given over one revision and streams its report; a bad revision is refused
 * before the stream opens, and a server with no scanner refuses the route.
 * The scanner itself is R1's `scan`, tested in its own package; here it is a
 * stand-in, so this suite proves the route and nothing about the probes.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { ReadinessReport } from '@olympus-ai/readiness';
import { createApiServer, GitHubBranchProtection, type ApiServer, type ReadinessScanner } from '../src/index.js';
import { makeWorkspace, policyDocument, removeWorkspace, ROLES, stubComponents } from './harness.js';
import { writeFile } from 'node:fs/promises';

const TOKEN = 't'.repeat(40);
const COMMIT = 'a'.repeat(40);
const REPORT = { commit: COMMIT, ceiling: { kind: 'scanned', level: 1, commit: COMMIT }, probes: [], skipped: [], collectedBy: 'runtime' } as unknown as ReadinessReport;

let workspace: string;
let server: ApiServer | undefined;
let url: string;

beforeEach(async () => {
  workspace = await makeWorkspace('r35-readiness-');
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  await removeWorkspace(workspace);
});

async function serve(readiness: ReadinessScanner | null): Promise<void> {
  const policyFile = `${workspace}.policy.yaml`;
  await writeFile(policyFile, JSON.stringify(policyDocument()));
  server = createApiServer({ components: stubComponents(workspace), token: TOKEN, principal: 'local', policyFile, rolesDirectory: ROLES, readiness });
  url = await server.listen(0, '127.0.0.1');
}

async function get(path: string): Promise<{ status: number; type: string | null; text: string }> {
  const res = await fetch(`${url}${path}`, { headers: { authorization: `Bearer ${TOKEN}` } });
  return { status: res.status, type: res.headers.get('content-type'), text: await res.text() };
}

describe('GET /readiness', () => {
  test('streams the commit, then the report for the revision asked for', async () => {
    const asked: string[] = [];
    await serve({ resolve: (rev) => { asked.push(rev); return Promise.resolve(COMMIT); }, scan: (commit) => Promise.resolve({ ...REPORT, commit }) });
    const res = await get('/readiness?revision=main');
    expect(res.status).toBe(200);
    expect(res.type).toMatch(/^text\/event-stream/u);
    expect(asked).toEqual(['main']);
    expect(res.text).toContain(`event: started\ndata: ${JSON.stringify({ revision: 'main', commit: COMMIT })}`);
    expect(res.text).toContain(`event: report\ndata: ${JSON.stringify(REPORT)}`);
  });

  test('scans HEAD when no revision is named', async () => {
    const asked: string[] = [];
    await serve({ resolve: (rev) => { asked.push(rev); return Promise.resolve(COMMIT); }, scan: () => Promise.resolve(REPORT) });
    expect((await get('/readiness')).status).toBe(200);
    expect(asked).toEqual(['HEAD']);
  });

  test('a revision that names no commit is refused before anything is scanned', async () => {
    let scanned = false;
    await serve({ resolve: () => Promise.reject(new Error("readiness: /repo has no commit 'nope'")), scan: () => { scanned = true; return Promise.resolve(REPORT); } });
    const res = await get('/readiness?revision=nope');
    expect(res.status).toBe(400);
    expect(JSON.parse(res.text)).toMatchObject({ error: 'bad-request', message: expect.stringContaining('no commit') as unknown });
    expect(scanned).toBe(false);
  });

  test('a scan that fails ends the stream with failed, never a report', async () => {
    await serve({ resolve: () => Promise.resolve(COMMIT), scan: () => Promise.reject(new Error('the policy file is refused')) });
    const res = await get('/readiness');
    expect(res.text).toContain('event: failed');
    expect(res.text).not.toContain('event: report');
  });

  test('a server with no scanner refuses the route', async () => {
    await serve(null);
    const res = await get('/readiness');
    expect(res.status).toBe(409);
    expect(JSON.parse(res.text)).toMatchObject({ error: 'refused' });
  });

  test('the route needs the token, and only GET', async () => {
    await serve({ resolve: () => Promise.resolve(COMMIT), scan: () => Promise.resolve(REPORT) });
    expect((await fetch(`${url}/readiness`)).status).toBe(401);
    expect((await fetch(`${url}/readiness`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` } })).status).toBe(405);
  });
});

describe('the GitHub branch-protection checker', () => {
  test('reads the branch\'s protected field, and throws on any other answer', async () => {
    const answers: Array<{ status: number; body: unknown }> = [{ status: 200, body: { protected: true } }, { status: 200, body: { protected: false } }, { status: 404, body: {} }, { status: 200, body: {} }];
    const { createServer } = await import('node:http');
    const seen: string[] = [];
    const api = createServer((req, res) => {
      seen.push(`${req.url ?? ''} ${req.headers.authorization ?? ''}`);
      const next = answers.shift() ?? { status: 500, body: {} };
      res.writeHead(next.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(next.body));
    });
    await new Promise<void>((done) => { api.listen(0, '127.0.0.1', done); });
    const address = api.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    try {
      const checker = new GitHubBranchProtection({ repository: 'o/r', branch: 'main', token: 'tok', apiBase: `http://127.0.0.1:${String(port)}` });
      expect(checker.name).toBe('github:o/r@main');
      expect((await checker.check()).protected).toBe(true);
      expect((await checker.check()).protected).toBe(false);
      await expect(checker.check()).rejects.toThrow(/404/u);
      await expect(checker.check()).rejects.toThrow(/no protected field/u);
      expect(seen[0]).toBe('/repos/o/r/branches/main Bearer tok');
    } finally {
      await new Promise((done) => { api.close(done); });
    }
  });
});
