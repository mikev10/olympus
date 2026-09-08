// I5: a policy resolution succeeds with a level or refuses with a reason and
// detail. A refusal cannot omit its reason, success cannot carry a downgrade
// marker in place of a refusal, and a capability resolution cannot succeed
// without the scope it resolved.
import type { CapabilityResolution, PolicyResolution } from '@olympus-ai/core';

export const granted: PolicyResolution = { ok: true, level: 2 };
export const refused: PolicyResolution = { ok: false, reason: 'exceeds-cap', detail: 'requested 3, cap 2' };
export const bare: PolicyResolution = { ok: false }; // expect-error TS2322: Type '{ ok: false; }' is not assignable to type 'PolicyResolution'
export const unknownReason: PolicyResolution = { ok: false, reason: 'downgraded', detail: '' }; // expect-error TS2322: Type '"downgraded"' is not assignable to type
export const downgraded: PolicyResolution = { ok: true, level: 1, downgradedFrom: 3 }; // expect-error TS2353: 'downgradedFrom' does not exist in type
export const noScope: CapabilityResolution = { ok: true }; // expect-error TS2322: Type '{ ok: true; }' is not assignable to type 'CapabilityResolution'
