/**
 * Whether tokens were spent well, from usage records alone (R59): what a
 * task read for what it wrote, and which tasks ended on a spent budget. The
 * records here are written by hand, so each rule's edge is one record away
 * from the case beside it.
 */
import { describe, expect, test } from 'vitest';
import type { ModelFamily, RoleId, RunId, StationId, TaskId } from '@olympus-ai/core';
import type { UsageReading, UsageRecord } from '@olympus-ai/vault';
import { spentBudgets, tokenEfficiency } from '../src/index.js';

type Metered = Extract<UsageReading, { kind: 'metered' }>;

const metered = (over: Partial<Metered> = {}): Metered => ({
  kind: 'metered', calls: 1, inputTokens: 100, outputTokens: 10, cacheReadTokens: 300, cacheWriteTokens: 100, costUsd: 0.002, exhausted: 'none', refused: 0, ...over,
});

function record(taskId: string, attempt: number, reading: UsageReading, station: StationId = 'build'): UsageRecord {
  return {
    runId: 'r59' as RunId,
    taskId: taskId as TaskId,
    station,
    attempt,
    model: { provider: 'test', family: 'claude' as ModelFamily, model: 'scripted', version: '1' },
    role: { id: 'builder' as RoleId, sha256: '0'.repeat(64) },
    driver: 'scripted',
    reading,
    timing: 'not-recorded',
    harnessImage: 'not-recorded',
    collectedBy: 'runtime',
  };
}

describe('tokenEfficiency', () => {
  test('a task read its input, cache-read, and cache-write tokens for the output it wrote, summed over its calls', () => {
    const [a, b] = tokenEfficiency([record('a', 1, metered()), record('b', 1, metered({ inputTokens: 7, cacheReadTokens: 593_220, cacheWriteTokens: 0, outputTokens: 6_976 })), record('a', 2, metered())]);
    expect(a).toStrictEqual({ taskId: 'a', readTokens: 1000, writtenTokens: 20, readPerWritten: { kind: 'ratio', value: 50 }, bound: 'exact' });
    expect(b?.readTokens).toBe(593_227);
    expect(b?.readPerWritten).toStrictEqual({ kind: 'ratio', value: 593_227 / 6_976 });
  });

  test('a task that wrote nothing has no ratio, never zero and never infinite', () => {
    const [silent, unmetered] = tokenEfficiency([record('silent', 1, metered({ outputTokens: 0 })), record('unmetered', 1, { kind: 'unmetered' })]);
    expect(silent?.readPerWritten).toStrictEqual({ kind: 'no-sample' });
    expect(unmetered).toStrictEqual({ taskId: 'unmetered', readTokens: 0, writtenTokens: 0, readPerWritten: { kind: 'no-sample' }, bound: 'lower' });
  });

  test('a call the relay could not read, or one that was lost, makes the task a lower bound', () => {
    const [unreadable, lost] = tokenEfficiency([
      record('unreadable', 1, metered({ exhausted: 'unreadable' })),
      record('lost', 1, metered()),
      record('lost', 2, { kind: 'lost', detail: 'the sandbox could not be read' }),
    ]);
    expect(unreadable?.bound).toBe('lower');
    expect(lost).toMatchObject({ readTokens: 500, bound: 'lower' });
  });
});

describe('spentBudgets', () => {
  test('names a task whose last call reached the token or the cost bound, with the bound and the start', () => {
    const spent = spentBudgets([
      record('tokens', 1, metered()),
      record('tokens', 2, metered({ exhausted: 'tokens', refused: 3 })),
      record('cost', 1, metered({ exhausted: 'cost' }), 'review'),
    ]);
    expect(spent.map((s) => [s.taskId, s.station, s.attempt, s.bound, s.refused])).toStrictEqual([['tokens', 'build', 2, 'tokens', 3], ['cost', 'review', 1, 'cost', 0]]);
    expect(spent[0]?.message).toBe('task tokens ended on a spent budget: its last call, start 2 at build, reached the token bound of its budget');
    expect(spent[1]?.message).toContain('cost bound');
  });

  test('does not name a task whose earlier call ran out and whose last did not', () => {
    expect(spentBudgets([record('recovered', 1, metered({ exhausted: 'cost' })), record('recovered', 2, metered())])).toStrictEqual([]);
  });

  test('a pending reading its own terminal reading followed is not the last call', () => {
    const spent = spentBudgets([record('a', 1, { kind: 'pending' }), record('a', 1, metered({ exhausted: 'cost' }))]);
    expect(spent.map((s) => s.taskId)).toStrictEqual(['a']);
  });

  test('a reading stopped as unreadable, a lost last call, and a call nothing read are not spent budgets', () => {
    expect(spentBudgets([
      record('unreadable', 1, metered({ exhausted: 'unreadable' })),
      record('lost', 1, metered({ exhausted: 'cost' })),
      record('lost', 2, { kind: 'lost', detail: 'gone' }),
      record('stopped', 1, metered({ exhausted: 'tokens' })),
      record('stopped', 2, { kind: 'pending' }),
      record('unmetered', 1, { kind: 'unmetered' }),
    ])).toStrictEqual([]);
  });
});
