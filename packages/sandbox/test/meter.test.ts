/**
 * The relay's meter and budget, against a real daemon (P13).
 *
 * Every call here is made from inside a real sandbox by `node`, not by the
 * model's CLI: the budget binds whatever calls the relay, and a task that
 * bypasses its CLI is the case the bound exists for. The upstream is a TLS
 * origin this suite owns, answering as the Messages API does with usage the
 * test chooses, so every charge is checked against arithmetic done by hand.
 * No model is called.
 *
 * The upstream sits on a network of its own that the relay is connected to,
 * rather than on the relay's outbound network, so it can outlive the sandbox:
 * `destroy` reads the meter, and a test that had to remove the upstream first
 * could not show what the relay counted while it was still answering.
 *
 * These tests require Docker and `openssl`, and fail without either, for the
 * reason `local.test.ts` gives.
 */
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import {
  EGRESS_PROXY_IMAGE,
  LocalDockerProvider,
  METER_PREFIX,
  SandboxRefusal,
  meterReadingFrom,
  relayOf,
  type AppliedRelay,
  type MeterReading,
  type RelayBudget,
  type RelaySpec,
  type SandboxHandle,
  type SandboxSpec,
} from '../src/index.js';
import { TEST_BUDGET, TEST_METER, TEST_MODEL, UPSTREAM_ORIGIN, makeCertificate, startUpstream, upstreamDigests, upstreamLog, type Certificate } from './upstream.js';

const run = promisify(execFile);

const CREDENTIAL = 'model';
const URL_VARIABLE = 'MODEL_BASE_URL';

let certificate: Certificate;
let secret: string;
let provider: LocalDockerProvider;
let base: string;
let workspace: string;
const live: SandboxHandle[] = [];
const upstreams: string[] = [];
const networks: string[] = [];

function relaySpec(overrides: Partial<RelaySpec> = {}): RelaySpec {
  return {
    upstream: UPSTREAM_ORIGIN,
    paths: ['/v1/messages'],
    header: 'x-api-key',
    credential: CREDENTIAL,
    urlVariable: URL_VARIABLE,
    budget: TEST_BUDGET,
    meter: TEST_METER,
    ...overrides,
  };
}

/** The sandbox runs the proxy's pinned Node image, so the client inside it is `node`. */
function specFor(relay: Partial<RelaySpec> | undefined, overrides: Partial<SandboxSpec> = {}): SandboxSpec {
  return {
    image: EGRESS_PROXY_IMAGE,
    mounts: { workspace: { source: workspace, target: '/workspace', mode: 'rw' }, others: [] },
    egress: { mode: 'deny-all', allow: [] },
    limits: { cpus: 0.5, memoryMb: 256, pids: 64, wallClockMs: 120_000 },
    user: { uid: 0, gid: 0 },
    ...(relay === undefined ? {} : { relay: relaySpec(relay) }),
    ...overrides,
  };
}

async function provisioned(spec: SandboxSpec): Promise<SandboxHandle> {
  const handle = await provider.provision(spec);
  live.push(handle);
  return handle;
}

function relayFor(handle: SandboxHandle): AppliedRelay {
  const relay = relayOf(provider.appliedControls(handle).egress);
  if (relay === undefined) throw new Error('expected a sandbox with a relay');
  return relay;
}

/** A metered sandbox with its upstream answering. Returns the upstream's container name. */
async function metered(budget: RelayBudget = TEST_BUDGET, overrides: Partial<SandboxSpec> = {}): Promise<{ handle: SandboxHandle; upstream: string }> {
  const handle = await provisioned(specFor({ budget }, overrides));
  const relay = relayFor(handle);
  const id = randomUUID();
  const network = `meter-up-${id}`;
  const name = `meter-upstream-${id}`;
  await run('docker', ['network', 'create', network]);
  networks.push(network);
  upstreams.push(name);
  await startUpstream(name, network, certificate, secret);
  await run('docker', ['network', 'connect', network, relay.containerId]);
  return { handle, upstream: name };
}

/** Takes the handle out of the afterEach list: the test destroys it itself. */
function destroyed(handle: SandboxHandle): Promise<MeterReading> {
  live.splice(live.indexOf(handle), 1);
  return provider.destroy(handle).then((t) => t.meter);
}

interface Sent {
  readonly method?: string;
  readonly path?: string;
  readonly body?: unknown;
}

interface Answer {
  readonly status: number;
  readonly body: string;
  /** SHA-256 of the bytes the client received, and of the body it sent. */
  readonly received: string | null;
  readonly sent: string | null;
}

/** A client that sends each request in turn, or all at once when given `concurrent`, and reports what came back. Plain Node, no SDK. */
const CLIENT = `
const http = require('node:http');
const crypto = require('node:crypto');
const base = new URL(process.env.${URL_VARIABLE});
function sha(b) { return crypto.createHash('sha256').update(b).digest('hex'); }
function send(r) {
  return new Promise(function (resolve) {
    const body = r.body === undefined ? null : Buffer.from(typeof r.body === 'string' ? r.body : JSON.stringify(r.body));
    const headers = { 'content-type': 'application/json', 'x-api-key': 'placeholder' };
    if (body !== null) headers['content-length'] = String(body.length);
    const q = http.request({ host: base.hostname, port: base.port, method: r.method || 'POST', path: r.path || '/v1/messages', headers: headers, agent: false }, function (s) {
      const parts = [];
      s.on('data', function (c) { parts.push(c); });
      s.on('end', function () {
        const b = Buffer.concat(parts);
        resolve({ status: s.statusCode, body: b.toString('utf8'), received: sha(b), sent: body === null ? null : sha(body) });
      });
    });
    q.on('error', function (e) { resolve({ status: 0, body: String(e.message), received: null, sent: null }); });
    q.end(body === null ? undefined : body);
  });
}
let input = '';
process.stdin.on('data', function (c) { input += c; });
process.stdin.on('end', async function () {
  const requests = JSON.parse(input);
  const out = [];
  if (process.argv[1] === 'concurrent') out.push(...await Promise.all(requests.map(send)));
  else for (const r of requests) out.push(await send(r));
  process.stdout.write(JSON.stringify(out));
});
`;

async function send(handle: SandboxHandle, requests: readonly Sent[], concurrent = false): Promise<Answer[]> {
  const result = await provider.exec(handle, ['node', '--eval', CLIENT, ...(concurrent ? ['concurrent'] : [])], { stdin: JSON.stringify(requests) });
  if (result.exitCode !== 0) throw new Error(`the client exited ${String(result.exitCode)}: ${result.stderr}`);
  return JSON.parse(result.stdout) as Answer[];
}

interface Usage {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
}

function message(usage: Usage, extra: Record<string, unknown> = {}, test: Record<string, unknown> = {}): Record<string, unknown> {
  return { model: TEST_MODEL, max_tokens: 64, messages: [{ role: 'user', content: 'x' }], ...extra, relay_test: { usage, ...test } };
}

/** What `TEST_METER` charges for a usage, in dollars. Cache writes the test upstream reports as five-minute ones. */
function priced(u: Usage): number {
  return (u.input * 1 + u.output * 10 + u.cacheRead * 0.5 + u.cacheWrite * 1.25) / 1e6;
}

function meteredReading(reading: MeterReading): Extract<MeterReading, { kind: 'metered' }> {
  if (reading.kind !== 'metered') throw new Error(`expected a metered reading, not ${reading.kind}`);
  return reading;
}

const postsTo = (log: readonly string[]): string[] => log.filter((line) => line.startsWith('POST '));

async function exists(args: string[], notFound: string): Promise<boolean> {
  try {
    await run('docker', args);
    return true;
  } catch (error) {
    const stderr = (error as { stderr?: unknown }).stderr;
    if (typeof stderr === 'string' && stderr.includes(notFound)) return false;
    throw error;
  }
}

beforeAll(async () => {
  certificate = await makeCertificate();
});

beforeEach(async () => {
  secret = `canary-${randomUUID()}`;
  base = await mkdtemp(join(tmpdir(), 'meter-'));
  workspace = join(base, 'workspace');
  await mkdir(workspace, { recursive: true });
  provider = await LocalDockerProvider.create({ vaultPaths: [], credentials: { [CREDENTIAL]: secret }, relayTrust: certificate.cert });
});

afterEach(async () => {
  while (live.length > 0) {
    const handle = live.pop();
    if (handle !== undefined) await provider.destroy(handle).catch(() => undefined);
  }
  for (const name of upstreams.splice(0)) await run('docker', ['rm', '--force', '--volumes', name]).catch(() => undefined);
  for (const name of networks.splice(0)) await run('docker', ['network', 'rm', name]).catch(() => undefined);
  await rm(base, { recursive: true, force: true });
});

describe('the budget binds whatever calls the relay', () => {
  test('calls whose usage crosses maxCostUsd are forwarded up to the crossing call, and every later call is refused naming the bound', async () => {
    const { handle, upstream } = await metered({ maxTokens: 1_000_000_000, maxCostUsd: 0.003 });
    const usage = { input: 1000, output: 100, cacheRead: 0, cacheWrite: 0 };
    const answers = await send(handle, [message(usage), message(usage), message(usage), message(usage)].map((body) => ({ body })));

    expect(answers.map((a) => a.status)).toStrictEqual([200, 200, 402, 402]);
    expect(answers[2]?.body).toContain('maxCostUsd');
    // The refused calls never left the relay.
    expect(postsTo(await upstreamLog(upstream))).toHaveLength(2);

    const reading = meteredReading(await destroyed(handle));
    expect(reading).toMatchObject({ calls: 2, inputTokens: 2000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0, exhausted: 'cost', refused: 2 });
    expect(reading.costUsd).toBeCloseTo(2 * priced(usage), 12);
  });

  test('the same for maxTokens, which counts all four token classes', async () => {
    // 1300 tokens a call, 400 of them cache reads: without those the second call would total 1800 and the third would pass.
    const { handle, upstream } = await metered({ maxTokens: 2500, maxCostUsd: 100 });
    const usage = { input: 500, output: 100, cacheRead: 400, cacheWrite: 300 };
    const answers = await send(handle, [message(usage), message(usage), message(usage)].map((body) => ({ body })));

    expect(answers.map((a) => a.status)).toStrictEqual([200, 200, 402]);
    expect(answers[2]?.body).toContain('maxTokens');
    expect(postsTo(await upstreamLog(upstream))).toHaveLength(2);
    const reading = meteredReading(await destroyed(handle));
    expect(reading).toMatchObject({ calls: 2, inputTokens: 1000, outputTokens: 200, cacheReadTokens: 800, cacheWriteTokens: 600, exhausted: 'tokens', refused: 1 });
  });

  test('calls sent at once reach the upstream one at a time, so a crossing call leaves every call queued behind it refused', async () => {
    // Each answer is held a second, so without the queue all four would be in flight before the first is charged.
    const { handle, upstream } = await metered({ maxTokens: 1_000_000_000, maxCostUsd: 0.001 });
    const usage = { input: 1000, output: 100, cacheRead: 0, cacheWrite: 0 };
    const answers = await send(handle, [1, 2, 3, 4].map(() => ({ body: message(usage, {}, { hold: 1000 }) })), true);

    expect(answers.map((a) => a.status).sort()).toStrictEqual([200, 402, 402, 402]);
    expect(postsTo(await upstreamLog(upstream))).toHaveLength(1);
    expect(meteredReading(await destroyed(handle))).toMatchObject({ calls: 1, exhausted: 'cost', refused: 3 });
  });

  test('a streamed response and a whole one are metered identically, and both bodies cross the relay byte for byte', async () => {
    const usage = { input: 1000, output: 100, cacheRead: 200, cacheWrite: 300 };
    const readings: MeterReading[] = [];
    for (const stream of [true, false]) {
      const { handle, upstream } = await metered();
      const [answer] = await send(handle, [{ body: message(usage, { stream }) }]);
      const [digest] = await upstreamDigests(upstream);
      expect(answer?.status).toBe(200);
      // What the client sent is what the upstream received, and what the upstream sent is what the client received.
      expect(digest?.received).toBe(answer?.sent);
      expect(digest?.sent).toBe(answer?.received);
      readings.push(await destroyed(handle));
    }
    expect(readings[0]).toStrictEqual(readings[1]);
    const reading = meteredReading(readings[0] ?? { kind: 'unmetered' });
    expect(reading).toMatchObject({ calls: 1, inputTokens: 1000, outputTokens: 100, cacheReadTokens: 200, cacheWriteTokens: 300, exhausted: 'none' });
    expect(reading.costUsd).toBeCloseTo(priced(usage), 12);
  });
});

describe('what the meter cannot read, it charges or refuses', () => {
  test('a model absent from the price table is refused before the upstream sees the request', async () => {
    const { handle, upstream } = await metered();
    const [answer] = await send(handle, [{ body: { ...message({ input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }), model: 'unpriced-model' } }]);
    expect(answer?.status).toBe(400);
    expect(answer?.body).toContain('unpriced-model');
    expect(postsTo(await upstreamLog(upstream))).toStrictEqual([]);
    expect(meteredReading(await destroyed(handle))).toMatchObject({ calls: 0, refused: 1, costUsd: 0, exhausted: 'none' });
  });

  test('a successful answer with its input usage and no final output usage is charged max_tokens as output, streamed or whole', async () => {
    const { handle } = await metered();
    const usage = { input: 1000, output: 7, cacheRead: 0, cacheWrite: 0 };
    const answers = await send(handle, [
      { body: message(usage, { stream: true }, { omit: 'final' }) },
      { body: message(usage, { stream: false }, { omit: 'final' }) },
    ]);
    expect(answers.map((a) => a.status)).toStrictEqual([200, 200]);
    const reading = meteredReading(await destroyed(handle));
    expect(reading).toMatchObject({ calls: 2, inputTokens: 2000, outputTokens: 128, exhausted: 'none' });
    expect(reading.costUsd).toBeCloseTo(2 * priced({ ...usage, output: 64 }), 12);
  });

  test('an answer with no readable usage marks the budget unreadable, and every later call is refused', async () => {
    const { handle, upstream } = await metered();
    const usage = { input: 1000, output: 7, cacheRead: 0, cacheWrite: 0 };
    const answers = await send(handle, [{ body: message(usage, { stream: true }, { omit: 'all' }) }, { body: message(usage) }]);
    expect(answers.map((a) => a.status)).toStrictEqual([200, 402]);
    expect(postsTo(await upstreamLog(upstream))).toHaveLength(1);
    expect(meteredReading(await destroyed(handle))).toMatchObject({ calls: 1, outputTokens: 64, exhausted: 'unreadable', refused: 1 });
  });

  test('an answer in a content encoding the relay did not ask for is unreadable, and still reaches the client as sent', async () => {
    const { handle, upstream } = await metered();
    const answers = await send(handle, [{ body: message({ input: 10, output: 5, cacheRead: 0, cacheWrite: 0 }, {}, { encoding: 'gzip' }) }]);
    const [digest] = await upstreamDigests(upstream);
    expect(answers[0]?.status).toBe(200);
    expect(digest?.sent).toBe(answers[0]?.received);
    expect(meteredReading(await destroyed(handle))).toMatchObject({ calls: 1, exhausted: 'unreadable' });
  });

  test('an answer that is not a success is charged nothing', async () => {
    const { handle } = await metered();
    const [answer] = await send(handle, [{ body: message({ input: 1000, output: 100, cacheRead: 0, cacheWrite: 0 }, {}, { status: 529 }) }]);
    expect(answer?.status).toBe(529);
    expect(meteredReading(await destroyed(handle))).toMatchObject({ calls: 1, inputTokens: 0, outputTokens: 0, costUsd: 0, exhausted: 'none' });
  });

  test('a request the upstream received and never answered is charged as unreadable, and every later call is refused', async () => {
    const { handle, upstream } = await metered();
    const usage = { input: 1000, output: 7, cacheRead: 0, cacheWrite: 0 };
    const answers = await send(handle, [{ body: message(usage, {}, { hangup: true }) }, { body: message(usage) }]);
    expect(answers.map((a) => a.status)).toStrictEqual([502, 402]);
    expect(postsTo(await upstreamLog(upstream))).toHaveLength(1);
    expect(meteredReading(await destroyed(handle))).toMatchObject({ calls: 1, outputTokens: 64, exhausted: 'unreadable', refused: 1 });
  });

  test('a request that never reached the upstream is charged nothing, and the budget stays open', async () => {
    // No upstream is started, so its name does not resolve and nothing is sent.
    const handle = await provisioned(specFor({}));
    const usage = { input: 1000, output: 7, cacheRead: 0, cacheWrite: 0 };
    const answers = await send(handle, [{ body: message(usage) }, { body: message(usage) }]);
    expect(answers.map((a) => a.status)).toStrictEqual([502, 502]);
    expect(meteredReading(await destroyed(handle))).toMatchObject({ calls: 2, outputTokens: 0, costUsd: 0, exhausted: 'none', refused: 0 });
  });

  test('a write whose cost the meter cannot count is refused, and token counting is forwarded free', async () => {
    const { handle, upstream } = await metered();
    const answers = await send(handle, [
      { path: '/v1/messages/batches', body: { requests: [] } },
      { path: '/v1/messages/count_tokens', body: { model: TEST_MODEL, messages: [] } },
    ]);
    expect(answers.map((a) => a.status)).toStrictEqual([403, 200]);
    expect(answers[0]?.body).toContain('/v1/messages/batches');
    expect(await upstreamLog(upstream)).toStrictEqual(['POST /v1/messages/count_tokens']);
    // Upstream, the relay asked for the answer as it will read it.
    expect(JSON.parse(answers[1]?.body ?? '{}')).toMatchObject({ acceptEncoding: 'identity' });
    expect(meteredReading(await destroyed(handle))).toMatchObject({ calls: 0, refused: 1 });
  });
});

describe('destroy reads the meter after the sandbox stopped', () => {
  test('every call a process left running completed is in the reading, and none the upstream answered is missing from it', async () => {
    const { handle, upstream } = await metered();
    const loop = `
      const http = require('node:http');
      const fs = require('node:fs');
      const base = new URL(process.env.${URL_VARIABLE});
      const body = Buffer.from(JSON.stringify(${JSON.stringify(message({ input: 10, output: 1, cacheRead: 0, cacheWrite: 0 }))}));
      (function next() {
        const q = http.request({ host: base.hostname, port: base.port, method: 'POST', path: '/v1/messages', agent: false,
          headers: { 'content-type': 'application/json', 'content-length': String(body.length) } }, function (s) {
          s.resume();
          s.on('end', function () { fs.appendFileSync('/workspace/done.log', String(s.statusCode) + '\\n'); next(); });
        });
        q.on('error', function () { setTimeout(next, 50); });
        q.end(body);
      })();`;
    await provider.exec(handle, ['sh', '-c', 'node --eval "$1" > /dev/null 2>&1 &', 'loop', loop]);
    // Let it run long enough to have made several calls.
    await new Promise((done) => setTimeout(done, 3000));

    const reading = meteredReading(await destroyed(handle));
    const completed = (await readFile(join(workspace, 'done.log'), 'utf8')).split('\n').filter((l) => l === '200').length;
    const answered = postsTo(await upstreamLog(upstream)).length;
    expect(completed).toBeGreaterThan(2);
    // The sandbox was gone before the read: nothing completed that the reading lacks, and nothing the upstream answered is uncounted.
    expect(reading.calls).toBeGreaterThanOrEqual(completed);
    expect(reading.calls).toBe(answered);
  });

  test('a sandbox with no relay is unmetered, stated rather than zero', async () => {
    const handle = await provisioned(specFor(undefined));
    expect(await destroyed(handle)).toStrictEqual({ kind: 'unmetered' });
  });

  test('a sandbox its wall clock ended is still destroyed once, returning what its relay counted', async () => {
    const { handle } = await metered(TEST_BUDGET, { limits: { cpus: 0.5, memoryMb: 256, pids: 64, wallClockMs: 15_000 } });
    await send(handle, [{ body: message({ input: 10, output: 1, cacheRead: 0, cacheWrite: 0 }) }]);
    await expect(provider.exec(handle, ['sh', '-c', 'sleep 60'])).rejects.toThrow(SandboxRefusal);
    expect(meteredReading(await destroyed(handle))).toMatchObject({ calls: 1, inputTokens: 10 });
    await expect(provider.destroy(handle)).rejects.toMatchObject({ layer: 'lifetime' });
  });

  test('a relay log that cannot be accounted for throws, and the relay is still torn down', async () => {
    const { handle } = await metered();
    const relay = relayFor(handle);
    await send(handle, [{ body: message({ input: 10, output: 1, cacheRead: 0, cacheWrite: 0 }) }]);
    // Killed rather than stopped: it never writes the closing line that says its log is whole.
    await run('docker', ['kill', relay.containerId]);
    await expect(destroyed(handle)).rejects.toThrow(/closing meter line/u);
    expect(await exists(['inspect', '--type', 'container', relay.containerId], 'No such container')).toBe(false);
    expect(await exists(['network', 'inspect', relay.internalNetwork], 'not found')).toBe(false);
  });
});

describe('a relay nothing bounds is refused at provisioning, naming the field', () => {
  const cases: Array<[string, unknown, RegExp]> = [
    ['no budget', { budget: undefined }, /relay\.budget/u],
    ['no meter', { meter: undefined }, /relay\.meter/u],
    ['a zero token bound', { budget: { maxTokens: 0, maxCostUsd: 1 } }, /relay\.budget\.maxTokens/u],
    ['a negative cost bound', { budget: { maxTokens: 1, maxCostUsd: -1 } }, /relay\.budget\.maxCostUsd/u],
    ['a non-finite bound', { budget: { maxTokens: Number.POSITIVE_INFINITY, maxCostUsd: 1 } }, /relay\.budget\.maxTokens/u],
    ['a NaN bound', { budget: { maxTokens: 1, maxCostUsd: Number.NaN } }, /relay\.budget\.maxCostUsd/u],
    ['an unknown dialect', { meter: { ...TEST_METER, dialect: 'openai-chat' } }, /relay\.meter\.dialect/u],
    ['an empty price table', { meter: { ...TEST_METER, prices: {} } }, /relay\.meter\.prices/u],
    [
      'a negative price',
      { meter: { ...TEST_METER, prices: { [TEST_MODEL]: { ...TEST_METER.prices[TEST_MODEL], outputPerMTok: -1 } } } },
      /outputPerMTok/u,
    ],
    [
      'a non-finite price',
      { meter: { ...TEST_METER, prices: { [TEST_MODEL]: { ...TEST_METER.prices[TEST_MODEL], inputPerMTok: Number.NaN } } } },
      /inputPerMTok/u,
    ],
  ];
  test.each(cases)('%s', async (_name, overrides, field) => {
    const spec = specFor({});
    const relay = { ...spec.relay, ...(overrides as Partial<RelaySpec>) } as RelaySpec;
    const error: unknown = await provider.provision({ ...spec, relay }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SandboxRefusal);
    expect(error).toMatchObject({ layer: 'relay' });
    expect((error as Error).message).toMatch(field);
  });
});

describe('a reading is the sum of the per-call lines', () => {
  const call = (n: number, totals: Record<string, number>): string =>
    METER_PREFIX + JSON.stringify({ event: 'call', inputTokens: n, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: n / 1e6, totals, exhausted: 'none' });
  const totals = (calls: number, tokens: number): Record<string, number> => ({
    calls, inputTokens: tokens, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: tokens / 1e6, refused: 0,
  });
  const closed = (t: Record<string, number>): string => METER_PREFIX + JSON.stringify({ event: 'closed', totals: t, exhausted: 'none' });

  test('a whole log reads as the sum of its calls', () => {
    const log = ['model-relay listening', call(3, totals(1, 3)), 'model-relay: forwarded POST "/v1/messages" 200', call(4, totals(2, 7)), closed(totals(2, 7))].join('\n');
    expect(meterReadingFrom(log)).toMatchObject({ kind: 'metered', calls: 2, inputTokens: 7, exhausted: 'none' });
  });

  test('a log without its closing line is refused as cut short', () => {
    expect(() => meterReadingFrom(call(3, totals(1, 3)))).toThrow(/closing meter line/u);
  });

  test('a closing total the lines do not sum to is refused', () => {
    expect(() => meterReadingFrom([call(3, totals(1, 3)), closed(totals(1, 4))].join('\n'))).toThrow(/do not sum/u);
  });
});

