/**
 * The enforcement record's one write path in the runtime (P14). Every control
 * that decides — admission, the station machine, the line, an approval, the
 * egress proxy, the model relay — has its decision written here by the
 * runtime that holds the Vault, naming the decider (D-P14-09). A write that
 * fails throws: a decision with no record does not take effect (I5, D-P14-07).
 */
import { randomUUID } from 'node:crypto';
import type { RunId, StationId, StationRefusal, TaskId, VaultRef } from '@olympus-ai/core';
import type { EgressLog } from '@olympus-ai/sandbox';
import type { AdmissionRefusal, DecisionCause, Vault } from '@olympus-ai/vault';
import type { RequestProblem } from './validate.js';

export interface DecisionSite {
  readonly vault: Vault;
  readonly runId: RunId;
  readonly taskId: TaskId | null;
  readonly station: StationId | null;
}

export async function recordDecision(site: DecisionSite, decision: DecisionCause): Promise<VaultRef> {
  return site.vault.recordDecision({
    runId: site.runId,
    taskId: site.taskId,
    station: site.station,
    decidedAt: new Date().toISOString(),
    occurrence: randomUUID(),
    decision,
    collectedBy: 'runtime',
  });
}

/** Each problem's path and code; the message is not kept, because it can quote what the caller sent (D-P14-06). */
export function problemCodes(problems: readonly RequestProblem[]): AdmissionRefusal & { reason: 'invalid-request' } {
  return { reason: 'invalid-request', problems: problems.map((p) => ({ path: p.path, code: p.code })) };
}

/** Who made a station refusal: the line for what it found itself — a park, a tamper, a violation — and the station machine for the rest. */
export function stationDecider(refusal: StationRefusal): 'station-machine' | 'line' {
  switch (refusal.reason) {
    case 'parked':
    case 'lock-tamper':
    case 'violation':
      return 'line';
    case 'gate-failed':
    case 'unsafe-above-l1':
    case 'capability-missing':
    case 'same-family-reviewer':
    case 'approval-blocked':
    case 'approval-required':
    case 'cancelled':
    case 'halted':
      return 'station-machine';
  }
}

/** One decision per connection the proxy logged, whatever its verdict (D-P14-04). A sandbox with no proxy decided none. */
export async function recordEgress(site: DecisionSite, egress: EgressLog): Promise<void> {
  if (egress.kind === 'none') return;
  for (const connection of egress.connections) {
    await recordDecision(site, { cause: 'egress-connection', decidedBy: 'egress-proxy', connection });
  }
}
