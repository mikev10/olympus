/**
 * Policy: the versioned, Vault-resident declaration of what each role may do,
 * where, and at what autonomy level. I4: anything not granted here is denied.
 *
 * Two shapes. PolicyDocument is what a human authors and what policy.yaml
 * parses to; it is sparse. Policy is the resolved, total form the engine
 * consumes and the Vault stores. PolicyEngine.resolvePolicy is the only way
 * from one to the other.
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

/** One key per station and level: ten stations, four levels, forty keys. */
export type ApprovalKey = `${StationId}:${AutonomyLevel}`;

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

/**
 * What a human authors: the shape parsed from policy.yaml. `approvals` and
 * `stationCaps` are sparse, so a file need not enumerate every station and
 * level. The engine never consumes this shape directly; it becomes a Policy
 * only through PolicyEngine.resolvePolicy, which decides what every omitted
 * key means.
 */
export interface PolicyDocument {
  globalCap: AutonomyLevel;                                    // ships as 2
  stationCaps: Partial<Record<StationId, AutonomyLevel>>;
  approvals: Partial<Record<ApprovalKey, ApprovalOutcome>>;
  roles: Record<RoleId, CapabilityScope>;
  protectedPaths: string[];           // in-repo but escalating: CI, test config, package scripts
  triggers: TriggerPolicy;
  concurrency: { maxParallelTasks: number; maxConflictRetries: number };
}

/**
 * The resolved form the engine consumes. `approvals` is total: all forty
 * station:level keys are present, so a gate lookup can never miss and nothing
 * downstream has a default to apply.
 *
 * This resolved Policy, not the PolicyDocument it came from, is what is
 * hashed into the Vault (VaultRefKind 'policy'). An auditor reads the
 * effective table, never a config file plus a defaulting rule.
 */
export interface Policy {
  globalCap: AutonomyLevel;                                    // ships as 2
  stationCaps: Partial<Record<StationId, AutonomyLevel>>;
  approvals: Record<ApprovalKey, ApprovalOutcome>;
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
  /**
   * Runs once at load. Every approval the document leaves unspecified resolves
   * to 'human-required', never 'auto': an unconfigured policy is safe, not
   * broken. The Policy this returns is what the runtime hashes into the Vault
   * and what every other method here takes; the document is never the policy
   * of record.
   */
  resolvePolicy(doc: PolicyDocument): Policy;
  resolveAutonomy(
    requested: AutonomyLevel, station: StationId, role: RoleId, policy: Policy
  ): PolicyResolution;
  resolveCapabilities(role: RoleId, station: StationId, policy: Policy): CapabilityResolution;
}
