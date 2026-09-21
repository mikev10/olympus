import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Invocation } from '../evidence.ts';
import { redactEnv } from '../evidence.ts';
import {
  DEFAULT_TIMEOUT_MS,
  codexApprovalPolicy,
  codexArgv,
  codexModel,
  codexUsage,
  resolveCodexEntry,
  runCli,
} from '../codex.ts';

describe('codexArgv', () => {
  const argv = codexArgv('C:\\scratch\\final-message.json');

  it('contains the required flags', () => {
    expect(argv).toContain('--sandbox');
    expect(argv).toContain('read-only');
    expect(argv).toContain('--ignore-user-config');
    expect(argv).toContain('--skip-git-repo-check');
    expect(argv).toContain('--json');
    expect(argv).toContain('-o');
    expect(argv).toContain('C:\\scratch\\final-message.json');
  });

  it('ends with a bare "-" so the prompt is read from stdin', () => {
    expect(argv[argv.length - 1]).toBe('-');
  });

  it('does not contain --ask-for-approval, which does not exist in codex-cli 0.155.1 and aborts the run', () => {
    expect(argv).not.toContain('--ask-for-approval');
  });

  it('does not contain workspace-write, danger-full-access, or --yolo', () => {
    expect(argv).not.toContain('workspace-write');
    expect(argv).not.toContain('danger-full-access');
    expect(argv).not.toContain('--yolo');
  });
});

describe('resolveCodexEntry', () => {
  const cleanupRoots: string[] = [];

  afterEach(() => {
    while (cleanupRoots.length > 0) {
      const root = cleanupRoots.pop();
      if (root !== undefined) rmSync(root, { recursive: true, force: true });
    }
  });

  it('prefers an explicit CODEX_JS override when the file exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'olympus-codexjs-override-'));
    cleanupRoots.push(root);
    const overridePath = join(root, 'codex.js');
    writeFileSync(overridePath, '// fake codex entry');

    const resolved = resolveCodexEntry({ CODEX_JS: overridePath }, 'win32', 'C:\\node\\node.exe');

    expect(resolved).toBe(overridePath);
  });

  it('refuses when CODEX_JS is set but the file does not exist, naming the path', () => {
    const missing = join(tmpdir(), 'olympus-codexjs-does-not-exist', 'codex.js');

    let message = '';
    try {
      resolveCodexEntry({ CODEX_JS: missing }, 'win32', 'C:\\node\\node.exe');
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain(missing);
  });

  it('resolves the Windows npm global install path from %APPDATA% when no override is set', () => {
    const root = mkdtempSync(join(tmpdir(), 'olympus-codexjs-appdata-'));
    cleanupRoots.push(root);
    const entry = join(root, 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    mkdirSync(dirname(entry), { recursive: true });
    writeFileSync(entry, '// fake codex entry');

    const resolved = resolveCodexEntry({ APPDATA: root }, 'win32', 'C:\\node\\node.exe');

    expect(resolved).toBe(entry);
  });

  it('refuses on win32 when %APPDATA% is not set and no override was given', () => {
    expect(() => resolveCodexEntry({}, 'win32', 'C:\\node\\node.exe')).toThrow(/APPDATA/);
  });

  it('refuses on win32 when the resolved %APPDATA% path does not exist', () => {
    const root = mkdtempSync(join(tmpdir(), 'olympus-codexjs-appdata-missing-'));
    cleanupRoots.push(root);

    expect(() => resolveCodexEntry({ APPDATA: root }, 'win32', 'C:\\node\\node.exe')).toThrow(/codex\.js/);
  });

  it('resolves the POSIX global install path relative to execPath when no override is set', () => {
    const root = mkdtempSync(join(tmpdir(), 'olympus-codexjs-posix-'));
    cleanupRoots.push(root);
    const execPath = join(root, 'bin', 'node');
    const entry = join(root, 'lib', 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    mkdirSync(dirname(entry), { recursive: true });
    writeFileSync(entry, '// fake codex entry');

    const resolved = resolveCodexEntry({}, 'linux', execPath);

    expect(resolved).toBe(entry);
  });

  it('refuses on POSIX when the resolved path does not exist', () => {
    const root = mkdtempSync(join(tmpdir(), 'olympus-codexjs-posix-missing-'));
    cleanupRoots.push(root);
    const execPath = join(root, 'bin', 'node');

    expect(() => resolveCodexEntry({}, 'linux', execPath)).toThrow(/codex\.js/);
  });
});

// Measured against codex-cli 0.155.1: task-1-codex-report.md, Step 7. The four
// event types emitted on --json stdout carry no model field at all.
const MEASURED_JSON_STDOUT = [
  '{"type":"thread.started","thread_id":"01a0c1a8-cad7-7263-bc22-e5275628e008"}',
  '{"type":"turn.started"}',
  '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"READY"}}',
  '{"type":"turn.completed","usage":{"input_tokens":14344,"cached_input_tokens":12416,"cache_write_input_tokens":0,"output_tokens":5,"reasoning_output_tokens":0}}',
].join('\n');

describe('codexModel', () => {
  it('reads the model id from a world_state record at payload.state.collaboration_mode.model', () => {
    const rollout = [
      '{"type":"session_meta","id":"s1"}',
      '{"type":"world_state","payload":{"state":{"collaboration_mode":{"model":"gpt-6-astra"}}}}',
    ].join('\n');

    expect(codexModel(rollout)).toBe('gpt-6-astra');
  });

  it('returns null when no world_state record is present', () => {
    expect(codexModel('{"type":"session_meta","id":"s1"}')).toBeNull();
  });

  it('returns null for --json stdout, where the model is not present at all (measured)', () => {
    expect(codexModel(MEASURED_JSON_STDOUT)).toBeNull();
  });
});

describe('codexUsage', () => {
  it('reads input_tokens from a token_usage_record at payload.usage.input_tokens', () => {
    const rollout = '{"type":"token_usage_record","payload":{"usage":{"input_tokens":127096,"total_tokens":127200}}}';

    expect(codexUsage(rollout)).toBe(127096);
  });

  it('returns null when no token_usage_record is present', () => {
    expect(codexUsage('{"type":"session_meta","id":"s1"}')).toBeNull();
  });
});

describe('codexApprovalPolicy', () => {
  // Judgment call (see task-7B report): the exact field path for approval_policy
  // within turn_context was not directly measured. world_state and
  // token_usage_record, the two record types whose shape WAS measured, both nest
  // their payload under a `payload` key, so payload.approval_policy is checked
  // first. A top-level field on the same record is checked second, since it
  // cannot cost a false positive (the record type is still turn_context) and
  // guards against turn_context being shaped differently from the other two.
  it('reads approval_policy nested under payload on a turn_context record', () => {
    const rollout = '{"type":"turn_context","payload":{"approval_policy":"never","model_context_window":258400}}';

    expect(codexApprovalPolicy(rollout)).toBe('never');
  });

  it('reads approval_policy from a turn_context record where it is a top-level field', () => {
    const rollout = '{"type":"turn_context","approval_policy":"never","model_context_window":258400}';

    expect(codexApprovalPolicy(rollout)).toBe('never');
  });

  it('returns null when no turn_context record is present', () => {
    expect(codexApprovalPolicy('{"type":"session_meta","id":"s1"}')).toBeNull();
  });

  it('returns null when turn_context is present but carries no approval_policy', () => {
    expect(codexApprovalPolicy('{"type":"turn_context","model_context_window":258400}')).toBeNull();
  });
});

describe('runCli', () => {
  it('writes the payload to stdin and ends it, proving the child does not wait on it', async () => {
    const script = 'let d="";process.stdin.on("data",c=>{d+=c;});process.stdin.on("end",()=>{process.stdout.write(d);});';

    const result = await runCli({
      command: process.execPath,
      args: ['-e', script],
      cwd: process.cwd(),
      env: process.env,
      stdin: 'hello codex transport',
    });

    expect(result.stdout).toBe('hello codex transport');
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
  });

  it('kills a child that never exits once the timeout elapses', async () => {
    const script = 'setInterval(() => {}, 1000);';

    const result = await runCli({
      command: process.execPath,
      args: ['-e', script],
      cwd: process.cwd(),
      env: process.env,
      stdin: '',
      timeoutMs: 300,
    });

    expect(result.timedOut).toBe(true);
  }, 10_000);

  it('captures stderr separately from stdout', async () => {
    const script = 'process.stderr.write("oops");process.stdout.write("fine");';

    const result = await runCli({
      command: process.execPath,
      args: ['-e', script],
      cwd: process.cwd(),
      env: process.env,
      stdin: '',
    });

    expect(result.stdout).toBe('fine');
    expect(result.stderr).toBe('oops');
  });

  it('exposes a 900_000ms default timeout', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(900_000);
  });
});

describe('the env Codex runs with reaches an Invocation only through redactEnv', () => {
  it('never lets a key-shaped secret value survive into JSON.stringify of the Invocation', () => {
    const rawEnv = {
      OPENAI_API_KEY: 'sk-proj-DummyDummyDummyDummyDummyDummy',
      CODEX_HOME: 'C:\\scratch\\cfg',
    };

    const invocation: Invocation = {
      kind: 'cli',
      command: 'codex',
      argv: codexArgv('C:\\scratch\\final-message.json'),
      envOverrides: redactEnv(rawEnv),
    };

    expect(JSON.stringify(invocation)).not.toContain('sk-proj-DummyDummyDummyDummyDummyDummy');
    // CODEX_HOME is in evidence.ts's RECORDABLE_ENV allowlist, so it does survive
    // — this asserts the redaction is selective, not a blanket wipe.
    expect(JSON.stringify(invocation)).toContain('C:\\\\scratch\\\\cfg');
  });
});
