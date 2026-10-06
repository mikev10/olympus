/**
 * Which model tier a task runs at: the role's tier, or its tier at this
 * station, raised by escalation where policy grants it (A-R14-01).
 *
 * A pure function of policy and of the attempt counts run state keeps, so a
 * resumed run resolves the tier a run that never stopped would have, and
 * nothing a model returned is an input (I2). Escalation is absent unless
 * granted (I4), moves at most one tier between consecutive iterations, and
 * never passes its ceiling.
 */
import type { ModelTier, StationId, TaskAttempts } from '../run/types.js';
import { MODEL_TIERS, tierRank } from './constants.js';
import type { CapabilityScope } from './types.js';

/** The tier a scope names at a station before any escalation. */
export function stationTier(scope: CapabilityScope, station: StationId): ModelTier {
  return Object.hasOwn(scope.tierByStation, station) ? (scope.tierByStation[station] ?? scope.tier) : scope.tier;
}

/**
 * The gates a task has failed before its current iteration. `iterations` is
 * committed before the attempt it counts begins, and an iteration ends either
 * in a verdict or in a park, so every iteration before the current one ended
 * in a failed gate.
 */
export function failedGates(attempts: TaskAttempts): number {
  return Math.max(0, attempts.iterations - 1);
}

/**
 * The tier the task's current iteration runs at. Under a grant, the station
 * tier rises one step for every `afterFailedGates` failures, held at the
 * ceiling. A ceiling below the station tier never lowers it: validation
 * refuses such a policy, and this function would not act on one if it got
 * through.
 */
export function tierFor(scope: CapabilityScope, station: StationId, attempts: TaskAttempts): ModelTier {
  const base = stationTier(scope, station);
  const grant = scope.escalation;
  if (grant === 'none') return base;
  const steps = Math.floor(failedGates(attempts) / grant.afterFailedGates);
  const rank = Math.max(tierRank(base), Math.min(tierRank(base) + steps, tierRank(grant.ceiling)));
  // Ranks are the indices of MODEL_TIERS, and `rank` lies between two of them.
  return MODEL_TIERS[rank] ?? base;
}

export interface Escalation {
  readonly from: ModelTier;
  readonly to: ModelTier;
  /** The failures the decision was made on. */
  readonly failedGates: number;
}

/**
 * The escalation the current iteration starts with, or null where it runs at
 * the tier the iteration before it ran at. The first iteration never
 * escalates: no gate has failed.
 */
export function escalationAt(scope: CapabilityScope, station: StationId, attempts: TaskAttempts): Escalation | null {
  if (attempts.iterations < 2) return null;
  const to = tierFor(scope, station, attempts);
  const from = tierFor(scope, station, { ...attempts, iterations: attempts.iterations - 1 });
  return from === to ? null : { from, to, failedGates: failedGates(attempts) };
}
