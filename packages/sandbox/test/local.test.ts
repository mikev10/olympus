/**
 * LocalDockerProvider against a real daemon.
 *
 * These tests require Docker and fail without it. That is the point: the
 * assertions here are the only place the mount table, the network mode, and
 * the cgroup limits are observed rather than assumed, and a suite that
 * skipped itself on a host without containers would report green having
 * proved nothing about the substrate every other package's safety rests on
 * (I5, D-P2-02).
 */
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import {
  DockerUnavailable,
  LocalDockerProvider,
  SandboxRefusal,
  type SandboxHandle,
  type SandboxSpec,
} from '../src/index.js';
import { TEST_IMAGE } from './image.js';

const run = promisify(execFile);

/** Reads the container's kernel-facing configuration, so a limit is checked where it is applied rather than where it was requested. */
async function hostConfig(containerId: string): Promise<Record<string, string>> {
  const format = '{{.HostConfig.Memory}}|{{.HostConfig.NanoCpus}}|{{.HostConfig.PidsLimit}}|{{.HostConfig.NetworkMode}}|{{.State.Running}}';
  const { stdout } = await run('docker', ['inspect', '--format', format, containerId]);
  const [memory, nanoCpus, pidsLimit, networkMode, running] = stdout.trim().split('|');
  return {
    memory: memory ?? '',
    nanoCpus: nanoCpus ?? '',
    pidsLimit: pidsLimit ?? '',
    networkMode: networkMode ?? '',
    running: running ?? '',
  };
}

async function containerExists(containerId: string): Promise<boolean> {
  try {
    await run('docker', ['inspect', '--type', 'container', containerId]);
    return true;
  } catch {
    return false;
  }
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

let provider: LocalDockerProvider;
let base: string;
let workspace: string;
let vault: string;
let readable: string;
const live: SandboxHandle[] = [];

function specFor(overrides: Partial<SandboxSpec> = {}): SandboxSpec {
  return {
    image: TEST_IMAGE,
    mounts: { workspace: { source: workspace, target: '/workspace', mode: 'rw' }, others: [] },
    egress: { mode: 'deny-all', allow: [] },
    limits: { cpus: 0.5, memoryMb: 256, pids: 64, wallClockMs: 60_000 },
    ...overrides,
  };
}

async function provision(overrides: Partial<SandboxSpec> = {}): Promise<SandboxHandle> {
  const handle = await provider.provision(specFor(overrides));
  live.push(handle);
  return handle;
}

beforeAll(async () => {
  // Not wrapped: no daemon is a failing suite, never a skipped one.
  provider = await LocalDockerProvider.create({ vaultPaths: [] });
});

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'local-docker-'));
  workspace = join(base, 'workspace');
  vault = join(base, 'vault');
  readable = join(base, 'readable');
  await mkdir(workspace, { recursive: true });
  await mkdir(vault, { recursive: true });
  await mkdir(readable, { recursive: true });
  provider = await LocalDockerProvider.create({ vaultPaths: [vault] });
});

afterEach(async () => {
  while (live.length > 0) {
    const handle = live.pop();
    if (handle === undefined) continue;
    try {
      await provider.destroy(handle);
    } catch {
      // Already destroyed by the test, or by the wall clock.
    }
  }
  await rm(base, { recursive: true, force: true });
});

describe('create: the daemon is established before the provider exists', () => {
  test('refuses when the docker executable cannot be run, naming what is missing', async () => {
    await expect(
      LocalDockerProvider.create({ vaultPaths: [], executable: 'docker-that-is-not-installed' }),
    ).rejects.toBeInstanceOf(DockerUnavailable);
  });

  test('reports the daemon it probed: a Linux daemon on a local endpoint', () => {
    const daemon = provider.daemon();
    expect(daemon.osType).toBe('linux');
    expect(daemon.serverVersion).not.toBe('');
    expect(daemon.endpoint.startsWith('unix://') || daemon.endpoint.startsWith('npipe://')).toBe(true);
  });

  test('is the local-docker provider and declares no `unsafe` property', () => {
    expect(provider.id).toBe('local-docker');
    expect('unsafe' in provider).toBe(false);
  });
});

describe('the mount table is what the container gets', () => {
  test('a write to the rw workspace lands on the host', async () => {
    const handle = await provision();
    const result = await provider.exec(handle, ['sh', '-c', 'echo made > /workspace/made.txt']);
    expect(result.exitCode).toBe(0);
    expect((await readFile(join(workspace, 'made.txt'), 'utf8')).trim()).toBe('made');
  });

  test('a write outside the workspace reaches no host path', async () => {
    const handle = await provision();
    const result = await provider.exec(handle, ['sh', '-c', 'echo escaped > /outside.txt && cat /outside.txt']);
    // The container's own filesystem is writable and goes away with it; what matters is that
    // nothing it wrote outside its one rw mount reached the host.
    expect(result.stdout.trim()).toBe('escaped');
    expect(await readdir(base)).toStrictEqual(expect.arrayContaining(['workspace']));
    expect(await readdir(base)).not.toContain('outside.txt');
    expect(await readdir(workspace)).toStrictEqual([]);
  });

  test('a workspace the table marks ro is read-only inside the container (I3)', async () => {
    const handle = await provision({
      mounts: { workspace: { source: workspace, target: '/workspace', mode: 'ro' }, others: [] },
    });
    const result = await provider.exec(handle, ['sh', '-c', 'echo x > /workspace/nope.txt']);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('Read-only file system');
    expect(await readdir(workspace)).toStrictEqual([]);
  });

  test('an `others` mount is readable and not writable', async () => {
    const handle = await provision({
      mounts: {
        workspace: { source: workspace, target: '/workspace', mode: 'rw' },
        others: [{ source: readable, target: '/readable', mode: 'ro' }],
      },
    });
    const listed = await provider.exec(handle, ['sh', '-c', 'ls -d /readable']);
    expect(listed.exitCode).toBe(0);
    const written = await provider.exec(handle, ['sh', '-c', 'echo x > /readable/nope.txt']);
    expect(written.exitCode).not.toBe(0);
    expect(written.stderr).toContain('Read-only file system');
  });

  test('a mount that would land on a Vault path is refused before any container starts', async () => {
    const error = await refusal(() =>
      provider.provision(
        specFor({ mounts: { workspace: { source: vault, target: '/workspace', mode: 'rw' }, others: [] } }),
      ),
    );
    expect(error.layer).toBe('mount');
    expect(error.message).toContain('I1');
  });

  test('a second rw mount is refused at provision, even when the table skipped the constructor', async () => {
    const mounts = {
      workspace: { source: workspace, target: '/workspace', mode: 'rw' as const },
      others: [{ source: readable, target: '/second', mode: 'rw' }],
    } as SandboxSpec['mounts'];
    const error = await refusal(() => provider.provision(specFor({ mounts })));
    expect(error.layer).toBe('mount');
    expect(error.message).toContain('I1');
  });
});

describe('egress', () => {
  test('deny-all is --network none, and the container has no route off the host', async () => {
    const handle = await provision();
    const controls = provider.appliedControls(handle);
    expect(controls.network).toBe('none');
    expect(controls.runArgs).toStrictEqual(expect.arrayContaining(['--network', 'none']));
    expect((await hostConfig(controls.containerId)).networkMode).toBe('none');

    // The container has a loopback interface and nothing else, so there is no route off the
    // host to attempt. Asserted on the interface list rather than only on a failed request:
    // a request also fails when the tool is missing, and that would pass while proving nothing.
    const interfaces = await provider.exec(handle, ['ls', '/sys/class/net']);
    expect(interfaces.stdout.trim().split(/\s+/)).toStrictEqual(['lo']);

    // And the request itself, to an IP literal so the attempt is a route and not a name lookup.
    // The message must name the route: `wget` is present in this image and works when a network
    // is attached, so "Network unreachable" is the daemon's doing and not a missing binary.
    const result = await provider.exec(handle, ['sh', '-c', 'wget -T 2 -O /dev/null http://1.1.1.1/ 2>&1']);
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('Network unreachable');
  });

  test('an allowlist is refused, not applied as deny-all or as allow-all', async () => {
    const error = await refusal(() => provider.provision(specFor({ egress: { mode: 'allowlist', allow: ['example.com'] } })));
    expect(error.layer).toBe('egress');
    expect(error.message).toContain('refused');
  });

  test('a deny-all policy carrying allow entries contradicts itself and is refused', async () => {
    const error = await refusal(() => provider.provision(specFor({ egress: { mode: 'deny-all', allow: ['example.com'] } })));
    expect(error.layer).toBe('egress');
  });
});

describe('limits', () => {
  test('cpu, memory and pid limits reach the container configuration', async () => {
    const handle = await provision({ limits: { cpus: 0.5, memoryMb: 256, pids: 64, wallClockMs: 60_000 } });
    const config = await hostConfig(provider.appliedControls(handle).containerId);
    expect(config.memory).toBe(String(256 * 1024 * 1024));
    expect(config.nanoCpus).toBe(String(500_000_000));
    expect(config.pidsLimit).toBe('64');
  });

  test.each([
    ['cpus', { cpus: 0, memoryMb: 256, pids: 64, wallClockMs: 1000 }],
    ['memoryMb', { cpus: 0.5, memoryMb: -1, pids: 64, wallClockMs: 1000 }],
    ['pids', { cpus: 0.5, memoryMb: 256, pids: 0, wallClockMs: 1000 }],
    ['wallClockMs', { cpus: 0.5, memoryMb: 256, pids: 64, wallClockMs: 0 }],
  ])('an unbounded %s is refused, not granted', async (name, limits) => {
    const error = await refusal(() => provider.provision(specFor({ limits })));
    expect(error.layer).toBe('limits');
    expect(error.message).toContain(name);
  });

  test('a fractional megabyte or process count is refused', async () => {
    const error = await refusal(() => provider.provision(specFor({ limits: { cpus: 0.5, memoryMb: 256.5, pids: 64, wallClockMs: 1000 } })));
    expect(error.layer).toBe('limits');
  });

  test('a command that outlives the wall-clock budget is terminated and the container destroyed', async () => {
    const handle = await provision({ limits: { cpus: 0.5, memoryMb: 256, pids: 64, wallClockMs: 2000 } });
    const containerId = provider.appliedControls(handle).containerId;
    const error = await refusal(() => provider.exec(handle, ['sh', '-c', 'sleep 60']));
    expect(error.layer).toBe('lifetime');
    expect(error.message).toContain('2000ms');
    expect(await containerExists(containerId)).toBe(false);
  });

  test('a sandbox nobody calls again is destroyed when its budget expires — review finding 2', async () => {
    // The check inside exec() bounds only sandboxes somebody keeps calling. A task that starts
    // background work and is never exec'd again would otherwise outlive its limit entirely.
    const handle = await provision({ limits: { cpus: 0.5, memoryMb: 256, pids: 64, wallClockMs: 1500 } });
    const containerId = provider.appliedControls(handle).containerId;
    await provider.exec(handle, ['sh', '-c', 'nohup sh -c "while :; do sleep 1; done" >/dev/null 2>&1 &']);

    expect(await containerExists(containerId)).toBe(true);
    await new Promise((done) => setTimeout(done, 3500));

    // Nothing touched the provider in between; the budget enforced itself.
    expect(await containerExists(containerId)).toBe(false);
    const error = await refusal(() => provider.exec(handle, ['sh', '-c', 'echo x']));
    expect(error.layer).toBe('lifetime');
    expect(error.message).toContain('1500ms');
  });

  test('the budget is the sandbox lifetime, so a later exec is refused rather than started', async () => {
    const handle = await provision({ limits: { cpus: 0.5, memoryMb: 256, pids: 64, wallClockMs: 1500 } });
    const first = await provider.exec(handle, ['sh', '-c', 'echo one']);
    expect(first.stdout.trim()).toBe('one');
    await new Promise((done) => setTimeout(done, 1600));
    const error = await refusal(() => provider.exec(handle, ['sh', '-c', 'echo two']));
    expect(error.layer).toBe('lifetime');
    expect(error.message).toContain('1500ms');
  });
});

describe('lifecycle', () => {
  test('a file written in one exec is there for the next: `persistent` is true', async () => {
    const handle = await provision();
    await provider.exec(handle, ['sh', '-c', 'echo kept > /tmp/marker']);
    const second = await provider.exec(handle, ['cat', '/tmp/marker']);
    expect(second.stdout.trim()).toBe('kept');
    expect(provider.capabilities().persistent).toBe(true);
  });

  test('a non-zero exit code is reported as it is, not turned into a throw', async () => {
    const handle = await provision();
    const result = await provider.exec(handle, ['sh', '-c', 'echo out; echo err >&2; exit 3']);
    expect(result.exitCode).toBe(3);
    expect(result.stdout.trim()).toBe('out');
    expect(result.stderr.trim()).toBe('err');
    expect(result.durationMs).toBeGreaterThan(0);
  });

  test('destroy removes the container, and a later call says the sandbox ended rather than that the handle is unknown', async () => {
    const handle = await provision();
    const containerId = provider.appliedControls(handle).containerId;
    await provider.destroy(handle);
    expect(await containerExists(containerId)).toBe(false);

    const afterExec = await refusal(() => provider.exec(handle, ['sh', '-c', 'echo x']));
    expect(afterExec.layer).toBe('lifetime');
    expect(afterExec.message).toContain('destroyed');
    const twice = await refusal(() => provider.destroy(handle));
    expect(twice.layer).toBe('lifetime');

    // What was enforced on a sandbox outlives the sandbox: an audit reads it after the run.
    expect(provider.appliedControls(handle).network).toBe('none');
  });

  test('a sandbox killed by its wall clock says so, rather than reporting an unknown handle', async () => {
    const handle = await provision({ limits: { cpus: 0.5, memoryMb: 256, pids: 64, wallClockMs: 2000 } });
    await refusal(() => provider.exec(handle, ['sh', '-c', 'sleep 60']));
    const later = await refusal(() => provider.exec(handle, ['sh', '-c', 'echo x']));
    expect(later.layer).toBe('lifetime');
    expect(later.message).toContain('2000ms');
  });

  test('an unknown handle is refused by exec, destroy, and appliedControls', async () => {
    const stranger = 'not-a-handle' as SandboxHandle;
    expect((await refusal(() => provider.exec(stranger, ['sh']))).layer).toBe('handle');
    expect((await refusal(() => provider.destroy(stranger))).layer).toBe('handle');
    expect((await refusal(() => provider.appliedControls(stranger))).layer).toBe('handle');
  });

  test('an empty command is refused', async () => {
    const handle = await provision();
    expect((await refusal(() => provider.exec(handle, []))).layer).toBe('handle');
  });

  test('an image that cannot be run is refused, and no handle is issued', async () => {
    const error = await refusal(() => provider.provision(specFor({ image: 'no-such-image-p2:absent' })));
    expect(error.layer).toBe('image');
  });

  test('an empty image is refused before the daemon is touched', async () => {
    const error = await refusal(() => provider.provision(specFor({ image: '  ' })));
    expect(error.layer).toBe('image');
  });
});
