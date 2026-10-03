/**
 * The per-run report (D-I1b-07). Every figure is read from the Vault — run
 * state, the usage records, the evidence bundles, P14's enforcement record,
 * and the integration records — and never from a model's account (I2). A
 * claim appears only as the runtime's diff of it against the evidence.
 */
import { M1_STATIONS } from '@olympus-ai/core';
import type { ModelIdentity, RunId, StationId, TaskAttempts, TaskId, TaskStatus } from '@olympus-ai/core';
import type { EnforcementDecision, EvidenceBundle, IntegrationRecord, Vault } from '@olympus-ai/vault';
import { costTotals, readUsage, type CostTotals } from './cost.js';
import { readIntegration } from './line.js';
import { runStanding, type RunStanding } from './run.js';

/** Where a station's exit gate stands, derived from the run's position and standing. */
export type GateOutcome = 'passed' | 'awaiting-approval' | 'stopped' | 'open' | 'not-reached';

export interface StationReport {
  readonly station: StationId;
  readonly gate: GateOutcome;
  /** Iterations, retries, and starts summed over the tasks that ran at this station. */
  readonly attempts: TaskAttempts;
  /** Human approvals granted for this station's exit, from P14's record. */
  readonly approvals: number;
  /** Refusals P14 recorded at this station, by reason. */
  readonly refusals: Readonly<Record<string, number>>;
}

export interface RunReport {
  readonly runId: RunId;
  readonly requestedLevel: number;
  readonly standing: RunStanding;
  readonly cost: CostTotals;
  /**
   * Cache-read tokens over all input tokens — input, cache read, and cache
   * write — of the metered calls; null when no call was metered.
   */
  readonly cacheHitRate: number | null;
  /** Each driver call's model, as the runtime resolved it before the call (A-I1a-01). */
  readonly calls: ReadonlyArray<{ readonly taskId: TaskId; readonly station: StationId; readonly attempt: number; readonly model: ModelIdentity }>;
  readonly tasks: ReadonlyArray<{ readonly taskId: TaskId; readonly station: StationId | null; readonly status: TaskStatus; readonly attempts: TaskAttempts }>;
  readonly stations: readonly StationReport[];
  /** Where the agent's claim and the runtime's evidence differ, per evidence bundle. */
  readonly mismatches: ReadonlyArray<{ readonly taskId: TaskId; readonly diffSha256: string; readonly differences: readonly string[] }>;
  /** Every decision P14 recorded, by cause. */
  readonly decisions: Readonly<Record<string, number>>;
  /** Station refusals by reason, the parks among them by cause. */
  readonly refusals: Readonly<Record<string, number>>;
  readonly parks: Readonly<Record<string, number>>;
  readonly integration: readonly IntegrationRecord[];
}

const decode = (bytes: Uint8Array): unknown => JSON.parse(new TextDecoder().decode(bytes));

function bump(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function gateAt(index: number, current: number, standing: RunStanding): GateOutcome {
  if (standing.standing === 'passed') return 'passed';
  if (index < current) return 'passed';
  if (index > current) return 'not-reached';
  return standing.standing;
}

export async function runReport(vault: Vault, runId: RunId): Promise<RunReport> {
  const { state, standing } = await runStanding(vault, runId);
  const admission = decode(await vault.read(state.admission)) as { run?: { requestedLevel?: unknown } } | null;
  const requestedLevel = admission?.run?.requestedLevel;
  if (typeof requestedLevel !== 'number') throw new Error(`report: the admission record of run ${runId} names no level`);

  const usage = await readUsage(vault, state);
  const cost = costTotals(usage);
  const m = cost.run.metered;
  const input = m.inputTokens + m.cacheReadTokens + m.cacheWriteTokens;
  const calls = usage.filter((r) => r.reading.kind !== 'pending').map((r) => ({ taskId: r.taskId, station: r.station, attempt: r.attempt, model: r.model }));

  // A task's station is the one its calls were made at; a task that made none has none to report.
  const stationOf = new Map<TaskId, StationId>(usage.map((r) => [r.taskId, r.station]));
  const tasks = Object.entries(state.tasks).map(([id, status]) => {
    const taskId = id as TaskId;
    const attempts = state.attempts[taskId] ?? { iterations: 0, retries: 0, starts: 0 };
    return { taskId, station: stationOf.get(taskId) ?? null, status, attempts };
  });

  const decisions: EnforcementDecision[] = [];
  for (const ref of await vault.readDecisions(runId)) decisions.push(decode(await vault.read(ref)) as EnforcementDecision);
  const byCause: Record<string, number> = {};
  const refusals: Record<string, number> = {};
  const parks: Record<string, number> = {};
  for (const d of decisions) {
    bump(byCause, d.decision.cause);
    if (d.decision.cause === 'station-refused') {
      bump(refusals, d.decision.refusal.reason);
      if (d.decision.refusal.reason === 'parked') bump(parks, d.decision.refusal.cause);
    }
  }

  const current = M1_STATIONS.indexOf(state.station);
  const stations = M1_STATIONS.map((station, index): StationReport => {
    const attempts = tasks.filter((t) => t.station === station).reduce(
      (sum, t) => ({ iterations: sum.iterations + t.attempts.iterations, retries: sum.retries + t.attempts.retries, starts: sum.starts + t.attempts.starts }),
      { iterations: 0, retries: 0, starts: 0 },
    );
    const at = decisions.filter((d) => d.station === station);
    const stationRefusals: Record<string, number> = {};
    for (const d of at) if (d.decision.cause === 'station-refused') bump(stationRefusals, d.decision.refusal.reason);
    return {
      station,
      gate: gateAt(index, current, standing),
      attempts,
      approvals: at.filter((d) => d.decision.cause === 'approval-granted').length,
      refusals: stationRefusals,
    };
  });

  const mismatches: Array<{ taskId: TaskId; diffSha256: string; differences: readonly string[] }> = [];
  for (const ref of state.evidenceRefs) {
    const bundle = decode(await vault.read(ref)) as EvidenceBundle;
    if (bundle.claimEvidenceDiff.length > 0) mismatches.push({ taskId: bundle.taskId, diffSha256: bundle.diffSha256, differences: bundle.claimEvidenceDiff });
  }

  return {
    runId,
    requestedLevel,
    standing,
    cost,
    cacheHitRate: input === 0 ? null : m.cacheReadTokens / input,
    calls,
    tasks,
    stations,
    mismatches,
    decisions: byCause,
    refusals,
    parks,
    integration: await readIntegration(vault, runId),
  };
}
