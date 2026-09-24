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
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises';
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
  /** The stable prefix every task of this harness shares, nonce included. */
  readonly stablePrefix: string;
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
    // The image's own `node` user (image/Dockerfile), which the CLI's home belongs to.
    user: { uid: 1000, gid: 1000 },
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
  // One nonce per harness, so every task of this run shares a prefix that no
  // earlier run has ever presented to the cache.
  const prefix = stablePrefixFor(randomUUID());
  const image = await ensureImage();
  const base = await mkdtemp(join(tmpdir(), 'factory-driver-'));
  const workspaceDir = join(base, 'workspace');
  const vaultDir = join(base, 'vault');
  await mkdir(workspaceDir, { recursive: true });
  await mkdir(vaultDir, { recursive: true });
  // The container runs as a fixed user, and a bind mount carries the host's
  // ownership straight through: a workspace owned by any other uid is not
  // writable by the task, and the one thing the task is supposed to be able to
  // write is its workspace. On a developer's machine the two usually coincide
  // and this is a no-op; on a GitHub runner they do not -- the runner is uid
  // 1001 and the image's user is 1000 -- and without this the I1 assertion
  // fails having proved nothing about where commands ran.
  //
  // This makes the *fixture* usable. It does not fix the underlying constraint,
  // which is recorded as a known limit: a runtime that creates a workspace as a
  // uid the image does not run as hands the agent a read-only workspace.
  await chmod(workspaceDir, 0o777);
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
  // The run tells the driver which sandbox its artifacts belong in. `emitArtifacts`
  // takes a target directory and no handle, so a driver that has not been told
  // refuses rather than writing to the host (I1) — which is what it did the first
  // time this harness ran, because nothing here had said.
  driver.useSandbox(handle);

  const harness: Harness = {
    stablePrefix: prefix,
    driver,
    provider,
    handle,
    workspaceDir,
    request: (overrides: Partial<TaskRequest> = {}): TaskRequest => ({
      taskId: 'probe' as TaskId,
      role: 'builder' as TaskRequest['role'],
      stablePrefix: prefix,
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
 * The invariant half of the context: identical across every task of one run,
 * and different from every other run's.
 *
 * The nonce is what makes the cache measurement mean anything. The CLI's own
 * system prompt is large, identical between sessions, and cached account-wide,
 * so by the time this assertion runs, earlier tasks in the same suite have
 * already warmed it and a first task reads thousands of tokens from cache
 * before it has done anything. A prefix no session has ever presented cannot
 * be read from cache, so the first task must write it and only the second can
 * read it — which is the thing the split is supposed to buy.
 */
export function stablePrefixFor(nonce: string): string {
  return [`Run identifier: ${nonce}. It is the same for every task of this run.`, ...PREFIX_RULES].join('\n');
}

const PREFIX_RULES: readonly string[] = [
  'You are running inside a conformance assertion for a software factory runtime.',
  'The rules below are the same for every task in this run and never change between tasks.',
  'Answer in as few words as possible. Never explain. Never apologise. Never add preamble.',
  'When asked for a single word, reply with that word alone and nothing else.',
  'When asked to run a command, run it and report only what it printed.',
  'When asked to write a file, write it and say only the word written.',
  'Do not ask questions. Do not offer alternatives. Do not summarise what you did.',
  'These instructions are fixed context and are repeated verbatim on every task of this run,',
  'which is what makes them a stable prefix rather than a per-task instruction.',
  '',
  'Conventions that hold for every task, stated at length because a prefix worth caching is a prefix worth writing:',
  'Prefer the smallest change that satisfies the request, and make no change the request did not ask for.',
  'Never add a dependency to avoid writing five lines.',
  'Never widen a type to make a call site compile; fix the call site.',
  'Never catch an error you cannot handle; let it reach a caller that can.',
  'Never log and continue where a refusal is correct: a warning that lets a run proceed is a silent failure.',
  'A missing check, an absent capability, or an unsupported input is a refusal, never a degraded result.',
  'Name a thing for what it is, not for what uses it, and never for the ticket that introduced it.',
  'A comment says why, never what; if the what is unclear, the code is wrong.',
  'A test asserts one behaviour and names it in the sentence a reader sees when it fails.',
  'A test that still passes when the behaviour is deleted is not a test.',
  'Prefer a fixture that fails to compile over a fixture that fails at run time.',
  'Prefer an assertion about an observed fact over an assertion about a narrative.',
  'Do not mutate a record after it is constructed; construct a new one.',
  'Do not derive an identity from a name, an id, or a path; assign it deliberately.',
  'Do not read configuration from the working tree when the working tree is what is being judged.',
  'Do not put a secret in an argument vector, a file, or a prompt.',
  'Do not reach the network for something the task did not ask you to reach it for.',
  'Report what happened, not what was intended; if a step was skipped, say so.',
  'If two readings of an instruction lead to different work, say which you took and why.',
  'If a request cannot be satisfied as written, say what blocks it before doing something adjacent.',
  'Finish the whole of what was asked, or state plainly which part you did not do.',
];

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
export const MCP_SERVER_SOURCE = [
  "'use strict';",
  // The newline this protocol is framed by, built rather than written. A
  // literal escape here would be interpreted when this array is joined, not
  // when node runs the result, and the emitted source would carry a real line
  // break inside a string literal -- a syntax error, and one the CLI reports
  // only as an MCP server whose status is 'failed'.
  'const NL = String.fromCharCode(10);',
  "const name = process.argv[process.argv.length - 1] || 'probe';",
  "let buffer = '';",
  "process.stdin.on('data', function (chunk) {",
  '  buffer += chunk;',
  '  let index = buffer.indexOf(NL);',
  '  while (index !== -1) {',
  '    const line = buffer.slice(0, index).trim();',
  '    buffer = buffer.slice(index + 1);',
  "    if (line !== '') handle(line);",
  '    index = buffer.indexOf(NL);',
  '  }',
  '});',
  'function send(payload) { process.stdout.write(JSON.stringify(payload) + NL); }',
  'function handle(line) {',
  '  let message;',
  '  try { message = JSON.parse(line); } catch (error) { return; }',
  '  if (message.id === undefined) return;',
  "  if (message.method === 'initialize') {",
  "    send({ jsonrpc: '2.0', id: message.id, result: {",
  "      protocolVersion: '2024-11-05',",
  '      capabilities: { tools: {} },',
  "      serverInfo: { name: name, version: '0.0.0' },",
  '    } });',
  '    return;',
  '  }',
  "  if (message.method === 'tools/list') {",
  "    send({ jsonrpc: '2.0', id: message.id, result: { tools: [",
  "      { name: 'ping', description: 'Returns the single word pong.', inputSchema: { type: 'object', properties: {} } },",
  "      { name: 'ungranted', description: 'Exists so a grant naming only ping can be seen to exclude it.', inputSchema: { type: 'object', properties: {} } },",
  '    ] } });',
  '    return;',
  '  }',
  "  if (message.method === 'tools/call') {",
  "    send({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: 'pong' }] } });",
  '    return;',
  '  }',
  "  send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'no such method' } });",
  '}',
].join(String.fromCharCode(10));
