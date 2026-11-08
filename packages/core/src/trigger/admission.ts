/**
 * Admission's reading of the trigger policy, for every kind, `human` included
 * (D-A-TF-02, D-R22-06). Pure: the runtime supplies the trigger it derived,
 * never one a payload named.
 *
 * A kind not enabled, an author below the kind's floor, and a lineage past the
 * depth limit are trigger refusals. A level over the kind's cap, and a role
 * that does not list the kind, are the policy engine's own reasons,
 * `exceeds-cap` and `capability-missing`, so one over-request is counted one
 * way. A request over the cap is refused, never clamped (I5).
 */
import type { PolicyRefusal, TriggerPolicy } from '../policy/types.js';
import type { AuthorTrust, AutonomyLevel, NarrowingCause, RoleId, TriggerKind } from '../run/types.js';
import type { CapabilityScope, NarrowedScope } from '../policy/types.js';
import { trustRank } from './schemas.js';

/** Why admission refused a run's trigger (A-R22-05). */
export type TriggerAdmissionCause = 'not-enabled' | 'trust' | 'depth';

export interface AdmittedTrigger {
  readonly kind: TriggerKind;
  /** `owner` for a person's own run; for a candidate, the trust its delivery was extracted with. */
  readonly authorTrust: AuthorTrust;
  readonly depth: number;
}

export type TriggerAdmission =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'trigger-refused'; readonly cause: TriggerAdmissionCause; readonly detail: string }
  | { readonly ok: false; readonly reason: 'policy-refused'; readonly role: RoleId | null; readonly refusal: PolicyRefusal };

function own<K extends string, V>(map: Partial<Record<K, V>>, key: K): V | undefined {
  return Object.hasOwn(map, key) ? map[key] : undefined;
}

/**
 * Every check, in order. `roles` is every role the run seats, each with the
 * scope policy grants it; a role the policy does not define is the engine's
 * refusal and is not repeated here.
 */
export function admitTrigger(
  trigger: AdmittedTrigger,
  requested: AutonomyLevel,
  roles: ReadonlyArray<readonly [RoleId, CapabilityScope]>,
  policy: TriggerPolicy,
): TriggerAdmission {
  const { kind } = trigger;
  if (!policy.enabled.includes(kind)) {
    return { ok: false, reason: 'trigger-refused', cause: 'not-enabled', detail: `the trigger kind '${kind}' is not enabled` };
  }
  const cap = own(policy.maxAutonomy, kind);
  if (cap === undefined || requested > cap) {
    return {
      ok: false,
      reason: 'policy-refused',
      role: null,
      refusal: {
        ok: false,
        reason: 'exceeds-cap',
        detail: cap === undefined
          ? `the trigger kind '${kind}' has no autonomy cap, so no level is admitted under it`
          : `L${String(requested)} exceeds the '${kind}' trigger's cap of L${String(cap)}`,
      },
    };
  }
  const floor = own(policy.minAuthorTrust, kind);
  if (floor === undefined || trustRank(trigger.authorTrust) < trustRank(floor)) {
    return {
      ok: false,
      reason: 'trigger-refused',
      cause: 'trust',
      detail: floor === undefined
        ? `the trigger kind '${kind}' has no trust floor, so no author meets it`
        : `an author of trust '${trigger.authorTrust}' is below the '${kind}' floor of '${floor}'`,
    };
  }
  if (trigger.depth > policy.maxTriggerDepth) {
    return { ok: false, reason: 'trigger-refused', cause: 'depth', detail: `lineage depth ${String(trigger.depth)} exceeds the limit of ${String(policy.maxTriggerDepth)}` };
  }
  for (const [role, scope] of roles) {
    if (!scope.triggerKinds.includes(kind)) {
      return {
        ok: false,
        reason: 'policy-refused',
        role,
        refusal: { ok: false, reason: 'capability-missing', detail: `role '${role}' does not list the trigger kind '${kind}'` },
      };
    }
  }
  return { ok: true };
}

/**
 * What a narrowed run keeps: each seated role's narrowed scope, and the level
 * every exit reads its approval at once the run is narrowed (A-R10-01).
 */
export interface RunNarrowingPlan {
  readonly scopes: Readonly<Record<RoleId, NarrowedScope>>;
  readonly level: AutonomyLevel;
}

export type NarrowingPlan =
  | { readonly ok: true; readonly plan: RunNarrowingPlan }
  | { readonly ok: false; readonly role: RoleId; readonly refusal: PolicyRefusal };

/**
 * Every seated role's narrowed scope, or the first role that declares none,
 * refused (I5). The level is the lowest of `requested` and every narrowed
 * ceiling, so a narrowed run's exits read approvals no higher than any of its
 * roles may run at (D-R10-02).
 */
export function planNarrowing(
  requested: AutonomyLevel,
  roles: ReadonlyArray<readonly [RoleId, CapabilityScope]>,
): NarrowingPlan {
  const scopes: Record<RoleId, NarrowedScope> = {};
  let level = requested;
  for (const [role, scope] of roles) {
    if (scope.narrowed === null) {
      return {
        ok: false,
        role,
        refusal: { ok: false, reason: 'capability-missing', detail: `the run is narrowed and role '${role}' declares no narrowed scope, so it cannot be seated in it` },
      };
    }
    scopes[role] = scope.narrowed;
    if (scope.narrowed.autonomyCeiling < level) level = scope.narrowed.autonomyCeiling;
  }
  return { ok: true, plan: { scopes, level } };
}

export type AdmissionNarrowing =
  | { readonly ok: true; readonly narrowing: { readonly cause: NarrowingCause; readonly plan: RunNarrowingPlan } | null }
  | { readonly ok: false; readonly role: RoleId; readonly refusal: PolicyRefusal };

/**
 * Whether admission narrows the run, read after `admitTrigger` admitted it
 * (A-R10-01). An author below the kind's `narrowBelow` narrows it, and so does
 * any seated role granted a sensitive class; trust is named first where both
 * hold. A narrowed run is refused where a seated role declares no narrowed
 * scope, and where the level asked for is above a narrowed ceiling: known
 * before anything runs, that is an over-request, never a downgrade (D-R10-02).
 */
export function narrowAtAdmission(
  trigger: AdmittedTrigger,
  requested: AutonomyLevel,
  roles: ReadonlyArray<readonly [RoleId, CapabilityScope]>,
  policy: TriggerPolicy,
): AdmissionNarrowing {
  const below = own(policy.narrowBelow, trigger.kind);
  const granted = roles.filter(([, scope]) => scope.sensitiveGrants.length > 0).map(([role]) => role);
  const cause: NarrowingCause | null = below !== undefined && trustRank(trigger.authorTrust) < trustRank(below)
    ? { kind: 'author-trust', trust: trigger.authorTrust }
    : granted.length > 0 ? { kind: 'sensitive-grant', roles: granted } : null;
  if (cause === null) return { ok: true, narrowing: null };
  const planned = planNarrowing(requested, roles);
  if (!planned.ok) return planned;
  if (planned.plan.level < requested) {
    const binding = roles.find(([, scope]) => scope.narrowed?.autonomyCeiling === planned.plan.level);
    // The plan lowered the level only to a seated role's narrowed ceiling, so one holds it.
    if (binding === undefined) throw new Error('admission: a narrowed level below the request names no role');
    return {
      ok: false,
      role: binding[0],
      refusal: { ok: false, reason: 'exceeds-cap', detail: `L${String(requested)} exceeds the narrowed ceiling of L${String(planned.plan.level)} this run is admitted under` },
    };
  }
  return { ok: true, narrowing: { cause, plan: planned.plan } };
}

/**
 * The level a run's exits read their approvals at: the level it was admitted
 * at, or, once narrowed, the narrowing's, which is never higher (D-R10-02).
 * Every exit, every approval key, and every grade read from a run's level
 * reads it here, so a narrowed run's approvals are asked at the lower level.
 */
export function levelOf(requested: AutonomyLevel, narrowed: { readonly level: AutonomyLevel } | null): AutonomyLevel {
  return narrowed === null || narrowed.level > requested ? requested : narrowed.level;
}
