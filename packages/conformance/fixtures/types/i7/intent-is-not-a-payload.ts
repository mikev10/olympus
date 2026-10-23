// I7: a spec-less run is drafted from a person's intent, which only the human
// principal's channel supplies (R19, D-A-DS-01). A trigger's payload, its raw
// text, or an intent claiming another channel is not one.
import type { Intent, RunRequest } from '@olympus-ai/api';
import type { UntrustedPayload } from '@olympus-ai/triggers';

declare const payload: UntrustedPayload;

export const fromRaw: Intent = { text: payload.raw, from: 'principal' }; // expect-error TS2322: Type 'UntrustedText' is not assignable to type 'string'
export const asIntent: Intent = payload; // expect-error TS2739: is missing the following properties from type 'Intent'
export const fromTrigger: Intent = { text: 'add a greeting', from: 'trigger' }; // expect-error TS2322: Type '"trigger"' is not assignable to type '"principal"'
export const onRequest: RunRequest['intent'] = payload; // expect-error TS2739: is missing the following properties from type 'Intent'
export const fromPrincipal: RunRequest['intent'] = { text: 'add a greeting', from: 'principal' };
