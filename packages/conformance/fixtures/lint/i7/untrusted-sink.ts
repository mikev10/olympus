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

// Wrapped: the untrusted value inside a container the rule must look into.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- I7 fixture: the erasure under test
declare function erase<T>(value: T): unknown;
interface Wrapper { readonly inner: { readonly payload: UntrustedPayload } }
declare const wrapper: Wrapper;
// eslint-disable-next-line i7/no-untrusted-sink -- I7 fixture
export const wrapped = JSON.stringify({ payload }); // expect-lint i7/no-untrusted-sink
// eslint-disable-next-line i7/no-untrusted-sink -- I7 fixture
export const nested = JSON.stringify(wrapper); // expect-lint i7/no-untrusted-sink
// eslint-disable-next-line i7/no-untrusted-sink -- I7 fixture
sink({ payload }); // expect-lint i7/no-untrusted-sink
// eslint-disable-next-line i7/no-untrusted-sink -- I7 fixture
sink(wrapper); // expect-lint i7/no-untrusted-sink
// Generic erasure: a type parameter the return type drops.
// eslint-disable-next-line i7/no-untrusted-sink -- I7 fixture
export const erased = erase(payload); // expect-lint i7/no-untrusted-sink

// Not reported: the envelope kept at its own type, and a trusted string widened.
export const kept: UntrustedPayload = payload;
export const trusted: unknown = 'a trusted string';
// A generic that keeps its type parameter in what it returns erases nothing.
export const frozen = Object.freeze(payload);
export const lists: UntrustedPayload[][] = [[payload]];
