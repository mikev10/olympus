/**
 * What this package's tests share: a real container on the pinned image, and,
 * for the paid assertions, a real relay holding a real credential.
 *
 * **Every test here needs a Docker daemon, and the paid ones an
 * `OPENAI_API_KEY`. They fail without either and are never skipped**: an
 * assertion that skipped itself would leave the registry reporting a claim on
 * the strength of a test that did not run (the reason `local-sandbox.ts` and
 * the Claude Code driver's harness give).
 *
 * The free tests use a sandbox with no relay and no route out. The inspection
 * (D-R26-02) runs entirely on the sandbox's loopback, so they read the request
 * a session would send, on the real CLI, without a key and without a model.
 */
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, expect } from 'vitest';
import type { Budget, CompiledRole, RoleId, TaskId, TaskRequest } from '@olympus-ai/core';
import type { ExecOptions, ExecResult, LocalDockerProvider, MeterReading, SandboxHandle, SandboxProvider, SandboxSpec } from '@olympus-ai/sandbox';
import { CodexDriver, MODEL_CREDENTIAL, MODEL_RELAY, ensureImage, parseEvents, type CodexDriverOptions } from '../src/index.js';

const run = promisify(execFile);

/** Where the host's credential is read from, to be handed to the provider and from there to the relay alone. */
export const HOST_CREDENTIAL_VARIABLE = 'OPENAI_API_KEY';

/** Where the workspace mount lands, and where the driver runs. */
export const WORKDIR = '/workspace';

/**
 * Per sandbox, enforced by its relay. The prices are the long-context ceiling
 * (D-R26-06), so a dollar here buys about half of what the list suggests; one
 * session of the pinned CLI sends a system prompt of some tens of thousands of
 * tokens, so this holds a test's few sessions with room, and stops a runaway.
 */
export const BUDGET: Budget = { maxTokens: 2_000_000, maxCostUsd: 1, maxWallClockMs: 300_000 };

/** A role whose instructions a session can be seen to receive. */
export const PROBE_ROLE: CompiledRole = {
  role: 'builder' as RoleId,
  instructions: 'You are the builder role of a test harness. Do exactly what the message asks and nothing more.',
  sha256: '0'.repeat(64),
};

/** The credential, or a failure naming what is missing. Read per call, so a test that unsets it sees it gone. */
export function credential(): string {
  const value = process.env[HOST_CREDENTIAL_VARIABLE];
  if (value === undefined || value.trim() === '') {
    throw new Error(
      `${HOST_CREDENTIAL_VARIABLE} is not set. The driver's paid assertions are proven against a real model call, ` +
        'so they refuse rather than skip without a credential: a claim asserted by a test that did not run is worse than one reported pending.',
    );
  }
  return value;
}

/** What this file's model calls used, as the CLI reported each, printed so a CI log says where the money went. */
const spent = { calls: 0, inputTokens: 0, cachedTokens: 0, outputTokens: 0 };

function recordCost(stdout: string): void {
  const usage = parseEvents(stdout).usage;
  if (usage === undefined) return;
  spent.calls += 1;
  spent.inputTokens += usage.inputTokens;
  spent.cachedTokens += usage.cachedInputTokens;
  spent.outputTokens += usage.outputTokens;
  console.log(
    `[model-cost] ${expect.getState().currentTestName ?? '(outside a test)'}: in ${String(usage.inputTokens)} (cached ${String(usage.cachedInputTokens)}), out ${String(usage.outputTokens)}`,
  );
}

afterAll(() => {
  if (spent.calls === 0) return;
  console.log(`[model-cost] file total: ${String(spent.calls)} sessions, in ${String(spent.inputTokens)} (cached ${String(spent.cachedTokens)}), out ${String(spent.outputTokens)}`);
});

/** The CLI's own account of the sessions one sandbox ran, beside what its relay counted. */
export interface SessionCounts {
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
}

/** Every paid sandbox's reading and the CLI's account of it, kept for the meter control. */
export const meteredSessions: Array<{ readonly test: string; readonly reading: MeterReading | Error; readonly cli: SessionCounts }> = [];

export interface Harness {
  readonly driver: CodexDriver;
  readonly provider: LocalDockerProvider;
  readonly handle: SandboxHandle;
  /** The host directory behind the workspace mount. */
  readonly workspaceDir: string;
  /** The Vault root the provider was given, which no mount may be, sit inside, or contain (I1). */
  readonly vaultDir: string;
  /** The image the sandbox runs, for a test that provisions its own. */
  readonly image: string;
  /** The stable prefix every task of this harness shares, nonce included. */
  readonly stablePrefix: string;
  request(overrides?: Partial<TaskRequest>): TaskRequest;
  /** Every exec the driver made, in order. */
  readonly execs: ReadonlyArray<{ readonly cmd: readonly string[]; readonly env: Readonly<Record<string, string>> | undefined }>;
  /** Watches the driver's execs: `enter` runs as one starts and returns what to run when it ends. */
  observeExec(enter: (sandbox: SandboxHandle) => () => void): void;
  /** `count` more sandboxes like `handle`, each over its own workspace, torn down with the harness. */
  provisionMore(count: number): Promise<SandboxHandle[]>;
  /** Writes a file into the workspace, as an agent of an earlier seat could have. */
  plant(path: string, content: string): Promise<void>;
}

export interface HarnessOptions {
  /** Give the sandbox a relay holding the host's credential. Paid tests only. */
  readonly relay: boolean;
  readonly driver?: Partial<Omit<CodexDriverOptions, 'provider'>>;
}

export function spec(image: string, workspaceDir: string, relay: boolean): SandboxSpec {
  return {
    image,
    mounts: { workspace: { source: workspaceDir, target: WORKDIR, mode: 'rw' }, others: [] },
    // No egress at all: the relay, when there is one, is the sandbox's one route (P12).
    egress: { mode: 'deny-all', allow: [] },
    ...(relay ? { relay: { ...MODEL_RELAY, paths: [...MODEL_RELAY.paths], budget: { maxTokens: BUDGET.maxTokens, maxCostUsd: BUDGET.maxCostUsd } } } : {}),
    limits: { cpus: 2, memoryMb: 2048, pids: 512, wallClockMs: 600_000 },
    // The image's own `node` user. The workspace is opened to every uid below, as the Claude Code harness does.
    user: { uid: 1000, gid: 1000 },
  };
}

export async function withDriver<T>(options: HarnessOptions, body: (h: Harness) => Promise<T>): Promise<T> {
  const secret = options.relay ? credential() : undefined;
  const image = await ensureImage();
  const base = await mkdtemp(join(tmpdir(), 'codex-driver-'));
  const workspaceDir = join(base, 'workspace');
  const vaultDir = join(base, 'vault');
  await mkdir(workspaceDir, { recursive: true });
  await mkdir(vaultDir, { recursive: true });
  await chmod(workspaceDir, 0o777);
  const { LocalDockerProvider: Provider } = await import('@olympus-ai/sandbox');
  const provider = await Provider.create({
    vaultPaths: [vaultDir],
    ...(secret === undefined ? {} : { credentials: { [MODEL_CREDENTIAL]: secret } }),
  });
  const handle = await provider.provision(spec(image, workspaceDir, options.relay));
  const extra: SandboxHandle[] = [];
  const counts = new Map<SandboxHandle, SessionCounts>();
  const countsFor = (h: SandboxHandle): SessionCounts => {
    let c = counts.get(h);
    if (c === undefined) {
      c = { inputTokens: 0, cachedTokens: 0, outputTokens: 0 };
      counts.set(h, c);
    }
    return c;
  };
  let watcher: ((sandbox: SandboxHandle) => () => void) | undefined;
  const execs: Array<{ cmd: readonly string[]; env: Readonly<Record<string, string>> | undefined }> = [];
  const watched: SandboxProvider = {
    id: provider.id,
    provision: (s: SandboxSpec) => provider.provision(s),
    destroy: (h: SandboxHandle) => provider.destroy(h),
    capabilities: () => provider.capabilities(),
    exec: async (h: SandboxHandle, cmd: string[], o?: ExecOptions): Promise<ExecResult> => {
      const leave = watcher?.(h);
      execs.push({ cmd: [...cmd], env: o?.env });
      try {
        const result = await provider.exec(h, cmd, o);
        recordCost(result.stdout);
        const usage = parseEvents(result.stdout).usage;
        if (usage !== undefined) {
          const c = countsFor(h);
          c.inputTokens += usage.inputTokens;
          c.cachedTokens += usage.cachedInputTokens;
          c.outputTokens += usage.outputTokens;
        }
        return result;
      } finally {
        leave?.();
      }
    },
  };
  const driver = new CodexDriver({ provider: watched, workdir: WORKDIR, ...options.driver });
  const stablePrefix = `Run identifier: ${randomUUID()}. It is the same for every task of this run.`;
  const test = expect.getState().currentTestName ?? '(outside a test)';
  const harness: Harness = {
    driver,
    provider,
    handle,
    workspaceDir,
    vaultDir,
    image,
    stablePrefix,
    request: (overrides: Partial<TaskRequest> = {}): TaskRequest => ({
      taskId: 'probe' as TaskId,
      role: PROBE_ROLE,
      stablePrefix,
      variableSuffix: 'Reply with the single word: ready',
      tier: 'fast',
      tools: [],
      sandbox: handle,
      timeoutMs: 300_000,
      budget: BUDGET,
      ...overrides,
    }),
    execs,
    observeExec: (enter) => {
      watcher = enter;
    },
    provisionMore: async (count: number): Promise<SandboxHandle[]> => {
      for (let i = 0; i < count; i += 1) {
        const dir = join(base, `workspace-${String(extra.length)}`);
        await mkdir(dir, { recursive: true });
        await chmod(dir, 0o777);
        extra.push(await provider.provision(spec(image, dir, options.relay)));
      }
      return extra.slice(-count);
    },
    plant: async (path: string, content: string): Promise<void> => {
      const target = join(workspaceDir, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
    },
  };
  try {
    return await body(harness);
  } finally {
    for (const h of [handle, ...extra]) {
      const reading = await provider
        .destroy(h)
        .then((t) => t.meter)
        .catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))));
      if (options.relay) meteredSessions.push({ test, reading, cli: countsFor(h) });
    }
    await rm(base, { recursive: true, force: true });
  }
}

/** Runs `docker` on the host and returns its stdout. For reading a container from outside it. */
export async function dockerOut(args: string[]): Promise<string> {
  const { stdout } = await run('docker', args, { maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

/** Every process's environment and command line in the container, for a credential search. */
export const PROCESS_DUMP = 'for p in /proc/[0-9]*; do cat "$p/environ" "$p/cmdline" 2>/dev/null; printf "\\n"; done';
