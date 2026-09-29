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
import { isAgentStation, maxStarts, STATION_CONTRACTS, StrictPolicyEngine } from '@olympus-ai/core';
import type { Policy, RoleId, RunState, StationId, TaskGraph, TaskId } from '@olympus-ai/core';
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

/** One task's share of the worst case: every driver call it can make, each at its role's ceiling. */
export interface WorstCaseTask {
  readonly task: TaskId;
  readonly station: StationId;
  readonly role: RoleId;
  /** `maxStarts` for the task's station: the most times the line will invoke a driver for it, replays included. */
  readonly calls: number;
  readonly maxCostUsdPerCall: number;
  readonly usd: number;
}

/**
 * The most a run can be charged, known before it starts: for every task at a
 * station that calls a driver, the most calls the line will make for it times
 * its role's `Budget.maxCostUsd`, summed. It is a bound the line enforces, not
 * an estimate, and it needs no history (D-P9-03).
 *
 * Exact for the run as admitted. It inherits P13's stated limit: a call that
 * starts under its budget may end over it by at most one response.
 */
export interface WorstCaseCost {
  /** Rounded up to a millionth of a dollar per task, so the figure a person approves is the figure compared and never below the ceiling. */
  readonly usd: number;
  readonly calls: number;
  readonly tasks: readonly WorstCaseTask[];
}

const MICRO = 1_000_000;

export function worstCaseCost(graph: TaskGraph, policy: Policy): WorstCaseCost {
  const engine = new StrictPolicyEngine();
  const tasks: WorstCaseTask[] = [];
  for (const task of graph.tasks) {
    if (!isAgentStation(task.station)) continue;
    const resolved = engine.resolveCapabilities(task.role, task.station, policy);
    // Admission resolves every role the graph schedules before it asks for this figure.
    if (!resolved.ok) throw new Error(`worst-case cost: role ${task.role} has no scope at ${task.station}: ${resolved.detail}`);
    const calls = maxStarts(STATION_CONTRACTS[task.station]);
    const perCall = resolved.scope.budget.maxCostUsd;
    tasks.push({ task: task.id, station: task.station, role: task.role, calls, maxCostUsdPerCall: perCall, usd: Number(microsCeiling(perCall, calls)) / MICRO });
  }
  const micro = tasks.reduce((sum, t) => sum + microsCeiling(t.maxCostUsdPerCall, t.calls), 0n);
  return { usd: Number(micro) / MICRO, calls: tasks.reduce((sum, t) => sum + t.calls, 0), tasks };
}

/**
 * `calls` times `usd`, in whole millionths of a dollar, rounded up, so a
 * task's share is never less than the ceiling it stands for. Computed exactly
 * from the number's shortest decimal spelling, the one the policy author
 * wrote, so `0.07` is 70000 and not the 70001 that `Math.ceil(0.07 * 1e6)`
 * gives from the binary value.
 */
export function microsCeiling(usd: number, calls = 1): bigint {
  if (!Number.isFinite(usd) || usd < 0) throw new Error(`worst-case cost: ${String(usd)} is not a non-negative amount`);
  if (!Number.isSafeInteger(calls) || calls < 0) throw new Error(`worst-case cost: ${String(calls)} is not a count of calls`);
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(String(usd));
  // String() of a finite non-negative number always has this shape.
  if (match === null) throw new Error(`worst-case cost: cannot read ${String(usd)} as a decimal`);
  const fraction = match[2] ?? '';
  // usd = units / 10^scale exactly, where the exponent moves the point.
  const units = BigInt((match[1] ?? '0') + fraction) * BigInt(calls);
  const scale = fraction.length - Number(match[3] ?? '0') - 6;
  if (scale <= 0) return units * 10n ** BigInt(-scale);
  const divisor = 10n ** BigInt(scale);
  return (units + divisor - 1n) / divisor;
}
