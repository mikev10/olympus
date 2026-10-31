/**
 * The capability claims (I8): one assertion per key of `DriverCapabilities`,
 * `driver.<key>.codex`, each comparing what `capabilities()` declares with
 * what the pinned CLI's session actually holds (D-R26-07).
 *
 * Every one reads the request the session would send through the inspection
 * (D-R26-02), on the real image, so none of them calls a model.
 */
import { expect } from 'vitest';
import { invariantTest } from '@olympus-ai/conformance/vitest';
import type { TaskId } from '@olympus-ai/core';
import type { SandboxHandle } from '@olympus-ai/sandbox';
import { CodexDriver, DECLARED_TOOLS, DriverRefusal, PARALLELISM, cliArgs, groupsFor } from '../src/index.js';
import { PROBE_ROLE, WORKDIR, withDriver } from './harness.js';

/** Every tool name the session would offer with the whole inventory granted. */
async function offeredWithEverything(): Promise<readonly string[]> {
  return withDriver({ relay: false }, async (h) => (await h.driver.inspect(h.request({ taskId: 'everything' as TaskId, tools: [...DECLARED_TOOLS] }))).tools);
}

invariantTest(
  'driver.subagents.codex',
  'subagents is declared false and absent: there is no spawnSubagent(), and a session granted the whole inventory offers no multi-agent tool',
  async () => {
    const driver = new CodexDriver({ provider: {} as never });
    expect(driver.capabilities().subagents).toBe(false);
    expect('spawnSubagent' in driver).toBe(false);
    const offered = await offeredWithEverything();
    expect(offered.filter((t) => /agent|spawn|collab/iu.test(t))).toStrictEqual([]);
  },
);

invariantTest(
  'driver.hooks.codex',
  'hooks is declared false and absent: emitArtifacts refuses at the capability layer and writes nothing, and every session runs with the hooks feature off',
  async () => {
    const driver = new CodexDriver({ provider: {} as never });
    expect(driver.capabilities().hooks).toBe(false);
    const refusal: unknown = await driver.emitArtifacts([PROBE_ROLE], '/tmp/artifacts').catch((e: unknown) => e);
    expect(refusal).toBeInstanceOf(DriverRefusal);
    expect((refusal as DriverRefusal).layer).toBe('capability');
    const result = groupsFor([...DECLARED_TOOLS]);
    if ('refusal' in result) throw new Error(result.refusal);
    const args = cliArgs(WORKDIR, 'gpt-5.6-luna', {
      taskId: 't' as TaskId, role: PROBE_ROLE, stablePrefix: 'p', variableSuffix: 's', tier: 'fast', tools: [...DECLARED_TOOLS],
      sandbox: 'none' as never, timeoutMs: 1, budget: { maxTokens: 1, maxCostUsd: 1, maxWallClockMs: 1 },
    }, result.groups);
    expect(args.some((arg, i) => arg === '--disable' && args[i + 1] === 'hooks')).toBe(true);
  },
);

invariantTest(
  'driver.mcp.codex',
  'mcp is declared false and absent: a grant naming an MCP tool is refused before anything runs, and a session granted the whole inventory offers no MCP tool',
  async () => {
    await withDriver({ relay: false }, async (h) => {
      expect(h.driver.capabilities().mcp).toBe(false);
      const before = h.execs.length;
      const refusal: unknown = await h.driver.runTask(h.request({ taskId: 'mcp' as TaskId, tools: ['mcp__server__tool'] })).catch((e: unknown) => e);
      expect((refusal as DriverRefusal).layer).toBe('grant');
      expect(h.execs.length).toBe(before);
      const offered = (await h.driver.inspect(h.request({ taskId: 'mcp-all' as TaskId, tools: [...DECLARED_TOOLS] }))).tools;
      expect(offered.filter((t) => t.startsWith('mcp') || t.startsWith('type:mcp'))).toStrictEqual([]);
    });
  },
);

invariantTest(
  'driver.parallelism.codex',
  'the driver runs the declared number of tasks concurrently, each on its own sandbox: four overlap, a fifth waits for a slot, and a second task on one sandbox waits for the first',
  async () => {
    await withDriver({ relay: false }, async (h) => {
      expect(h.driver.capabilities().parallelism).toBe(PARALLELISM);
      const sandboxes = [h.handle, ...(await h.provisionMore(PARALLELISM))];
      let running = 0;
      let peak = 0;
      const perSandbox = new Map<SandboxHandle, number>();
      let perSandboxPeak = 0;
      h.observeExec((sandbox) => {
        running += 1;
        peak = Math.max(peak, running);
        const now = (perSandbox.get(sandbox) ?? 0) + 1;
        perSandbox.set(sandbox, now);
        perSandboxPeak = Math.max(perSandboxPeak, now);
        return () => {
          running -= 1;
          perSandbox.set(sandbox, (perSandbox.get(sandbox) ?? 1) - 1);
        };
      });
      // One more task than the bound, across sandboxes, and a second task on the first sandbox.
      const requests = [...sandboxes.map((sandbox, i) => h.request({ taskId: `p-${String(i)}` as TaskId, sandbox })), h.request({ taskId: 'p-again' as TaskId })];
      await Promise.all(requests.map((r) => h.driver.inspect(r)));
      expect(peak).toBe(PARALLELISM);
      expect(perSandboxPeak).toBe(1);
    });
  },
);

invariantTest(
  'driver.computerUse.codex',
  'computerUse is declared false and absent: no declared tool drives a display, and a session granted the whole inventory offers exactly the declared tools',
  async () => {
    const driver = new CodexDriver({ provider: {} as never });
    expect(driver.capabilities().computerUse).toBe(false);
    expect(DECLARED_TOOLS.some((t) => /computer|screen|display|mouse|keyboard|browser/iu.test(t))).toBe(false);
    const offered = await offeredWithEverything();
    expect([...offered].sort((a, b) => a.localeCompare(b))).toStrictEqual([...DECLARED_TOOLS]);
  },
);

invariantTest(
  'driver.steering.codex',
  'steering is declared false and there is no steer(): a running task has no runtime message channel',
  () => {
    const driver = new CodexDriver({ provider: {} as never });
    expect(driver.capabilities().steering).toBe(false);
    expect('steer' in driver).toBe(false);
  },
);

invariantTest(
  'driver.stablePrefixCaching.codex',
  'stablePrefixCaching is declared false: two tasks sharing one stable prefix send different prompt_cache_key values, so a second reading the first one\'s prefix from cache is not something the driver can promise',
  async () => {
    await withDriver({ relay: false }, async (h) => {
      expect(h.driver.capabilities().stablePrefixCaching).toBe(false);
      const keys: unknown[] = [];
      for (const taskId of ['cache-1', 'cache-2']) {
        const body = JSON.parse((await h.driver.inspect(h.request({ taskId: taskId as TaskId }))).body) as Record<string, unknown>;
        keys.push(body.prompt_cache_key);
      }
      expect(typeof keys[0]).toBe('string');
      expect(keys[0]).not.toBe(keys[1]);
    });
  },
);
