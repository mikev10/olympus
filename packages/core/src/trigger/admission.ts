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
import type { AuthorTrust, AutonomyLevel, RoleId, TriggerKind } from '../run/types.js';
import type { CapabilityScope } from '../policy/types.js';
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
