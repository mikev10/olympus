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
 * I7: branded so untrusted text cannot be passed where a prompt string is expected.
 * `raw` is NEVER concatenated into a system or role prompt - only `extracted` crosses in.
 */
export interface UntrustedPayload {
  readonly __brand: 'UntrustedPayload';
  raw: string;
  source: string;
  authorTrust: AuthorTrust;
}

export interface TriggerEvent {
  kind: TriggerKind;
  payload: UntrustedPayload;
  extracted: Record<string, string>;  // typed fields only; the sole path into a run
  lineage: TriggerLineage;
}
