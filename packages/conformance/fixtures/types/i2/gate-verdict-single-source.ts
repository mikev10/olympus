// I2: GateResult has one verdict. There is no second boolean that could
// disagree with it; "passed" is a comparison, not a field.
import type { GateResult } from '@olympus-ai/integrity';

declare const gate: GateResult;

export const passed = gate.passed; // expect-error TS2339: Property 'passed' does not exist on type 'GateResult'
export const ok = gate.ok; // expect-error TS2339: Property 'ok' does not exist on type 'GateResult'
export const isPass: boolean = gate.verdict === 'pass';
