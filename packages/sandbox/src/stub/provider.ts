/**
 * StubSandboxProvider: the SandboxProvider contract with no container. It
 * spawns commands on the host in the Workspace mount's source directory, so
 * the line runs on every host, and it enforces none of what a SandboxSpec
 * implies: the mount table, egress, limits, and isolation are each declared
 * unenforced through `unsafe` rather than accepted as if they held. P2
 * replaces this file with Docker.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import type { ExecResult, SandboxCapabilities, SandboxHandle, SandboxProvider, SandboxSpec } from '../types.js';

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** The host's os as the capabilities union names it; a host it cannot name throws (S1 finding 4a). */
function hostOs(): SandboxCapabilities['os'] {
  const platform = process.platform;
  if (platform === 'linux') return 'linux';
  if (platform === 'darwin') return 'macos';
  throw new Error(`StubSandboxProvider: SandboxCapabilities.os has no value for host platform ${platform}`);
}

export class StubSandboxProvider implements SandboxProvider {
  readonly id = 'stub-local';

  /**
   * Read structurally by the entry point in @olympus-ai/api; the conformance
   * fixture I5.stubs-declare-unsafe pins the shape.
   */
  readonly unsafe: { readonly component: 'StubSandboxProvider'; readonly cannotEnforce: readonly string[] } = {
    component: 'StubSandboxProvider',
    cannotEnforce: [
      "the mount table: nothing is mounted, every path on the host is reachable, the Vault's memory included, and `others` is ignored",
      'egress: the host network is reachable whatever the policy says',
      'limits: no CPU, memory, PID, or wall-clock bound is applied',
      'isolation: commands run on the host as the invoking user, and `image` is ignored',
    ],
  };

  /** Each provisioned handle and the host directory it executes in. */
  private readonly workspaces = new Map<SandboxHandle, string>();

  async provision(spec: SandboxSpec): Promise<SandboxHandle> {
    const source = spec.mounts.workspace.source;
    if (!(await isDirectory(source))) {
      throw new Error(`StubSandboxProvider: workspace source ${source} is not an existing directory`);
    }
    const handle = randomUUID() as SandboxHandle;
    this.workspaces.set(handle, source);
    return handle;
  }

  exec(h: SandboxHandle, cmd: string[]): Promise<ExecResult> {
    const cwd = this.workspaces.get(h);
    if (cwd === undefined) return Promise.reject(new Error(`StubSandboxProvider: unknown handle ${h}`));
    const [file, ...args] = cmd;
    if (file === undefined) return Promise.reject(new Error('StubSandboxProvider: empty command'));
    return new Promise((resolve, reject) => {
      const started = performance.now();
      const child = spawn(file, args, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      child.stdout.on('data', (chunk: Buffer) => {
        stdout.push(chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr.push(chunk);
      });
      child.on('error', reject);
      child.on('close', (code, signal) => {
        const durationMs = performance.now() - started;
        if (signal !== null) {
          // ExecResult.exitCode cannot represent a signal; inventing a code would be a lie (S1 finding 4c).
          reject(new Error(`StubSandboxProvider: ${file} ended by signal ${signal}`));
          return;
        }
        if (code === null) {
          reject(new Error(`StubSandboxProvider: ${file} ended with neither an exit code nor a signal`));
          return;
        }
        resolve({
          exitCode: code,
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
          durationMs,
        });
      });
    });
  }

  destroy(h: SandboxHandle): Promise<void> {
    if (!this.workspaces.delete(h)) return Promise.reject(new Error(`StubSandboxProvider: unknown handle ${h}`));
    return Promise.resolve();
  }

  /** `persistent: true` is true: nothing is ever torn down, so one exec's files are there for the next. */
  capabilities(): SandboxCapabilities {
    return { computerUse: false, gpu: false, os: hostOs(), persistent: true, remote: false };
  }
}
