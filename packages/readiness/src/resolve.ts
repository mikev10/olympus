/**
 * The four-term effective level, with the term that bound it named:
 * `min(run.requested, policy.stationCap, policy.globalCap, readiness.ceiling)`,
 * where the policy engine also bounds by the role's own ceiling.
 *
 * The engine's verdict is the authority on the policy terms, called unchanged;
 * readiness only adds a refusal it could not make (I4: a ceiling subtracts or
 * does nothing). Attribution reads the same public `Policy` fields the engine
 * does, so a refusal can say which cap bound it, and if the two ever disagree
 * the resolver throws rather than report a refusal it cannot attribute (I5).
 *
 * Nothing here is wired into run creation (R1 §5).
 */
import type { AutonomyLevel, Policy, PolicyEngine, PolicyRefusal, RoleId, StationId } from '@olympus-ai/core';
import type { HeldBy, ReadinessCeiling, ScanLevel } from './types.js';

export type BoundingTerm =
  | { readonly term: 'readiness'; readonly ceiling: ScanLevel; readonly heldBy: HeldBy; readonly commit: string }
  | { readonly term: 'global-cap'; readonly cap: AutonomyLevel }
  | { readonly term: 'station-cap'; readonly station: StationId; readonly cap: AutonomyLevel }
  | { readonly term: 'role-ceiling'; readonly role: RoleId; readonly cap: AutonomyLevel };

/** A refusal over a cap names every term the request exceeds; there is no bare `exceeds-cap`. */
export interface BoundRefusal {
  readonly ok: false;
  readonly reason: 'exceeds-bound';
  readonly requested: AutonomyLevel;
  readonly bounds: readonly [BoundingTerm, ...BoundingTerm[]];
  readonly detail: string;
}

/** The engine's refusals that are not about a cap pass through as it made them. */
export type ScopeRefusal = PolicyRefusal & { readonly reason: 'station-forbidden' | 'capability-missing' };

export type ReadinessResolution =
  | { readonly ok: true; readonly level: AutonomyLevel; readonly readiness: ReadinessCeiling }
  | BoundRefusal
  | ScopeRefusal;

export function resolveWithReadiness(
  engine: PolicyEngine,
  requested: AutonomyLevel,
  station: StationId,
  role: RoleId,
  policy: Policy,
  readiness: ReadinessCeiling,
): ReadinessResolution {
  const verdict = engine.resolveAutonomy(requested, station, role, policy);
  if (!verdict.ok && verdict.reason !== 'exceeds-cap') {
    return { ok: false, reason: verdict.reason, detail: verdict.detail };
  }

  const bounds: BoundingTerm[] = [];
  if (readiness.kind === 'scanned' && requested > readiness.level) {
    bounds.push({ term: 'readiness', ceiling: readiness.level, heldBy: readiness.heldBy, commit: readiness.commit });
  }
  if (!verdict.ok) {
    const caps = policyBounds(requested, station, role, policy);
    if (caps.length === 0) {
      throw new Error(
        `readiness: the policy engine refused L${String(requested)} over a cap, and no cap in the policy is below it; ` +
        `refused rather than reported unattributed (${verdict.detail})`,
      );
    }
    bounds.push(...caps);
  }

  const [first, ...rest] = bounds;
  if (first === undefined) {
    if (!verdict.ok) throw new Error('readiness: unreachable, a refused verdict always carries a bound');
    return { ok: true, level: verdict.level, readiness };
  }
  return {
    ok: false,
    reason: 'exceeds-bound',
    requested,
    bounds: [first, ...rest],
    detail:
      `L${String(requested)} requested for role '${role}' at '${station}' exceeds ` +
      `${bounds.map(describe).join('; ')}. Refused, not downgraded.`,
  };
}

/** Each policy cap the request exceeds, read from own properties only, as the engine reads them. */
function policyBounds(requested: AutonomyLevel, station: StationId, role: RoleId, policy: Policy): BoundingTerm[] {
  const out: BoundingTerm[] = [];
  if (requested > policy.globalCap) out.push({ term: 'global-cap', cap: policy.globalCap });
  const stationCap = Object.hasOwn(policy.stationCaps, station) ? policy.stationCaps[station] : undefined;
  if (stationCap !== undefined && requested > stationCap) out.push({ term: 'station-cap', station, cap: stationCap });
  const scope = Object.hasOwn(policy.roles, role) ? policy.roles[role] : undefined;
  if (scope !== undefined && requested > scope.autonomyCeiling) out.push({ term: 'role-ceiling', role, cap: scope.autonomyCeiling });
  return out;
}

function describe(bound: BoundingTerm): string {
  switch (bound.term) {
    case 'readiness': {
      const held = bound.heldBy.kind === 'probe' ? `held by probe ${bound.heldBy.probe}` : 'no scan grants L3';
      return `the readiness ceiling L${String(bound.ceiling)} (${held}, commit ${bound.commit})`;
    }
    case 'global-cap':
      return `the global cap L${String(bound.cap)}`;
    case 'station-cap':
      return `the ${bound.station} station cap L${String(bound.cap)}`;
    case 'role-ceiling':
      return `role '${bound.role}' ceiling L${String(bound.cap)}`;
  }
}
