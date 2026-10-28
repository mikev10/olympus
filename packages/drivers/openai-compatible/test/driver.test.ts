/**
 * The driver's own behaviour beyond the registry's assertions: the
 * configuration it refuses, the answers it refuses, and the tool errors a
 * model reads and recovers from. Docker and `openssl` where a sandbox is
 * needed; no model is called.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import type { TaskId } from '@olympus-ai/core';
import { LocalDockerProvider, checkRelay } from '@olympus-ai/sandbox';
import { DriverRefusal, ENDPOINT_CREDENTIAL, OpenAICompatibleDriver, RELAY_URL_VARIABLE, checkConfig, type EndpointConfig } from '../src/index.js';
import { script } from './endpoint.js';
import { BUDGET, CONFIG, withHarness } from './harness.js';

async function refusalOf(action: () => unknown): Promise<DriverRefusal> {
  try {
    await action();
  } catch (error) {
    if (error instanceof DriverRefusal) return error;
    throw error;
  }
  throw new Error('expected a DriverRefusal, and nothing was refused');
}

describe('the configuration is the operator\'s, stated in full (D-R6-02)', () => {
  test('a complete configuration is accepted as written and frozen', () => {
    const checked = checkConfig(CONFIG);
    expect(checked).toStrictEqual(CONFIG);
    expect(Object.isFrozen(checked)).toBe(true);
  });

  test.each<[string, Partial<Record<keyof EndpointConfig, unknown>> | Record<string, unknown>, string]>([
    ['an http origin', { upstream: 'http://endpoint.test' }, 'upstream'],
    ['an origin with a path', { upstream: 'https://endpoint.test/v1' }, 'upstream'],
    ['a path that is not chat completions', { path: '/v1/completions' }, 'path'],
    ['a path with a dot segment', { path: '/v1/../chat/completions' }, 'path'],
    ['an unknown scheme', { scheme: 'basic' }, 'scheme'],
    ['a header that is not one', { header: 'x api key' }, 'header'],
    ['a tier with no model', { models: { fast: 'test-fast', standard: 'test-standard' } }, 'models.deep'],
    ['a tier that is not one', { models: { ...CONFIG.models, huge: 'x' } }, 'huge'],
    ['a model with no price', { prices: { 'test-fast': CONFIG.prices['test-fast'], 'test-standard': CONFIG.prices['test-standard'] } }, 'models.deep'],
    ['a negative price', { prices: { ...CONFIG.prices, 'test-deep': { ...CONFIG.prices['test-deep'], outputPerMTok: -1 } } }, 'outputPerMTok'],
    ['a zero ceiling', { maxOutputTokens: 0 }, 'maxOutputTokens'],
    ['an unknown ceiling field', { ceilingField: 'max_output_tokens' }, 'ceilingField'],
    ['a fractional parallelism', { parallelism: 1.5 }, 'parallelism'],
    ['no turn bound', { maxTurns: undefined }, 'maxTurns'],
    ['a field the driver does not read', { temperature: 0 }, 'temperature'],
    // A-R21-04: local is a declaration, never a URL, and only a local endpoint may take no credential.
    ['localhost over http', { upstream: 'http://localhost:11434' }, 'upstream'],
    ['the none scheme with an https endpoint', { scheme: 'none' }, "scheme 'none'"],
    ['a local upstream on port 0', { upstream: { local: 'docker-host', port: 0 }, scheme: 'none' }, 'upstream.port'],
    ['a local upstream with its port as text', { upstream: { local: 'docker-host', port: '11434' }, scheme: 'none' }, 'upstream.port'],
    ['a local upstream other than the Docker host', { upstream: { local: 'lan', port: 11434 }, scheme: 'none' }, 'upstream.local'],
    ['a local upstream naming a host', { upstream: { local: 'docker-host', port: 11434, host: 'gpu.lan' }, scheme: 'none' }, "'host'"],
  ])('%s is refused, naming the field', async (_label, change, field) => {
    const refused = await refusalOf(() => checkConfig({ ...CONFIG, ...change }));
    expect(refused.layer).toBe('configuration');
    expect(refused.message).toContain(field);
  });

  test('a local endpoint with no credential is accepted, and its relay request is one the relay takes with nothing held (A-R21-04)', async () => {
    const local: EndpointConfig = { ...CONFIG, upstream: { local: 'docker-host', port: 11434 }, scheme: 'none' };
    expect(checkConfig(local)).toStrictEqual(local);
    // A key is still allowed to a local endpoint that asks for one.
    expect(checkConfig({ ...local, scheme: 'bearer' }).scheme).toBe('bearer');
    const provider = await LocalDockerProvider.create({ vaultPaths: [], dockerHostPorts: [11434] });
    const request = new OpenAICompatibleDriver({ provider, endpoint: local }).relayRequest();
    expect(request).toStrictEqual({
      upstream: { local: 'docker-host', port: 11434 },
      paths: [CONFIG.path],
      header: 'authorization',
      scheme: 'none',
      credential: null,
      urlVariable: RELAY_URL_VARIABLE,
      meter: { dialect: 'openai-chat', prices: CONFIG.prices },
    });
    expect(checkRelay({ ...request, budget: { maxTokens: 1, maxCostUsd: 1 } }, new Set(), new Set([11434])).credential).toBeNull();
  });

  test('the relay request is the endpoint, its one path, the declared scheme, and the openai-chat meter', () => {
    return withHarness((h) => {
      expect(h.driver.relayRequest()).toStrictEqual({
        upstream: CONFIG.upstream,
        paths: [CONFIG.path],
        header: 'authorization',
        scheme: 'bearer',
        credential: ENDPOINT_CREDENTIAL,
        urlVariable: RELAY_URL_VARIABLE,
        meter: { dialect: 'openai-chat', prices: CONFIG.prices },
      });
      return Promise.resolve();
    });
  });
});

describe('what the endpoint answers, read strictly', () => {
  test('an answer with no usage, an error status, and a spent budget each refuse the task at their own layer', async () => {
    await withHarness(async (h) => {
      const { handle } = await h.sandbox();
      const noUsage = await refusalOf(() => h.driver.runTask(h.request(handle, { taskId: 'no-usage' as TaskId, variableSuffix: script([{ content: 'x', usage: false }]) })));
      expect(noUsage.layer).toBe('endpoint');
      expect(noUsage.message).toContain('D-R6-05');
      // The relay charged that call its ceiling and stopped forwarding, so the next is refused by the budget.
      const spent = await refusalOf(() => h.driver.runTask(h.request(handle, { taskId: 'after' as TaskId })));
      expect(spent.layer).toBe('budget');

      const fresh = await h.sandbox();
      const failed = await refusalOf(() => h.driver.runTask(h.request(fresh.handle, { taskId: 'status' as TaskId, variableSuffix: script([{ status: 503 }]) })));
      expect(failed.layer).toBe('endpoint');
      expect(failed.message).toContain('503');
    });
  });

  test('a task that does not finish within maxTurns is refused, and the ceiling is sent in the configured field', async () => {
    await withHarness(
      async (h) => {
        const { handle } = await h.sandbox();
        const loop = script(Array.from({ length: 5 }, () => ({ calls: [{ name: 'Read', arguments: { path: '/etc/hostname' } }] })));
        const refused = await refusalOf(() => h.driver.runTask(h.request(handle, { tools: ['Read'], variableSuffix: loop })));
        expect(refused.layer).toBe('invocation');
        expect(refused.message).toContain('maxTurns');
        const sent = await h.received();
        expect(sent).toHaveLength(3);
        expect(sent.every((r) => r.body.max_completion_tokens === 128 && !('max_tokens' in r.body))).toBe(true);
      },
      { ...CONFIG, maxTurns: 3, maxOutputTokens: 128, ceilingField: 'max_completion_tokens' },
    );
  });

  test('usage is summed over every turn and priced from the operator\'s table', async () => {
    await withHarness(async (h) => {
      const { handle } = await h.sandbox();
      const result = await h.driver.runTask(
        h.request(handle, {
          tools: ['Read'],
          variableSuffix: script([
            { calls: [{ name: 'Read', arguments: { path: '/etc/hostname' } }], usage: { prompt: 1000, completion: 50, cached: 200 } },
            { content: 'done', usage: { prompt: 2000, completion: 100, cached: 1000 } },
          ]),
        }),
      );
      expect(result.usage).toMatchObject({ inputTokens: 1800, cacheReadTokens: 1200, cacheWriteTokens: 0, outputTokens: 150 });
      expect(result.usage.costUsd).toBeCloseTo((1800 * 1 + 1200 * 0.5 + 150 * 10) / 1e6, 12);
      expect(result.model.family).toBe(CONFIG.family);
      expect(result.taskId).toBe('task');
    });
  });
});

describe('tool errors go back to the model, and the task goes on', () => {
  test('bad arguments, a missing file, and an edit that does not match once are each an error the model reads', async () => {
    await withHarness(async (h) => {
      const { handle, workspace } = await h.sandbox();
      const result = await h.driver.runTask(
        h.request(handle, {
          tools: ['Edit', 'Read', 'Write'],
          variableSuffix: script([
            { calls: [{ name: 'Write', arguments: '{not json' }, { name: 'Read', arguments: { path: 'missing.txt' } }] },
            { calls: [{ name: 'Write', arguments: { path: 'twice.txt', content: 'aa' } }, { name: 'Edit', arguments: { path: 'twice.txt', old_string: 'a', new_string: 'b' } }] },
            { content: 'recovered' },
          ]),
        }),
      );
      expect(result.claim.narrative).toBe('recovered');
      expect(await readFile(join(workspace, 'twice.txt'), 'utf8')).toBe('aa');
      const last = (await h.received()).at(-1);
      const errors = ((last?.body.messages ?? []) as Array<{ role: string; content: string }>).filter((m) => m.role === 'tool').map((m) => m.content);
      expect(errors[0]).toContain('not a JSON object');
      expect(errors[1]).toMatch(/^error: reading \/workspace\/missing\.txt failed/u);
      expect(errors[3]).toContain('occurs 2 times');
    });
  });

  test('a cancelled task is refused at its next turn', async () => {
    await withHarness(async (h) => {
      const { handle } = await h.sandbox();
      const running = h.driver.runTask(
        h.request(handle, { taskId: 'cancel' as TaskId, tools: ['Read'], variableSuffix: script([{ calls: [{ name: 'Read', arguments: { path: '/etc/hostname' } }], hold: 2000 }, { content: 'too late' }]) }),
      );
      await new Promise((done) => setTimeout(done, 500));
      await h.driver.cancel('cancel' as TaskId);
      const refused = await refusalOf(() => running);
      expect(refused.layer).toBe('invocation');
      expect(refused.message).toContain('cancelled');
      expect(BUDGET.maxWallClockMs).toBeGreaterThan(0);
    });
  });
});
