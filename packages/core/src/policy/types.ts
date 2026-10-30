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
import type { TemplateId } from '../trigger/schemas.js';
import type {
  AuthorTrust, AutonomyLevel, ModelTier, RoleId, StationId, TriggerKind,
} from '../run/types.js';

export interface CapabilityScope {
  stations: StationId[];              // where this role may act - nowhere else
  writableGlobs: string[];            // within the Workspace only
  tools: string[];                    // default deny (I4)
  network: { egress: 'none' | string[] };
  tier: ModelTier;
  /**
   * The tier at a station this role acts at, where it differs from `tier`
   * (A-R14-01). Sparse: a station absent here runs at `tier`. A station the
   * role may not act at is refused at validation, since its tier would apply
   * nowhere.
   */
  tierByStation: Partial<Record<StationId, ModelTier>>;
  /** Whether a task whose gate keeps failing runs its next iteration a tier higher. `'none'` unless policy grants it (I4, A-R14-01). */
  escalation: EscalationGrant;
  autonomyCeiling: AutonomyLevel;
  triggerKinds: TriggerKind[];
  budget: Budget;
}

/**
 * Escalation, granted or not (A-R14-01). Granted, a task's tier rises one step
 * for every `afterFailedGates` iterations whose gate failed, and never past
 * `ceiling`. The runtime counts the failures from the attempts it keeps; no
 * model asks for a stronger one (I2). The task's budget does not reset.
 */
export type EscalationGrant =
  | 'none'
  | { afterFailedGates: number; ceiling: ModelTier };

export type ApprovalOutcome = 'auto' | 'human-required' | 'blocked';

/** One key per station and level: ten stations, four levels, forty keys. */
export type ApprovalKey = `${StationId}:${AutonomyLevel}`;

/**
 * I7: a trigger selects a pre-declared template; the payload cannot name one.
 *
 * A non-human kind in `enabled` validates only with its whole route: an entry
 * station, a registered template, an autonomy cap, a trust floor, and a field
 * schema in code (D-A-TF-03); and then `maxDeliveryAgeMs` and
 * `candidateExpiryMs` are required (D-R22-02, D-R22-04). The four keys R22
 * added are optional in a document, so a policy that enables only `human`
 * still validates; an absent list resolves to empty (D-R22-10).
 */
export interface TriggerPolicy {
  enabled: TriggerKind[];             // ships as ['human'] only
  entryStation: Partial<Record<TriggerKind, StationId>>;
  taskTemplate: Partial<Record<TriggerKind, TemplateId>>;   // from the closed registry; payload cannot name it (A-R22-02)
  maxAutonomy: Partial<Record<TriggerKind, AutonomyLevel>>;
  minAuthorTrust: Partial<Record<TriggerKind, AuthorTrust>>;
  maxTriggerDepth: number;
  /** Candidates recorded, across non-human kinds, in a sliding window; a person's own runs do not count (D-R22-07). */
  budgetPerWindow: { runs: number; windowMs: number };
  /** Each a grant: a delivery for an id not here is refused before its body is read (D-A-TF-05). */
  subscriptions?: TriggerSubscription[];
  /** Daily firings of the `scheduled` kind (D-A-TF-08). */
  schedules?: TriggerSchedule[];
  /** How old a delivery's own signed timestamp may be; at most seven days (D-R22-02). */
  maxDeliveryAgeMs?: number;
  /** How long a recorded candidate may wait to be admitted, on the runtime's clock; at most thirty days (D-R22-04). */
  candidateExpiryMs?: number;
}

/**
 * One subscription: a grant naming where deliveries come from and the
 * secret that verifies them, never the secret (D-A-TF-05). `secret` is the
 * name of a host environment variable, prefixed `FACTORY_WEBHOOK_`; the host
 * resolves it and no sandbox spec can name it.
 */
export interface TriggerSubscription {
  id: string;
  kind: TriggerKind;
  source: 'github';
  transport: 'signed-webhook';
  secret: string;
  /** The highest trust a delivery's author association can reach here (D-A-TF-07). */
  trustCeiling: AuthorTrust;
  /** For an `issue` subscription, the labels an event may carry through; every other label is not extracted. */
  labels: string[];
}

/** One daily firing at a UTC time, `HH:MM`, of a registered template (D-A-TF-08). */
export interface TriggerSchedule {
  id: string;
  template: TemplateId;
  at: string;
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
