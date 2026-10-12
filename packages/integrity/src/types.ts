/**
 * Integrity: the checks the runtime runs, the results only the runtime can
 * produce, the tamper analysis that turns a diff into a verdict, and the
 * violation record the Vault stores when a control is circumvented.
 */
import type { RoleId, RunId, TaskId } from '@olympus-ai/core';

export type CheckKind =
  | 'compile' | 'typecheck' | 'lint' | 'unit'
  | 'acceptance' | 'behavioral' | 'coverage' | 'mutation';

/** What a check declares it does over the base: `'fails'` reproduces what the change must fix, `'passes'` guards behaviour that must survive it. */
export type BaseDeclaration = 'fails' | 'passes';

/**
 * A check as `test-design` locked it. An acceptance check declares what it
 * does on the base, with no default; a behavioral check may, since it runs
 * the product rather than a test runner and so reproduces a defect in a
 * repository with no test framework. The runtime runs every declared check
 * over the base before any driver is invoked and refuses the `test-design`
 * exit if one does otherwise (D-A-BF-01, D-R15-02). No other kind carries a
 * declaration: one that did nothing would be a claim with no effect.
 */
export type CheckSpec = AcceptanceCheckSpec | UnitCheckSpec | BehavioralCheckSpec | OtherCheckSpec;

/**
 * A check whose result is a test runner's: `unit` and `acceptance`. It pins
 * no command. The runtime runs the test framework the base declares, from
 * the base's own install, over the suites the check names, so a suite count
 * is a count of what the runner was made to load rather than an inventory
 * of the tree, and nothing the change writes can stand in for the runner
 * (D-R15-04).
 */
export type SuiteCheckSpec = AcceptanceCheckSpec | UnitCheckSpec;

/**
 * An acceptance check runs exactly the locked acceptance tests it names, and
 * its suite count is the number of those the runner was made to load: every
 * one, or the gate refuses. A pinned `expectedSuiteCount` would restate it.
 */
export interface AcceptanceCheckSpec extends SuiteCheckFields {
  kind: 'acceptance';
  onBase: BaseDeclaration;
  /** Tree-relative paths, each an admitted acceptance test the base's framework enumerates as a suite. */
  tests: readonly [string, ...string[]];
  expectedSuiteCount?: never;
}

/** A unit check runs every suite the tree's test framework is configured to run. */
export interface UnitCheckSpec extends SuiteCheckFields {
  kind: 'unit';
  onBase?: never;
  tests?: never;
  expectedSuiteCount?: number;        // I5: a shrunken enumeration is a failure
}

export interface BehavioralCheckSpec extends CommandCheckFields {
  kind: 'behavioral';
  onBase?: BaseDeclaration;
}

export interface OtherCheckSpec extends CommandCheckFields {
  kind: Exclude<CheckKind, SuiteCheckSpec['kind'] | 'behavioral'>;
  onBase?: never;
}

/** A check that carries a declaration, and so runs over the base. */
export type DeclaredCheckSpec = (AcceptanceCheckSpec | BehavioralCheckSpec) & { onBase: BaseDeclaration };

interface CheckSpecFields {
  id: string;
  required: boolean;
  timeoutMs: number;
}

interface SuiteCheckFields extends CheckSpecFields {
  /** The runtime's, never the manifest's: see `SuiteCheckSpec`. */
  command?: never;
}

interface CommandCheckFields extends CheckSpecFields {
  /**
   * Pinned at test-design; lives in the Vault. An argument vector, run exactly
   * as given with no shell: a check that needs one names it, `['sh', '-c', …]`,
   * so the shell is part of what was pinned rather than something the runtime
   * added. A string with a grammar the runtime would have to invent is not
   * representable (A-P6-01).
   */
  command: readonly [string, ...string[]];
  tests?: never;
  expectedSuiteCount?: number;        // I5: a shrunken enumeration is a failure
}

export interface VerificationManifest {
  runId: RunId;
  lockedAt: string;
  checks: CheckSpec[];
}

/** One way a behavioral check's observation differed from its locked expectation. */
export interface ExpectationMismatch {
  field: string;                      // the expectation that did not hold, e.g. `exitCode` or `stdoutIncludes[1]`
  expected: string;
  observed: string;
}

/**
 * The runtime's comparison of what a check observed against what it was
 * expected to observe, made where the code under test cannot reach it (I2).
 * The two arms keep the verdict and the evidence for it from disagreeing: an
 * expectation that held carries no mismatch, and one that failed names at
 * least one (A-P8-01).
 *
 * `mismatches?: never` on the held arm is what makes that true of every
 * assignment rather than of fresh object literals alone: excess properties
 * are only checked on a literal written at the point of assignment, so
 * without it a value built first and annotated afterwards carries both a
 * verdict and evidence against it. The failed arm's tuple is readonly for the
 * same reason: a tuple typed as non-empty can still be emptied by `pop`.
 */
export type ExpectationOutcome =
  | { readonly held: true; readonly mismatches?: never }
  | { readonly held: false; readonly mismatches: readonly [ExpectationMismatch, ...ExpectationMismatch[]] };

/** Produced by the runtime executing CheckSpec in a fresh sandbox. Never by an agent. */
export interface CheckResult {
  checkId: string;
  exitCode: number;                   // the check's own process, not the agent session's
  stdout: string; stderr: string;
  suiteCount: number | null;
  /**
   * `null` for a check whose exit code is its whole result. A behavioral
   * check's exit code is the product's: it can be 0 while the output is
   * wrong, and non-zero because the scenario expects an error. So when this
   * is present it is the verdict, a gate fails the check when `held` is false,
   * and the exit code is evidence rather than a verdict (A-P8-01). Required:
   * omission is not representable.
   */
  expectation: ExpectationOutcome | null;
  durationMs: number;
  startedAt: string;
}

export interface TamperReport {
  assertionsWeakened: Array<{ file: string; before: string; after: string }>;
  skipMarkersAdded: Array<{ file: string; marker: string }>;
  testsDeleted: string[];             // renames, moves, case-set reduction all count
  snapshotsRegenerated: string[];
  /**
   * The coverage of the lines the diff changed, as the coverage adapter reads it
   * from the report a pinned coverage check wrote, or `null` when the manifest
   * pins no coverage check. A pinned check with no readable report refuses; it
   * is never a zero and never a `null` (A-P7-02).
   */
  coverageDelta: number | null;
  protectedPathsTouched: string[];
}

export interface IntegrityViolation {
  runId: RunId; taskId: TaskId | null;
  kind: 'lock-tamper' | 'vault-write-attempt' | 'protected-path'
      | 'claim-mismatch' | 'suite-shrink' | 'skip-marker'
      | 'assertion-weakened' | 'prompt-injection' | 'capability-escape';
  role: RoleId; driverProvenanceId: string; contractVersion: string;
  detectedAt: string; detail: Record<string, unknown>;
}

/** `verdict` is the single source of truth; "passed" is `verdict === 'pass'`. */
export interface GateResult {
  checks: CheckResult[];
  tamper: TamperReport;
  violations: IntegrityViolation[];
  verdict: 'pass' | 'fail' | 'escalate';
}
