/**
 * Integrity: the checks the runtime runs, the results only the runtime can
 * produce, the tamper analysis that turns a diff into a verdict, and the
 * violation record the Vault stores when a control is circumvented.
 */
import type { RoleId, RunId, TaskId } from '@olympus-ai/core';

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
