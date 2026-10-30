/**
 * What every Vault implementation checks of a trigger decision before it
 * writes one (A-R22-04). The local store repeats these inline, because its
 * module carries no value import (`local/vault.ts`, header).
 */
import { createHash } from 'node:crypto';
import type { CandidateId } from '@olympus-ai/core';
import type { CandidateRecord, TriggerDecision } from './types.js';

/** A decision's id, and its candidate's: the SHA-256 of its source and replay key, so a replay names the same one. */
export function intakeId(source: string, key: string): CandidateId {
  return createHash('sha256').update(`${source}\0${key}`, 'utf8').digest('hex') as CandidateId;
}

/** Why a decision and candidate may not be written together, or undefined when they may. */
export function intakeProblem(d: TriggerDecision, candidate: CandidateRecord | null): string | undefined {
  if ((d.collectedBy as string) !== 'runtime') return 'a trigger decision is collected by the runtime';
  if (d.source === '' || d.key === '') return 'a trigger decision names its source and key';
  const id = intakeId(d.source, d.key);
  if (d.outcome.kind === 'candidate') {
    if (candidate === null) return 'a candidate outcome is written with its candidate';
    if (d.outcome.candidate !== id || candidate.id !== id) return 'a candidate is named by its source and key';
    if ((candidate.collectedBy as string) !== 'runtime') return 'a candidate is collected by the runtime';
    if (candidate.body !== null) {
      const bytes = Buffer.from(candidate.body.base64, 'base64');
      if (createHash('sha256').update(bytes).digest('hex') !== candidate.body.sha256) return "a candidate's body hash is the hash of its body";
    }
    return undefined;
  }
  return candidate === null ? undefined : 'only a candidate outcome carries a candidate';
}
