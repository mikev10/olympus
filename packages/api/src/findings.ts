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
import { CHAR_CLASSES, REVIEW_CATEGORIES, TREE_CATEGORIES, type FieldDefect, type ReviewCategory, type ReviewSeatKind, type TreeCategory } from '@olympus-ai/core';
import type { SeatFinding } from '@olympus-ai/vault';
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
