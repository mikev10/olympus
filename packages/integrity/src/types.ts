/**
 * Integrity: the checks the runtime runs, the results only the runtime can
 * produce, the tamper analysis that turns a diff into a verdict, and the
 * violation record the Vault stores when a control is circumvented.
 */
import type { RoleId, RunId, TaskId } from '@olympus-ai/core';

export type CheckKind =
  | 'compile' | 'typecheck' | 'lint' | 'unit'
  | 'acceptance' | 'behavioral' | 'coverage' | 'mutation'
  | 'property'
  | SecurityCheckKind;

/** The kinds a scanner runs: deterministic, no model call, judged by their findings against the base (D-A-SC-01). */
export type SecurityCheckKind = 'secret-scan' | 'static-analysis';

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
export type CheckSpec = AcceptanceCheckSpec | UnitCheckSpec | PropertyCheckSpec | BehavioralCheckSpec | SecurityCheckSpec | OtherCheckSpec;

/**
 * A scanner's check. It pins no command: the runtime runs the scanner its
 * image is declared for, with the arguments that scanner's declaration
 * names, over a copy of the tree with the scanner's in-tree ignore files
 * removed, and its rules mounted read-only from `config` (D-R17-01,
 * D-R17-03). Nothing the repository holds configures it (I3). Its exit code
 * is not its verdict: its findings are, judged against the base's (D-A-SC-02).
 */
export interface SecurityCheckSpec extends CheckSpecFields {
  kind: SecurityCheckKind;
  /** `name@sha256:<64 hex>`, and the image admission declares for this kind; a tag is not a pin. */
  image: string;
  /** The scanner's rules, as text locked with the manifest; `null` for the image's built-in rules where its scanner has them. */
  config: string | null;
  command?: never;
  tests?: never;
  onBase?: never;
  expectedSuiteCount?: never;
  deniesRule?: never;
  seed?: never;
  numRuns?: never;
}

/**
 * A check whose result is a test runner's: `unit`, `acceptance`, and
 * `property`. It pins
 * no command. The runtime runs the test framework the base declares, from
 * the base's own install, over the suites the check names, so a suite count
 * is a count of what the runner was made to load rather than an inventory
 * of the tree, and nothing the change writes can stand in for the runner
 * (D-R15-04).
 */
export type SuiteCheckSpec = AcceptanceCheckSpec | UnitCheckSpec | PropertyCheckSpec;

/**
 * A property check (R25) runs locked property files. Each states what must
 * hold for every input in a domain, and the stack's property framework
 * checks it against inputs it generates. The files are admitted and locked
 * with the acceptance tests (I3). The runtime sets the seed and the number of
 * cases through the set's property adapter; the file never does. Every
 * property the adapter found in the files must report that many cases on
 * that seed. Fewer, another seed, or no report is a refusal (I5, D-R25-02).
 * The seed is pinned so that a rerun reaches the same verdict (I2).
 */
export interface PropertyCheckSpec extends SuiteCheckFields {
  kind: 'property';
  onBase: BaseDeclaration;
  /** Tree-relative paths, each an admitted file that registers at least one property with the set's framework. */
  tests: readonly [string, ...string[]];
  /** The generator's seed, a 32-bit signed integer. */
  seed: number;
  /** The cases every property must run, a positive integer. */
  numRuns: number;
  expectedSuiteCount?: never;
  deniesRule?: never;
  reproduces?: never;
}

/**
 * An acceptance check runs exactly the locked acceptance tests it names, and
 * its suite count is the number of those the runner was made to load: every
 * one, or the gate refuses. A pinned `expectedSuiteCount` would restate it.
 */
export interface AcceptanceCheckSpec extends SuiteCheckFields, DenialFields {
  kind: 'acceptance';
  onBase: BaseDeclaration;
  /** Tree-relative paths, each an admitted acceptance test the base's framework enumerates as a suite. */
  tests: readonly [string, ...string[]];
  expectedSuiteCount?: never;
  seed?: never;
  numRuns?: never;
}

/**
 * What an acceptance or behavioral check carries when it exercises a caller
 * an authorization rule refuses: the rule's id, as the spec's security part
 * names it. Every rule needs one, or the `test-design` exit is refused.
 */
interface DenialFields {
  deniesRule?: string;
  /**
   * That the check follows the spec's steps and so reproduces the defect a
   * bug-fix run fixes (A-R16-04). Valid only with `onBase: 'fails'`, so R15's
   * base run is what shows it fails; whether it follows the steps is the
   * `test-design` critic's to judge. A bug-fix manifest needs a required one,
   * and any other run's manifest may declare none.
   */
  reproduces?: true;
}

/** A unit check runs every suite the tree's test framework is configured to run. */
export interface UnitCheckSpec extends SuiteCheckFields {
  kind: 'unit';
  onBase?: never;
  tests?: never;
  expectedSuiteCount?: number;        // I5: a shrunken enumeration is a failure
  deniesRule?: never;
  seed?: never;
  numRuns?: never;
}

export interface BehavioralCheckSpec extends CommandCheckFields, DenialFields {
  kind: 'behavioral';
  onBase?: BaseDeclaration;
}

export interface OtherCheckSpec extends CommandCheckFields {
  kind: Exclude<CheckKind, SuiteCheckSpec['kind'] | 'behavioral' | SecurityCheckKind>;
  onBase?: never;
  deniesRule?: never;
}

/** A check that carries a declaration, and so runs over the base. */
export type DeclaredCheckSpec = (AcceptanceCheckSpec | PropertyCheckSpec | BehavioralCheckSpec) & { onBase: BaseDeclaration };

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
  seed?: never;
  numRuns?: never;
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

/**
 * One thing a scanner reported, in the runtime's terms. `fingerprint` is the
 * runtime's, derived from the report and independent of line position, so
 * the same finding on the base and after the change is the same string
 * (D-R17-02). A secret's value is never here: its fingerprint is a hash.
 */
export interface Finding {
  readonly rule: string;
  readonly location: { readonly path: string; readonly line: number };
  readonly fingerprint: string;
}

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
  /**
   * A security check's findings as the runtime parsed them from its
   * scanner's report, or `null` for every other kind and for a security check
   * whose report could not be read, which is never an empty list: a scanner
   * that reported nothing readable has not shown the tree is clean (I5).
   * Required, so omission is not representable.
   */
  findings: readonly Finding[] | null;
  /**
   * A property check's runs, as the runtime read them from its process's
   * reports. `null` for every other kind, and for a property check none of
   * whose reports could be read. Never an empty run: a check that reported
   * nothing has not shown that a property holds (I5). Required, so omission
   * is not representable. The verdict is `expectation`, the runtime's
   * comparison of these runs against the pin (D-R25-02).
   */
  property: PropertyEvidence | null;
  durationMs: number;
  startedAt: string;
}

/** What a property check ran: the pin it ran under, and one entry per report (R25). */
export interface PropertyEvidence {
  readonly seed: number;
  /** The cases pinned for every property. */
  readonly numRuns: number;
  readonly runs: readonly PropertyRun[];
}

/** One property's run, as its framework reported it, located at the call that registered it. */
export interface PropertyRun {
  /** Tree-relative. */
  readonly file: string;
  readonly line: number;
  readonly seed: number;
  /** The cases the framework ran before it stopped: every pinned case, or up to and including the first that failed. */
  readonly casesRun: number;
  readonly failed: boolean;
  /** The shrunk counterexample as the framework prints it, or `null` when no case failed. */
  readonly counterexample: string | null;
}

export interface TamperReport {
  assertionsWeakened: Array<{ file: string; before: string; after: string }>;
  skipMarkersAdded: Array<{ file: string; marker: string }>;
  /** Each declared scanner suppression marker on a line the diff added, by the scanner it suppresses (D-R17-04). */
  suppressionMarkersAdded: Array<{ file: string; marker: string; kind: SecurityCheckKind }>;
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
      | 'assertion-weakened' | 'prompt-injection' | 'capability-escape'
      | 'suppression-marker';
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
