// I7: a spec-less run is drafted from a person's intent, which only the human
// principal's channel supplies (R19, D-A-DS-01). A trigger's payload, its raw
// text, or an intent claiming another channel is not one.
// A bug fix's three parts are the same channel's (A-R16-02): no part is a payload's text.
import type { Intent, RunRequest } from '@olympus-ai/api';
import type { UntrustedPayload } from '@olympus-ai/triggers';

declare const payload: UntrustedPayload;

export const fromRaw: Intent = { text: payload.raw, from: 'principal' }; // expect-error TS2322: Type 'UntrustedText' is not assignable to type 'string'
export const asIntent: Intent = payload; // expect-error TS2322: Type 'UntrustedPayload' is not assignable to type 'Intent'
export const fromTrigger: Intent = { text: 'add a greeting', from: 'trigger' }; // expect-error TS2322: Type '"trigger"' is not assignable to type '"principal"'
export const onRequest: RunRequest['intent'] = payload; // expect-error TS2322: Type 'UntrustedPayload' is not assignable to type 'Intent | null | undefined'
export const fromPrincipal: RunRequest['intent'] = { text: 'add a greeting', from: 'principal' };
export const bugFromRaw: Intent = { from: 'principal', template: 'bug-fix', steps: payload.raw, actual: 'it fails', expected: 'it passes' }; // expect-error TS2322: Type 'UntrustedText' is not assignable to type 'string'
export const bugFromTrigger: Intent = { from: 'trigger', template: 'bug-fix', steps: 'run it', actual: 'it fails', expected: 'it passes' }; // expect-error TS2322: Type '"trigger"' is not assignable to type '"principal"'
export const bugFromPrincipal: Intent = { from: 'principal', template: 'bug-fix', steps: 'run it', actual: 'it fails', expected: 'it passes' };
