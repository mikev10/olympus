/**
 * Every CLI command, end to end, against an API server it reaches only by the
 * URL it is given (I9). The server is the runtime's own, over stub
 * components; the CLI shares nothing with it but the socket.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { buildGraph, createApiServer, UNANALYSED_TESTS, localWorkspaceStore, type ApiServer, type CreatedRun, type RunView } from '@olympus-ai/api';
import { StubDriver } from '@olympus-ai/core';
import { StubSandboxProvider } from '@olympus-ai/sandbox';
import { StubVault } from '@olympus-ai/vault';
import { runCli, type CliIo } from '../src/cli.js';

const TOKEN = 'k'.repeat(48);

function scope(stations: string[], tier: string): Record<string, unknown> {
  return {
    stations,
    writableGlobs: ['**'],
    tools: ['read', 'write'],
    network: { egress: 'none' },
    tier,
    autonomyCeiling: 2,
    triggerKinds: ['human'],
    budget: { maxTokens: 1000, maxCostUsd: 0.25, maxWallClockMs: 60_000 },
  };
}

const POLICY = {
  globalCap: 2,
  stationCaps: {},
  approvals: Object.fromEntries(['intake', 'spec', 'test-design', 'plan', 'build', 'verify', 'review'].map((s) => [`${s}:1`, 'auto'])),
  roles: { builder: scope(['build', 'verify'], 'standard'), reviewer: scope(['review'], 'deep') },
  protectedPaths: [],
  triggers: {
    enabled: ['human'],
    entryStation: { human: 'intake' },
    taskTemplate: {},
    maxAutonomy: { human: 2 },
    minAuthorTrust: { human: 'owner' },
    maxTriggerDepth: 2,
    budgetPerWindow: { runs: 20, windowMs: 3_600_000 },
  },
  concurrency: { maxParallelTasks: 1, maxConflictRetries: 0 },
};

let root: string;
let workspace: string;
let server: ApiServer;
let url: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'p9-cli-'));
  workspace = join(root, 'workspace');
  await mkdir(workspace);
  await writeFile(join(workspace, 'spec.md'), '# spec\n');
  await writeFile(join(workspace, 'acceptance.md'), '# acceptance\n');
  await writeFile(join(workspace, 'verify.json'), JSON.stringify({ checks: [{ id: 'ok', kind: 'compile', command: ['node', '-e', 'process.exit(0)'], required: true, timeoutMs: 10_000 }] }));
  await writeFile(join(workspace, 'graph.json'), JSON.stringify({ tasks: [
    { id: 'hello', station: 'build', role: 'builder', dependsOn: [], dependencySet: ['**'] },
    { id: 'hello-review', station: 'review', role: 'reviewer', dependsOn: ['hello'], dependencySet: ['**'] },
  ] }));
  const policyFile = join(root, 'policy.yaml');
  await writeFile(policyFile, JSON.stringify(POLICY));
  const driver = new StubDriver();
  const user = process.getuid === undefined ? { uid: 0, gid: 0 } : undefined;
  const store = join(root, 'store');
  server = createApiServer({
    components: buildGraph({
      vault: new StubVault(workspace),
      sandbox: new StubSandboxProvider(),
      driver,
      reviewer: driver,
      workspaces: localWorkspaceStore(user === undefined ? { root: store } : { root: store, user }),
    }),
    token: TOKEN,
    principal: 'cli-test',
    policyFile,
  });
  // Not a default: an ephemeral port on the loopback address, known to the CLI only through --url.
  url = await server.listen(0, '127.0.0.1');
});

afterEach(async () => {
  await server.close();
  await rm(root, { recursive: true, force: true });
});

interface Ran { code: number; out: string[]; err: string[] }

async function cli(args: string[], env: Record<string, string> = {}): Promise<Ran> {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = { env, fetch: globalThis.fetch, out: (l) => out.push(l), err: (l) => err.push(l) };
  const code = await runCli(args, io);
  return { code, out, err };
}

function remote(...args: string[]): string[] {
  return ['--url', url, '--token', TOKEN, ...args];
}

const CREATE = ['create', '--workspace', '', '--base-commit', '0'.repeat(40), '--level', '1', '--spec', 'spec.md', '--tests', 'acceptance.md', '--manifest', 'verify.json', '--graph', 'graph.json'];

function createArgs(...extra: string[]): string[] {
  const args = [...CREATE];
  args[2] = workspace;
  return [...args, ...extra];
}

async function settle(runId: string): Promise<RunView> {
  for (let i = 0; i < 400; i += 1) {
    const ran = await cli(remote('status', runId));
    const view = JSON.parse(ran.out.join('\n')) as RunView;
    if (!view.driving) return view;
    await new Promise((done) => setTimeout(done, 25));
  }
  throw new Error('never settled');
}

describe('the CLI is a client of a remote API URL', () => {
  test('create shows the worst-case cost and starts nothing until that figure is approved; then create, events, status, approve', async () => {
    const shown = await cli(remote(...createArgs()));
    expect(shown.code).toBe(1);
    expect(shown.err[0]).toBe('the worst-case cost of this run is $3, over at most 12 driver calls');
    expect(shown.err[1]).toContain('--approve-cost 3');

    const wrong = await cli(remote(...createArgs('--approve-cost', '2.99')));
    expect(wrong).toMatchObject({ code: 1 });
    expect(wrong.err[1]).toContain('is not that figure');

    const created = await cli(remote(...createArgs('--approve-cost', '3')));
    expect(created.code).toBe(0);
    const run = JSON.parse(created.out.join('\n')) as CreatedRun;
    expect(run.worstCase).toMatchObject({ usd: 3, calls: 12 });

    const events = await cli(remote('events', run.runId));
    expect(events.code).toBe(0);
    expect(events.out.at(-1)).toMatch(/^end \{"kind":"outcome"/);
    expect(events.out.some((line) => line.startsWith('state {'))).toBe(true);

    const waiting = await settle(run.runId);
    expect(waiting.standing).toEqual({ standing: 'awaiting-approval', key: 'integrate:1', escalations: [UNANALYSED_TESTS] });

    const approved = await cli(remote('approve', run.runId, 'integrate:1'));
    expect(approved.code).toBe(0);
    expect((await settle(run.runId)).standing).toEqual({ standing: 'passed' });
  });

  test('cancel stops a run; cancelling it again is refused with the runtime\'s reason', async () => {
    const created = await cli(remote(...createArgs('--approve-cost', '3')));
    const run = JSON.parse(created.out.join('\n')) as CreatedRun;
    await settle(run.runId);
    const cancelled = await cli(remote('cancel', run.runId));
    expect(cancelled.code).toBe(0);
    expect(JSON.parse(cancelled.out.join('\n'))).toMatchObject({ state: { cancelled: { by: 'cli-test' } }, standing: { standing: 'stopped' } });
    const again = await cli(remote('cancel', run.runId));
    expect(again.code).toBe(1);
    expect(again.err[0]).toMatch(/^error 409 refused:/);
  });

  test('the URL and token may come from the environment instead', async () => {
    const ran = await cli(['status', 'no-such-run'], { FACTORY_API_URL: url, FACTORY_API_TOKEN: TOKEN });
    expect(ran.code).toBe(1);
    expect(ran.err[0]).toMatch(/^error 404 not-found/);
  });
});

describe('the CLI refuses rather than guessing', () => {
  test('with no URL, it refuses and sends nothing; there is no default server', async () => {
    let fetched = false;
    const io: CliIo = { env: {}, fetch: () => { fetched = true; return Promise.reject(new Error('unreachable')); }, out: () => undefined, err: () => undefined };
    expect(await runCli(['--token', TOKEN, 'status', 'x'], io)).toBe(2);
    expect(fetched).toBe(false);
  });

  test('with no token, a wrong token, or a bad command, it fails and says why', async () => {
    expect((await cli(['--url', url, 'status', 'x'])).err[0]).toMatch(/no token/);
    const wrong = await cli(['--url', url, '--token', 'nope', 'status', 'x']);
    expect(wrong).toMatchObject({ code: 1 });
    expect(wrong.err[0]).toMatch(/^error 401 unauthorized/);
    expect((await cli(remote('frobnicate'))).code).toBe(2);
    expect((await cli(remote('create', '--workspace', workspace))).err[0]).toMatch(/--base-commit is required/);
    expect((await cli(remote('approve', 'only-one-arg'))).code).toBe(2);
  });

  test('a server that is not there is reported, not retried against a default', async () => {
    const ran = await cli(['--url', 'http://127.0.0.1:9', '--token', TOKEN, 'status', 'x']);
    expect(ran.code).toBe(2);
    expect(ran.err[0]).toMatch(/could not reach the API/);
  });
});
