/**
 * Outcome measurement across runs (R2, `docs/plan/R2-outcomes.md`). Every
 * figure is derived from Vault records — admission, run state, evidence,
 * P13's usage, P14's decisions, and the integration record — and never from
 * a model's account or from what a workspace holds now (I2). The same records
 * read twice give the same figures, so any of them can be recomputed from the
 * Vault alone (D-A-BR-05).
 *
 * Two kinds of number, never blended: safety (work the line called done that
 * was not) and throughput (how much it finishes without a human).
 */
import { approvalKey } from '@olympus-ai/core';
import type { AutonomyLevel, ModelIdentity, RunId, RunState, StationId, TaskId, TaskStatus } from '@olympus-ai/core';
import { isNoRunState, type AdmissionRecord, type EnforcementDecision, type EvidenceBundle, type IntegrationRecord, type UsageRecord, type Vault } from '@olympus-ai/vault';
import { distribution, failureRate, successRate, type Distribution, type Proportion } from './bounds.js';
import { costTotals, readUsage, type UsageTotal } from './cost.js';
import { readIntegration } from './line.js';

/**
 * How a run ended, read from its records alone. `passed` crossed its last exit
 * with no merge recorded: a run with no integrator, which a human merges.
 * `unfinished` is every run with no terminal record yet.
 */
export type RunEnding = 'refused' | 'merged' | 'passed' | 'cancelled' | 'halted' | 'parked' | 'unfinished';

/** One attempt: one evidence bundle, judged by the runtime's verdict, with whether the agent's claim held. */
export interface AttemptRecord {
  readonly outcome: 'passed' | 'failed';
  readonly claimMismatch: boolean;
}

export interface TaskRecord {
  readonly taskId: TaskId;
  /** The station its calls were made at, from the usage records; null for a task that made none. */
  readonly station: StationId | null;
  readonly status: TaskStatus;
  readonly iterations: number;
  readonly attempts: readonly AttemptRecord[];
  /** The model of the task's first call, from the usage record of its first start. */
  readonly firstModel: string | null;
  /** Every model the task's calls were resolved to; more than one is a task that escalated. */
  readonly models: readonly string[];
}

/** Everything R2 reads about one run, as the Vault holds it. */
export interface RunRecords {
  readonly runId: RunId;
  readonly ending: RunEnding;
  /** Null for a run refused at admission, which has no admission record. */
  readonly requestedLevel: AutonomyLevel | null;
  /** Admission time; for a run refused at admission, the refusal's. Null where neither exists. */
  readonly startedAt: string | null;
  /** GitHub's merge time (A-R2-01); null unless merged. */
  readonly mergedAt: string | null;
  readonly approvalsSpent: number;
  readonly tasks: readonly TaskRecord[];
  readonly decisions: readonly EnforcementDecision[];
  readonly usage: readonly UsageRecord[];
  /** Null for a run with no state. */
  readonly cost: UsageTotal | null;
}

/** A window over admission time, inclusive at `from` and exclusive at `to`. */
export interface OutcomeWindow {
  readonly from?: string;
  readonly to?: string;
}

export type Keyed<T> = Readonly<Record<string, T>>;

export interface Outcomes {
  readonly window: OutcomeWindow;
  readonly population: Readonly<Record<RunEnding, number>> & { readonly total: number };
  readonly safety: {
    /** Attempts the agent ended whose verdict was not a pass, or whose claim differed from the evidence. */
    readonly caughtFalseDone: Proportion;
    readonly caughtFalseDoneByStation: Keyed<Proportion>;
    /** Keyed by the task's one model, or `escalated` where its calls ran on more than one. */
    readonly caughtFalseDoneByModel: Keyed<Proportion>;
    readonly caughtFalseDoneByLevel: Keyed<Proportion>;
    /** A change that passed every gate and failed later needs `observe` (R8). Never implied to be zero. */
    readonly escapedFalseDone: 'not-established';
  };
  readonly throughput: {
    /** Merged runs that spent no approval, over admitted runs that finished. Per run: approvals are granted per station exit. */
    readonly autonomyRatio: Proportion;
    readonly autonomyRatioByLevel: Keyed<Proportion>;
    readonly firstPassYieldByStation: Keyed<Proportion>;
    /** Keyed by the model of each task's first call. */
    readonly firstPassYieldByModel: Keyed<Proportion>;
    /** The product of the per-station yields; null when any station has no sample. */
    readonly rolledYield: number | null;
    readonly iterationsToGreen: Distribution;
    readonly attemptsPerTask: Distribution;
    /** Runs whose `review` exit was refused for any reason but a pending approval, over runs that seated a reviewer. */
    readonly reviewExitRefused: Proportion;
    readonly decisionsByCause: Keyed<number>;
    readonly refusalsByReason: Keyed<number>;
    readonly parksByCause: Keyed<number>;
    /** Milliseconds from the first `approval-required` refusal of an exit to the grant that cleared it, keyed `station:level`. */
    readonly approvalWait: Keyed<Distribution>;
    /** Approval requests no grant has cleared yet, keyed `station:level`; counted, never folded into a wait. */
    readonly approvalsOpen: Keyed<number>;
    /** Milliseconds from admission to GitHub's merge time, merged runs only. */
    readonly cycleTime: Distribution;
    readonly costPerMergedChange: CostPerMerge;
  };
  /** What is not measured, said once so a reader never takes an absence for a zero. */
  readonly notMeasured: readonly string[];
}

export type CostPerMerge =
  | { readonly kind: 'no-sample'; readonly spentUsd: number }
  | {
      readonly kind: 'cost';
      readonly usd: number;
      readonly spentUsd: number;
      readonly merges: number;
      /** `lower` when any call's cost is unknown — lost, or made with no relay — so the figure is at least this. */
      readonly bound: 'exact' | 'lower';
    };

export const NOT_MEASURED: readonly string[] = [
  'escaped false-done: needs post-merge observation (R8)',
  "the team's own baseline: attributed by R8",
  'stack: no run record names one (R17)',
  'role per call: read from the station, review being the reviewer',
];

const decode = (bytes: Uint8Array): unknown => JSON.parse(new TextDecoder().decode(bytes));

/** The model as one key: provider, family, and model, so two families never share a row (I6). */
export function modelKey(m: ModelIdentity): string {
  return `${m.provider}/${m.family}/${m.model}`;
}

/** Reads one run's records. A run with no state is one refused at admission, or one with nothing yet. */
export async function readRunRecords(vault: Vault, runId: RunId): Promise<RunRecords> {
  const decisions: EnforcementDecision[] = [];
  for (const ref of await vault.readDecisions(runId)) decisions.push(decode(await vault.read(ref)) as EnforcementDecision);
  decisions.sort((a, b) => a.decidedAt.localeCompare(b.decidedAt));

  // Integration before state: a merge happens only after its grant is committed, so a state read
  // after a merge was seen holds that grant, and a merge is never paired with an older state.
  const integration: IntegrationRecord[] = await readIntegration(vault, runId);

  let state: RunState;
  try {
    state = await vault.readRunState(runId);
  } catch (error) {
    // Only absence is absence; a state that cannot be read is a fault, never a run with no evidence (I5).
    if (!isNoRunState(error)) throw error;
    const refusal = decisions.find((d) => d.decision.cause === 'admission-refused');
    return {
      runId,
      ending: refusal === undefined ? 'unfinished' : 'refused',
      requestedLevel: null,
      startedAt: refusal?.decidedAt ?? null,
      mergedAt: null,
      approvalsSpent: 0,
      tasks: [],
      decisions,
      usage: [],
      cost: null,
    };
  }

  const admission = decode(await vault.read(state.admission)) as AdmissionRecord;
  const merged = integration.find((r) => r.kind === 'merged');
  const usage = await readUsage(vault, state);

  const bundles: EvidenceBundle[] = [];
  for (const ref of state.evidenceRefs) bundles.push(decode(await vault.read(ref)) as EvidenceBundle);

  const tasks = Object.entries(state.tasks).map(([id, status]): TaskRecord => {
    const taskId = id as TaskId;
    const own = bundles.filter((b) => b.taskId === taskId);
    // The line builds again only after a failed verdict, so every bundle before the last failed;
    // the last carries the task's status, the runtime's verdict and nothing else (I2).
    const attempts = own.map((b, i): AttemptRecord => ({
      outcome: i === own.length - 1 && status === 'passed' ? 'passed' : 'failed',
      claimMismatch: b.claimEvidenceDiff.length > 0,
    }));
    const calls = usage.filter((r) => r.taskId === taskId);
    const first = calls.find((r) => r.attempt === 1) ?? calls[0];
    return {
      taskId,
      station: calls[0]?.station ?? null,
      status,
      iterations: state.attempts[taskId]?.iterations ?? 0,
      attempts,
      firstModel: first === undefined ? null : modelKey(first.model),
      models: [...new Set(calls.map((r) => modelKey(r.model)))].sort(),
    };
  });

  const ending: RunEnding = merged !== undefined
    ? 'merged'
    : state.cancelled !== null
      ? 'cancelled'
      : state.halted !== null
        ? 'halted'
        : state.approvals.some((g) => g.key === approvalKey('integrate', admission.run.requestedLevel) && g.usedAt !== null)
          // The grant for the last exit is spent in the commit that ends a passed run, as `runStanding` reads it (D-P9-08).
          ? 'passed'
          : Object.values(state.tasks).includes('parked')
          ? 'parked'
          : 'unfinished';

  return {
    runId,
    ending,
    requestedLevel: admission.run.requestedLevel,
    startedAt: admission.run.createdAt,
    mergedAt: merged?.kind === 'merged' ? merged.mergedAt : null,
    // The drive merges before it spends the integrate grant (D-I1b-01), so on a merged run that grant
    // was consumed by the merge, spent in state or not yet.
    approvalsSpent: state.approvals.filter((g) => g.usedAt !== null || (merged !== undefined && g.key === approvalKey('integrate', admission.run.requestedLevel))).length,
    tasks,
    decisions,
    usage,
    cost: costTotals(usage).run,
  };
}

function inWindow(at: string | null, window: OutcomeWindow): boolean {
  if (window.from === undefined && window.to === undefined) return true;
  if (at === null) return false;
  const t = Date.parse(at);
  return (window.from === undefined || t >= Date.parse(window.from)) && (window.to === undefined || t < Date.parse(window.to));
}

/** Counts per key, turned into proportions once every count is in. */
class Tally {
  readonly #counts = new Map<string, { count: number; sample: number }>();

  add(key: string, hit: boolean): void {
    const c = this.#counts.get(key) ?? { count: 0, sample: 0 };
    this.#counts.set(key, { count: c.count + (hit ? 1 : 0), sample: c.sample + 1 });
  }

  rates(as: (count: number, sample: number) => Proportion): Keyed<Proportion> {
    return Object.fromEntries([...this.#counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, c]) => [k, as(c.count, c.sample)]));
  }
}

function bump(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

/** Every run the Vault names (A-R2-02), read whole. The store picks the runs, never a caller. */
export async function outcomes(vault: Vault, window: OutcomeWindow = {}): Promise<Outcomes> {
  const runs: RunRecords[] = [];
  for (const runId of await vault.listRuns()) {
    const run = await readRunRecords(vault, runId);
    if (inWindow(run.startedAt, window)) runs.push(run);
  }
  return deriveOutcomes(runs, window);
}

/** The derivation itself, over records already read: pure, so a figure is a function of its records. */
export function deriveOutcomes(runs: readonly RunRecords[], window: OutcomeWindow = {}): Outcomes {
  const population: Record<RunEnding, number> = { refused: 0, merged: 0, passed: 0, cancelled: 0, halted: 0, parked: 0, unfinished: 0 };
  for (const run of runs) population[run.ending] += 1;

  // Safety: every attempt, finished run or not — an attempt the runtime judged is a fact either way.
  let attempts = 0;
  let falseDone = 0;
  const fdStation = new Tally();
  const fdModel = new Tally();
  const fdLevel = new Tally();
  for (const run of runs) {
    for (const task of run.tasks) {
      const model = task.models.length > 1 ? 'escalated' : (task.models[0] ?? 'no-call');
      for (const a of task.attempts) {
        const bad = a.outcome !== 'passed' || a.claimMismatch;
        attempts += 1;
        if (bad) falseDone += 1;
        fdStation.add(task.station ?? 'no-call', bad);
        fdModel.add(model, bad);
        fdLevel.add(`L${String(run.requestedLevel)}`, bad);
      }
    }
  }

  // Throughput over admitted runs that finished; an unfinished run is counted in the population and nowhere else.
  const finished = runs.filter((r) => r.ending !== 'refused' && r.ending !== 'unfinished');
  const autonomous = (r: RunRecords): boolean => r.ending === 'merged' && r.approvalsSpent === 0;
  const byLevel = new Tally();
  for (const r of finished) byLevel.add(`L${String(r.requestedLevel)}`, autonomous(r));

  const fpStation = new Tally();
  const fpModel = new Tally();
  const toGreen: number[] = [];
  const perTask: number[] = [];
  for (const run of runs) {
    for (const task of run.tasks) {
      const first = task.attempts[0];
      if (first === undefined) continue;
      fpStation.add(task.station ?? 'no-call', first.outcome === 'passed');
      fpModel.add(task.firstModel ?? 'no-call', first.outcome === 'passed');
      perTask.push(task.attempts.length);
      if (task.status === 'passed') toGreen.push(task.iterations);
    }
  }
  const yields = fpStation.rates(successRate);
  const rolledYield = Object.keys(yields).length === 0 || Object.values(yields).some((p) => p.kind === 'no-sample')
    ? null
    : Object.values(yields).reduce((product, p) => product * (p.kind === 'rate' ? p.rate : 1), 1);

  let seated = 0;
  let returned = 0;
  const decisionsByCause: Record<string, number> = {};
  const refusalsByReason: Record<string, number> = {};
  const parksByCause: Record<string, number> = {};
  const waits = new Map<string, number[]>();
  const open: Record<string, number> = {};
  for (const run of runs) {
    // A run-level rate, so over finished runs: a review that has not returned is not a sample.
    if (finished.includes(run) && run.usage.some((u) => u.station === 'review')) {
      seated += 1;
      if (run.decisions.some((d) => d.station === 'review' && d.decision.cause === 'station-refused' && d.decision.refusal.reason !== 'approval-required')) returned += 1;
    }
    const requested = new Map<string, string[]>();
    for (const d of run.decisions) {
      bump(decisionsByCause, d.decision.cause);
      if (d.decision.cause === 'station-refused') {
        bump(refusalsByReason, d.decision.refusal.reason);
        if (d.decision.refusal.reason === 'parked') bump(parksByCause, d.decision.refusal.cause);
        if (d.decision.refusal.reason === 'approval-required') requested.set(d.decision.refusal.key, [...(requested.get(d.decision.refusal.key) ?? []), d.decidedAt]);
      }
    }
    // Each grant clears the first request of its key made before it; the requests repeated by resumes before that grant are the same wait.
    for (const [key, times] of requested) {
      const grants = run.decisions.filter((d) => d.decision.cause === 'approval-granted' && d.decision.key === key).map((d) => d.decidedAt);
      let from = 0;
      for (const granted of grants) {
        const first = times.slice(from).find((t) => t <= granted);
        if (first === undefined) continue;
        waits.set(key, [...(waits.get(key) ?? []), Date.parse(granted) - Date.parse(first)]);
        from = times.findIndex((t) => t > granted);
        if (from === -1) from = times.length;
      }
      if (from < times.length) bump(open, key);
    }
  }

  const merges = runs.filter((r) => r.ending === 'merged');
  const cycle = merges.flatMap((r) => (r.startedAt === null || r.mergedAt === null ? [] : [Date.parse(r.mergedAt) - Date.parse(r.startedAt)]));
  const spent = runs.reduce((sum, r) => sum + (r.cost?.metered.costUsd ?? 0), 0);
  const unknown = runs.some((r) => r.cost !== null && r.cost.bound === 'lower');

  return {
    window,
    population: { ...population, total: runs.length },
    safety: {
      caughtFalseDone: failureRate(falseDone, attempts),
      caughtFalseDoneByStation: fdStation.rates(failureRate),
      caughtFalseDoneByModel: fdModel.rates(failureRate),
      caughtFalseDoneByLevel: fdLevel.rates(failureRate),
      escapedFalseDone: 'not-established',
    },
    throughput: {
      autonomyRatio: successRate(finished.filter(autonomous).length, finished.length),
      autonomyRatioByLevel: byLevel.rates(successRate),
      firstPassYieldByStation: yields,
      firstPassYieldByModel: fpModel.rates(successRate),
      rolledYield,
      iterationsToGreen: distribution(toGreen),
      attemptsPerTask: distribution(perTask),
      reviewExitRefused: failureRate(returned, seated),
      decisionsByCause,
      refusalsByReason,
      parksByCause,
      approvalWait: Object.fromEntries([...waits.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, distribution(v)])),
      approvalsOpen: open,
      cycleTime: distribution(cycle),
      costPerMergedChange: merges.length === 0
        ? { kind: 'no-sample', spentUsd: spent }
        : { kind: 'cost', usd: spent / merges.length, spentUsd: spent, merges: merges.length, bound: unknown ? 'lower' : 'exact' },
    },
    notMeasured: NOT_MEASURED,
  };
}

/** The fewest past tasks a station-and-model cell needs before its median is used (D-R2-01). */
export const MIN_ESTIMATE_SAMPLE = 5;

/** One task a run would schedule: where it runs, and the model its starting tier resolves to. */
export interface EstimateCell {
  readonly station: StationId;
  readonly model: ModelIdentity;
}

export type CostEstimate =
  | { readonly kind: 'likely'; readonly usd: number; readonly cells: ReadonlyArray<{ readonly station: StationId; readonly model: string; readonly medianUsd: number; readonly sample: number }> }
  /** Some cell has too little history; the estimate declines rather than guess (I5). */
  | { readonly kind: 'insufficient-sample'; readonly short: ReadonlyArray<{ readonly station: StationId; readonly model: string; readonly sample: number }>; readonly needed: number };

/**
 * Task statuses after which a task makes no more calls. Not `failed`: the line
 * builds a failed task again while it has iterations left, and parks it when it
 * has none.
 */
const ENDED: ReadonlySet<TaskStatus> = new Set<TaskStatus>(['passed', 'parked', 'cancelled']);

/**
 * The likely cost of a run, from past runs' usage: for each task it would
 * schedule, the median cost of a past task at the same station on the same
 * model. A past task counts only where it has ended and every call it made
 * was metered: a task still running has spent only part of its cost, and a
 * lost or unmetered call has no cost to take a median of. Escalation is not
 * modelled: each task is priced at its starting tier.
 */
export async function estimateCost(vault: Vault, tasks: readonly EstimateCell[]): Promise<CostEstimate> {
  const past = new Map<string, number[]>();
  for (const runId of await vault.listRuns()) {
    const run = await readRunRecords(vault, runId);
    const byTask = new Map<TaskId, UsageRecord[]>();
    for (const r of run.usage) byTask.set(r.taskId, [...(byTask.get(r.taskId) ?? []), r]);
    for (const [taskId, calls] of byTask) {
      const first = calls[0];
      const status = run.tasks.find((t) => t.taskId === taskId)?.status;
      // A task on a run that has ended makes no more calls, whatever its status.
      const ended = run.ending !== 'unfinished' || (status !== undefined && ENDED.has(status));
      if (first === undefined || !ended || calls.some((c) => c.reading.kind !== 'metered')) continue;
      const usd = calls.reduce((sum, c) => sum + (c.reading.kind === 'metered' ? c.reading.costUsd : 0), 0);
      const key = `${first.station} ${modelKey(first.model)}`;
      past.set(key, [...(past.get(key) ?? []), usd]);
    }
  }
  const cells = new Map<string, { station: StationId; model: string; count: number }>();
  for (const t of tasks) {
    const model = modelKey(t.model);
    const key = `${t.station} ${model}`;
    cells.set(key, { station: t.station, model, count: (cells.get(key)?.count ?? 0) + 1 });
  }
  const short = [...cells.entries()]
    .map(([key, c]) => ({ station: c.station, model: c.model, sample: past.get(key)?.length ?? 0 }))
    .filter((c) => c.sample < MIN_ESTIMATE_SAMPLE);
  if (short.length > 0) return { kind: 'insufficient-sample', short, needed: MIN_ESTIMATE_SAMPLE };
  let usd = 0;
  const priced = [...cells.entries()].map(([key, c]) => {
    const d = distribution(past.get(key) ?? []);
    const medianUsd = d.kind === 'distribution' ? d.median : 0;
    usd += medianUsd * c.count;
    return { station: c.station, model: c.model, medianUsd, sample: d.kind === 'distribution' ? d.sample : 0 };
  });
  return { kind: 'likely', usd, cells: priced };
}
