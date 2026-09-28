/**
 * An HTTP scenario is served inside the sandbox, observed by the provider's
 * probe, and judged on the host. The reading and the comparison are asserted
 * on their own, and then end to end against a real server in a real
 * container: this suite requires a Docker daemon and fails without one,
 * because a behavioral check that skips itself proves nothing (I5).
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { EGRESS_PROXY_IMAGE, LocalDockerProvider, StubSandboxProvider, type SandboxHandle } from '@olympus-ai/sandbox';
import { AdapterRefusal, buildAdapterSet, compareHttp, HttpBehavioralAdapter, readHttpScenario, type HttpExpected } from '../src/index.js';
import { cleanup, pkg, repo } from './repo.js';

const get = { method: 'GET', path: '/' };
const ok = { exchanges: [{ status: 200 }] };
/** An array of `length` with only the given indexes set, and a hole at every other. */
const holed = (length: number, at: Record<number, unknown>): unknown[] => Object.assign(new Array<unknown>(length), at);

describe('readHttpScenario', () => {
  test('reads serve, port, and each exchange, and defaults readyWithinMs', () => {
    expect(readHttpScenario({ id: 's', input: { serve: ['node', 'server.js'], port: 8080, exchanges: [get] }, expected: { exchanges: [{ status: 200, json: { a: 1 } }] } })).toEqual({
      input: { serve: ['node', 'server.js'], port: 8080, readyWithinMs: 10_000, exchanges: [get] },
      expected: { exchanges: [{ status: 200, json: { a: 1 } }] },
    });
  });

  test.each([
    ['an unknown input key', { serve: ['s'], port: 80, exchanges: [get], url: 'http://x' }, ok, /input\.url/],
    ['an empty serve', { serve: [], port: 80, exchanges: [get] }, ok, /input\.serve/],
    ['port 0', { serve: ['s'], port: 0, exchanges: [get] }, ok, /input\.port/],
    ['a port past 65535', { serve: ['s'], port: 65_536, exchanges: [get] }, ok, /input\.port/],
    ['no exchanges', { serve: ['s'], port: 80, exchanges: [] }, { exchanges: [] }, /input\.exchanges/],
    ['a path that is a URL', { serve: ['s'], port: 80, exchanges: [{ method: 'GET', path: 'http://x/' }] }, ok, /input\.exchanges\[0\]\.path/],
    ['an unknown exchange key', { serve: ['s'], port: 80, exchanges: [{ ...get, host: 'x' }] }, ok, /input\.exchanges\[0\]\.host/],
    ['fewer expected responses than requests', { serve: ['s'], port: 80, exchanges: [get, get] }, ok, /expected\.exchanges has 1 entries for 2/],
    ['a status out of range', { serve: ['s'], port: 80, exchanges: [get] }, { exchanges: [{ status: 42 }] }, /expected\.exchanges\[0\]\.status/],
    ['an unknown expected key', { serve: ['s'], port: 80, exchanges: [get] }, { exchanges: [{ status: 200, bodyMatches: 'x' }] }, /bodyMatches/],
  ])('%s is refused, naming the field', (_, input, expected, field) => {
    const read = (): unknown => readHttpScenario({ id: 's', input, expected });
    expect(read).toThrow(AdapterRefusal);
    expect(read).toThrow(field);
  });

  // A hole in an array is skipped by map and forEach, so an unchecked one removes a comparison (codex-3).
  test.each([
    ['a hole in expected.exchanges', { serve: ['s'], port: 80, exchanges: [get] }, { exchanges: new Array(1) }, /expected\.exchanges\[0\]/],
    ['a hole in input.exchanges', { serve: ['s'], port: 80, exchanges: holed(3, { 0: get, 2: get }) }, { exchanges: [{ status: 200 }, { status: 200 }, { status: 200 }] }, /input\.exchanges\[1\]/],
    ['a hole in input.serve', { serve: holed(3, { 0: 'node', 2: 'x' }), port: 80, exchanges: [get] }, ok, /input\.serve/],
    ['a hole in bodyIncludes', { serve: ['s'], port: 80, exchanges: [get] }, { exchanges: [{ status: 200, bodyIncludes: holed(3, { 0: 'a', 2: 'b' }) }] }, /bodyIncludes/],
  ])('%s is refused, naming the field', (_, input, expected, field) => {
    const read = (): unknown => readHttpScenario({ id: 's', input, expected });
    expect(read).toThrow(AdapterRefusal);
    expect(read).toThrow(field);
  });

  // An expected json value JSON cannot carry would be compared as whatever JSON.stringify makes of it (codex-1).
  test.each([
    ['Infinity', Infinity],
    ['NaN', NaN],
    ['a nested undefined', { a: [undefined] }],
    ['a function', { a: () => 1 }],
  ])('an expected json holding %s is refused', (_, json) => {
    const read = (): unknown => readHttpScenario({ id: 's', input: { serve: ['s'], port: 80, exchanges: [get] }, expected: { exchanges: [{ status: 200, json }] } });
    expect(read).toThrow(AdapterRefusal);
    expect(read).toThrow(/expected\.exchanges\[0\]\.json/);
  });
});

describe('compareHttp', () => {
  const response = (status: number, body: string, headers: Record<string, string> = {}) => ({ kind: 'response' as const, status, headers, body });
  const expected: HttpExpected = { exchanges: [{ status: 200, headers: { 'Content-Type': 'application/json' }, json: { a: 1, b: [2] } }] };

  test('a matching response holds, whatever the JSON key order and header case', () => {
    const observed = { ready: true, observations: [response(200, '{ "b": [2], "a": 1 }', { 'content-type': 'application/json' })], durationMs: 1 };
    expect(compareHttp(expected, observed)).toEqual({ held: true });
  });

  test('a 200 with the wrong body does not hold, naming the exchange and field', () => {
    const observed = { ready: true, observations: [response(200, '{"a":2,"b":[2]}', { 'content-type': 'application/json' })], durationMs: 1 };
    expect(compareHttp(expected, observed)).toEqual({ held: false, mismatches: [{ field: 'exchanges[0].json', expected: '{"a":1,"b":[2]}', observed: '{"a":2,"b":[2]}' }] });
  });

  test('a server that never listened does not hold', () => {
    expect(compareHttp(ok, { ready: false, observations: [], durationMs: 1 })).toMatchObject({ held: false, mismatches: [{ field: 'ready' }] });
  });

  test('no response, and a body over the cap, do not hold', () => {
    expect(compareHttp(ok, { ready: true, observations: [{ kind: 'no-response', reason: 'socket hang up' }], durationMs: 1 })).toEqual({
      held: false, mismatches: [{ field: 'exchanges[0]', expected: 'a response with status 200', observed: 'socket hang up' }],
    });
    const oversized = { ready: true, observations: [{ kind: 'oversized' as const, status: 200, headers: {}, limitBytes: 10 }], durationMs: 1 };
    expect(compareHttp({ exchanges: [{ status: 200, bodyIncludes: ['x'] }] }, oversized)).toMatchObject({ held: false, mismatches: [{ field: 'exchanges[0].body' }] });
  });

  test('a body over the cap does not hold even when only the status is expected', () => {
    // The probe stops reading at the cap, so whether the response ever completed is unknown (codex-2).
    const oversized = { ready: true, observations: [{ kind: 'oversized' as const, status: 200, headers: {}, limitBytes: 10 }], durationMs: 1 };
    expect(compareHttp(ok, oversized)).toEqual({
      held: false, mismatches: [{ field: 'exchanges[0].body', expected: "a body within the probe's limit", observed: 'more than 10 bytes' }],
    });
  });

  test('a number past JSON\'s range is not equal to null, at the top or nested', () => {
    // JSON.parse turns 1e400 into Infinity, which JSON.stringify writes as null (codex-1).
    const at = (json: unknown, body: string) => compareHttp({ exchanges: [{ status: 200, json }] }, { ready: true, observations: [response(200, body)], durationMs: 1 });
    expect(at(null, '1e400')).toMatchObject({ held: false, mismatches: [{ field: 'exchanges[0].json' }] });
    expect(at({ a: [null] }, '{"a":[-1e400]}')).toMatchObject({ held: false, mismatches: [{ field: 'exchanges[0].json' }] });
    expect(at({ a: [null] }, '{"a":[null]}')).toEqual({ held: true });
  });
});

describe('HttpBehavioralAdapter', () => {
  test('a provider with no probe is refused at construction', () => {
    expect(() => new HttpBehavioralAdapter(new StubSandboxProvider())).toThrow(/has no probe/);
  });
});

describe('HttpBehavioralAdapter against a real sandbox', () => {
  /** A server that answers `/` with JSON and `/wrong` with a 200 whose body is not what a scenario expects. */
  const SERVER = `
    require('node:http').createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(req.url === '/wrong' ? '{"greeting":"goodbye"}' : '{"greeting":"hello"}');
    }).listen(8080);
  `;
  const scenario = (id: string, path: string) => ({
    id,
    input: { serve: ['node', '--eval', SERVER], port: 8080, exchanges: [{ method: 'GET', path }] },
    expected: { exchanges: [{ status: 200, headers: { 'content-type': 'application/json' }, json: { greeting: 'hello' } }] },
  });

  let provider: LocalDockerProvider;
  let workspace: string;
  const handles: SandboxHandle[] = [];

  async function sandbox(): Promise<SandboxHandle> {
    const h = await provider.provision({
      image: EGRESS_PROXY_IMAGE,
      mounts: { workspace: { source: workspace, target: '/workspace', mode: 'ro' }, others: [] },
      egress: { mode: 'deny-all', allow: [] },
      limits: { cpus: 0.5, memoryMb: 256, pids: 64, wallClockMs: 60_000 },
      user: { uid: 0, gid: 0 },
    });
    handles.push(h);
    return h;
  }

  beforeAll(async () => {
    // Not wrapped: no daemon is a failing suite, never a skipped one.
    provider = await LocalDockerProvider.create({ vaultPaths: [] });
    workspace = await mkdtemp(join(tmpdir(), 'adapters-http-'));
  });

  afterAll(async () => {
    for (const h of handles) await provider.destroy(h).catch(() => undefined);
    await rm(workspace, { recursive: true, force: true });
    await cleanup();
  });

  test('a set built on this provider carries the HTTP adapter', async () => {
    const set = await buildAdapterSet(await repo({ 'package.json': pkg({ vitest: '4' }) }), { provider, coverage: null });
    expect(set.behavioral.map((adapter) => adapter.kind)).toContain('http');
    expect(set.unavailableControls()).not.toContain('behavioral:http');
  });

  test('a server that answers as expected holds', async () => {
    const result = await new HttpBehavioralAdapter(provider).run(scenario('greets', '/'), await sandbox());
    expect(result).toMatchObject({ checkId: 'greets', exitCode: 0, suiteCount: null, expectation: { held: true } });
    expect(JSON.parse(result.stdout)).toMatchObject({ ready: true, observations: [{ kind: 'response', status: 200 }] });
  }, 60_000);

  test('a server that answers 200 with the wrong body does not hold, and a second scenario on the handle is refused', async () => {
    const adapter = new HttpBehavioralAdapter(provider);
    const h = await sandbox();
    const result = await adapter.run(scenario('greets-wrong', '/wrong'), h);
    expect(result.expectation).toEqual({
      held: false,
      mismatches: [{ field: 'exchanges[0].json', expected: '{"greeting":"hello"}', observed: '{"greeting":"goodbye"}' }],
    });
    await expect(adapter.run(scenario('again', '/'), h)).rejects.toThrow(/already ran an HTTP scenario/);
  }, 60_000);

  test('a server that never starts does not hold', async () => {
    const never = { ...scenario('never', '/'), input: { serve: ['sleep', '60'], port: 8080, readyWithinMs: 500, exchanges: [get] } };
    const result = await new HttpBehavioralAdapter(provider).run(never, await sandbox());
    expect(result.expectation).toMatchObject({ held: false, mismatches: [{ field: 'ready' }] });
  }, 60_000);
});
