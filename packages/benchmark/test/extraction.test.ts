/**
 * Where an arm's token counts come from (R59): the relay's reading, as the
 * runtime read it at teardown or from the run's usage records, and never
 * what a driver said it used. Each test seats a driver whose own account
 * disagrees with the meter, so an arm that read the driver would fail here.
 */
import { describe, expect, test } from 'vitest';
import { costTotals } from '@olympus-ai/api';
import { StubDriver, type CompiledRole, type Driver, type ModelFamily, type RoleId, type RunId, type TaskId, type TaskRequest, type TaskResult } from '@olympus-ai/core';
import type { MeterReading, RelaySpec, SandboxHandle, SandboxProvider, SandboxSpec } from '@olympus-ai/sandbox';
import type { UsageReading, UsageRecord } from '@olympus-ai/vault';
import { aloneCall } from '../src/alone.js';
import { tokensByTask } from '../src/critic.js';

type Metered = Extract<MeterReading, { kind: 'metered' }>;

const READING: Metered = { kind: 'metered', calls: 4, inputTokens: 120, outputTokens: 30, cacheReadTokens: 5000, cacheWriteTokens: 700, costUsd: 0.02, exhausted: 'none', refused: 0 };

/** A driver that says it used a million tokens of each kind; the relay counted `READING`. */
function boasting(): Driver {
  const inner = new StubDriver();
  const price = { inputPerMTok: 1, outputPerMTok: 1, cacheReadPerMTok: 1, cacheWritePerMTok: 1, cacheWrite1hPerMTok: 1 };
  const relay = { upstream: 'https://model.invalid', paths: ['/v1'], header: 'x-api-key', scheme: 'raw', credential: 'none', urlVariable: 'MODEL_URL', meter: { dialect: 'anthropic-messages', prices: { stub: price } } } as unknown as Omit<RelaySpec, 'budget'>;
  return Object.assign(Object.create(inner) as Driver, {
    relayRequest: () => relay,
    runTask: async (req: TaskRequest): Promise<TaskResult> => ({
      ...(await inner.runTask(req)),
      claim: { narrative: '{"done": true, "reasons": []}', filesChanged: [] },
      usage: { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000, costUsd: 99, wallClockMs: 1 },
    }),
  });
}

/** A provider that starts nothing and reads `meter` at teardown. */
function provider(meter: MeterReading, specs: SandboxSpec[] = []): SandboxProvider {
  return {
    provision: (spec: SandboxSpec) => {
      specs.push(spec);
      return Promise.resolve('h' as SandboxHandle);
    },
    destroy: () => Promise.resolve({ meter, egress: { kind: 'none' } }),
  } as unknown as SandboxProvider;
}

const ROLE: CompiledRole = { role: 'done-checker' as RoleId, instructions: '', sha256: '0'.repeat(64) };

function call(meter: MeterReading) {
  return aloneCall({
    provider: provider(meter),
    driver: boasting(),
    role: ROLE,
    image: 'none',
    user: { uid: 1000, gid: 1000 },
    limits: { cpus: 1, memoryMb: 1, pids: 1 },
    tree: '/nowhere',
    asked: 'is it done',
    tier: 'fast',
    tools: [],
    budget: { maxTokens: 1000, maxCostUsd: 0.1, maxWallClockMs: 1000 },
  });
}

describe('the driver-alone call', () => {
  test('counts what the relay read at teardown, whatever the driver said it used', async () => {
    const outcome = await call(READING);
    expect(outcome.verdict).toStrictEqual({ kind: 'verdict', done: true, reasons: [] });
    expect(outcome.costUsd).toBe(0.02);
    expect(outcome.tokens).toStrictEqual({ calls: 1, inputTokens: 120, outputTokens: 30, cacheReadTokens: 5000, cacheWriteTokens: 700, exhausted: 0, bound: 'exact' });
  });

  test('a call that ended on its budget is counted as one, and an unreadable one makes the count a lower bound', async () => {
    expect((await call({ ...READING, exhausted: 'cost' })).tokens).toMatchObject({ exhausted: 1, bound: 'exact' });
    expect((await call({ ...READING, exhausted: 'unreadable' })).tokens).toMatchObject({ exhausted: 1, bound: 'lower' });
  });

  test('a call no relay metered is refused, never counted as free', async () => {
    await expect(call({ kind: 'unmetered' })).rejects.toThrow('the relay did not meter the driver-alone call');
  });
});

describe('the critic arm', () => {
  const record = (taskId: string, attempt: number, reading: UsageReading): UsageRecord => ({
    runId: 'r' as RunId,
    taskId: taskId as TaskId,
    station: 'spec',
    attempt,
    model: { provider: 'test', family: 'claude' as ModelFamily, model: 'scripted', version: '1' },
    role: { id: 'spec-critic' as RoleId, sha256: '0'.repeat(64) },
    driver: 'scripted',
    reading,
    timing: 'not-recorded',
    harnessImage: 'not-recorded',
    collectedBy: 'runtime',
  });

  test("counts each task's metered calls from the run's usage records, and records no task a relay never read", () => {
    const tokens = tokensByTask(costTotals([
      record('spec.drafter', 1, { kind: 'unmetered' }),
      record('spec.critic', 1, READING),
      record('spec.drafter', 2, { kind: 'unmetered' }),
      record('spec.critic', 2, { ...READING, exhausted: 'unreadable' }),
    ]).byTask);
    expect(tokens).toStrictEqual({ 'spec.critic': { calls: 2, inputTokens: 240, outputTokens: 60, cacheReadTokens: 10_000, cacheWriteTokens: 1400, exhausted: 1, bound: 'lower' } });
  });
});
