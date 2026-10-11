// I2 (R1 §4): a probe's outcome is computed by the runtime from what it
// observed, never supplied by a model or a driver. A ProbeResult and a
// ReadinessReport say so with a `collectedBy: 'runtime'` literal no other
// value satisfies, and neither has a field that can be written after the
// runtime built it.
import type { ProbeResult, ReadinessReport } from '@olympus-ai/readiness';

declare const result: ProbeResult;
declare const report: ReadinessReport;

export const fromRuntime: ProbeResult = { ...result, collectedBy: 'runtime' };
export const fromModel: ProbeResult = { ...result, collectedBy: 'model' }; // expect-error TS2322: Type '"model"' is not assignable to type '"runtime"'
export const fromDriver: ProbeResult = { ...result, collectedBy: 'driver' }; // expect-error TS2322: Type '"driver"' is not assignable to type '"runtime"'
export const unstated: ProbeResult = { ...result, collectedBy: undefined }; // expect-error TS2322: Type 'undefined' is not assignable to type '"runtime"'
export const reportFromModel: ReadinessReport = { ...report, collectedBy: 'model' }; // expect-error TS2322: Type '"model"' is not assignable to type '"runtime"'

export function overwrite(target: ProbeResult): void {
  target.outcome = 'supported'; // expect-error TS2540: Cannot assign to 'outcome' because it is a read-only property
}
export function relabel(target: ReadinessReport): void {
  target.ceiling.level = 2; // expect-error TS2540: Cannot assign to 'level' because it is a read-only property
}
export function append(target: ReadinessReport): void {
  target.probes.push(result); // expect-error TS2339: Property 'push' does not exist on type 'readonly ProbeResult[]'
}
