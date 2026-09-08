/**
 * Integrity: the checks the runtime runs, the results only the runtime can
 * produce, and the tamper analysis that turns a diff into a verdict.
 */
import type { RunId } from '@olympus-ai/core';
import type { IntegrityViolation } from '@olympus-ai/vault';

export type CheckKind =
  | 'compile' | 'typecheck' | 'lint' | 'unit'
  | 'acceptance' | 'behavioral' | 'coverage' | 'mutation';

export interface CheckSpec {
  id: string;
  kind: CheckKind;
  command: string;                    // pinned at test-design; lives in the Vault
  required: boolean;
  timeoutMs: number;
  expectedSuiteCount?: number;        // I5: a shrunken enumeration is a failure
}

export interface VerificationManifest {
  runId: RunId;
  lockedAt: string;
  checks: CheckSpec[];
}

/** Produced by the runtime executing CheckSpec in a fresh sandbox. Never by an agent. */
export interface CheckResult {
  checkId: string;
  exitCode: number;                   // the check's own process, not the agent session's
  stdout: string; stderr: string;
  suiteCount: number | null;
  durationMs: number;
  startedAt: string;
}

export interface TamperReport {
  assertionsWeakened: Array<{ file: string; before: string; after: string }>;
  skipMarkersAdded: Array<{ file: string; marker: string }>;
  testsDeleted: string[];             // renames, moves, case-set reduction all count
  snapshotsRegenerated: string[];
  coverageDelta: number;
  protectedPathsTouched: string[];
}

export interface GateResult {
  passed: boolean;
  checks: CheckResult[];
  tamper: TamperReport;
  violations: IntegrityViolation[];
  verdict: 'pass' | 'fail' | 'escalate';
}
