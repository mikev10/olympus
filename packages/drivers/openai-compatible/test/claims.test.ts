/**
 * The seven `driver.*` capability claims, as this driver makes them
 * (D-R6-06), each asserted under its own id, `driver.<key>.openai-compatible`,
 * beside the Claude Code driver's assertion of the same claim.
 *
 * Six are `false`, and a `false` needs an assertion as much as a `true` does:
 * each proves the capability absent, so a driver that grew one without
 * declaring it fails here. `parallelism` is a number, proven by running one
 * more task than it and watching one wait.
 *
 * They require Docker and `openssl`, call no model, and never skip.
 */
import { readdir } from 'node:fs/promises';
import { expect } from 'vitest';
import { invariantTest } from '@olympus-ai/conformance/vitest';
import type { RoleId, TaskId } from '@olympus-ai/core';
import { DECLARED_TOOLS, DriverRefusal } from '../src/index.js';
import { script } from './endpoint.js';
import { CONFIG, WORKDIR, modelCalls, mostAtOnce, withHarness } from './harness.js';

async function refusalOf(action: () => unknown): Promise<DriverRefusal> {
  try {
    await action();
  } catch (error) {
    if (error instanceof DriverRefusal) return error;
    throw error;
  }
  throw new Error('expected a DriverRefusal, and nothing was refused');
}

/** Every key anywhere in a JSON value, at any depth. */
function keysIn(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const item of value) keysIn(item, into);
  else if (typeof value === 'object' && value !== null) {
    for (const [key, inner] of Object.entries(value)) {
      into.add(key);
      keysIn(inner, into);
    }
  }
  return into;
}

invariantTest(
  'driver.subagents.openai-compatible',
  'subagents is declared false and absent: there is no spawnSubagent(), and a model call naming a subagent tool is answered with an error and runs nothing',
  async () => {
    await withHarness(async (h) => {
      expect(h.driver.capabilities().subagents).toBe(false);
      expect('spawnSubagent' in h.driver).toBe(false);
      const { handle } = await h.sandbox();
      const result = await h.driver.runTask(
        h.request(handle, { taskId: 'sub' as TaskId, tools: [...DECLARED_TOOLS], variableSuffix: script([{ calls: [{ name: 'Task', arguments: { prompt: 'x' } }] }, { content: 'done' }]) }),
      );
      expect(result.events.map((e) => e.detail)).toStrictEqual([{ tool: 'Task', refused: true }]);
      expect(h.execs.filter((e) => e.argv[0] !== 'node')).toStrictEqual([]);
    });
  },
);

invariantTest(
  'driver.hooks.openai-compatible',
  'hooks is declared false and absent: emitArtifacts refuses at the capability layer and writes nothing, so no hook point exists to fire',
  async () => {
    await withHarness(async (h) => {
      expect(h.driver.capabilities().hooks).toBe(false);
      const { workspace } = await h.sandbox();
      const refused = await refusalOf(() => h.driver.emitArtifacts([{ role: 'builder' as RoleId, instructions: 'x', sha256: '0'.repeat(64) }], `${WORKDIR}/.agents`));
      expect(refused.layer).toBe('capability');
      expect(await readdir(workspace)).toStrictEqual([]);
      expect(h.execs).toStrictEqual([]);
    });
  },
);

invariantTest(
  'driver.mcp.openai-compatible',
  'mcp is declared false and absent: a grant naming an MCP tool is refused before anything runs, and no request offers one',
  async () => {
    await withHarness(async (h) => {
      expect(h.driver.capabilities().mcp).toBe(false);
      const { handle } = await h.sandbox();
      const refused = await refusalOf(() => h.driver.runTask(h.request(handle, { tools: ['mcp__files__read'] })));
      expect(refused.layer).toBe('grant');
      expect(h.execs).toStrictEqual([]);
      expect(DECLARED_TOOLS.some((tool) => tool.startsWith('mcp__'))).toBe(false);
    });
  },
);

invariantTest(
  'driver.parallelism.openai-compatible',
  'the driver runs the declared number of tasks concurrently, each on its own sandbox: two overlap, a third waits for a slot, and a second task on one sandbox waits for the first',
  async () => {
    await withHarness(async (h) => {
      expect(h.driver.capabilities().parallelism).toBe(CONFIG.parallelism);
      expect(CONFIG.parallelism).toBe(2);
      const held = script([{ content: 'done', hold: 3000 }]);
      const sandboxes = await Promise.all([h.sandbox(), h.sandbox(), h.sandbox()]);
      await Promise.all(sandboxes.map((s, i) => h.driver.runTask(h.request(s.handle, { taskId: `par-${String(i)}` as TaskId, variableSuffix: held }))));
      const across = modelCalls(h.execs);
      expect(across).toHaveLength(3);
      // Two at once, never three: the bound is reached and held.
      expect(mostAtOnce(across)).toBe(2);

      // One sandbox: two tasks never overlap, whatever the bound says.
      h.execs.splice(0);
      const one = sandboxes[0];
      await Promise.all([0, 1].map((i) => h.driver.runTask(h.request(one.handle, { taskId: `same-${String(i)}` as TaskId, variableSuffix: held }))));
      expect(mostAtOnce(modelCalls(h.execs))).toBe(1);
    });
  },
);

invariantTest(
  'driver.computerUse.openai-compatible',
  'computerUse is declared false and absent: no declared tool drives a display, and a task granted the whole inventory is offered exactly Bash, Edit, Read, and Write',
  async () => {
    await withHarness(async (h) => {
      expect(h.driver.capabilities().computerUse).toBe(false);
      const { handle } = await h.sandbox();
      await h.driver.runTask(h.request(handle, { tools: [...DECLARED_TOOLS] }));
      const [request] = await h.received();
      const offered = (request?.body.tools as Array<{ function: { name: string } }>).map((t) => t.function.name);
      expect(offered).toStrictEqual(['Bash', 'Edit', 'Read', 'Write']);
    });
  },
);

invariantTest(
  'driver.steering.openai-compatible',
  'steering is declared false and there is no steer(): a running task has no runtime message channel',
  () => {
    return withHarness((h) => {
      expect(h.driver.capabilities().steering).toBe(false);
      expect('steer' in h.driver).toBe(false);
      return Promise.resolve();
    });
  },
);

invariantTest(
  'driver.stablePrefixCaching.openai-compatible',
  'stablePrefixCaching is declared false: no request marks a prefix for caching, and the cached tokens a result reports are the endpoint\'s own count and nothing the driver claims',
  async () => {
    await withHarness(async (h) => {
      expect(h.driver.capabilities().stablePrefixCaching).toBe(false);
      const { handle } = await h.sandbox();
      const result = await h.driver.runTask(
        h.request(handle, { tools: [...DECLARED_TOOLS], variableSuffix: script([{ content: 'done', usage: { prompt: 1000, completion: 10, cached: 600 } }]) }),
      );
      const [request] = await h.received();
      const keys = keysIn(request?.body);
      expect([...keys].filter((key) => /cache/iu.test(key))).toStrictEqual([]);
      expect(result.usage).toMatchObject({ inputTokens: 400, cacheReadTokens: 600, cacheWriteTokens: 0, outputTokens: 10 });
    });
  },
);
