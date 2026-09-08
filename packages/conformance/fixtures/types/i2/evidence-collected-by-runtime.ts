// I2: an evidence bundle is collected by the runtime. The literal type makes
// any other collector unrepresentable, and the bundle has no pass/fail field
// for anyone to fill in.
import type { EvidenceBundle } from '@olympus-ai/vault';

declare const bundle: EvidenceBundle;

export const byAgent: EvidenceBundle = { ...bundle, collectedBy: 'agent' }; // expect-error TS2322: Type '"agent"' is not assignable to type '"runtime"'
export const byDriver: EvidenceBundle = { ...bundle, collectedBy: 'driver' }; // expect-error TS2322: Type '"driver"' is not assignable to type '"runtime"'
export const passed = bundle.passed; // expect-error TS2339: Property 'passed' does not exist on type 'EvidenceBundle'
export const status = bundle.status; // expect-error TS2339: Property 'status' does not exist on type 'EvidenceBundle'
export const diff: string[] = bundle.claimEvidenceDiff;
