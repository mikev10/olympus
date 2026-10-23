// I7 and I3: the compiler's only input is the roles directory. No parameter
// exists through which an UntrustedPayload, its raw text, or anything that
// judges an agent could reach a role's instructions (D-A-RC-05).
import { compileRoles } from '@olympus-ai/compiler';
import type { CheckSpec } from '@olympus-ai/integrity';
import type { UntrustedPayload } from '@olympus-ai/triggers';

declare const payload: UntrustedPayload;
declare const check: CheckSpec;

export const fromPayload = compileRoles(payload); // expect-error TS2345: Argument of type 'UntrustedPayload' is not assignable to parameter of type 'string'
export const fromRaw = compileRoles(payload.raw); // expect-error TS2345: Argument of type 'UntrustedText' is not assignable to parameter of type 'string'
export const fromCheck = compileRoles(check); // expect-error TS2345: is not assignable to parameter of type 'string'
export const withPayload = compileRoles('/roles', payload); // expect-error TS2554: Expected 1 arguments, but got 2
export const fromDirectory = compileRoles('/roles');
