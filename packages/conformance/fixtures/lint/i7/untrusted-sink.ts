// I7 lint fixture for the sink rule. Each annotated line serialises untrusted
// text or widens it to a slot that keeps nothing of its type, both of which
// compile and pass the three coercion rules. The registry assertion lints this
// file with inline configuration ignored and requires each annotated line to
// report.
import type { UntrustedPayload, UntrustedText } from '@olympus-ai/triggers';

declare const payload: UntrustedPayload;
declare const raw: UntrustedText;
declare function sink(value: unknown): void;
declare function anySink(value: object): void;

// eslint-disable-next-line i7/no-untrusted-sink -- I7 fixture
export const serialised = JSON.stringify(payload.raw); // expect-lint i7/no-untrusted-sink
// eslint-disable-next-line i7/no-untrusted-sink -- I7 fixture
export const envelope = JSON.stringify(payload); // expect-lint i7/no-untrusted-sink
// eslint-disable-next-line i7/no-untrusted-sink -- I7 fixture
export const widened: unknown = raw; // expect-lint i7/no-untrusted-sink
// eslint-disable-next-line i7/no-untrusted-sink -- I7 fixture
sink(raw); // expect-lint i7/no-untrusted-sink
// eslint-disable-next-line i7/no-untrusted-sink -- I7 fixture
anySink(payload); // expect-lint i7/no-untrusted-sink
export function returned(): object {
  // eslint-disable-next-line i7/no-untrusted-sink -- I7 fixture
  return raw; // expect-lint i7/no-untrusted-sink
}
// eslint-disable-next-line i7/no-untrusted-sink -- I7 fixture
export const held: Record<string, unknown> = { raw }; // expect-lint i7/no-untrusted-sink
// eslint-disable-next-line i7/no-untrusted-sink -- I7 fixture
export const listed: unknown[] = [raw]; // expect-lint i7/no-untrusted-sink

// Not reported: the envelope kept at its own type, and a trusted string widened.
export const kept: UntrustedPayload = payload;
export const trusted: unknown = 'a trusted string';
