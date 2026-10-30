import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Policy, TriggerSchedule } from '@olympus-ai/core';
import type { Vault } from '@olympus-ai/vault';
import { startSchedules, type Intake } from '../src/index.js';

const HOUR = 3_600_000;
const START = Date.parse('2026-10-30T01:00:00Z');

/** A policy holding only the schedules the scheduler reads, changed in place as an edited policy file would be. */
function policyOf(schedules: TriggerSchedule[]): { current: Policy } {
  return { current: { triggers: { schedules } } as unknown as Policy };
}

function schedule(at: string): TriggerSchedule {
  return { id: 'nightly', template: 'intake-candidate', at };
}

describe('the daily schedule follows the current policy (codex-4)', () => {
  const fired: Array<{ at: string; date: string }> = [];
  const intake = {
    fire: (_policy: Policy, s: TriggerSchedule, date: string) => { fired.push({ at: s.at, date }); return Promise.resolve(); },
    missed: () => Promise.resolve(),
  } as unknown as Intake;
  const vault = { readTriggerDecisions: () => Promise.resolve([]) } as unknown as Vault;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    fired.length = 0;
  });
  afterEach(() => { vi.useRealTimers(); });

  test('a retimed schedule fires at its new time, not its old one', async () => {
    const policy = policyOf([schedule('02:00')]);
    const scheduler = await startSchedules(() => Promise.resolve(policy.current), vault, intake);
    policy.current = policyOf([schedule('18:00')]).current;
    await vi.advanceTimersByTimeAsync(2 * HOUR);
    expect(fired).toEqual([]);
    await vi.advanceTimersByTimeAsync(16 * HOUR);
    expect(fired).toEqual([{ at: '18:00', date: '2026-10-30' }]);
    scheduler.stop();
  });

  test('a schedule added while the service runs fires without a restart', async () => {
    const policy = policyOf([]);
    const scheduler = await startSchedules(() => Promise.resolve(policy.current), vault, intake);
    policy.current = policyOf([schedule('04:00')]).current;
    await vi.advanceTimersByTimeAsync(4 * HOUR);
    expect(fired).toEqual([{ at: '04:00', date: '2026-10-30' }]);
    scheduler.stop();
  });

  test('a removed schedule stops firing and is not armed again', async () => {
    const policy = policyOf([schedule('02:00')]);
    const scheduler = await startSchedules(() => Promise.resolve(policy.current), vault, intake);
    policy.current = policyOf([]).current;
    await vi.advanceTimersByTimeAsync(3 * 24 * HOUR);
    expect(fired).toEqual([]);
    expect(vi.getTimerCount()).toBeLessThanOrEqual(1);
    scheduler.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});
