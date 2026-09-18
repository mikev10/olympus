/**
 * What the model-calling assertions share: a real container, a real egress
 * allowlist, and a real credential.
 *
 * **These assertions require a Docker daemon and an `ANTHROPIC_API_KEY`, and
 * they fail without either.** They are never skipped. An assertion that
 * skipped itself would leave the registry reporting a capability claim as
 * asserted on the strength of a test that did not run, which is worse than
 * reporting it pending: the pending entry at least names what is owed. That is
 * the reason `local-sandbox.ts` gives for the mount assertions, and the reason
 * holds here for the same shape of evidence.
 *
 * They also cost money. Every task in this file is the smallest one that can
 * prove its point, and the prompts ask for one word wherever a word will do.
 */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Budget, TaskId, TaskRequest } from '@olympus-ai/core';
import type { ExecOptions, LocalDockerProvider, SandboxHandle, SandboxProvider, SandboxSpec } from '@olympus-ai/sandbox';
import { CREDENTIAL_VARIABLE, ClaudeCodeDriver, ensureImage, type ClaudeCodeDriverOptions } from '../src/index.js';

/**
 * The one host the sandbox may reach. The allowlist grants the API and nothing
 * else, so a task that wanted anything more — a package registry, an analytics
 * endpoint — is refused by the proxy rather than quietly served.
 */
export const API_HOST = 'api.anthropic.com';

/** Where the workspace mount lands inside the container, and where the driver runs. */
export const WORKDIR = '/workspace';

export const BUDGET: Budget = { maxTokens: 20_000, maxCostUsd: 1, maxWallClockMs: 300_000 };

/**
 * The credential, or a failure that names what is missing. Read once per call
 * rather than captured, so a test that unsets it sees it gone.
 */
export function credential(): string {
  const value = process.env[CREDENTIAL_VARIABLE];
  if (value === undefined || value.trim() === '') {
    throw new Error(
      `${CREDENTIAL_VARIABLE} is not set. The driver's capability claims are proven against a real model call, ` +
        'so they refuse rather than skip when there is no credential: a claim asserted by a test that did not run ' +
        'is worse than a claim reported pending.',
    );
  }
  return value;
}

export interface Harness {
  readonly driver: ClaudeCodeDriver;
  readonly provider: LocalDockerProvider;
  readonly handle: SandboxHandle;
  /** The host directory behind the workspace mount, so a test can look at what a task left. */
  readonly workspaceDir: string;
  request(overrides?: Partial<TaskRequest>): TaskRequest;
  /**
   * Watches the driver's own execs. `enter` runs when one starts and returns
   * what to run when it ends, so a test can count how many are inside the
   * sandbox at once. Only one watcher is held; a second replaces the first.
   */
  observeExec(enter: () => () => void): void;
}

function spec(image: string, workspaceDir: string): SandboxSpec {
  return {
    image,
    mounts: { workspace: { source: workspaceDir, target: WORKDIR, mode: 'rw' }, others: [] },
    // The allowlist P10 delivers. `deny-all` cannot reach the model API at
    // all, which is why P5 waited for it.
    egress: { mode: 'allowlist', allow: [API_HOST] },
    limits: { cpus: 2, memoryMb: 2048, pids: 512, wallClockMs: 600_000 },
  };
}

/**
 * Provisions a sandbox, builds the image if the host does not hold it, and
 * hands `body` a driver wired to both. Everything is torn down when `body`
 * settles, whether it threw or not.
 */
export async function withDriver<T>(
  body: (h: Harness) => Promise<T>,
  options: Partial<Omit<ClaudeCodeDriverOptions, 'provider'>> = {},
): Promise<T> {
  const secret = credential();
  const image = await ensureImage();
  const base = await mkdtemp(join(tmpdir(), 'factory-driver-'));
  const workspaceDir = join(base, 'workspace');
  const vaultDir = join(base, 'vault');
  await mkdir(workspaceDir, { recursive: true });
  await mkdir(vaultDir, { recursive: true });
  const { LocalDockerProvider: Provider } = await import('@olympus-ai/sandbox');
  // A Vault root that exists and holds nothing: the provider requires one, and
  // no mount here may be it, sit inside it, or contain it (I1).
  const provider = await Provider.create({ vaultPaths: [vaultDir] });
  const handle = await provider.provision(spec(image, workspaceDir));

  // The driver is given a provider that reports each exec as it starts and
  // ends. It is the real provider underneath — nothing is stubbed — so an
  // assertion about concurrency reads the same containers everything else does.
  let watcher: (() => () => void) | undefined;
  const watched: SandboxProvider = {
    id: provider.id,
    provision: (s: SandboxSpec) => provider.provision(s),
    destroy: (h: SandboxHandle) => provider.destroy(h),
    capabilities: () => provider.capabilities(),
    exec: async (h: SandboxHandle, cmd: string[], o?: ExecOptions) => {
      const leave = watcher?.();
      try {
        return await provider.exec(h, cmd, o);
      } finally {
        leave?.();
      }
    },
  };
  const driver = new ClaudeCodeDriver({ provider: watched, credential: secret, workdir: WORKDIR, ...options });

  const harness: Harness = {
    driver,
    provider,
    handle,
    workspaceDir,
    request: (overrides: Partial<TaskRequest> = {}): TaskRequest => ({
      taskId: 'probe' as TaskId,
      role: 'builder' as TaskRequest['role'],
      stablePrefix: STABLE_PREFIX,
      variableSuffix: 'Reply with the single word: ready',
      tier: 'fast',
      tools: [],
      sandbox: handle,
      timeoutMs: 300_000,
      budget: BUDGET,
      ...overrides,
    }),
    observeExec: (enter: () => () => void): void => {
      watcher = enter;
    },
  };

  try {
    return await body(harness);
  } finally {
    await provider.destroy(handle).catch(() => undefined);
    await rm(base, { recursive: true, force: true });
  }
}

/**
 * The invariant half of the context, long enough to be worth caching and
 * identical across every task that uses it. The cache-read assertion turns on
 * two tasks presenting this same prefix and differing only in their suffix, so
 * changing this text changes what that assertion measures.
 */
export const STABLE_PREFIX = [
  'You are running inside a conformance assertion for a software factory runtime.',
  'The rules below are the same for every task in this run and never change between tasks.',
  'Answer in as few words as possible. Never explain. Never apologise. Never add preamble.',
  'When asked for a single word, reply with that word alone and nothing else.',
  'When asked to run a command, run it and report only what it printed.',
  'When asked to write a file, write it and say only the word written.',
  'Do not ask questions. Do not offer alternatives. Do not summarise what you did.',
  'These instructions are fixed context and are repeated verbatim on every task of this run,',
  'which is what makes them a stable prefix rather than a per-task instruction.',
].join('\n');

/**
 * A minimal stdio MCP server, passed to `node --eval` as one argv element.
 *
 * The same trick the egress proxy uses (`PROXY_SOURCE`): no image to build, no
 * mount, and nothing between this source and what runs. It exists so the `mcp`
 * claim can be proven without reaching a package registry — the sandbox's
 * allowlist grants the model API and nothing else, so an assertion that had to
 * `npx` a server would fail for a reason that has nothing to do with MCP.
 *
 * It speaks the newline-delimited JSON-RPC the CLI expects and offers two
 * tools: one a grant names and one it does not, so "no tool beyond the grant"
 * has something to exclude. The server names itself from its last argument, so
 * two of them can run side by side and be told apart.
 */
export const MCP_SERVER_SOURCE = `'use strict';
const name = process.argv[process.argv.length - 1] || 'probe';
let buffer = '';
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let index = buffer.indexOf('\n');
  while (index !== -1) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line !== '') handle(line);
    index = buffer.indexOf('\n');
  }
});
function send(payload) { process.stdout.write(JSON.stringify(payload) + '\n'); }
function handle(line) {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  if (message.id === undefined) return;
  if (message.method === 'initialize') {
    send({ jsonrpc: '2.0', id: message.id, result: {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: name, version: '0.0.0' },
    } });
    return;
  }
  if (message.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: message.id, result: { tools: [
      { name: 'ping', description: 'Returns the single word pong.', inputSchema: { type: 'object', properties: {} } },
      { name: 'ungranted', description: 'Exists so a grant that names only ping can be seen to exclude it.', inputSchema: { type: 'object', properties: {} } },
    ] } });
    return;
  }
  if (message.method === 'tools/call') {
    send({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: 'pong' }] } });
    return;
  }
  send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'no such method' } });
}
`;
