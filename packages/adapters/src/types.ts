/**
 * Stack adapters: the per-language, per-framework hooks the integrity layer
 * uses to enumerate suites, parse assertions, and measure coverage. I5: a
 * stack with no adapter loses controls loudly and can never run at L3.
 */
import type { CheckResult } from '@olympus-ai/integrity';
import type { SandboxHandle } from '@olympus-ai/sandbox';
import type { SecurityScanner } from './security.js';

export interface TestFrameworkAdapter {
  readonly stack: string;
  /**
   * The runner's entry point, relative to the repository root: the copy the
   * repository installed of the framework it declares. A suite check runs
   * this file and no command a manifest pinned (D-R15-04).
   */
  readonly runner: string;
  /**
   * The argument vector that runs the framework from the repository root:
   * over every configured suite when `tests` is null, else over exactly the
   * named files, each tree-relative. Nothing in it comes from the
   * repository's configuration but the configuration the runner itself reads.
   */
  invocation(tests: readonly string[] | null): readonly [string, ...string[]];
  /**
   * The suites of `dir`, tree-relative and sorted, that `invocation(tests)`
   * runs there, by the runner's own selection rule. A caller that named
   * `tests` compares the two: a rule that selects more than was named runs
   * suites nobody locked, and one that selects less leaves a named test
   * unrun.
   */
  selectSuites(dir: string, tests: readonly string[]): Promise<string[]>;
  enumerateSuites(dir: string): Promise<string[]>;
  parseAssertions(file: string): Promise<Assertion[]>;
  compareAssertions(before: Assertion[], after: Assertion[]): AssertionDelta;
  detectSkipMarkers(file: string): Promise<string[]>;
  /**
   * The test cases a file declares, each by its describe-qualified title, e.g.
   * `math > adds`. A title the parser cannot resolve to a literal refuses,
   * naming the file and line, rather than dropping the case (A-P7-01).
   */
  enumerateCases(file: string): Promise<string[]>;
}

export interface Assertion { file: string; line: number; operator: string; args: string[]; tolerance?: number; }
export interface AssertionDelta { weakened: Assertion[]; removed: Assertion[]; toleranceWidened: Assertion[]; }

export interface CoverageAdapter { changedLineCoverage(base: string, head: string): Promise<number>; }

export interface MutationAdapter {
  run(files: string[], budgetMs: number): Promise<{ score: number; survived: string[]; equivalent: string[]; timedOut: string[] }>;
}

export interface BehavioralAdapter {
  kind: 'cli' | 'http' | 'browser';
  run(scenario: BehavioralScenario, h: SandboxHandle): Promise<CheckResult>;
}

export interface BehavioralScenario {
  id: string;
  input: unknown;
  expected: unknown;                  // from locked acceptance criteria, never from the implementation
}

export interface ManifestAdapter { detectConfigChanges(base: string, head: string): Promise<string[]>; }

/** I5: an unsupported stack disables controls loudly and refuses L3. */
export interface AdapterSet {
  stack: string;
  test: TestFrameworkAdapter | null;
  coverage: CoverageAdapter | null;
  mutation: MutationAdapter | null;
  behavioral: BehavioralAdapter[];
  manifest: ManifestAdapter | null;
  /**
   * The stack's static-analysis scanner, or null where it has none, which
   * names `static-analysis` among the missing controls and so refuses L3 (I5).
   * Where it is present, admission refuses a manifest that pins no check of it
   * (R17).
   */
  staticAnalysis: SecurityScanner | null;
  unavailableControls(): string[];
}

/** The stacks a dependency audit covers: the two R1 installs from (R13a, D-R13a-06). */
export type AuditStack = 'npm' | 'pnpm';

/** One advisory the audit reported against one package, located in the lockfile where the package is named. */
export interface AuditFinding {
  /** The advisory's GHSA id. */
  readonly rule: string;
  readonly packageName: string;
  /** The lockfile line naming the package, or null where none does; a null line is never invented (D-R13a-06). */
  readonly line: number | null;
  /** The runtime's: the stack, the advisory, and the package, so a finding is the same finding on another night. */
  readonly fingerprint: string;
}

/**
 * A dependency audit's declaration (R13a): the stack it audits, the root
 * files it reads, the image it is pinned to, and how its output becomes
 * findings. The arguments are the declaration's; nothing in a policy or a
 * repository chooses them. Its image is pinned by digest here, and a policy
 * cannot name another (D-A-NR-04).
 */
export interface DependencyAuditor {
  readonly stack: AuditStack;
  /** The lockfile, by its name at the tree's root. */
  readonly lockfile: string;
  /** The root files copied into the audit's sandbox, the lockfile among them; nothing else of the tree is. */
  readonly files: readonly string[];
  /** `name@sha256:<digest>`. */
  readonly image: string;
  readonly invocation: readonly [string, ...string[]];
  /**
   * The findings a whole report names, located in `lockfileText`, or a
   * reason the output is not one. A report is whole only from an exit the
   * auditor declares, and only where that exit agrees with what it found:
   * a clean report from an abnormal exit, or findings from a clean exit, is
   * not one. Never an empty list for a report it could not read (I5).
   */
  parse(stdout: string, exitCode: number, lockfileText: string): { readonly ok: true; readonly findings: AuditFinding[] } | { readonly ok: false; readonly unreachable: boolean };
}

/** A stack the runtime installs from its lockfile (A-R34-02). R29 adds Python's. */
export type InstallStack = 'npm' | 'pnpm';

/**
 * One package a lockfile pins: its key in the lockfile, the integrity hash
 * the lockfile records for it, and why an install could not verify it
 * against that hash, or null when it can (D-R34-06).
 */
export interface LockedPackage {
  readonly key: string;
  readonly integrity: string | null;
  readonly unverifiable: string | null;
}

/**
 * The runtime's dependency install for one stack (A-R34-02), declared once
 * beside the dependency audit (R13a). The runtime runs it, never a seat: in
 * a sandbox of its own whose egress is the registries policy grants, over a
 * copy of `files` and nothing else of the tree, with no lifecycle script.
 * What it writes under `trees` is what every check runs over (I3).
 */
export interface DependencyInstaller {
  readonly stack: InstallStack;
  /** The lockfile, by its name at the tree's root. */
  readonly lockfile: string;
  /** How the runtime parses the lockfile before `packages` reads it (D-R34-07). */
  readonly format: 'json' | 'yaml';
  /** The root manifest that declares this stack's dependencies; a tree holding it and no lockfile is refused. */
  readonly manifest: string;
  /** The root files copied into the install's sandbox, the lockfile among them. */
  readonly files: readonly string[];
  /** A file name copied from every directory below the root outside a dependency tree (workspace manifests), or null. */
  readonly nested: string | null;
  /** The dependency trees the install writes, by directory name, found at any depth. */
  readonly trees: readonly string[];
  /** `name@sha256:<digest>`. */
  readonly image: string;
  readonly invocation: readonly [string, ...string[]];
  readonly env: Readonly<Record<string, string>>;
  /**
   * Every package the parsed lockfile pins, or why the document is not a
   * lockfile this installer reads. Never an empty list for a document it
   * could not read (I5).
   */
  packages(document: unknown): { readonly ok: true; readonly packages: readonly LockedPackage[] } | { readonly ok: false; readonly reason: string };
  /** The cause a failed install's output names, where it names one the runtime knows; null otherwise. */
  failure(output: string): string | null;
}
