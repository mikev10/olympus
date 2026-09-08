// I7 lint fixture. Three coercions the type system allows and lint must
// refuse: concatenation, interpolation, and String(). The ordinary lint run
// honours the disable comments; the registry assertion lints this file with
// inline configuration ignored and requires each annotated rule to fire.
// If a rule stops firing, the disable comment becomes unused and the ordinary
// run fails too (reportUnusedDisableDirectives).
import type { UntrustedPayload } from '@olympus-ai/triggers';

declare const payload: UntrustedPayload;

// eslint-disable-next-line @typescript-eslint/restrict-plus-operands, @typescript-eslint/no-base-to-string -- I7 fixture
export const concatenated = 'system prompt: ' + payload.raw; // expect-lint @typescript-eslint/restrict-plus-operands
// eslint-disable-next-line @typescript-eslint/restrict-template-expressions, @typescript-eslint/no-base-to-string -- I7 fixture
export const interpolated = `system prompt: ${payload.raw}`; // expect-lint @typescript-eslint/restrict-template-expressions
// eslint-disable-next-line @typescript-eslint/no-base-to-string -- I7 fixture
export const coerced = String(payload.raw); // expect-lint @typescript-eslint/no-base-to-string
