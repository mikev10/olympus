/**
 * The driver's tests that call no model. They run on every pull request, with
 * no credential, and one that started to call a model would fail for want of
 * one (D-A-CI-05).
 *
 * The inspection tests run the pinned CLI in a real container on the real
 * image, against the capture endpoint on the sandbox's loopback (D-R26-02),
 * so what they read is the request the session would send.
 */
import { describe, expect, test } from 'vitest';
import type { TaskId } from '@olympus-ai/core';
import { DRIVER_CONTRACT_VERSION } from '@olympus-ai/core';
import type { SandboxProvider } from '@olympus-ai/sandbox';
import {
  CATALOG_WITH_PATCH,
  CATALOG_WITHOUT_PATCH,
  CLI_VERSION,
  CodexDriver,
  DECLARED_TOOLS,
  DriverRefusal,
  FAMILY,
  KEY_PLACEHOLDER,
  MODEL_METER,
  MODEL_RELAY,
  TIER_MODELS,
  TOOL_GROUPS,
  groupsFor,
  parseEvents,
  tomlString,
} from '../src/index.js';
import { PROBE_ROLE, withDriver } from './harness.js';
import { controlRequestBody, plantAll, plants } from './plants.js';

/** A provider that records every exec and runs none, for refusals that must happen before anything starts. */
function inertProvider(): { provider: SandboxProvider; execs: number } {
  const state = { execs: 0 };
  const provider = {
    id: 'inert',
    provision: () => Promise.reject(new Error('not used')),
    destroy: () => Promise.reject(new Error('not used')),
    capabilities: () => {
      throw new Error('not used');
    },
    exec: () => {
      state.execs += 1;
      return Promise.reject(new Error('an exec was attempted'));
    },
  } as unknown as SandboxProvider;
  return {
    provider,
    get execs() {
      return state.execs;
    },
  };
}

function refusalOf(body: () => unknown): Promise<DriverRefusal> {
  return Promise.resolve()
    .then(body)
    .then(
      () => {
        throw new Error('expected a refusal');
      },
      (error: unknown) => {
        if (!(error instanceof DriverRefusal)) throw error;
        return error;
      },
    );
}

describe('the driver as declared', () => {
  test('a driver with no provider, an unpriced model, or a working directory TOML cannot carry is refused at construction', async () => {
    expect((await refusalOf(() => new CodexDriver({} as unknown as { provider: never }))).layer).toBe('provider');
    const { provider } = inertProvider();
    expect((await refusalOf(() => new CodexDriver({ provider, models: { ...TIER_MODELS, fast: 'gpt-unpriced' } }))).message).toContain('MODEL_METER');
    expect((await refusalOf(() => new CodexDriver({ provider, workdir: '/work"space' }))).layer).toBe('capability');
  });

  test('the inventory is the groups, sorted, and every tool is in exactly one group', () => {
    const { provider } = inertProvider();
    const driver = new CodexDriver({ provider });
    expect(driver.declaredTools()).toStrictEqual(['apply_patch', 'create_goal', 'exec_command', 'get_goal', 'update_goal', 'view_image', 'write_stdin']);
    expect(Object.isFrozen(driver.declaredTools())).toBe(true);
    const grouped = TOOL_GROUPS.flatMap((g) => g.tools);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort((a, b) => a.localeCompare(b))).toStrictEqual([...DECLARED_TOOLS]);
    // Never declared: hosted, billed outside the meter, asking a person, or out of scope (D-R26-03).
    for (const absent of ['web_search', 'request_user_input', 'tool_search', 'spawn_agent']) expect(DECLARED_TOOLS).not.toContain(absent);
  });

  test('every capability declared false has no method behind it, and emitArtifacts refuses at the capability layer', async () => {
    const { provider } = inertProvider();
    const driver = new CodexDriver({ provider });
    expect(driver.capabilities()).toStrictEqual({ subagents: false, hooks: false, mcp: false, parallelism: 4, computerUse: false, steering: false, stablePrefixCaching: false });
    expect('spawnSubagent' in driver).toBe(false);
    expect('steer' in driver).toBe(false);
    expect((await refusalOf(() => driver.emitArtifacts([PROBE_ROLE], '/tmp/x'))).layer).toBe('capability');
    expect(driver.contractVersion).toBe(DRIVER_CONTRACT_VERSION);
    expect(driver.provenanceId()).toBe(`codex@${CLI_VERSION}`);
  });

  test('the family is the stated constant for every tier and every model map, and each model is priced with a ceiling', () => {
    const { provider } = inertProvider();
    const swapped = { fast: TIER_MODELS.deep, standard: TIER_MODELS.fast, deep: TIER_MODELS.standard };
    for (const driver of [new CodexDriver({ provider }), new CodexDriver({ provider, models: swapped })]) {
      for (const tier of ['fast', 'standard', 'deep'] as const) {
        const identity = driver.resolveModel(tier);
        expect(identity.family).toBe(FAMILY);
        expect(identity.family).toBe('openai');
        expect(identity.version).toBe(CLI_VERSION);
        expect(MODEL_METER.prices[identity.model]?.maxOutputTokens).toBe(128_000);
      }
    }
    expect(MODEL_METER.dialect).toBe('openai-responses');
    expect(MODEL_RELAY).toMatchObject({ upstream: 'https://api.openai.com', paths: ['/v1/responses'], header: 'authorization', scheme: 'bearer' });
  });

  test('a grant the driver cannot honour exactly is refused before anything runs in the sandbox', async () => {
    const inert = inertProvider();
    const driver = new CodexDriver({ provider: inert.provider });
    const base = {
      taskId: 'refused' as TaskId,
      role: PROBE_ROLE,
      stablePrefix: 'p',
      variableSuffix: 's',
      tier: 'fast' as const,
      sandbox: 'none' as never,
      timeoutMs: 1000,
      budget: { maxTokens: 1, maxCostUsd: 1, maxWallClockMs: 1 },
    };
    for (const tools of [['Bash'], ['web_search'], ['exec_command'], ['get_goal', 'create_goal'], ['mcp__server__tool']]) {
      const refusal = await refusalOf(() => driver.runTask({ ...base, tools }));
      expect(refusal.layer).toBe('grant');
    }
    expect(inert.execs).toBe(0);
  });

  test('a TOML string carries what JSON escapes, and DEL, and refuses an unpaired surrogate', async () => {
    expect(tomlString('a"b\\c\nd\u007f')).toBe('"a\\"b\\\\c\\nd\\u007f"');
    expect((await refusalOf(() => tomlString('\uD800'))).layer).toBe('invocation');
    expect(tomlString('😀')).toBe('"😀"');
  });
});

describe('the event reader is closed', () => {
  const line = (o: unknown): string => JSON.stringify(o);

  test('usage is summed over turns, file changes and commands are read, and the last message is the narrative', () => {
    const parsed = parseEvents(
      [
        line({ type: 'thread.started', thread_id: 't' }),
        line({ type: 'turn.started' }),
        line({ type: 'item.started', item: { id: 'a', type: 'command_execution', command: 'ls', exit_code: null } }),
        line({ type: 'item.completed', item: { id: 'a', type: 'command_execution', command: 'ls', exit_code: 0 } }),
        line({ type: 'item.completed', item: { id: 'b', type: 'file_change', changes: [{ path: '/workspace/x', kind: 'add' }] } }),
        line({ type: 'item.completed', item: { id: 'c', type: 'agent_message', text: 'first' } }),
        line({ type: 'item.completed', item: { id: 'd', type: 'agent_message', text: 'last' } }),
        line({ type: 'turn.completed', usage: { input_tokens: 10, cached_input_tokens: 4, output_tokens: 2 } }),
        line({ type: 'turn.completed', usage: { input_tokens: 5, cached_input_tokens: 1, output_tokens: 1 } }),
      ].join('\n'),
    );
    expect(parsed.threadId).toBe('t');
    expect(parsed.commands).toStrictEqual([{ command: 'ls', exitCode: 0 }]);
    expect(parsed.changedPaths).toStrictEqual(['/workspace/x']);
    expect(parsed.messages.at(-1)).toBe('last');
    expect(parsed.usage).toStrictEqual({ inputTokens: 15, cachedInputTokens: 5, cacheWriteTokens: 0, outputTokens: 3 });
    expect(parsed.unknown).toStrictEqual([]);
  });

  test('a session with no thread id, or a turn with absent or invalid usage, is unreadable rather than a completed zero-usage turn (codex-4)', () => {
    const cases = [
      [line({ type: 'thread.started' }), line({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } })],
      [line({ type: 'thread.started', thread_id: '' }), line({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } })],
      [line({ type: 'thread.started', thread_id: 't' }), line({ type: 'turn.completed' })],
      [line({ type: 'thread.started', thread_id: 't' }), line({ type: 'turn.completed', usage: { input_tokens: 'many', output_tokens: 1 } })],
      [line({ type: 'thread.started', thread_id: 't' }), line({ type: 'turn.completed', usage: { input_tokens: 1 } })],
      [line({ type: 'thread.started', thread_id: 't' }), line({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: -1 } })],
    ];
    for (const lines of cases) {
      const parsed = parseEvents(lines.join('\n'));
      expect(parsed.unreadable.length, lines.join(' ')).toBe(1);
    }
    // Optional counts the CLI may omit stay optional; the two the meter is held to do not.
    const minimal = parseEvents([line({ type: 'thread.started', thread_id: 't' }), line({ type: 'turn.completed', usage: { input_tokens: 3, output_tokens: 2 } })].join('\n'));
    expect(minimal.unreadable).toStrictEqual([]);
    expect(minimal.usage).toStrictEqual({ inputTokens: 3, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 2 });
  });

  test('an item from a tool nobody granted, an unnamed event, an unreadable line, and a reroute are each recorded', () => {
    const parsed = parseEvents(
      [
        line({ type: 'item.completed', item: { id: 'w', type: 'web_search', query: 'x' } }),
        line({ type: 'item.completed', item: { id: 'm', type: 'mcp_tool_call' } }),
        line({ type: 'session.configured' }),
        'not json',
        line({ type: 'item.completed', item: { id: 'e', type: 'error', message: 'model rerouted: gpt-5.6-luna -> gpt-other' } }),
        line({ type: 'turn.failed', error: { message: 'boom' } }),
      ].join('\n'),
    );
    expect(parsed.unknown).toStrictEqual(['item:web_search', 'item:mcp_tool_call', 'event:session.configured']);
    expect(parsed.unreadable).toStrictEqual(['not json']);
    expect(parsed.reroute).toBe('gpt-other');
    expect(parsed.failures).toStrictEqual(['boom']);
  });
});

describe('the inspection reads the request the session would send (D-R26-02)', () => {
  test('for every grant shape the request offers exactly the grant, names the resolved model, and carries the placeholder', async () => {
    await withDriver({ relay: false }, async (h) => {
      const shapes: string[][] = [
        [],
        ['exec_command', 'write_stdin'],
        ['apply_patch'],
        ['view_image'],
        ['get_goal', 'create_goal', 'update_goal'],
        [...DECLARED_TOOLS],
      ];
      for (const [i, tools] of shapes.entries()) {
        expect('groups' in groupsFor(tools)).toBe(true);
        const inspection = await h.driver.inspect(h.request({ taskId: `shape-${String(i)}` as TaskId, tools }));
        expect([...inspection.tools].sort((a, b) => a.localeCompare(b))).toStrictEqual([...tools].sort((a, b) => a.localeCompare(b)));
        expect(inspection.model).toBe(TIER_MODELS.fast);
        expect(inspection.authorization).toBe(`Bearer ${KEY_PLACEHOLDER}`);
      }
      // Each tier's model is the one the request names.
      for (const tier of ['standard', 'deep'] as const) {
        expect((await h.driver.inspect(h.request({ taskId: `tier-${tier}` as TaskId, tier }))).model).toBe(TIER_MODELS[tier]);
      }
    });
  });

  test("a session that would offer a tool nobody granted is refused, and the catalogs that decide apply_patch are not the task's to rewrite", async () => {
    await withDriver({ relay: false }, async (h) => {
      const writable = await h.provider.exec(h.handle, ['sh', '-c', 'for f in /opt/codex/*.json; do test -w "$f" && echo "$f"; done; true']);
      expect(writable.stdout.trim()).toBe('');
      const widening: SandboxProvider = {
        id: h.provider.id,
        provision: (x) => h.provider.provision(x),
        destroy: (x) => h.provider.destroy(x),
        capabilities: () => h.provider.capabilities(),
        exec: (x, cmd, o) => h.provider.exec(x, cmd.map((arg) => arg.replace(CATALOG_WITHOUT_PATCH, CATALOG_WITH_PATCH)), o),
      };
      const driver = new CodexDriver({ provider: widening, workdir: '/workspace' });
      const refusal = await refusalOf(() => driver.inspect(h.request({ taskId: 'widened' as TaskId, tools: [] })));
      expect(refusal.layer).toBe('grant');
      expect(refusal.message).toContain('apply_patch');
    });
  });

  test("the role's instructions and the stable prefix reach the request on the argv, and the variable suffix is the prompt (D-R26-08)", async () => {
    await withDriver({ relay: false }, async (h) => {
      const suffix = `Suffix ${crypto.randomUUID()}`;
      const inspection = await h.driver.inspect(h.request({ taskId: 'context' as TaskId, variableSuffix: suffix }));
      expect(inspection.body).toContain(PROBE_ROLE.instructions);
      expect(inspection.body).toContain(h.stablePrefix);
      expect(inspection.body).toContain(suffix);
    });
  });

  test('no planted instruction source reaches the request, while the same invocation without the driver settings reads them', async () => {
    await withDriver({ relay: false }, async (h) => {
      const set = plants();
      await plantAll(h, set);
      const inspection = await h.driver.inspect(h.request({ taskId: 'plants' as TaskId, tools: [...DECLARED_TOOLS] }));
      for (const p of set) expect(inspection.body, p.path).not.toContain(p.token);
      // The control: the plants are where the pinned CLI reads (R23).
      const control = await controlRequestBody(h, [...DECLARED_TOOLS]);
      const seen = set.filter((p) => control.includes(p.token)).map((p) => p.path);
      expect(seen).toEqual(expect.arrayContaining(['AGENTS.override.md', '.agents/skills/plant/SKILL.md', '.codex/skills/plant-codex/SKILL.md']));
    });
  });
});
