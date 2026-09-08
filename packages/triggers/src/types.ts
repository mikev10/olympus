/**
 * Triggers: how work enters the factory. I7: a payload is data, never an
 * instruction. It arrives inside an envelope, selects a pre-declared template,
 * and supplies parameters only.
 *
 * TriggerKind, AuthorTrust, TriggerLineage, and TriggerRef live in core
 * (run/types.ts) because runs and policy refer to them; TriggerPolicy lives in
 * core (policy/types.ts) because it is policy. This package owns the envelope.
 */
import type { AuthorTrust, TriggerKind, TriggerLineage } from '@olympus-ai/core';

/**
 * I7: an opaque handle to untrusted text. Deliberately NOT a string subtype, so
 * it cannot be passed where a string is expected: not to a prompt builder, a
 * template, or a driver. Only the trigger extractor reads it, through a
 * deliberate cast, and the conformance suite (packages/conformance) rejects
 * that cast anywhere else. Two gaps remain at the type level because `+` and
 * template interpolation accept objects; lint closes them with the
 * typescript-eslint rules restrict-plus-operands and
 * restrict-template-expressions.
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

export interface TriggerEvent {
  kind: TriggerKind;
  payload: UntrustedPayload;
  /**
   * I7: the only path from a payload into a run, and it is currently
   * unconstrained. Once the extractor casts `raw` and reads it, whatever it
   * pulls through becomes ordinary trusted strings, and Record<string, string>
   * limits neither which fields exist nor what they may contain. An
   * over-permissive extractor that copies the payload into a field defeats I7
   * entirely, and no type notices. Per-kind field schemas with length caps
   * and character-class validation are required before a non-human trigger
   * is enabled (docs/decisions.md, F2 known gaps).
   */
  extracted: Record<string, string>;
  lineage: TriggerLineage;
}
