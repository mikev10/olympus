/**
 * What the driver's assertions share: a real provider, real sandboxes, each
 * with a real model relay, and an endpoint the test owns (`endpoint.ts`) that
 * the relays reach and the sandboxes cannot.
 *
 * **These assertions require a Docker daemon and `openssl`, and fail without
 * either.** They are never skipped, for the reason the Claude Code driver's
 * harness gives: an assertion that skipped itself would leave the registry
 * counting a claim on a test that did not run. They call no model and cost
 * nothing.
 */
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Budget, CompiledRole, RoleId, TaskId, TaskRequest } from '@olympus-ai/core';
import { EGRESS_PROXY_IMAGE, LocalDockerProvider, relayOf, type ExecOptions, type ExecResult, type RelayCallRequest, type RelayCallResult, type SandboxHandle } from '@olympus-ai/sandbox';
import { ENDPOINT_CREDENTIAL, OpenAICompatibleDriver, type EndpointConfig } from '../src/index.js';
import { ENDPOINT_ORIGIN, ENDPOINT_PATH, makeCertificate, received, startEndpoint, type Certificate, type Received } from './endpoint.js';

const run = promisify(execFile);

export const WORKDIR = '/workspace';

/** A dollar per million input tokens, ten per million output, half a dollar per million cached. Round numbers, checked by hand. */
const PRICE = { inputPerMTok: 1, outputPerMTok: 10, cacheReadPerMTok: 0.5, cacheWritePerMTok: 0, cacheWrite1hPerMTok: 0 };

export const CONFIG: EndpointConfig = {
  upstream: ENDPOINT_ORIGIN,
  path: ENDPOINT_PATH,
  header: 'authorization',
  scheme: 'bearer',
  provider: 'test-endpoint',
  family: 'test-family',
  version: '2026-10-24',
  models: { fast: 'test-fast', standard: 'test-standard', deep: 'test-deep' },
  prices: { 'test-fast': PRICE, 'test-standard': PRICE, 'test-deep': PRICE },
  maxOutputTokens: 256,
  ceilingField: 'max_tokens',
  parallelism: 2,
  maxTurns: 8,
};

export const BUDGET: Budget = { maxTokens: 1_000_000, maxCostUsd: 10, maxWallClockMs: 240_000 };

export const ROLE: CompiledRole = {
  role: 'builder' as RoleId,
  instructions: 'You are the builder role of a test harness.',
  sha256: '0'.repeat(64),
};

/** One call the driver made into the provider: an `exec` with its argv, or a `relayCall` with its path as the one element. */
export interface SeenExec {
  readonly kind: 'exec' | 'relayCall';
  readonly handle: SandboxHandle;
  readonly argv: readonly string[];
  readonly startedAt: number;
  endedAt?: number;
}

export interface Harness {
  readonly provider: LocalDockerProvider;
  readonly driver: OpenAICompatibleDriver;
  /** The credential the provider holds for the relay. A canary: never a real key. */
  readonly secret: string;
  /** Every exec and relay call any driver built from this harness made, in order. */
  readonly execs: SeenExec[];
  /** A fresh sandbox with its relay reaching the endpoint, and its workspace on the host. */
  sandbox(): Promise<{ handle: SandboxHandle; workspace: string }>;
  request(handle: SandboxHandle, overrides?: Partial<TaskRequest>): TaskRequest;
  /** What the endpoint received, in order. */
  received(): Promise<Received[]>;
  /** A driver over the same provider with a different configuration. */
  driverWith(endpoint: EndpointConfig): OpenAICompatibleDriver;
}

let certificate: Certificate | undefined;

/** A provider whose exec and relay call are watched: what the driver ran, where, and when. */
function watched(provider: LocalDockerProvider, execs: SeenExec[]): LocalDockerProvider {
  return new Proxy(provider, {
    get(target, property, receiver) {
      if (property === 'relayCall') {
        return async (handle: SandboxHandle, request: RelayCallRequest): Promise<RelayCallResult> => {
          const seen: SeenExec = { kind: 'relayCall', handle, argv: [request.path], startedAt: Date.now() };
          execs.push(seen);
          try {
            return await target.relayCall(handle, request);
          } finally {
            seen.endedAt = Date.now();
          }
        };
      }
      if (property === 'exec') {
        return async (handle: SandboxHandle, argv: string[], options?: ExecOptions): Promise<ExecResult> => {
          const seen: SeenExec = { kind: 'exec', handle, argv: [...argv], startedAt: Date.now() };
          execs.push(seen);
          try {
            return await target.exec(handle, argv, options);
          } finally {
            seen.endedAt = Date.now();
          }
        };
      }
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

export async function withHarness<T>(body: (h: Harness) => Promise<T>, endpoint: EndpointConfig = CONFIG): Promise<T> {
  certificate ??= await makeCertificate();
  const secret = `canary-${randomUUID()}`;
  const id = randomUUID().slice(0, 8);
  const network = `oac-endpoint-${id}`;
  const endpointName = `oac-endpoint-${id}`;
  const base = await mkdtemp(join(tmpdir(), 'openai-compatible-'));
  const provider = await LocalDockerProvider.create({ vaultPaths: [], credentials: { [ENDPOINT_CREDENTIAL]: secret }, relayTrust: certificate.cert });
  const execs: SeenExec[] = [];
  const observed = watched(provider, execs);
  const live: SandboxHandle[] = [];
  await run('docker', ['network', 'create', network]);
  try {
    await startEndpoint(endpointName, network, certificate, secret);
    const driverWith = (config: EndpointConfig): OpenAICompatibleDriver => new OpenAICompatibleDriver({ provider: observed, endpoint: config, workdir: WORKDIR });
    const driver = driverWith(endpoint);
    return await body({
      provider,
      driver,
      secret,
      execs,
      driverWith,
      async sandbox() {
        const workspace = join(base, `ws-${String(live.length)}`);
        await mkdir(workspace, { recursive: true });
        const handle = await provider.provision({
          image: EGRESS_PROXY_IMAGE,
          mounts: { workspace: { source: workspace, target: WORKDIR, mode: 'rw' }, others: [] },
          egress: { mode: 'deny-all', allow: [] },
          limits: { cpus: 0.5, memoryMb: 256, pids: 64, wallClockMs: BUDGET.maxWallClockMs },
          user: { uid: 0, gid: 0 },
          relay: { ...driver.relayRequest(), budget: { maxTokens: BUDGET.maxTokens, maxCostUsd: BUDGET.maxCostUsd } },
        });
        live.push(handle);
        const relay = relayOf(provider.appliedControls(handle).egress);
        if (relay === undefined) throw new Error('the sandbox was provisioned without its relay');
        await run('docker', ['network', 'connect', network, relay.containerId]);
        return { handle, workspace };
      },
      request: (handle, overrides = {}) => ({
        taskId: 'task' as TaskId,
        role: ROLE,
        stablePrefix: 'the stable prefix',
        variableSuffix: '{"turns":[{"content":"done"}]}',
        tier: 'standard',
        tools: [],
        sandbox: handle,
        timeoutMs: BUDGET.maxWallClockMs,
        budget: BUDGET,
        ...overrides,
      }),
      received: () => received(endpointName),
    });
  } finally {
    for (const handle of live) await provider.destroy(handle).catch(() => undefined);
    await run('docker', ['rm', '--force', endpointName]).catch(() => undefined);
    await run('docker', ['network', 'rm', network]).catch(() => undefined);
    await rm(base, { recursive: true, force: true });
  }
}

/** The calls that were model calls: each made through the relay, never an exec in the sandbox (A-R6-05). */
export function modelCalls(execs: readonly SeenExec[]): SeenExec[] {
  return execs.filter((e) => e.kind === 'relayCall');
}

/** The most of `execs` that were running at one moment. */
export function mostAtOnce(execs: readonly SeenExec[]): number {
  let most = 0;
  for (const e of execs) {
    const overlapping = execs.filter((o) => o.startedAt <= e.startedAt && (o.endedAt ?? Infinity) > e.startedAt).length;
    most = Math.max(most, overlapping);
  }
  return most;
}

/** The argument vector and environment of every process the container user can read, read from inside (D-P5-20). */
export const PROCESS_DUMP = 'for p in /proc/[0-9]*; do cat "$p/environ" "$p/cmdline" 2>/dev/null; printf "\\n"; done';

/** Whether `secret` is anywhere in a container's own filesystem, searched from the host. Nothing is sent into the container. */
export function exportContains(container: string, secret: string): Promise<boolean> {
  const needle = Buffer.from(secret, 'utf8');
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['export', container], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let tail = Buffer.alloc(0);
    let found = false;
    child.stdout.on('data', (chunk: Buffer) => {
      if (found) return;
      const window = Buffer.concat([tail, chunk]);
      if (window.includes(needle)) found = true;
      else tail = window.subarray(Math.max(0, window.length - needle.length + 1));
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0 && !found) reject(new Error(`docker export exited ${String(code)}`));
      else resolve(found);
    });
  });
}

export async function dockerOut(args: string[]): Promise<string> {
  const { stdout } = await run('docker', args, { maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}
