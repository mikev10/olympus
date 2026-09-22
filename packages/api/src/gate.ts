/**
 * The rule that turns one check's result into a gate outcome, in the
 * runtime's terms (I2). The verify station applies it to every pinned check;
 * it is exported so the rule itself is assertable without a run.
 */
import type { FailedCheck } from '@olympus-ai/core';
import type { CheckResult, CheckSpec } from '@olympus-ai/integrity';

/**
 * Why a required check fails the gate, or undefined when it does not.
 *
 * A result that carries an expectation is judged by it and not by its exit
 * code: that exit code is the product's, a scenario may expect it to be
 * non-zero, and 0 says nothing about whether the output was right
 * (A-P8-01). A result without one is judged by its exit code, as every check
 * was before behavioral checks existed.
 */
export function requiredShortfall(check: CheckSpec, result: CheckResult | undefined): FailedCheck | undefined {
  if (!check.required) return undefined;
  if (result === undefined) return { checkId: check.id, exitCode: null, cause: 'no-result' };
  if (result.expectation !== null) {
    if (!result.expectation.held) return { checkId: check.id, exitCode: result.exitCode, cause: 'expectation' };
  } else if (result.exitCode !== 0) {
    return { checkId: check.id, exitCode: result.exitCode, cause: 'exit-code' };
  }
  if (check.expectedSuiteCount !== undefined && (result.suiteCount === null || result.suiteCount < check.expectedSuiteCount)) {
    return { checkId: check.id, exitCode: result.exitCode, cause: 'suite-count' };
  }
  return undefined;
}
