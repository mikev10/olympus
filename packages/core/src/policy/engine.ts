/**
 * The policy engine: the only path from an authored `PolicyDocument` to the
 * resolved `Policy` the runtime consumes, and the only place autonomy and
 * capability questions are answered.
 *
 * I4: nothing is granted that the document did not grant. An undefined role
 * has no scope, a station outside a role's `stations` is forbidden, and an
 * absent tool is simply absent — there is no warn-and-proceed path.
 *
 * I5: an over-request is refused. `resolveAutonomy` never returns a level
 * below the one asked for; a request above the effective cap is a
 * `PolicyRefusal` naming both numbers. Silently handing back L1 for an L3
 * request is the failure this invariant exists to prevent, because the caller
 * would proceed believing it had asked for and received something.
 */
import type { AutonomyLevel, RoleId, StationId } from '../run/types.js';
import { APPROVAL_KEYS, STATION_IDS, AUTONOMY_LEVELS } from './constants.js';
import type {
  ApprovalKey, ApprovalOutcome, CapabilityResolution, CapabilityScope,
  Policy, PolicyDocument, PolicyEngine, PolicyResolution, TriggerPolicy,
} from './types.js';

/**
 * One tool a policy grants that the driver's inventory does not offer.
 * `role` is a plain string rather than a `RoleId`: it is read back out of the
 * policy's own keys for a message, and a defect report is not a capability.
 */
export interface UngrantedTool {
  readonly role: string;
  readonly tool: string;
}

export type ToolGrantValidation =
  | { readonly ok: true }
  | {
    readonly ok: false;
    readonly reason: 'capability-missing';
    readonly ungranted: readonly UngrantedTool[];
    readonly detail: string;
  };

/**
 * Freezes in place and returns the same static type. The contract declares
 * mutable arrays (`stations: StationId[]`), so `Object.freeze`'s `readonly`
 * return type cannot be assigned back into one; discarding the return keeps
 * the declared type while the value is genuinely immutable at run time. A
 * caller that mutates a resolved policy throws rather than succeeding.
 */
function frozenCopy<T>(items: readonly T[]): T[] {
  const copy = [...items];
  Object.freeze(copy);
  return copy;
}

function frozen<T extends object>(value: T): T {
  Object.freeze(value);
  return value;
}

function cloneScope(scope: CapabilityScope): CapabilityScope {
  return frozen({
    stations: frozenCopy(scope.stations),
    writableGlobs: frozenCopy(scope.writableGlobs),
    tools: frozenCopy(scope.tools),
    network: frozen(
      scope.network.egress === 'none'
        ? { egress: 'none' as const }
        : { egress: frozenCopy(scope.network.egress) },
    ),
    tier: scope.tier,
    autonomyCeiling: scope.autonomyCeiling,
    triggerKinds: frozenCopy(scope.triggerKinds),
    budget: frozen({ ...scope.budget }),
  });
}

function cloneRoles(roles: PolicyDocument['roles']): Policy['roles'] {
  const cloned = Object.fromEntries(
    Object.entries(roles).map(([role, scope]) => [role, cloneScope(scope)]),
  );
  return frozen(cloned);
}

function cloneTriggers(triggers: TriggerPolicy): TriggerPolicy {
  return frozen({
    enabled: frozenCopy(triggers.enabled),
    entryStation: frozen({ ...triggers.entryStation }),
    taskTemplate: frozen({ ...triggers.taskTemplate }),
    maxAutonomy: frozen({ ...triggers.maxAutonomy }),
    minAuthorTrust: frozen({ ...triggers.minAuthorTrust }),
    maxTriggerDepth: triggers.maxTriggerDepth,
    budgetPerWindow: frozen({ ...triggers.budgetPerWindow }),
  });
}

/**
 * Fills all forty `station:level` keys. An approval the document omits becomes
 * `human-required`, never `auto`: an unconfigured policy is safe, not broken
 * (R-F2-08). A present-but-malformed value never reaches here — the validator
 * refused the document before resolution.
 */
function totalApprovals(sparse: PolicyDocument['approvals']): Record<ApprovalKey, ApprovalOutcome> {
  const filled: Partial<Record<ApprovalKey, ApprovalOutcome>> = {};
  for (const key of APPROVAL_KEYS) filled[key] = sparse[key] ?? 'human-required';

  const expected = STATION_IDS.length * AUTONOMY_LEVELS.length;
  if (Object.keys(filled).length !== expected) {
    // Unreachable while APPROVAL_KEYS is the cross product of the two total
    // records in constants.ts. Checked rather than trusted, because the
    // assertion below is what makes the table total for every consumer, and a
    // partial approvals table would make a gate lookup miss (I5).
    throw new Error(
      `policy: resolved ${String(Object.keys(filled).length)} of ${String(expected)} station:level approvals`,
    );
  }
  // Sound by the check above: every ApprovalKey was just assigned.
  return frozen(filled as Record<ApprovalKey, ApprovalOutcome>);
}

/**
 * Names the caps that bound a request, for a refusal message. Order is stable
 * so the message reads the same way every time.
 */
function capDetail(policy: Policy, station: StationId, scope: CapabilityScope): string {
  const stationCap = policy.stationCaps[station];
  const parts = [
    `global L${String(policy.globalCap)}`,
    stationCap === undefined ? `no ${station} cap` : `${station} L${String(stationCap)}`,
    `role ceiling L${String(scope.autonomyCeiling)}`,
  ];
  return parts.join(', ');
}

/**
 * The effective cap: the tightest of the global cap, the station cap where the
 * document sets one, and the role's own ceiling.
 *
 * An omitted station cap does not mean L0 (D-P3-06). `Policy.stationCaps`
 * stays `Partial` in the resolved form while `approvals` is made total, which
 * is the contract saying a station cap is a tightening control rather than a
 * grant: omitting one cannot widen anything, because the global cap and the
 * role ceiling both still bound the request and every approval still reads
 * `human-required` until a document says otherwise.
 */
function effectiveCap(policy: Policy, station: StationId, scope: CapabilityScope): AutonomyLevel {
  const stationCap = policy.stationCaps[station];
  const bounds: AutonomyLevel[] = [policy.globalCap, scope.autonomyCeiling];
  if (stationCap !== undefined) bounds.push(stationCap);
  return bounds.reduce((tightest, bound) => (bound < tightest ? bound : tightest));
}

export class StrictPolicyEngine implements PolicyEngine {
  /**
   * Runs once at load. The result is deeply frozen and shares no object with
   * the document it came from, so a caller holding either cannot alter what
   * the runtime hashes into the Vault.
   */
  resolvePolicy(doc: PolicyDocument): Policy {
    return frozen({
      globalCap: doc.globalCap,
      stationCaps: frozen({ ...doc.stationCaps }),
      approvals: totalApprovals(doc.approvals),
      roles: cloneRoles(doc.roles),
      protectedPaths: frozenCopy(doc.protectedPaths),
      triggers: cloneTriggers(doc.triggers),
      concurrency: frozen({ ...doc.concurrency }),
    });
  }

  resolveAutonomy(
    requested: AutonomyLevel, station: StationId, role: RoleId, policy: Policy,
  ): PolicyResolution {
    const scope = policy.roles[role];
    if (scope === undefined) {
      return {
        ok: false,
        reason: 'capability-missing',
        detail: `the policy defines no role '${role}', so it grants nothing at any station`,
      };
    }
    if (!scope.stations.includes(station)) {
      return {
        ok: false,
        reason: 'station-forbidden',
        detail: `role '${role}' may act at ${scope.stations.join(', ')}; '${station}' is not among them`,
      };
    }
    const cap = effectiveCap(policy, station, scope);
    if (requested > cap) {
      return {
        ok: false,
        reason: 'exceeds-cap',
        detail:
          `L${String(requested)} requested for role '${role}' at '${station}', `
          + `effective cap L${String(cap)} (${capDetail(policy, station, scope)}). `
          + 'Refused, not downgraded.',
      };
    }
    // The requested level, never the cap: a request within bounds is granted
    // as asked, and one outside them was refused above.
    return { ok: true, level: requested };
  }

  resolveCapabilities(role: RoleId, station: StationId, policy: Policy): CapabilityResolution {
    const scope = policy.roles[role];
    if (scope === undefined) {
      return {
        ok: false,
        reason: 'capability-missing',
        detail: `the policy defines no role '${role}', so no scope exists to grant`,
      };
    }
    if (!scope.stations.includes(station)) {
      return {
        ok: false,
        reason: 'station-forbidden',
        detail: `role '${role}' may act at ${scope.stations.join(', ')}; '${station}' is not among them`,
      };
    }
    // A fresh frozen copy: the caller receives exactly what policy grants and
    // holds no handle on the policy itself.
    return { ok: true, scope: cloneScope(scope) };
  }
}

/**
 * Checks every `tools` grant in the policy against the inventory of tools a
 * driver actually offers (D-P3-04).
 *
 * `inventory` is mandatory and has no default. A validator that can be called
 * without one, or whose empty case means allow-all, validates nothing, and
 * every caller would take that path: an empty inventory against a non-empty
 * grant list is a refusal. The other half of the gap — a driver that can
 * produce a real inventory, since `DriverCapabilities` holds feature flags and
 * no tool list — is owed to P5 as `I4.driver-tool-inventory-validated`.
 */
export function validateToolGrants(policy: Policy, inventory: readonly string[]): ToolGrantValidation {
  const offered = new Set(inventory);
  const ungranted: UngrantedTool[] = [];
  for (const [role, scope] of Object.entries(policy.roles)) {
    for (const tool of scope.tools) {
      if (!offered.has(tool)) ungranted.push({ role, tool });
    }
  }
  if (ungranted.length === 0) return { ok: true };
  return {
    ok: false,
    reason: 'capability-missing',
    ungranted: frozenCopy(ungranted),
    detail:
      `the policy grants ${String(ungranted.length)} tool(s) no driver offers: `
      + ungranted.map((u) => `${u.role} -> ${u.tool}`).join(', '),
  };
}
