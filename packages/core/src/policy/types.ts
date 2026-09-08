/**
 * Policy: the versioned, Vault-resident declaration of what each role may do,
 * where, and at what autonomy level. I4: anything not granted here is denied.
 */
import type { Budget } from '../driver/contract.js';
import type {
  AuthorTrust, AutonomyLevel, ModelTier, RoleId, StationId, TriggerKind,
} from '../run/types.js';

export interface CapabilityScope {
  stations: StationId[];              // where this role may act - nowhere else
  writableGlobs: string[];            // within the Workspace only
  tools: string[];                    // default deny (I4)
  network: { egress: 'none' | string[] };
  tier: ModelTier;
  autonomyCeiling: AutonomyLevel;
  triggerKinds: TriggerKind[];
  budget: Budget;
}

export type ApprovalOutcome = 'auto' | 'human-required' | 'blocked';

/** I7: a trigger selects a pre-declared template; the payload cannot name one. */
export interface TriggerPolicy {
  enabled: TriggerKind[];             // ships as ['human'] only
  entryStation: Partial<Record<TriggerKind, StationId>>;
  taskTemplate: Partial<Record<TriggerKind, string>>;   // pre-declared; payload cannot name it
  maxAutonomy: Partial<Record<TriggerKind, AutonomyLevel>>;
  minAuthorTrust: Partial<Record<TriggerKind, AuthorTrust>>;
  maxTriggerDepth: number;
  budgetPerWindow: { runs: number; windowMs: number };
}

export interface Policy {
  globalCap: AutonomyLevel;                                    // ships as 2
  stationCaps: Partial<Record<StationId, AutonomyLevel>>;
  approvals: Record<`${StationId}:${AutonomyLevel}`, ApprovalOutcome>;
  roles: Record<RoleId, CapabilityScope>;
  protectedPaths: string[];           // in-repo but escalating: CI, test config, package scripts
  triggers: TriggerPolicy;
  concurrency: { maxParallelTasks: number; maxConflictRetries: number };
}

export interface PolicyRefusal {
  ok: false;
  reason: 'exceeds-cap' | 'station-forbidden' | 'capability-missing';
  detail: string;
}

export type PolicyResolution =
  | { ok: true; level: AutonomyLevel }
  | PolicyRefusal;

export type CapabilityResolution =
  | { ok: true; scope: CapabilityScope }
  | PolicyRefusal;

/**
 * The policy engine. An interface rather than ambient function declarations so
 * the contract has no runtime exports that resolve to undefined before an
 * implementation exists.
 *
 * I5: over-request is refused, never silently downgraded. A request above the
 * station cap or the global cap is a PolicyRefusal, never a lower level.
 */
export interface PolicyEngine {
  resolveAutonomy(
    requested: AutonomyLevel, station: StationId, role: RoleId, policy: Policy
  ): PolicyResolution;
  resolveCapabilities(role: RoleId, station: StationId, policy: Policy): CapabilityResolution;
}
