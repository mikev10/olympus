/**
 * Findings and what became of them (R28, D-A-FO-01, D-R28-01).
 *
 * A review seat's finding is read from its final message strictly, as a
 * nightly reviewer's is: located in the tree it reviewed, or refused with its
 * cause. Its note stays in the claim and enters no record and no prompt (I7).
 * The task's status never reads a finding (I2, D-P4-07).
 */

import { lstat, readFile, realpath } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { CHAR_CLASSES, REVIEW_CATEGORIES, TREE_CATEGORIES, type DraftStation, type FieldDefect, type ReviewCategory, type ReviewSeatKind, type RunId, type RunState, type TaskId, type TreeCategory, type VaultRef } from '@olympus-ai/core';
import type { CheckResult } from '@olympus-ai/integrity';
import { criticFindingsOf, findingKeyOf, isNoRunState } from '@olympus-ai/vault';
import type { CriticRecord, DismissalCause, DraftLockRecord, DraftRecord, EvidenceBundle, FindingOutcome, FindingOutcomeRecord, FindingRef, IntegrationMerged, ReviewFindingsRecord, SeatFinding, Vault } from '@olympus-ai/vault';
import { isAncestor, pathHunks, type HunkRange } from './history.js';
import { readIntegration } from './line.js';
import { readReviewResult } from './nightly-review.js';

/** The byte caps a finding's fields are held to, as the nightly tree finding's schema holds them. */
const PATH_CAP = 1024;
const LINE_CAP = 10;
const CATEGORY_CAP = 40;

const encoder = new TextEncoder();

/** The categories each seat may name: one per question its role asks. */
export function seatCategories(seat: ReviewSeatKind): readonly string[] {
  return seat === 'security' ? TREE_CATEGORIES : REVIEW_CATEGORIES;
}

/** The number of lines a file holds, as an editor would number them. */
export function lineCount(text: string): number {
  if (text.length === 0) return 0;
  const lines = text.split('\n').length;
  return text.endsWith('\n') ? lines - 1 : lines;
}

/**
 * One element's fields checked as `checkFields` checks a schema's: no field
 * but `category`, `path`, `line`, and an optional string `note`; each a
 * string under its cap and in its class. A line may be a whole number.
 */
function seatFields(element: unknown, categories: readonly string[]): { category: string; path: string; line: number } | { defects: FieldDefect[] } {
  const keys = ['category', 'path', 'line'];
  if (typeof element !== 'object' || element === null || Array.isArray(element)) return { defects: keys.map((field) => ({ field, problem: 'missing' })) };
  const { note, ...fields } = element as Record<string, unknown>;
  if (note !== undefined && typeof note !== 'string') return { defects: [{ field: 'note', problem: 'not-a-string' }] };
  const defects: FieldDefect[] = [];
  for (const field of Object.keys(fields)) if (!keys.includes(field)) defects.push({ field, problem: 'unknown' });
  const line = typeof fields.line === 'number' && Number.isSafeInteger(fields.line) ? String(fields.line) : fields.line;
  const values: Record<string, unknown> = { category: fields.category, path: fields.path, line };
  const checks: Record<string, { cap: number; ok: (v: string) => boolean }> = {
    category: { cap: CATEGORY_CAP, ok: (v) => categories.includes(v) },
    path: { cap: PATH_CAP, ok: (v) => CHAR_CLASSES['tree-path'].test(v) },
    line: { cap: LINE_CAP, ok: (v) => CHAR_CLASSES.decimal.test(v) },
  };
  for (const field of keys) {
    const value = values[field];
    const check = checks[field];
    if (check === undefined) continue;
    if (!Object.hasOwn(fields, field)) defects.push({ field, problem: 'missing' });
    else if (typeof value !== 'string') defects.push({ field, problem: 'not-a-string' });
    else if (encoder.encode(value).byteLength > check.cap) defects.push({ field, problem: 'over-cap' });
    else if (!check.ok(value)) defects.push({ field, problem: 'out-of-class' });
  }
  if (defects.length > 0) return { defects };
  return { category: values.category as string, path: values.path as string, line: Number(values.line) };
}

/**
 * The file a finding names, read from `tree` only if it is a regular file
 * inside it: a link, a directory, or a path that resolves outside is not a
 * file the tree holds. Null for any of those, or for no file.
 */
async function heldText(tree: string, path: string): Promise<string | null> {
  const full = join(tree, path);
  try {
    const info = await lstat(full);
    if (!info.isFile()) return null;
    const inside = relative(await realpath(tree), await realpath(full));
    if (inside === '' || inside.startsWith(`..${sep}`) || inside === '..') return null;
    return await readFile(full, 'utf8');
  } catch {
    return null;
  }
}

/**
 * A review seat's findings, read strictly from its final message (R28). An
 * unreadable message is recorded as unreadable, never as no findings (I5). A
 * finding whose fields break their rules is `unrecordable`, naming only the
 * field and the rule; one naming no file `tree` holds, or a line that file
 * does not have, is `unlocated`. Neither is ever stored as a finding.
 */
export async function readSeatFindings(seat: ReviewSeatKind, narrative: string, tree: string): Promise<{ readable: boolean; findings: SeatFinding[] }> {
  const read = readReviewResult(narrative);
  if (!read.readable) return { readable: false, findings: [] };
  const categories = seatCategories(seat);
  const findings: SeatFinding[] = [];
  for (const element of read.findings) {
    const fields = seatFields(element, categories);
    if ('defects' in fields) {
      findings.push({ kind: 'refused', cause: 'unrecordable', defects: fields.defects });
      continue;
    }
    const text = await heldText(tree, fields.path);
    if (text === null || fields.line > lineCount(text)) {
      findings.push({ kind: 'refused', cause: 'unlocated', defects: [] });
      continue;
    }
    findings.push({ kind: 'located', category: fields.category as ReviewCategory | TreeCategory, path: fields.path, line: fields.line });
  }
  return { readable: true, findings };
}

/**
 * A finding's id as a person names it on the wire and in the CLI (R28):
 * `review:<run>:<hash>:<index>`, `critic:<run>:<hash>:<index>`, or
 * `nightly:<hash>:<index>`, the hash its source record's.
 */
export function findingId(f: FindingRef): string {
  const s = f.source;
  return s.kind === 'nightly' ? `nightly:${s.record}:${String(f.index)}` : `${s.kind}:${s.record.runId}:${s.record.hash}:${String(f.index)}`;
}

const SHA = /^[0-9a-f]{64}$/u;
const RUN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const INDEX = /^(?:0|[1-9][0-9]{0,8})$/u;

/** The finding an id names, or null for anything that is not one. */
export function parseFindingId(id: string): FindingRef | null {
  const [kind = '', a = '', b = '', c = '', ...rest] = id.split(':');
  if (rest.length > 0) return null;
  if (kind === 'nightly' && c === '' && SHA.test(a) && INDEX.test(b) && id === `nightly:${a}:${b}`) return { source: { kind: 'nightly', record: a }, index: Number(b) };
  if ((kind === 'review' || kind === 'critic') && RUN.test(a) && SHA.test(b) && INDEX.test(c)) {
    const record: VaultRef = { runId: a as RunId, kind: kind === 'review' ? 'review-findings' : 'critic-result', hash: b };
    return { source: { kind, record }, index: Number(c) };
  }
  return null;
}

/** What a raised finding cites, and so what could resolve it (D-R28-01). */
export type Citation =
  /** A file and line of code at `commit`; null where the code never landed, a run that did not merge. */
  | { readonly kind: 'code'; readonly path: string; readonly line: number; readonly commit: string | null }
  /** A file of the draft a critic read, at the station it was drafted at. */
  | { readonly kind: 'draft'; readonly station: DraftStation; readonly path: string }
  /** A record of the day a nightly reviewer read: nothing resolves it. */
  | { readonly kind: 'record' };

/**
 * A located finding, as R28 measures it (D-A-FO-01). A refused finding is
 * never one: it named nothing the runtime could find.
 */
export interface RaisedFinding {
  readonly ref: FindingRef;
  readonly id: string;
  /** `review`, `security`, `critic`, or `nightly:<job>`. */
  readonly seat: string;
  /** The seat's model family, as the runtime recorded it (I6). */
  readonly family: string;
  /** The run it was raised in; null for a nightly one. */
  readonly runId: RunId | null;
  /** The UTC date a nightly firing covers; null for a run's. */
  readonly date: string | null;
  readonly cites: Citation;
}

function decodeJson(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder().decode(bytes));
}

/**
 * Every located finding the store holds (R28): each review seat's, from the
 * findings record of its committed result only, so a seat rerun after a stop
 * is counted once; each critic's, from the attempts run state holds; and each
 * nightly reviewer's. The store names the set, never a caller.
 */
export async function raisedFindings(vault: Vault): Promise<RaisedFinding[]> {
  const out: RaisedFinding[] = [];
  for (const runId of await vault.listRuns()) {
    let state: RunState;
    try {
      state = await vault.readRunState(runId);
    } catch (error) {
      if (isNoRunState(error)) continue;
      throw error;
    }
    const merged = (await readIntegration(vault, runId)).find((r) => r.kind === 'merged');
    for (const ref of await vault.readReviewFindings(runId)) {
      const record = decodeJson(await vault.read(ref)) as ReviewFindingsRecord;
      if (!Object.hasOwn(state.results, record.taskId) || state.results[record.taskId]?.hash !== record.result.hash) continue;
      record.findings.forEach((f, index) => {
        if (f.kind !== 'located') return;
        const finding: FindingRef = { source: { kind: 'review', record: ref }, index };
        out.push({ ref: finding, id: findingId(finding), seat: record.seat, family: record.reviewer.family, runId, date: null, cites: { kind: 'code', path: f.path, line: f.line, commit: merged?.commit ?? null } });
      });
    }
    for (const [station, drafts] of Object.entries(state.drafts) as Array<[DraftStation, NonNullable<RunState['drafts'][DraftStation]>]>) {
      for (const attempt of drafts.attempts) {
        if (attempt.critic === null || attempt.critic === 'not-seated') continue;
        const ref = attempt.critic;
        const critic = decodeJson(await vault.read(ref)) as CriticRecord;
        criticFindingsOf(critic.findings).forEach((f, index) => {
          if (f.kind !== 'located') return;
          const finding: FindingRef = { source: { kind: 'critic', record: ref }, index };
          out.push({ ref: finding, id: findingId(finding), seat: 'critic', family: critic.critic.family, runId, date: null, cites: { kind: 'draft', station, path: f.path } });
        });
      }
    }
  }
  for (const entry of await vault.readNightly()) {
    const { review } = entry.record;
    if (review?.seat == null) continue;
    const family = review.seat.reviewer.model.family;
    const commit = review.subject?.kind === 'tree' ? review.subject.commit : null;
    review.findings.forEach((f, index) => {
      if (f.kind === 'refused') return;
      const finding: FindingRef = { source: { kind: 'nightly', record: entry.sha256 }, index };
      const cites: Citation = f.kind === 'tree' ? { kind: 'code', path: f.path, line: f.line, commit } : { kind: 'record' };
      out.push({ ref: finding, id: findingId(finding), seat: `nightly:${entry.record.template}`, family, runId: null, date: entry.record.date, cites });
    });
  }
  return out;
}

/** Every outcome, by its finding's key. A finding with none is open (D-A-FO-01). */
export async function outcomesByFinding(vault: Vault): Promise<Map<string, FindingOutcomeRecord>> {
  return new Map((await vault.readFindingOutcomes()).map((e) => [findingKeyOf(e.record.finding), e.record]));
}

/**
 * Resolves the critic findings of a station's drafts once its draft is locked
 * (D-A-FO-01): a located finding whose file's hash differs between the draft
 * the critic read and the locked draft. At `test-design` the locked draft
 * must have a base record, which shows its checks ran over the base. No
 * check covers a spec file, so a `spec` finding is never resolved. Safe to
 * call again: an outcome already written is refused, and nothing is written.
 */
export async function resolveCriticFindings(vault: Vault, state: RunState, station: DraftStation, lockRef: VaultRef, lock: DraftLockRecord, at: () => string): Promise<number> {
  if (station === 'spec') return 0;
  if ((await vault.readBaseRun(state.runId, lock.draft.sha256)) === null) return 0;
  const locked = new Map(lock.files.map((f) => [f.path, f.sha256]));
  let resolved = 0;
  for (const attempt of state.drafts[station]?.attempts ?? []) {
    if (attempt.critic === null || attempt.critic === 'not-seated' || attempt.draft === null) continue;
    const critic = decodeJson(await vault.read(attempt.critic)) as CriticRecord;
    const draft = decodeJson(await vault.read(attempt.draft)) as DraftRecord;
    const raisedAt = new Map(draft.files.map((f) => [f.path, f.sha256]));
    const findings = criticFindingsOf(critic.findings);
    for (const [index, f] of findings.entries()) {
      if (f.kind !== 'located') continue;
      const raised = raisedAt.get(f.path);
      const now = locked.get(f.path);
      // A file the locked draft no longer holds did not change into anything a check covers: it stays open.
      if (raised === undefined || now === undefined || raised === now) continue;
      const written = await vault.recordFindingOutcome({
        finding: { source: { kind: 'critic', record: attempt.critic }, index },
        outcome: { kind: 'resolved', resolution: { kind: 'draft-changed', lock: lockRef, raised, locked: now } },
        at: at(),
        collectedBy: 'runtime',
      });
      if (written !== null) resolved += 1;
    }
  }
  return resolved;
}

/**
 * A line mapped through a zero-context diff (D-R28-01): null where a hunk
 * rewrote it, otherwise shifted by every hunk wholly before it. A pure
 * insertion after line n is before every line past n.
 */
export function mapLine(hunks: readonly HunkRange[], line: number): number | null {
  let delta = 0;
  for (const h of hunks) {
    if (h.oldLines > 0 && line >= h.oldStart && line < h.oldStart + h.oldLines) return null;
    const before = h.oldLines > 0 ? h.oldStart + h.oldLines - 1 < line : h.oldStart < line;
    if (before) delta += h.newLines - h.oldLines;
  }
  return line + delta;
}

/** The hunk whose base side holds `line`, if any: a pure insertion holds none. */
export function holdingHunk(hunks: readonly HunkRange[], line: number): HunkRange | undefined {
  return hunks.find((h) => h.oldLines > 0 && line >= h.oldStart && line < h.oldStart + h.oldLines);
}

/**
 * A run's latest accepted evidence bundle and its ref: the last bundle of a
 * passed task, whose head tree is the tree `integrate` pushed, so its line
 * numbers are the run's change's head side (D-R28-01). Null for none.
 */
async function latestAccepted(vault: Vault, state: RunState): Promise<{ bundle: EvidenceBundle; ref: VaultRef } | null> {
  const last = new Map<TaskId, { bundle: EvidenceBundle; ref: VaultRef; at: number }>();
  for (const [at, ref] of state.evidenceRefs.entries()) {
    const bundle = decodeJson(await vault.read(ref)) as EvidenceBundle;
    last.set(bundle.taskId, { bundle, ref, at });
  }
  let latest: { bundle: EvidenceBundle; ref: VaultRef; at: number } | null = null;
  for (const [taskId, entry] of last) {
    if (Object.hasOwn(state.tasks, taskId) && state.tasks[taskId] === 'passed' && (latest === null || entry.at > latest.at)) latest = entry;
  }
  return latest;
}

/** Whether a check's result passed, judged as the gate judges one (A-P8-01). */
function passed(result: CheckResult): boolean {
  return result.expectation === null ? result.exitCode === 0 : result.expectation.held;
}

/** What one resolving run did to the open code findings. */
export interface CodeResolutions {
  readonly resolved: number;
  /** Findings whose history could not be read, by id: each stays open, and the walk names them (I5). */
  readonly unreadable: readonly string[];
}

/**
 * Resolves the open code findings a merged run fixed (D-A-FO-01): each whose
 * cited line, mapped from its commit to the run's base, a hunk of the run's
 * change rewrote, where the run's pinned coverage check passed with a changed
 * line of that hunk executed. A run with no line coverage, a check that did
 * not pass, a line the history rewrote, or a file either end lacks resolves
 * nothing, and each such finding stays open (I5). Today no run carries line
 * coverage: a pinned coverage check is refused at `verify` until M3 gives its
 * report a channel (D-P7-05, D-R28-01).
 */
export async function resolveCodeFindings(vault: Vault, checkout: string, runId: RunId, at: () => string): Promise<CodeResolutions> {
  const merged = (await readIntegration(vault, runId)).find((r): r is IntegrationMerged => r.kind === 'merged');
  if (merged === undefined) return { resolved: 0, unreadable: [] };
  const accepted = await latestAccepted(vault, await vault.readRunState(runId));
  // A bundle stored before R28 names no lines: read as none.
  const lines = accepted?.bundle.tamper.changedLines ?? null;
  if (accepted === null || lines === null) return { resolved: 0, unreadable: [] };
  const check = accepted.bundle.checks.find((c) => c.checkId === lines.check);
  if (check === undefined || !passed(check)) return { resolved: 0, unreadable: [] };

  const outcomes = await outcomesByFinding(vault);
  const unreadable: string[] = [];
  let resolved = 0;
  for (const f of await raisedFindings(vault)) {
    if (f.cites.kind !== 'code' || f.cites.commit === null || f.runId === runId || outcomes.has(findingKeyOf(f.ref))) continue;
    const { path, line: cited, commit } = f.cites;
    try {
      // Raised before this run's base, on its history; a finding of later code is not this run's to resolve.
      if (!(await isAncestor(checkout, commit, merged.baseCommit))) continue;
      const toBase = await pathHunks(checkout, commit, merged.baseCommit, path);
      const line = toBase === null ? null : mapLine(toBase, cited);
      if (line === null) continue;
      const change = await pathHunks(checkout, merged.baseCommit, merged.commit, path);
      const hunk = change === null ? undefined : holdingHunk(change, line);
      if (hunk === undefined) continue;
      const end = hunk.newStart + hunk.newLines;
      const executed = (lines.files.find((x) => x.path === path)?.executed ?? []).filter((n) => n >= hunk.newStart && n < end);
      if (executed.length === 0) continue;
      const written = await vault.recordFindingOutcome({
        finding: f.ref,
        outcome: { kind: 'resolved', resolution: { kind: 'covered-change', runId, mergeCommit: merged.mergeCommit, path, line, hunk, executed, evidence: accepted.ref } },
        at: at(),
        collectedBy: 'runtime',
      });
      if (written !== null) resolved += 1;
    } catch {
      unreadable.push(f.id);
    }
  }
  return { resolved, unreadable };
}

/** A raised finding with what became of it, as the API and the CLI show it (R28). `open` is the absence of an outcome. */
export interface FindingSummary {
  readonly id: string;
  readonly seat: string;
  readonly family: string;
  readonly runId: RunId | null;
  readonly date: string | null;
  readonly cites: Citation;
  readonly outcome: { readonly kind: 'open' } | FindingOutcome;
}

/** Every located finding and its outcome, open where it has none, sorted by id. */
export async function listFindings(vault: Vault): Promise<FindingSummary[]> {
  const outcomes = await outcomesByFinding(vault);
  return (await raisedFindings(vault))
    .map((f): FindingSummary => ({ id: f.id, seat: f.seat, family: f.family, runId: f.runId, date: f.date, cites: f.cites, outcome: outcomes.get(findingKeyOf(f.ref))?.outcome ?? { kind: 'open' } }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * A person's dismissal of a finding, with a cause and no text (A-R16-05,
 * D-A-FO-01). Only a located finding can be dismissed: a refused one was
 * never measured. A finding that already has an outcome keeps it.
 */
export async function dismissFinding(
  vault: Vault, id: string, cause: DismissalCause, at: string,
): Promise<{ readonly kind: 'dismissed'; readonly finding: FindingSummary } | { readonly kind: 'unknown' } | { readonly kind: 'decided'; readonly outcome: FindingOutcome }> {
  const ref = parseFindingId(id);
  if (ref === null) return { kind: 'unknown' };
  const finding = (await raisedFindings(vault)).find((f) => f.id === id);
  if (finding === undefined) return { kind: 'unknown' };
  const written = await vault.recordFindingOutcome({ finding: finding.ref, outcome: { kind: 'dismissed', cause }, at, collectedBy: 'runtime' });
  if (written === null) {
    const outcome = (await outcomesByFinding(vault)).get(findingKeyOf(finding.ref))?.outcome;
    if (outcome === undefined) throw new Error(`findings: ${id} was refused a second outcome, and none is stored`);
    return { kind: 'decided', outcome };
  }
  return { kind: 'dismissed', finding: { id, seat: finding.seat, family: finding.family, runId: finding.runId, date: finding.date, cites: finding.cites, outcome: { kind: 'dismissed', cause } } };
}
