/**
 * Triggers: how work enters the factory. I7: a payload is data, never an
 * instruction. It arrives inside an envelope, selects a pre-declared template,
 * and supplies parameters only.
 *
 * TriggerKind, AuthorTrust, TriggerLineage, and TriggerRef live in core
 * (run/types.ts) because runs and policy refer to them; TriggerPolicy lives in
 * core (policy/types.ts) because it is policy; the template registry and the
 * field schemas live in core (trigger/schemas.ts) because the policy validator
 * reads them (D-R22-05). This package owns the envelope, the signature check,
 * and the extractors.
 */
import type { AuthorTrust, ExtractedFields, SchemaKind, TriggerLineage } from '@olympus-ai/core';

/**
 * I7: an opaque handle to untrusted text. Deliberately NOT a string subtype, so
 * it cannot be passed where a string is expected: not to a prompt builder, a
 * template, or a driver. Only the trigger extractor reads it, through a
 * deliberate cast, and the conformance suite (packages/conformance) rejects
 * that cast anywhere else. `+` and template interpolation accept objects; lint
 * closes them with restrict-plus-operands and restrict-template-expressions,
 * and `JSON.stringify` and widening to `unknown` with the sink rule
 * (`packages/conformance/lint/untrusted-sink.js`).
 */
export type UntrustedText = { readonly __brand: 'UntrustedText' };

/**
 * I7: the envelope for untrusted input. `raw` is NEVER concatenated into a
 * system or role prompt; only `extracted` (on TriggerEvent) crosses in.
 */
export interface UntrustedPayload {
  readonly __brand: 'UntrustedPayload';
  raw: UntrustedText;
  source: string;
  authorTrust: AuthorTrust;
}

/**
 * An event the extractor admitted, typed by its kind. `extracted` is exactly
 * the kind's schema record (A-R22-03): no field the schema does not declare,
 * every value checked whole against its cap and class. It is the only path
 * from a payload into anything the runtime does.
 */
export type TriggerEvent = {
  [K in SchemaKind]: {
    kind: K;
    payload: UntrustedPayload;
    extracted: ExtractedFields<K>;
    lineage: TriggerLineage;
  };
}[SchemaKind];
