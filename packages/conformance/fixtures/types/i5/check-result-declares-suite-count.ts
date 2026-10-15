// I5: a check result must state its suite count, null when the adapter could
// not enumerate. An omitted count would let a shrunken suite pass unnoticed;
// null is a declared unknown the gate can refuse on.
import type { CheckResult } from '@olympus-ai/integrity';

declare const result: CheckResult;

export const omitted: CheckResult = { // expect-error TS2741: Property 'suiteCount' is missing
  checkId: result.checkId,
  exitCode: result.exitCode,
  stdout: result.stdout,
  stderr: result.stderr,
  expectation: result.expectation,
  findings: result.findings,
  durationMs: result.durationMs,
  startedAt: result.startedAt,
};

export const unknown: CheckResult = { ...result, suiteCount: null };
export const optional: CheckResult = { ...result, suiteCount: undefined }; // expect-error TS2322: Type 'undefined' is not assignable to type 'number | null'
// R17: a security check's findings are stated the same way, null when its report could not be read.
export const findingsOptional: CheckResult = { ...result, findings: undefined }; // expect-error TS2322: Type 'undefined' is not assignable to type 'readonly Finding[] | null'

