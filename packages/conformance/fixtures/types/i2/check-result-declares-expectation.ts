// I2 (A-P8-01): a check result must state whether an expectation held, null
// when the check has none. A behavioral check's exit code is the product's,
// so a result that could omit its expectation would let a gate read that
// exit code as the verdict. The outcome's two arms keep the verdict and the
// evidence for it from disagreeing: a held expectation names no mismatch, and
// a failed one names at least one.
import type { CheckResult, ExpectationOutcome } from '@olympus-ai/integrity';

declare const result: CheckResult;

export const omitted: CheckResult = { // expect-error TS2741: Property 'expectation' is missing
  checkId: result.checkId,
  exitCode: result.exitCode,
  stdout: result.stdout,
  stderr: result.stderr,
  suiteCount: result.suiteCount,
  durationMs: result.durationMs,
  startedAt: result.startedAt,
};

export const none: CheckResult = { ...result, expectation: null };
export const optional: CheckResult = { ...result, expectation: undefined }; // expect-error TS2322: Type 'undefined' is not assignable to type 'ExpectationOutcome | null'

export const held: ExpectationOutcome = { held: true };
export const heldWithMismatches: ExpectationOutcome = { held: true, mismatches: [] }; // expect-error TS2353: 'mismatches' does not exist
export const failedWithNone: ExpectationOutcome = { held: false, mismatches: [] }; // expect-error TS2322: Source has 0 element(s) but target requires 1
export const failed: ExpectationOutcome = { held: false, mismatches: [{ field: 'stdout', expected: 'a', observed: 'b' }] };
