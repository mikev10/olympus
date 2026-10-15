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
