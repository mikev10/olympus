/**
 * The rule that turns the base record into a refusal or none (D-A-BF-01).
 * The line runs the declared checks over the base at the `test-design`
 * exit and records what they did; this reads that record against what each
 * check declared, in the runtime's terms alone (I2). It is exported so the
 * rule is assertable without a run.
 */
import type { BaseMismatch, StationRefusal, VaultRef } from '@olympus-ai/core';
import type { CheckSpec, DeclaredCheckSpec } from '@olympus-ai/integrity';
import type { BaseRunRecord } from '@olympus-ai/vault';
import { requiredSuites, SUITE_KINDS } from './gate.js';

/** The checks the base run runs: every check that declares what it does there, in the manifest's order (D-R15-02). */
export function declaredChecks(checks: readonly CheckSpec[]): DeclaredCheckSpec[] {
  return checks.filter((check): check is DeclaredCheckSpec => check.onBase !== undefined);
}

/**
 * Each declared check that did not do on the base what it declared. A check
 * with no result is `no-result`, never a failure: a test that never ran did
 * not fail (I5). One that ran and did the opposite of its declaration is
 * `contrary`. A suite check, or one that pins `expectedSuiteCount`, that did
 * what it declared over suites that could not be counted, or counted below
 * what it requires, is `suite-count`. An acceptance check's count is how many
 * of its named tests the runner it was run with selects, so one below the
 * number named is a test the runner never loaded, and its failure
 * reproduces nothing (D-R15-04). This is `verify`'s gate rule. A
 * behavioral check that pins no count runs the product rather than a runner,
 * so its exit code alone decides.
 */
export function baseMismatches(checks: readonly CheckSpec[], record: BaseRunRecord): BaseMismatch[] {
  const mismatched: BaseMismatch[] = [];
  for (const check of declaredChecks(checks)) {
    const result = record.checks.find((r) => r.checkId === check.id);
    if (result === undefined) {
      mismatched.push({ checkId: check.id, declared: check.onBase, exitCode: null, cause: 'no-result' });
      continue;
    }
    const failed = result.exitCode !== 0;
    if (failed !== (check.onBase === 'fails')) {
      mismatched.push({ checkId: check.id, declared: check.onBase, exitCode: result.exitCode, cause: 'contrary' });
      continue;
    }
    const counted = result.suiteCount;
    const required = requiredSuites(check);
    const unknown = counted === null && (SUITE_KINDS.has(check.kind) || required !== undefined);
    if (unknown || (counted !== null && required !== undefined && counted < required)) {
      mismatched.push({ checkId: check.id, declared: check.onBase, exitCode: result.exitCode, cause: 'suite-count' });
    }
  }
  // A security check declares nothing; it runs over the base for its findings, and one with none
  // readable there leaves no base set to judge a finding by, so the exit is refused (D-R17-01).
  for (const check of checks) {
    if (check.kind !== 'secret-scan' && check.kind !== 'static-analysis') continue;
    const result = record.checks.find((r) => r.checkId === check.id);
    if ((result?.findings ?? null) === null) {
      mismatched.push({ checkId: check.id, declared: null, exitCode: result?.exitCode ?? null, cause: 'no-result' });
    }
  }
  return mismatched;
}

/** The refusal of the `test-design` exit for a base record, or undefined when every declared check did what it declared. */
export function baseRefusal(checks: readonly CheckSpec[], record: BaseRunRecord, ref: VaultRef): StationRefusal | undefined {
  const [first, ...rest] = baseMismatches(checks, record);
  if (first === undefined) return undefined;
  const mismatched: [BaseMismatch, ...BaseMismatch[]] = [first, ...rest];
  const named = mismatched.map((m) => `${m.checkId} (${m.declared === null ? 'a security check' : `declared ${m.declared}`}, ${describe(m)})`).join(', ');
  return {
    ok: false,
    reason: 'base-mismatch',
    mismatched,
    baseRun: ref,
    message: `checks did not do on the base what they declared: ${named}`,
  };
}

function describe(m: BaseMismatch): string {
  switch (m.cause) {
    case 'contrary':
      return `exited ${String(m.exitCode)}`;
    case 'no-result':
      return m.declared === null ? 'wrote no readable report' : 'did not start';
    case 'suite-count':
      return `exited ${String(m.exitCode)} over suites that could not be counted or counted short`;
  }
}
