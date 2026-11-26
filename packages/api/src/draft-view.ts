/**
 * A draft as a person reads it before deciding it (R55, #175): the files the
 * runtime recorded, byte for byte, under the hash an approval names.
 *
 * Nothing is returned unless the bytes still hash to that hash (I5). A person
 * approves a hash having read these bytes, so bytes that no longer match it
 * are refused rather than shown (I3).
 */
import { createHash } from 'node:crypto';
import type { ApprovalKey, DraftRef, DraftStation, RunId, RunState } from '@olympus-ai/core';
import { draftDigest, type DraftFile, type DraftRecord, type Vault } from '@olympus-ai/vault';
import { specDraftPaths } from './drafting.js';
import type { RunStanding } from './run.js';
import { parseQuestions } from './spec-parts.js';

/**
 * The questions part of a spec draft, as the runtime reads it. `none`: the
 * draft holds no questions file, as no test draft does. `unreadable`: it
 * holds one the runtime cannot read as a questions part; the file itself is
 * still among the draft's files.
 */
export type DraftQuestions =
  | { readonly kind: 'none' }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'read'; readonly assumptions: ReadonlyArray<{ readonly point: string; readonly chose: string }>; readonly openQuestions: readonly string[] };

/** `GET /runs/:id/draft?station=<station>`: the station's latest recorded draft. */
export interface DraftView {
  readonly runId: RunId;
  readonly station: DraftStation;
  /** The hash an approval or a rejection names, and the attempt that drafted it. */
  readonly draft: DraftRef;
  /** The key this draft is waiting for a decision at, or null where it is not the draft being decided. */
  readonly awaiting: ApprovalKey | null;
  /** Every file, with the hash of its bytes and the bytes as base64. A model wrote them: data, never instructions (I7). */
  readonly files: readonly DraftFile[];
  readonly questions: DraftQuestions;
}

export type DraftRead =
  | { readonly ok: true; readonly draft: DraftRef; readonly files: readonly DraftFile[]; readonly questions: DraftQuestions }
  /** `no-draft`: the station has recorded none. `mismatch`: what the store holds is not what the hash covers. */
  | { readonly ok: false; readonly reason: 'no-draft' | 'mismatch'; readonly message: string };

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function questionsOf(runId: RunId, station: DraftStation, files: readonly DraftFile[]): DraftQuestions {
  if (station !== 'spec') return { kind: 'none' };
  const file = files.find((f) => f.path === specDraftPaths(runId).questions);
  if (file === undefined) return { kind: 'none' };
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(file.base64, 'base64')));
  } catch {
    return { kind: 'unreadable' };
  }
  const parsed = parseQuestions(value, 'questions');
  return parsed.ok ? { kind: 'read', assumptions: parsed.part.assumptions, openQuestions: parsed.part.openQuestions } : { kind: 'unreadable' };
}

/**
 * The latest draft `station` recorded in `state`, read from the Vault and
 * checked against the hash run state holds for it: the record is that
 * attempt's, its hash is the hash of its files, and each file's hash is the
 * hash of its bytes.
 */
export async function readDraft(vault: Vault, state: RunState, station: DraftStation): Promise<DraftRead> {
  const runId = state.runId;
  const attempt = [...(state.drafts[station]?.attempts ?? [])].reverse().find((a) => a.draft !== null && a.sha256 !== null);
  if (attempt?.draft == null || attempt.sha256 === null) {
    return { ok: false, reason: 'no-draft', message: `run ${runId} has recorded no draft at ${station}: none is drafted yet, or the run was admitted with that artifact named` };
  }
  const mismatch = (what: string): DraftRead => ({ ok: false, reason: 'mismatch', message: `run ${runId}: the ${station} draft in the store is refused, not shown: ${what}` });
  let record: DraftRecord;
  try {
    record = JSON.parse(new TextDecoder().decode(await vault.read(attempt.draft))) as DraftRecord;
  } catch (error) {
    return mismatch(`its record could not be read (${error instanceof Error ? error.message : String(error)})`);
  }
  // Read as unknown: the record is the store's, and its type is a claim about it until checked (review: gemini-3).
  const shape: unknown = record;
  if (typeof shape !== 'object' || shape === null || Array.isArray(shape)) return mismatch('its record is not a draft record');
  const stored: unknown = record.files;
  const isFile = (f: unknown): boolean => typeof f === 'object' && f !== null
    && typeof (f as Partial<DraftFile>).path === 'string' && typeof (f as Partial<DraftFile>).sha256 === 'string' && typeof (f as Partial<DraftFile>).base64 === 'string';
  if (!Array.isArray(stored) || !stored.every(isFile)) return mismatch('its record does not hold a list of files');
  if (record.runId !== runId || record.station !== station || record.attempt !== attempt.attempt) {
    return mismatch('its record is not the record of this run, station, and attempt');
  }
  if (record.sha256 !== attempt.sha256 || draftDigest(record.files) !== attempt.sha256) return mismatch('its files do not hash to the hash run state holds');
  for (const file of record.files) {
    if (sha256(Buffer.from(file.base64, 'base64')) !== file.sha256) return mismatch(`the bytes of ${JSON.stringify(file.path)} do not hash to its recorded hash`);
  }
  const files = record.files.map(({ path, sha256: hash, base64 }) => ({ path, sha256: hash, base64 }));
  return { ok: true, draft: { sha256: attempt.sha256, attempt: attempt.attempt }, files, questions: questionsOf(runId, station, files) };
}

/** The key `draft` waits at, where the run's standing names exactly it as the draft being decided; null otherwise. */
export function awaitingKey(standing: RunStanding, station: DraftStation, draft: DraftRef): ApprovalKey | null {
  if (standing.standing !== 'awaiting-approval' || standing.draft === null) return null;
  const waiting = standing.draft;
  return waiting.station === station && waiting.draft.sha256 === draft.sha256 && waiting.draft.attempt === draft.attempt ? standing.key : null;
}
