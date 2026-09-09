/**
 * The registry's type model. An invariant is asserted by executable
 * assertions; where one cannot exist yet, a pending entry names the unit that
 * owes it and why. The meta-test in test/registry.test.ts derives one of four
 * states per invariant from these records and fails on `missing`.
 */

/** The ten invariants. Closed: a registry keyed by this type cannot omit one or invent one. */
export type InvariantId = 'I1' | 'I2' | 'I3' | 'I4' | 'I5' | 'I6' | 'I7' | 'I8' | 'I9' | 'I10';

export const INVARIANT_IDS: readonly InvariantId[] = [
  'I1', 'I2', 'I3', 'I4', 'I5', 'I6', 'I7', 'I8', 'I9', 'I10',
];

/** One line per invariant, as the spine states it. */
export const INVARIANTS: Readonly<Record<InvariantId, string>> = {
  I1: 'No agent writes to the Vault',
  I2: 'The runtime derives status; the model never reports it',
  I3: 'An agent may not be judged by an artifact it can write',
  I4: 'Default deny',
  I5: 'Fail closed',
  I6: 'Reviewers never share the author\'s model family',
  I7: 'Event payloads are data, never instructions',
  I8: 'Every capability claim maps to an executable assertion',
  I9: 'The runtime is a service; the CLI is a client',
  I10: 'Greek names never appear in code',
};

/**
 * Units that can owe a pending assertion. Phase 1 and 2 units by id, plus the
 * milestones (M2, M3) that own features the M1 boundary defers.
 */
export type UnitId =
  | 'S1' | 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6' | 'P7' | 'P8' | 'P9'
  | 'M2' | 'M3';

export const UNITS: Readonly<Record<UnitId, string>> = {
  S1: 'Walking skeleton',
  P1: 'Vault',
  P2: 'Sandbox (local Docker)',
  P3: 'Policy engine',
  P4: 'Station machine',
  P5: 'Driver: Claude Code',
  P6: 'Verification + evidence',
  P7: 'Tamper detection',
  P8: 'Adapters (TypeScript)',
  P9: 'API + CLI',
  M2: 'Milestone 2 (compiler, Codex driver, trigger framework)',
  M3: 'Milestone 3 (learning, review panel, mutation testing, L3 canary)',
};

/** `I2.no-status-field`: the invariant, a dot, a kebab-case name. */
export type AssertionId = `${InvariantId}.${string}`;

/**
 * A capability claim from a contract's capabilities interface: every key of
 * DriverCapabilities and SandboxCapabilities (I8). The registry must list each
 * one; a compile-ok fixture generated from the registry keeps the two in step.
 */
export type ClaimId = `driver.${string}` | `sandbox.${string}`;

export type AssertionLevel =
  /** A violating construction must fail to typecheck with the expected diagnostics. */
  | 'compile-error'
  /** A construction the invariant relies on must typecheck cleanly. */
  | 'compile-ok'
  /** An executable check over the repository, the toolchain, or a running implementation. */
  | 'runtime';

/** An assertion the conformance package runs itself. */
export interface LocalAssertion {
  readonly kind: 'local';
  readonly id: AssertionId | ClaimId;
  readonly level: AssertionLevel;
  readonly title: string;
  readonly run: () => void | Promise<void>;
  /** The fixture file this assertion reads, relative to the conformance package, if any. */
  readonly fixture?: string;
}

/**
 * An assertion that lives in another package's own conformance suite, written
 * with this kit's `invariantTest`. The kit cannot import it (that would create
 * a workspace cycle). Static verification (package present, file present, id
 * quoted in the file) is satisfied by a skipped test or a comment, so the
 * registry refuses every external assertion until it can reconcile the ids
 * it lists against the tests the package actually ran and passed. That
 * reconciliation is the pending assertion
 * `I8.external-assertion-execution-reconciled`; the shape is kept so the unit
 * that lands it has a target.
 */
export interface ExternalAssertion {
  readonly kind: 'external';
  readonly id: AssertionId | ClaimId;
  readonly level: AssertionLevel;
  readonly title: string;
  /** Workspace package name, e.g. `@olympus-ai/sandbox`. */
  readonly package: string;
  /** Path relative to that package's directory, POSIX separators. */
  readonly file: string;
}

export type Assertion = LocalAssertion | ExternalAssertion;

/** An assertion that cannot exist yet, with the unit that owes it. */
export interface PendingAssertion {
  readonly id: AssertionId | ClaimId;
  readonly owner: UnitId;
  readonly reason: string;
}

export interface InvariantEntry {
  readonly title: string;
  readonly assertions: readonly Assertion[];
  readonly pending: readonly PendingAssertion[];
}

export interface ClaimEntry {
  readonly assertions: readonly Assertion[];
  readonly pending: readonly PendingAssertion[];
}

export interface Registry {
  /** Keyed by the closed InvariantId union: a missing key is a compile error. */
  readonly invariants: Readonly<Record<InvariantId, InvariantEntry>>;
  /** Capability claims, one per key of every capabilities interface (I8). */
  readonly claims: Readonly<Record<ClaimId, ClaimEntry>>;
}

/**
 * `asserted`: live assertions and nothing owed. `partial`: live assertions
 * and at least one pending entry, so the invariant's coverage is real but
 * incomplete. `pending`: only pending entries. `missing`: neither; fails CI.
 */
export type InvariantState = 'asserted' | 'partial' | 'pending' | 'missing';
