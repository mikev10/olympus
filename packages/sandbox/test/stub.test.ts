/**
 * StubSandboxProvider: executes on the host in the Workspace mount's source
 * directory, with no container. It enforces nothing the mount table, egress
 * policy, or limits imply, and declares each of those rather than pretending.
 */
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { StubSandboxProvider, type SandboxHandle, type SandboxSpec } from '../src/index.js';

function specFor(source: string): SandboxSpec {
  return {
    image: 'none',
    mounts: { workspace: { source, target: '/workspace', mode: 'rw' }, others: [] },
    egress: { mode: 'deny-all', allow: [] },
    limits: { cpus: 0, memoryMb: 0, pids: 0, wallClockMs: 0 },
  };
}

const platform = process.platform;
const hostIsNamed = platform === 'linux' || platform === 'darwin';

let workspace: string;
let provider: StubSandboxProvider;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'stub-sandbox-'));
  provider = new StubSandboxProvider();
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe('declaration', () => {
  test('is the stub-local provider', () => {
    expect(provider.id).toBe('stub-local');
  });

  test('declares itself unsafe as StubSandboxProvider, naming the mount table, egress, limits, and isolation', () => {
    expect(provider.unsafe.component).toBe('StubSandboxProvider');
    const text = provider.unsafe.cannotEnforce.join('\n');
    expect(text).toMatch(/mount/i);
    expect(text).toMatch(/egress/i);
    expect(text).toMatch(/limit/i);
    expect(text).toMatch(/isolat/i);
  });
});

describe('provision', () => {
  test('requires the workspace source to be an existing directory', async () => {
    await expect(provider.provision(specFor(join(workspace, 'missing')))).rejects.toThrow(/missing/);
    const file = join(workspace, 'file.txt');
    await writeFile(file, 'x');
    await expect(provider.provision(specFor(file))).rejects.toThrow(/file\.txt/);
  });

  test('returns a fresh handle for each provision', async () => {
    const a = await provider.provision(specFor(workspace));
    const b = await provider.provision(specFor(workspace));
    expect(a).not.toBe(b);
  });
});

describe('exec', () => {
  let handle: SandboxHandle;

  beforeEach(async () => {
    handle = await provider.provision(specFor(workspace));
  });

  test('runs the command in the workspace source with no shell and returns its exit code, output, and duration', async () => {
    const result = await provider.exec(handle, ['node', '-e', 'process.stdout.write(process.cwd())']);
    expect(result.exitCode).toBe(0);
    expect(await realpath(result.stdout)).toBe(await realpath(workspace));
    expect(result.stderr).toBe('');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test('returns a non-zero exit code as the process reported it', async () => {
    const result = await provider.exec(handle, ['node', '-e', 'process.exit(3)']);
    expect(result.exitCode).toBe(3);
  });

  test('captures stderr separately from stdout', async () => {
    const result = await provider.exec(handle, ['node', '-e', 'process.stderr.write("err"); process.stdout.write("out")']);
    expect(result.stdout).toBe('out');
    expect(result.stderr).toBe('err');
  });

  test('passes arguments literally: shell metacharacters are not interpreted', async () => {
    const literal = '$HOME && echo hi | cat';
    const result = await provider.exec(handle, ['node', '-e', 'process.stdout.write(process.argv[1])', literal]);
    expect(result.stdout).toBe(literal);
  });

  test('files written by one exec are there for the next: persistent is true', async () => {
    await provider.exec(handle, ['node', '-e', 'require("node:fs").writeFileSync("kept.txt", "kept")']);
    const next = await provider.exec(handle, ['node', '-e', 'process.stdout.write(require("node:fs").readFileSync("kept.txt", "utf8"))']);
    expect(next.stdout).toBe('kept');
    expect(await readFile(join(workspace, 'kept.txt'), 'utf8')).toBe('kept');
  });

  test('throws on an empty command', async () => {
    await expect(provider.exec(handle, [])).rejects.toThrow(/empty/i);
  });

  test('throws on an unknown handle', async () => {
    await expect(provider.exec('nope' as SandboxHandle, ['node', '-e', '0'])).rejects.toThrow(/nope/);
  });

  test('throws when the executable cannot be started', async () => {
    await expect(provider.exec(handle, ['definitely-not-a-program-s1', 'x'])).rejects.toThrow();
  });

  // On Windows a process that kills itself exits with a code and no signal, so
  // the signal path cannot be produced from inside the child there; CI runs on
  // Linux and covers it.
  test.skipIf(platform === 'win32')('throws naming the signal when the process ends by one (finding 4c)', async () => {
    await expect(provider.exec(handle, ['node', '-e', 'process.kill(process.pid, "SIGKILL")'])).rejects.toThrow(/SIGKILL/);
  });
});

describe('destroy', () => {
  test('forgets the handle so it cannot be used or destroyed again', async () => {
    const handle = await provider.provision(specFor(workspace));
    await provider.destroy(handle);
    await expect(provider.exec(handle, ['node', '-e', '0'])).rejects.toThrow();
    await expect(provider.destroy(handle)).rejects.toThrow();
  });

  test('throws on an unknown handle', async () => {
    await expect(provider.destroy('nope' as SandboxHandle)).rejects.toThrow(/nope/);
  });
});

describe('capabilities', () => {
  test.runIf(hostIsNamed)('reports the host os, persistent true, and every other capability false', () => {
    expect(provider.capabilities()).toEqual({
      computerUse: false,
      gpu: false,
      os: platform === 'linux' ? 'linux' : 'macos',
      persistent: true,
      remote: false,
    });
  });

  test.runIf(!hostIsNamed)('throws on a host the os union cannot name rather than claiming one (finding 4a)', () => {
    expect(() => provider.capabilities()).toThrow(new RegExp(platform));
  });
});
