/**
 * Every CLI command, end to end, against an API server it reaches only by the
 * URL it is given (I9). The server is the runtime's own, over stub
 * components; the CLI shares nothing with it but the socket.
 */
import { createServer, type IncomingHttpHeaders } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { buildGraph, createApiServer, outcomes, STAND_IN_SCANNERS, telemetryOf, UNANALYSED_TESTS, localWorkspaceStore, type ApiServer, type CreatedRun, type RunView } from '@olympus-ai/api';
import { StubDriver, type Driver, type TaskRequest, type TaskResult } from '@olympus-ai/core';
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
    tierByStation: {},
    escalation: 'none',
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
let vault: StubVault;
let url: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'p9-cli-'));
  workspace = join(root, 'workspace');
  await mkdir(workspace);
  await writeFile(join(workspace, 'spec.md'), '# spec\n');
  await writeFile(join(workspace, 'acceptance.md'), '# acceptance\n');
  await writeFile(join(workspace, 'verify.json'), JSON.stringify({ checks: [
    { id: 'ok', kind: 'compile', command: ['node', '-e', 'process.exit(0)'], required: true, timeoutMs: 10_000 },
    // The reproduction: fails over the base, passes once the builder has written `done` (D-A-BF-01). The name is built, since one spelt is protected (D-R15-03).
    { id: 'done', kind: 'behavioral', onBase: 'fails', command: ['node', '-e', "process.exit(require('node:fs').existsSync(['do', 'ne'].join('')) ? 0 : 1)"], required: true, timeoutMs: 10_000 },
    // Every run is scanned for secrets, here by the stand-in the graph runs (R17).
    { id: 'secret-scan', kind: 'secret-scan', image: STAND_IN_SCANNERS.secretScan.image, config: null, required: true, timeoutMs: 30_000 },
  ] }));
  await writeFile(join(workspace, 'security.json'), JSON.stringify({ none: 'the change writes one file in the workspace and crosses no trust boundary' }));
  await writeFile(join(workspace, 'graph.json'), JSON.stringify({ tasks: [
    { id: 'hello', station: 'build', role: 'builder', dependsOn: [], dependencySet: ['**'] },
    { id: 'hello-review', station: 'review', role: 'reviewer', dependsOn: ['hello'], dependencySet: ['**'] },
  ] }));
  const policyFile = join(root, 'policy.yaml');
  // The roles the graph's seats run under, beside the workspace and outside it (R20).
  const roles = join(root, 'roles');
  await mkdir(roles);
  await writeFile(join(roles, 'builder.md'), 'Build the task.');
  await writeFile(join(roles, 'reviewer.md'), 'Review the change.');
  await writeFile(policyFile, JSON.stringify(POLICY));
  const sandbox = new StubSandboxProvider();
  const stub = new StubDriver();
  // The builder makes the change the reproduction asks for, through its own sandbox, and claims it.
  const driver: Driver = Object.assign(Object.create(stub) as Driver, {
    runTask: async (req: TaskRequest): Promise<TaskResult> => {
      if (req.role.role !== 'builder') return stub.runTask(req);
      await sandbox.exec(req.sandbox, ['node', '-e', "require('node:fs').writeFileSync('done', 'done')"]);
      const result = await stub.runTask(req);
      return { ...result, claim: { ...result.claim, filesChanged: ['done'] } };
    },
  });
  const user = process.getuid === undefined ? { uid: 0, gid: 0 } : undefined;
  const store = join(root, 'store');
  vault = new StubVault(workspace);
  server = createApiServer({
    components: buildGraph({
      vault,
      sandbox,
      driver,
      reviewer: driver,
      scanners: STAND_IN_SCANNERS,
      workspaces: localWorkspaceStore(user === undefined ? { root: store } : { root: store, user }),
    }),
    token: TOKEN,
    principal: 'cli-test',
    policyFile,
    rolesDirectory: roles,
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

const CREATE = ['create', '--workspace', '', '--base-commit', '0'.repeat(40), '--level', '1', '--spec', 'spec.md', '--tests', 'acceptance.md', '--manifest', 'verify.json', '--graph', 'graph.json', '--security-part', 'security.json'];

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
    // No past run has priced a task here, so the likely figure declines rather than guess (R2).
    expect(shown.err[1]).toMatch(/^no likely cost: fewer than 5 past tasks at build on .+ \(0\), review on .+ \(0\)$/);
    expect(shown.err[2]).toContain('--approve-cost 3');

    const wrong = await cli(remote(...createArgs('--approve-cost', '2.99')));
    expect(wrong).toMatchObject({ code: 1 });
    expect(wrong.err[2]).toContain('is not that figure');

    const created = await cli(remote(...createArgs('--approve-cost', '3')));
    expect(created.code).toBe(0);
    const run = JSON.parse(created.out.join('\n')) as CreatedRun;
    expect(run.worstCase).toMatchObject({ usd: 3, calls: 12 });

    const events = await cli(remote('events', run.runId));
    expect(events.code).toBe(0);
    expect(events.out.at(-1)).toMatch(/^end \{"kind":"outcome"/);
    expect(events.out.some((line) => line.startsWith('state {'))).toBe(true);

    const waiting = await settle(run.runId);
    expect(waiting.standing).toEqual({ standing: 'awaiting-approval', key: 'integrate:1', escalations: [UNANALYSED_TESTS], draft: null });

    const approved = await cli(remote('approve', run.runId, 'integrate:1'));
    expect(approved.code).toBe(0);
    expect((await settle(run.runId)).standing).toEqual({ standing: 'passed' });

    // The report is the server's, read from the Vault (D-I1b-07).
    const report = await cli(remote('report', run.runId));
    expect(report.code).toBe(0);
    const body = JSON.parse(report.out.join('\n')) as { runId: string; standing: unknown; decisions: Record<string, number> };
    expect(body).toMatchObject({ runId: run.runId, standing: { standing: 'passed' } });
    expect(body.decisions['approval-granted']).toBe(1);
    expect((await cli(remote('report', 'no-such-run'))).code).toBe(1);

    // Outcomes are the server's, derived from the same Vault the library reads (R2).
    const measured = await cli(remote('outcomes'));
    expect(measured.code).toBe(0);
    const served = JSON.parse(measured.out.join('\n')) as unknown;
    expect(served).toEqual(JSON.parse(JSON.stringify(await outcomes(vault))));
    expect(served).toMatchObject({ population: { refused: 2, passed: 1, total: 3 } });
    expect((await cli(remote('outcomes', '--from', 'yesterday'))).code).toBe(1);
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

describe('telemetry (R12)', () => {
  test('a finished run prints what the library exports, an unfinished one is refused, and a collector is sent both bodies with its headers by the client', async () => {
    const run = JSON.parse((await cli(remote(...createArgs('--approve-cost', '3')))).out.join('\n')) as CreatedRun;
    await settle(run.runId);
    // Waiting at the integrate exit is unfinished: refused, never exported (D-R12-04).
    const open = await cli(remote('telemetry', run.runId));
    expect(open.code).toBe(1);
    expect(open.err[0]).toMatch(/^error 409 not-finished/);
    expect((await cli(remote('telemetry', 'no-such-run'))).err[0]).toMatch(/^error 404/);

    expect((await cli(remote('approve', run.runId, 'integrate:1'))).code).toBe(0);
    await settle(run.runId);
    const printed = await cli(remote('telemetry', run.runId));
    expect(printed.code).toBe(0);
    expect(printed.out).toHaveLength(1);
    const library = await telemetryOf(vault, run.runId);
    if (!library.ok) throw new Error('the library refused a passed run');
    expect(JSON.parse(printed.out[0] ?? '')).toEqual({ runId: run.runId, ...JSON.parse(JSON.stringify(library.export)) });

    const received: Array<{ path: string; headers: IncomingHttpHeaders; body: unknown }> = [];
    const collector = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
      req.on('end', () => {
        received.push({ path: req.url ?? '', headers: req.headers, body: JSON.parse(body) as unknown });
        res.writeHead(200).end('{}');
      });
    });
    await new Promise<void>((done) => collector.listen(0, '127.0.0.1', done));
    const address = collector.address();
    if (address === null || typeof address === 'string') throw new Error('the collector has no port');
    try {
      const sent = await cli(remote('telemetry', run.runId, '--header', 'x-collector-key=secret-value'), { OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${String(address.port)}/otlp` });
      expect(sent.code).toBe(0);
      expect(received.map((r) => r.path)).toEqual(['/otlp/v1/traces', '/otlp/v1/metrics']);
      expect(received.map((r) => r.headers['x-collector-key'])).toEqual(['secret-value', 'secret-value']);
      expect(received.map((r) => r.body)).toEqual([JSON.parse(JSON.stringify(library.export.traces)), JSON.parse(JSON.stringify(library.export.metrics))]);
      // The collector's credential is sent, never printed.
      expect([...sent.out, ...sent.err].join('\n')).not.toContain('secret-value');
    } finally {
      await new Promise((done) => collector.close(done));
    }
  });
});
