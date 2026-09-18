/**
 * The driver's own suite: everything provable without a container and without
 * a model call.
 *
 * Nothing here is a registry assertion. These are the ordinary tests that keep
 * the parts the expensive assertions depend on honest — the argv the driver
 * builds, the refusals it makes before it spends anything, and the reading of
 * a stream that is recorded rather than produced. The recorded lines are real
 * output from the pinned CLI version, trimmed.
 */
import { describe, expect, test } from 'vitest';
import type { SandboxHandle, SandboxProvider, SandboxSpec } from '@olympus-ai/sandbox';
import type { Budget, TaskId, TaskRequest } from '@olympus-ai/core';
import {
  CREDENTIAL_VARIABLE,
  ClaudeCodeDriver,
  DriverRefusal,
  artifactFiles,
  eventsFrom,
  mcpServerOf,
  parseStream,
  sessionIdFor,
  shellQuote,
  writeFileScript,
  DECLARED_TOOLS,
} from '../src/index.js';

const HANDLE = 'sandbox-1' as SandboxHandle;
const CREDENTIAL = 'sk-ant-test-not-a-real-key';

/** Records every exec instead of running one. Nothing in this file starts a process. */
class RecordingProvider implements SandboxProvider {
  readonly id = 'recording';
  readonly calls: Array<{ cmd: string[]; env: Readonly<Record<string, string>> | undefined }> = [];
  stdout = '';
  exitCode = 0;

  provision(_spec: SandboxSpec): Promise<SandboxHandle> {
    return Promise.resolve(HANDLE);
  }

  exec(_h: SandboxHandle, cmd: string[], options?: { env?: Readonly<Record<string, string>> }): Promise<{ exitCode: number; stdout: string; stderr: string; durationMs: number }> {
    this.calls.push({ cmd, env: options?.env });
    return Promise.resolve({ exitCode: this.exitCode, stdout: this.stdout, stderr: '', durationMs: 5 });
  }

  destroy(_h: SandboxHandle): Promise<void> {
    return Promise.resolve();
  }

  capabilities(): { computerUse: boolean; gpu: boolean; os: 'linux'; persistent: boolean; remote: boolean } {
    return { computerUse: false, gpu: false, os: 'linux', persistent: true, remote: false };
  }
}

const BUDGET: Budget = { maxTokens: 1000, maxCostUsd: 0.5, maxWallClockMs: 60_000 };

function request(overrides: Partial<TaskRequest> = {}): TaskRequest {
  return {
    taskId: 'task-1' as TaskId,
    role: 'builder' as TaskRequest['role'],
    stablePrefix: 'the invariant half',
    variableSuffix: 'this task only',
    tier: 'standard',
    tools: ['Read'],
    sandbox: HANDLE,
    timeoutMs: 60_000,
    budget: BUDGET,
    ...overrides,
  };
}

/** A minimal stream that satisfies every refusal, so a test can vary one thing. */
function stream(parts: { tools?: string[]; usage?: Record<string, number>; extra?: string[] } = {}): string {
  const init = {
    type: 'system',
    subtype: 'init',
    session_id: '11111111-2222-5333-a444-555566667777',
    tools: parts.tools ?? ['Read'],
    mcp_servers: [],
    agents: ['claude'],
    model: 'claude-sonnet-5',
    apiKeySource: CREDENTIAL_VARIABLE,
    claude_code_version: '2.1.277',
  };
  const result = {
    type: 'result',
    subtype: 'success',
    is_error: false,
    num_turns: 1,
    result: 'done',
    total_cost_usd: 0.01,
    duration_ms: 1234,
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 7, ...parts.usage },
  };
  return [JSON.stringify(init), ...(parts.extra ?? []), JSON.stringify(result)].join('\n');
}

function driverWith(provider: RecordingProvider, options: Record<string, unknown> = {}): ClaudeCodeDriver {
  return new ClaudeCodeDriver({ provider, credential: CREDENTIAL, ...options });
}

/**
 * The exec that ran the task, rather than the MCP inspection that may precede
 * it. The inspection carries no prompt, so the task is the one that does.
 */
function taskCall(provider: RecordingProvider): { cmd: string[]; env: Readonly<Record<string, string>> | undefined } | undefined {
  return provider.calls.find((call) => call.cmd.includes('--append-system-prompt'));
}

describe('construction', () => {
  test('a driver without a provider cannot be constructed (I1)', () => {
    // The type forbids this; the cast is the untyped caller the refusal exists for.
    const construct = (): ClaudeCodeDriver => new ClaudeCodeDriver({ credential: CREDENTIAL } as unknown as { provider: SandboxProvider });
    expect(construct).toThrow(DriverRefusal);
    try {
      construct();
    } catch (error) {
      expect((error as DriverRefusal).layer).toBe('provider');
    }
  });

  test('a driver without a credential refuses at construction, not at the first task (I5)', () => {
    const saved = process.env[CREDENTIAL_VARIABLE];
    // The variable is emptied rather than removed: `delete` on a computed key
    // is the one form the lint rules refuse, and an empty value is the same
    // refusal path.
    process.env[CREDENTIAL_VARIABLE] = '';
    try {
      expect(() => new ClaudeCodeDriver({ provider: new RecordingProvider() })).toThrow(/no credential/);
    } finally {
      process.env[CREDENTIAL_VARIABLE] = saved ?? '';
    }
  });
});

describe('the invocation', () => {
  test('every command goes through the provider, and none of them is the host (I1)', async () => {
    const provider = new RecordingProvider();
    provider.stdout = stream();
    await driverWith(provider).runTask(request());
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.cmd).toContain('claude');
  });

  test('the credential travels as an environment value and appears in no argument', async () => {
    const provider = new RecordingProvider();
    provider.stdout = stream();
    await driverWith(provider).runTask(request());
    const call = provider.calls[0];
    expect(call?.env?.[CREDENTIAL_VARIABLE]).toBe(CREDENTIAL);
    expect(call?.cmd.join(' ')).not.toContain(CREDENTIAL);
  });

  test('the prefix and the suffix reach different flags, which is what makes the cache reading possible', async () => {
    const provider = new RecordingProvider();
    provider.stdout = stream();
    await driverWith(provider).runTask(request());
    const cmd = provider.calls[0]?.cmd ?? [];
    expect(cmd[cmd.indexOf('--append-system-prompt') + 1]).toBe('the invariant half');
    expect(cmd[cmd.indexOf('--print') + 1]).toBe('this task only');
    expect(cmd).toContain('--exclude-dynamic-system-prompt-sections');
  });

  test('the granted tools reach --tools, which decides what exists rather than what needs approval (I4)', async () => {
    const provider = new RecordingProvider();
    provider.stdout = stream({ tools: ['Read', 'Write'] });
    await driverWith(provider).runTask(request({ tools: ['Read', 'Write'] }));
    const cmd = provider.calls[0]?.cmd ?? [];
    expect(cmd[cmd.indexOf('--tools') + 1]).toBe('Read,Write');
    expect(cmd).not.toContain('--allowedTools');
  });

  test('an empty grant is an empty tool list, not an absent flag (I4)', async () => {
    const provider = new RecordingProvider();
    provider.stdout = stream({ tools: [] });
    await driverWith(provider).runTask(request({ tools: [] }));
    const cmd = provider.calls[0]?.cmd ?? [];
    expect(cmd.indexOf('--tools')).toBeGreaterThan(-1);
    expect(cmd[cmd.indexOf('--tools') + 1]).toBe('');
  });

  test('no settings source outside the argv configures the session (I3)', async () => {
    const provider = new RecordingProvider();
    provider.stdout = stream();
    await driverWith(provider).runTask(request());
    const cmd = provider.calls[0]?.cmd ?? [];
    expect(cmd[cmd.indexOf('--setting-sources') + 1]).toBe('');
    expect(cmd).toContain('--strict-mcp-config');
  });
});

describe('grants the driver refuses before spending anything (I4, I5)', () => {
  test('a granted tool the driver does not declare refuses, and no task starts', async () => {
    const provider = new RecordingProvider();
    provider.stdout = stream();
    await expect(driverWith(provider).runTask(request({ tools: ['Read', 'Telepathy'] }))).rejects.toThrow(/does not declare/);
    expect(provider.calls).toHaveLength(0);
  });

  test('a granted MCP tool whose server the driver does not hold refuses', async () => {
    const provider = new RecordingProvider();
    provider.stdout = stream();
    await expect(driverWith(provider).runTask(request({ tools: ['mcp__absent__thing'] }))).rejects.toThrow(/no MCP server named/);
    expect(provider.calls).toHaveLength(0);
  });

  test('only the servers the grants name are configured', async () => {
    const provider = new RecordingProvider();
    provider.stdout = stream();
    const driver = driverWith(provider, {
      mcpServers: { used: { command: 'node' }, unused: { command: 'node' } },
    });
    await driver.runTask(request({ tools: ['Read', 'mcp__used__thing'] }));
    const cmd = taskCall(provider)?.cmd ?? [];
    const config = cmd[cmd.indexOf('--mcp-config') + 1] ?? '';
    expect(config).toContain('used');
    expect(config).not.toContain('unused');
  });

  test('the servers are inspected before the task, and every tool they offer beyond the grant is named as disallowed (I4)', async () => {
    const provider = new RecordingProvider();
    // The inspection session reports both of the server's tools; the task
    // granted one. `--tools` cannot narrow an MCP server's contribution, so the
    // other has to be named.
    provider.stdout = stream({ tools: ['mcp__used__thing', 'mcp__used__other'] });
    const driver = driverWith(provider, { mcpServers: { used: { command: 'node' } } });
    await driver.runTask(request({ tools: ['mcp__used__thing'] }));

    const inspection = provider.calls[0]?.cmd ?? [];
    expect(inspection).not.toContain('--append-system-prompt');
    expect(inspection[inspection.indexOf('--tools') + 1]).toBe('');

    const cmd = taskCall(provider)?.cmd ?? [];
    const disallowed = cmd[cmd.indexOf('--disallowedTools') + 1] ?? '';
    expect(disallowed).toBe('mcp__used__other');
  });

  test('a task with no MCP grant is not inspected, so nothing is spent looking for servers it has none of', async () => {
    const provider = new RecordingProvider();
    provider.stdout = stream();
    await driverWith(provider).runTask(request({ tools: ['Read'] }));
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.cmd).not.toContain('--disallowedTools');
  });

  test('servers that cannot be inspected refuse the task rather than running it with tools nobody enumerated (I5)', async () => {
    const provider = new RecordingProvider();
    provider.stdout = 'the CLI wrote nothing a session could be read from';
    const driver = driverWith(provider, { mcpServers: { used: { command: 'node' } } });
    await expect(driver.runTask(request({ tools: ['mcp__used__thing'] }))).rejects.toThrow(/could not be inspected/);
  });

  test('an MCP tool is not passed to --tools, which names built-ins only', async () => {
    const provider = new RecordingProvider();
    provider.stdout = stream();
    const driver = driverWith(provider, { mcpServers: { used: { command: 'node' } } });
    await driver.runTask(request({ tools: ['Read', 'mcp__used__thing'] }));
    const cmd = taskCall(provider)?.cmd ?? [];
    expect(cmd[cmd.indexOf('--tools') + 1]).toBe('Read');
  });
});

describe('refusals when the CLI did not run the task (I5)', () => {
  test('no session at all refuses rather than returning an empty result', async () => {
    const provider = new RecordingProvider();
    provider.stdout = 'command not found: claude';
    provider.exitCode = 127;
    await expect(driverWith(provider).runTask(request())).rejects.toThrow(/produced no session/);
  });

  test('a credential from a source this driver did not arrange refuses', async () => {
    const provider = new RecordingProvider();
    provider.stdout = stream().replace(CREDENTIAL_VARIABLE, 'keychain');
    await expect(driverWith(provider).runTask(request())).rejects.toThrow(/rather than ANTHROPIC_API_KEY/);
  });

  test('an API status the CLI gave up on refuses, and is never a TaskResult', async () => {
    const provider = new RecordingProvider();
    provider.stdout = stream().replace('"is_error":false', '"is_error":true,"api_error_status":401');
    await expect(driverWith(provider).runTask(request())).rejects.toThrow(/the API answered 401/);
  });

  test('a stream with no result refuses', async () => {
    const provider = new RecordingProvider();
    provider.stdout = stream().split('\n')[0] ?? '';
    await expect(driverWith(provider).runTask(request())).rejects.toThrow(/ended without a result/);
  });
});

describe('the result', () => {
  test('there is no status field and nothing to put one in (I2)', async () => {
    const provider = new RecordingProvider();
    provider.stdout = stream();
    const result = await driverWith(provider).runTask(request());
    expect(Object.keys(result)).not.toContain('status');
    expect(JSON.stringify(result)).not.toMatch(/"(status|succeeded|passed)":/);
  });

  test('the narrative is a claim and the files are the model\'s account of itself (I2)', async () => {
    const provider = new RecordingProvider();
    const toolUse = JSON.stringify({
      type: 'assistant',
      parent_tool_use_id: null,
      message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: '/workspace/a.ts' } }] },
    });
    provider.stdout = stream({ extra: [toolUse] });
    const result = await driverWith(provider).runTask(request());
    expect(result.claim.narrative).toBe('done');
    expect(result.claim.filesChanged).toEqual(['/workspace/a.ts']);
  });

  test('family is the driver\'s own value and survives the model the session reports (I6)', async () => {
    const provider = new RecordingProvider();
    provider.stdout = stream();
    const result = await driverWith(provider).runTask(request());
    expect(result.model.family).toBe('claude');
    expect(result.model.model).toBe('claude-sonnet-5');
    expect(result.model.family).not.toBe(result.model.model);
  });

  test('usage carries the cache counters the CLI reported', async () => {
    const provider = new RecordingProvider();
    provider.stdout = stream({ usage: { cache_read_input_tokens: 4096 } });
    const result = await driverWith(provider).runTask(request());
    expect(result.usage.cacheReadTokens).toBe(4096);
    expect(result.usage.cacheWriteTokens).toBe(7);
    expect(result.usage.wallClockMs).toBe(1234);
  });
});

describe('capabilities as declarations', () => {
  test('steering is false and there is no steer method, in both directions', () => {
    const driver = driverWith(new RecordingProvider());
    expect(driver.capabilities().steering).toBe(false);
    expect('steer' in driver).toBe(false);
  });

  test('computerUse is false and no declared tool could drive a display', () => {
    const driver = driverWith(new RecordingProvider());
    expect(driver.capabilities().computerUse).toBe(false);
    expect(DECLARED_TOOLS.some((tool) => /computer|screenshot|display/i.test(tool))).toBe(false);
  });

  test('parallelism is 1 and a second task on the same sandbox waits for the first', async () => {
    const provider = new RecordingProvider();
    provider.stdout = stream();
    const driver = driverWith(provider);
    expect(driver.capabilities().parallelism).toBe(1);

    const order: string[] = [];
    const wrapped = new Proxy(provider, {
      get(target, property, receiver: unknown) {
        if (property !== 'exec') return Reflect.get(target, property, receiver) as unknown;
        return async (h: SandboxHandle, cmd: string[], options?: { env?: Record<string, string> }) => {
          order.push('start');
          await new Promise((r) => setTimeout(r, 20));
          order.push('end');
          return target.exec(h, cmd, options);
        };
      },
    });
    const serial = new ClaudeCodeDriver({ provider: wrapped, credential: CREDENTIAL });
    await Promise.all([serial.runTask(request()), serial.runTask(request({ taskId: 'task-2' as TaskId }))]);
    expect(order).toEqual(['start', 'end', 'start', 'end']);
  });
});

describe('artifacts', () => {
  test('roles render to agent files, a SKILL.md, and a settings file carrying the hook points', () => {
    const files = artifactFiles([{ role: 'builder' as TaskRequest['role'], instructions: 'do the thing' }], '/workspace/.claude');
    const paths = files.map((f) => f.path);
    expect(paths).toContain('/workspace/.claude/agents/builder.md');
    expect(paths).toContain('/workspace/.claude/skills/factory-roles/SKILL.md');
    expect(paths).toContain('/workspace/.claude/settings.json');
    const settings = files.find((f) => f.path.endsWith('settings.json'))?.content ?? '';
    expect(settings).toContain('PreToolUse');
    expect(settings).toContain('PostToolUse');
  });

  test('instructions are rendered verbatim; what they say is the compiler\'s (M2)', () => {
    const odd = 'a line with $VAR and `backticks` and \'quotes\'';
    const files = artifactFiles([{ role: 'r' as TaskRequest['role'], instructions: odd }], '/t');
    expect(files[0]?.content).toContain(odd);
  });

  test('emitArtifacts writes through the sandbox and refuses when it has none (I1)', async () => {
    const provider = new RecordingProvider();
    const driver = driverWith(provider);
    await expect(driver.emitArtifacts([{ role: 'r' as TaskRequest['role'], instructions: 'x' }], '/t')).rejects.toThrow(/no sandbox/);
    driver.useSandbox(HANDLE);
    await driver.emitArtifacts([{ role: 'r' as TaskRequest['role'], instructions: 'x' }], '/t');
    expect(provider.calls.length).toBeGreaterThan(0);
    expect(provider.calls.every((c) => c.cmd[0] === 'sh')).toBe(true);
  });

  test('a here-document delimiter is quoted, so nothing in the content is read as shell syntax', () => {
    const script = writeFileScript('/t/a.md', 'rm -rf / && echo $(whoami)');
    expect(script).toContain("<<'FACTORY_ARTIFACT_EOF'");
    expect(script).toContain('rm -rf / && echo $(whoami)');
  });
});

describe('reading a recorded stream', () => {
  test('a line that is not JSON is kept rather than dropped, so a refusal can quote it', () => {
    const parsed = parseStream('not json at all\n{"type":"system","subtype":"init"}');
    expect(parsed.unreadable).toEqual(['not json at all']);
  });

  test('an unknown message type is ignored, so a CLI that adds one does not break the driver', () => {
    const parsed = parseStream('{"type":"something_new","payload":1}');
    expect(parsed.unreadable).toEqual([]);
    expect(parsed.result).toBeUndefined();
  });

  test('hook responses are read and hook_started lines are not counted twice', () => {
    const lines = [
      '{"type":"system","subtype":"hook_started","hook_event":"SessionStart","hook_name":"SessionStart:startup"}',
      '{"type":"system","subtype":"hook_response","hook_event":"SessionStart","hook_name":"SessionStart:startup","outcome":"success"}',
    ].join('\n');
    const parsed = parseStream(lines);
    expect(parsed.hooks).toEqual([{ event: 'SessionStart', name: 'SessionStart:startup', outcome: 'success' }]);
  });

  test('a usage field that is not a finite number is a missing measurement, not a measurement', () => {
    const parsed = parseStream('{"type":"result","usage":{"input_tokens":null,"output_tokens":"lots"},"total_cost_usd":0}');
    expect(parsed.result?.usage.inputTokens).toBe(0);
    expect(parsed.result?.usage.outputTokens).toBe(0);
  });

  test('a tool use becomes the events its kind implies', () => {
    const parsed = parseStream(
      '{"type":"assistant","parent_tool_use_id":null,"message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"ls"}}]}}',
    );
    const kinds = eventsFrom(parsed).map((e) => e.kind);
    expect(kinds).toEqual(['tool-call', 'command']);
  });
});

describe('small parts', () => {
  test('a shell-quoted value closes, escapes, and reopens every embedded quote', () => {
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });

  test('a session id is a UUID the CLI will accept, and the same task gives the same one', () => {
    const a = sessionIdFor('task-1' as TaskId);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(sessionIdFor('task-1' as TaskId)).toBe(a);
    expect(sessionIdFor('task-2' as TaskId)).not.toBe(a);
  });

  test('an MCP tool name yields its server and an ordinary tool name yields nothing', () => {
    expect(mcpServerOf('mcp__github__create_issue')).toBe('github');
    expect(mcpServerOf('Read')).toBeUndefined();
  });

  test('the declared inventory is sorted, unique, and free of MCP names', () => {
    expect([...DECLARED_TOOLS].sort((a, b) => a.localeCompare(b))).toEqual([...DECLARED_TOOLS]);
    expect(new Set(DECLARED_TOOLS).size).toBe(DECLARED_TOOLS.length);
    expect(DECLARED_TOOLS.some((t) => t.startsWith('mcp__'))).toBe(false);
  });
});
