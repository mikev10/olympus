// I7: UntrustedText is an opaque brand with no string in it. It cannot reach
// a prompt, a template, a steer message, or any string-typed slot without a
// cast, and the cast is what the runtime scan in the registry looks for.
// Concatenation and interpolation still compile; lint closes those
// (fixtures/lint/i7).
import type { Driver, TaskId, TaskRequest } from '@olympus-ai/core';
import type { UntrustedPayload } from '@olympus-ai/triggers';

declare const payload: UntrustedPayload;
declare const request: TaskRequest;
declare const driver: Driver;
declare const taskId: TaskId;

export const asString: string = payload.raw; // expect-error TS2322: Type 'UntrustedText' is not assignable to type 'string'
export const inPrefix: TaskRequest = { ...request, stablePrefix: payload.raw }; // expect-error TS2322: Type 'UntrustedText' is not assignable to type 'string'
export const inSuffix: TaskRequest = { ...request, variableSuffix: payload.raw }; // expect-error TS2322: Type 'UntrustedText' is not assignable to type 'string'
export const steered = driver.steer?.(taskId, payload.raw); // expect-error TS2345: Argument of type 'UntrustedText' is not assignable to parameter of type 'string'
export const trimmed = payload.raw.trim(); // expect-error TS2339: Property 'trim' does not exist on type 'UntrustedText'
export const length = payload.raw.length; // expect-error TS2339: Property 'length' does not exist on type 'UntrustedText'
export const sliced = payload.raw.slice(0, 10); // expect-error TS2339: Property 'slice' does not exist on type 'UntrustedText'
export const asPayload: UntrustedPayload = { ...payload, raw: 'plain text' }; // expect-error TS2322: Type 'string' is not assignable to type 'UntrustedText'
export const source: string = payload.source;
