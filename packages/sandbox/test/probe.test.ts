/**
 * The HTTP probe (A-P11-01): a client in the sandbox's network namespace and
 * out of its filesystem and process tree, started for one call and gone after
 * it. Requires a Docker daemon and fails without one, as the rest of this
 * package's Docker-backed suites do: a probe that skipped itself would prove
 * nothing about where it ran.
 *
 * The sandbox runs the proxy's pinned Node image, because the product under
 * test here is an HTTP server and alpine has none.
 */
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import {
  EGRESS_PROXY_IMAGE,
  LocalDockerProvider,
  PROBE_BODY_LIMIT_BYTES,
  SandboxRefusal,
  type ProbeRequest,
  type SandboxHandle,
  type SandboxSpec,
} from '../src/index.js';

const run = promisify(execFile);

/** A server on 8080 answering `/`, `/slow` after two seconds, and `/big` with a body over the probe's cap. */
const SERVER = `
const http = require('node:http');
http.createServer((req, res) => {
  if (req.url === '/slow') { setTimeout(() => res.end('late'), 2000); return; }
  if (req.url === '/big') { res.end('x'.repeat(${String(PROBE_BODY_LIMIT_BYTES + 1)})); return; }
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    res.setHeader('content-type', 'text/plain');
    res.end(req.method + ' ' + req.url + ' ' + body);
  });
}).listen(8080, '127.0.0.1');
`;

let provider: LocalDockerProvider;
let base: string;
const live: SandboxHandle[] = [];

function specFor(overrides: Partial<SandboxSpec> = {}): SandboxSpec {
  return {
    image: EGRESS_PROXY_IMAGE,
    mounts: { workspace: { source: join(base, 'workspace'), target: '/workspace', mode: 'rw' }, others: [] },
    egress: { mode: 'deny-all', allow: [] },
    limits: { cpus: 0.5, memoryMb: 256, pids: 64, wallClockMs: 60_000 },
    user: { uid: 0, gid: 0 },
    ...overrides,
  };
}

async function serving(overrides: Partial<SandboxSpec> = {}): Promise<SandboxHandle> {
  const h = await provider.provision(specFor(overrides));
  live.push(h);
  const started = await provider.exec(h, ['node', '--eval', SERVER], { detach: true });
  expect(started.exitCode).toBe(0);
  return h;
}

function get(path: string, readyWithinMs = 10_000): ProbeRequest {
  return { port: 8080, readyWithinMs, exchanges: [{ method: 'GET', path }] };
}

async function probeContainers(): Promise<string[]> {
  const { stdout } = await run('docker', ['ps', '--all', '--filter', 'name=probe-', '--format', '{{.Names}}']);
  return stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '');
}

async function refusal(body: () => unknown): Promise<SandboxRefusal> {
  try {
    await body();
  } catch (error) {
    if (error instanceof SandboxRefusal) return error;
    throw error;
  }
  throw new Error('expected a SandboxRefusal, but the call returned');
}

beforeAll(async () => {
  provider = await LocalDockerProvider.create({ vaultPaths: [] });
});

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'sandbox-probe-'));
  await mkdir(join(base, 'workspace'));
});

afterEach(async () => {
  for (const h of live.splice(0)) await provider.destroy(h).catch(() => undefined);
  await rm(base, { recursive: true, force: true });
});

describe('probe', () => {
  test('a deny-all sandbox is answered on its loopback, and is still --network none afterwards', async () => {
    const h = await serving();
    const result = await provider.probe(h, {
      port: 8080,
      readyWithinMs: 10_000,
      exchanges: [
        { method: 'GET', path: '/a' },
        { method: 'POST', path: '/b', headers: { 'x-test': '1' }, body: 'hello' },
      ],
    });
    expect(result.ready).toBe(true);
    expect(result.observations.map((o) => (o.kind === 'response' ? [o.status, o.headers['content-type'], o.body] : o.kind))).toEqual([
      [200, 'text/plain', 'GET /a '],
      [200, 'text/plain', 'POST /b hello'],
    ]);
    expect(provider.appliedControls(h).egress).toEqual({ mode: 'deny-all', network: 'none' });
    const { stdout } = await run('docker', ['inspect', '--format', '{{.HostConfig.NetworkMode}}', h]);
    expect(stdout.trim()).toBe('none');
    expect(await probeContainers()).toEqual([]);
  }, 60_000);

  test('the probe shares the network and not the filesystem, runs read-only with nothing, and is gone after the call', async () => {
    const h = await serving();
    // Something the product wrote where a forged probe would sit in its own container.
    expect((await provider.exec(h, ['sh', '-c', 'echo forged > /tmp/probe-marker'])).exitCode).toBe(0);

    const call = provider.probe(h, get('/slow'));
    let name: string | undefined;
    for (let i = 0; i < 50 && name === undefined; i += 1) {
      [name] = await probeContainers();
      if (name === undefined) await new Promise((r) => setTimeout(r, 100));
    }
    expect(name).toBeDefined();
    const probe = name ?? '';
    const format = '{{.HostConfig.NetworkMode}}|{{json .Mounts}}|{{.HostConfig.ReadonlyRootfs}}|{{json .HostConfig.CapDrop}}';
    const { stdout } = await run('docker', ['inspect', '--format', format, probe]);
    const [networkMode, mounts, readOnly, capDrop] = stdout.trim().split('|');
    expect(networkMode).toBe(`container:${h}`);
    expect(mounts).toBe('[]');
    expect(readOnly).toBe('true');
    expect(capDrop).toBe('["ALL"]');
    const marker = await run('docker', ['exec', probe, 'cat', '/tmp/probe-marker']).then(() => 'present', () => 'absent');
    expect(marker).toBe('absent');

    const result = await call;
    expect(result.observations.map((o) => (o.kind === 'response' ? o.body : o.kind))).toEqual(['late']);
    expect(await probeContainers()).toEqual([]);
  }, 60_000);

  test('a port nothing listens on is reported not ready, with nothing sent', async () => {
    const h = await provider.provision(specFor());
    live.push(h);
    const result = await provider.probe(h, get('/', 500));
    expect([result.ready, result.observations]).toEqual([false, []]);
  }, 60_000);

  test('a body over the cap is reported oversized, never truncated', async () => {
    const h = await serving();
    const result = await provider.probe(h, get('/big'));
    expect(result.observations.map((o) => (o.kind === 'oversized' ? [o.status, o.limitBytes] : o.kind))).toEqual([[200, PROBE_BODY_LIMIT_BYTES]]);
  }, 60_000);

  test('a probe still running when the sandbox is destroyed goes with it', async () => {
    const h = await serving();
    const call = provider.probe(h, get('/slow')).then(() => 'answered', () => 'failed');
    for (let i = 0; i < 50 && (await probeContainers()).length === 0; i += 1) await new Promise((r) => setTimeout(r, 100));
    await provider.destroy(h);
    live.splice(live.indexOf(h), 1);
    expect(await probeContainers()).toEqual([]);
    expect(await call).toBe('failed');
  }, 60_000);

  test.each([
    ['port 0', { port: 0, readyWithinMs: 1000, exchanges: [{ method: 'GET', path: '/' }] }, /port/],
    ['a port past 65535', { port: 70_000, readyWithinMs: 1000, exchanges: [{ method: 'GET', path: '/' }] }, /port/],
    ['no exchanges', { port: 80, readyWithinMs: 1000, exchanges: [] }, /exchanges/],
    ['a path that is a URL', { port: 80, readyWithinMs: 1000, exchanges: [{ method: 'GET', path: 'http://example.com/' }] }, /path/],
    ['a method with a space', { port: 80, readyWithinMs: 1000, exchanges: [{ method: 'GET /x', path: '/' }] }, /method/],
    ['a header value with a line break', { port: 80, readyWithinMs: 1000, exchanges: [{ method: 'GET', path: '/', headers: { a: 'b\r\nc: d' } }] }, /headers\.a/],
  ])('%s is refused, naming the field', async (_, request, field) => {
    const h = await provider.provision(specFor());
    live.push(h);
    const error = await refusal(() => provider.probe(h, request as unknown as ProbeRequest));
    expect(error.layer).toBe('probe');
    expect(error.message).toMatch(field);
  }, 60_000);

  test('an ended sandbox is refused, and detach with stdin is refused', async () => {
    const h = await provider.provision(specFor());
    live.push(h);
    expect((await refusal(() => provider.exec(h, ['cat'], { detach: true, stdin: 'x' }))).layer).toBe('probe');
    await provider.destroy(h);
    live.splice(live.indexOf(h), 1);
    expect((await refusal(() => provider.probe(h, get('/')))).layer).toBe('lifetime');
  }, 60_000);
});
