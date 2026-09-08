/**
 * Triggers: how work enters the factory. I7: a payload is data, never an
 * instruction. It arrives inside an envelope, selects a pre-declared template,
 * and supplies parameters only.
 */
import type { AutonomyLevel, RunId, StationId } from '@olympus-ai/core';

export type TriggerKind = 'human' | 'ci-failure' | 'review-feedback' | 'post-merge' | 'scheduled';
export type AuthorTrust = 'owner' | 'collaborator' | 'outside' | 'anonymous';

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

export interface TriggerLineage {
  depth: number;                      // maxTriggerDepth default 2
  chain: RunId[];
  windowStart: string;
}

export interface TriggerEvent {
  kind: TriggerKind;
  payload: UntrustedPayload;
  extracted: Record<string, string>;  // typed fields only; the sole path into a run
  lineage: TriggerLineage;
}

export interface TriggerRef { kind: TriggerKind; eventId: string; lineage: TriggerLineage; }

export interface TriggerPolicy {
  enabled: TriggerKind[];             // ships as ['human'] only
  entryStation: Partial<Record<TriggerKind, StationId>>;
  taskTemplate: Partial<Record<TriggerKind, string>>;   // pre-declared; payload cannot name it
  maxAutonomy: Partial<Record<TriggerKind, AutonomyLevel>>;
  minAuthorTrust: Partial<Record<TriggerKind, AuthorTrust>>;
  maxTriggerDepth: number;
  budgetPerWindow: { runs: number; windowMs: number };
}
