// I7: the cast scan (I7.no-cast-outside-extractor) must see through the
// standard escape hatch. `raw as unknown as string` compiles, and so do the
// angle-bracket and `as never` forms; each is two casts, and the inner one is
// a cast from UntrustedText, which is what the scan reports. This fixture
// compiles cleanly (the type system allows every line) and is checked by the
// scan instead: every annotated line must be reported with the named type,
// and a cast of a plain string field must not be reported at all.
import type { UntrustedPayload } from '@olympus-ai/triggers';

declare const payload: UntrustedPayload;

export const doubleCast = payload.raw as unknown as string; // expect-cast UntrustedText
export const angleDoubleCast = <string>(<unknown>payload.raw); // expect-cast UntrustedText
export const viaNever = payload.raw as never as string; // expect-cast UntrustedText
export const widened = payload.raw as unknown; // expect-cast UntrustedText
export const payloadDoubleCast = payload as unknown as { raw: string }; // expect-cast UntrustedPayload
export const plainField = payload.source as string;
export const unrelated = 1 as unknown as number;
