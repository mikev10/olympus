/**
 * What a run cost, derived from its `UsageRecord`s and nothing else (D-P13-08).
 *
 * No total is stored anywhere: a stored total is a second figure that can
 * disagree with its parts, so every total here is recomputed from the records
 * each time it is asked for. The records are what the relay counted, read by
 * the runtime after each sandbox stopped (I2); what a driver reported it used
 * is in its `TaskResult` and is not an input here.
 *
 * A call whose sandbox had no relay is `unmetered`. Its cost is not zero, it
 * is unknown, so a total counts such calls separately and its figures cover
 * the metered calls alone. A consumer that shows a total with a non-zero
 * `unmetered` beside it is showing a floor, and the type says so.
 */
import type { RunState, StationId, TaskId } from '@olympus-ai/core';
import type { UsageRecord, Vault } from '@olympus-ai/vault';

/** Sums over the calls a relay counted. */
export interface MeteredTotal {
  readonly calls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly costUsd: number;
  /** Calls whose budget ran out, for whatever reason the reading gives. */
  readonly exhausted: number;
}

export interface UsageTotal {
  /** Every driver call recorded, metered or not. */
  readonly calls: number;
  /** Calls with no reading behind them. While this is non-zero, `metered` is a floor, not the total. */
  readonly unmetered: number;
  readonly metered: MeteredTotal;
}

export interface CostTotals {
  readonly run: UsageTotal;
  readonly byStation: Readonly<Partial<Record<StationId, UsageTotal>>>;
  readonly byTask: Readonly<Record<TaskId, UsageTotal>>;
}

const EMPTY: UsageTotal = {
  calls: 0,
  unmetered: 0,
  metered: { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, exhausted: 0 },
};

function add(total: UsageTotal, record: UsageRecord): UsageTotal {
  const r = record.reading;
  if (r.kind === 'unmetered') return { ...total, calls: total.calls + 1, unmetered: total.unmetered + 1 };
  const m = total.metered;
  return {
    calls: total.calls + 1,
    unmetered: total.unmetered,
    metered: {
      calls: m.calls + 1,
      inputTokens: m.inputTokens + r.inputTokens,
      outputTokens: m.outputTokens + r.outputTokens,
      cacheReadTokens: m.cacheReadTokens + r.cacheReadTokens,
      cacheWriteTokens: m.cacheWriteTokens + r.cacheWriteTokens,
      costUsd: m.costUsd + r.costUsd,
      exhausted: m.exhausted + (r.exhausted === 'none' ? 0 : 1),
    },
  };
}

/** Totals per run, per station, and per task, each the sum of its records in the order they were written. */
export function costTotals(records: readonly UsageRecord[]): CostTotals {
  let run = EMPTY;
  const byStation: Partial<Record<StationId, UsageTotal>> = {};
  const byTask: Record<TaskId, UsageTotal> = {};
  for (const record of records) {
    run = add(run, record);
    byStation[record.station] = add(byStation[record.station] ?? EMPTY, record);
    byTask[record.taskId] = add(Object.hasOwn(byTask, record.taskId) ? (byTask[record.taskId] ?? EMPTY) : EMPTY, record);
  }
  return { run, byStation, byTask };
}

/**
 * The run's usage records, read back from the Vault in the order run state
 * references them. A record that is not one the runtime wrote for this run is
 * refused rather than summed.
 */
export async function readUsage(vault: Vault, state: RunState): Promise<UsageRecord[]> {
  const records: UsageRecord[] = [];
  for (const ref of state.usage) {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(await vault.read(ref)));
    const record = parsed as Partial<UsageRecord> | null;
    if (record?.collectedBy !== 'runtime' || record.runId !== state.runId || typeof record.taskId !== 'string' || typeof record.reading !== 'object') {
      throw new Error(`cost: a usage record referenced by run ${state.runId} is not one the runtime collected for it`);
    }
    records.push(record as UsageRecord);
  }
  return records;
}
