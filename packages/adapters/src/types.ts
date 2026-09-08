/**
 * Stack adapters: the per-language, per-framework hooks the integrity layer
 * uses to enumerate suites, parse assertions, and measure coverage. I5: a
 * stack with no adapter loses controls loudly and can never run at L3.
 */
import type { CheckResult } from '@olympus-ai/integrity';
import type { SandboxHandle } from '@olympus-ai/sandbox';

export interface TestFrameworkAdapter {
  readonly stack: string;
  enumerateSuites(dir: string): Promise<string[]>;
  parseAssertions(file: string): Promise<Assertion[]>;
  compareAssertions(before: Assertion[], after: Assertion[]): AssertionDelta;
  detectSkipMarkers(file: string): Promise<string[]>;
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
  unavailableControls(): string[];
}
