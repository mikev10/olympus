/**
 * Reads the target repository's own instructions from the base admission
 * snapshotted (R24, D-A-RI-01), under R20's rules (D-R24-02).
 *
 * The list is fixed: `CLAUDE.md` and `AGENTS.md` at the root, each
 * `.claude/rules/*.md`, and the `SKILL.md` of each directory under
 * `.claude/skills/` and `.agents/skills/`. Nothing else is read: no skill's
 * `scripts/`, `references/`, or `assets/`, and no file a listed one points
 * at. The only input is the base's path, so nothing a workspace holds is
 * read (I3).
 *
 * Every limit is a refusal that names the file, never a skip or a truncation
 * (I5): a link anywhere on a listed path, a listed path that is not a regular
 * file, a file over the byte cap or a set over the set's cap (checked before
 * a byte is decoded), and bytes that are not UTF-8. A path that is absent
 * holds nothing (D-R24-03).
 *
 * Front matter is never read. `splitFrontMatter` drops it from what a seat
 * is given, and the file is marked, so no field in a target's file widens or
 * narrows a grant (I4, D-R24-04).
 */
import { createHash } from 'node:crypto';
import type { BigIntStats } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { readListed, ROLE_FILE_MAX_BYTES } from './compile.js';

/** The most bytes one instruction file may hold: R20's cap for a role file. */
export const REPO_INSTRUCTION_FILE_MAX_BYTES = ROLE_FILE_MAX_BYTES;

/**
 * The most bytes the whole set may take once rendered for a seat: each file's
 * bytes, its path, and its heading. The set shares the Claude Code driver's
 * one system argv element with a role of up to 32 KiB and the granted
 * context, and Linux refuses one past 128 KiB (D-R20-03, D-R24-03). A path
 * costs as much as content does, so a set of empty files is bounded too
 * (codex-1). Above the file cap by enough that one file at that cap, with its
 * heading, fits.
 */
export const REPO_INSTRUCTIONS_MAX_BYTES = 36 * 1024;

/**
 * What a file adds to the rendered set beyond its bytes and its path: the
 * heading's `--- ` and ` ---` and newline, and the blank line between files,
 * rounded up so the rendering can grow a little without passing the cap.
 */
export const REPO_INSTRUCTION_HEADING_BYTES = 16;

export type RepoInstructionCode = 'unreadable' | 'not-regular' | 'too-large' | 'not-utf8' | 'set-too-large';

/** One file the reader refused, by its path in the base. */
export interface RepoInstructionRefusal {
  readonly path: string;
  readonly code: RepoInstructionCode;
  readonly message: string;
}

/** One file as read: its whole text, the hash of its bytes, and whether it opened with front matter. */
export interface ReadInstructionFile {
  readonly path: string;
  readonly sha256: string;
  readonly text: string;
  readonly frontMatterDropped: boolean;
}

/** Every file in the fixed order, or every file refused. Never some of each. */
export type RepoInstructionRead =
  | { readonly ok: true; readonly files: readonly ReadInstructionFile[] }
  | { readonly ok: false; readonly refused: readonly [RepoInstructionRefusal, ...RepoInstructionRefusal[]] };

/**
 * A first line `---`, up to and including the next line `---`. A byte-order
 * mark before it is dropped with it. A file whose first line is `---` and
 * that never closes it has no front matter, and is delivered whole.
 */
const FRONT_MATTER = /^\uFEFF?---[ \t]*\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/u;

/** `text` without its front matter, which is never read, and whether it had any. */
export function splitFrontMatter(text: string): { readonly body: string; readonly dropped: boolean } {
  const match = FRONT_MATTER.exec(text);
  return match === null ? { body: text, dropped: false } : { body: text.slice(match[0].length), dropped: true };
}

type Listed = { readonly kind: 'absent' } | { readonly kind: 'link' } | { readonly kind: 'other'; readonly stats: BigIntStats };

async function listed(path: string): Promise<Listed | { readonly kind: 'error'; readonly error: unknown }> {
  try {
    const stats = await lstat(path, { bigint: true });
    return stats.isSymbolicLink() ? { kind: 'link' } : { kind: 'other', stats };
  } catch (error) {
    if ((error as { code?: unknown }).code === 'ENOENT' || (error as { code?: unknown }).code === 'ENOTDIR') return { kind: 'absent' };
    return { kind: 'error', error };
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Reads the fixed list from `base`. A refused file refuses the whole set: a
 * run is never admitted with some of the target's instructions.
 */
export async function readRepoInstructions(base: string): Promise<RepoInstructionRead> {
  const files: ReadInstructionFile[] = [];
  const refusals: RepoInstructionRefusal[] = [];
  let total = 0;
  /** Set once the set passes its cap: nothing more is read, so a base of a million files costs no more than one past the cap (gemini-2). */
  const cap = { passed: false };

  /** A directory on a listed path: its entries, sorted, or none where it is absent or not a directory. A link is refused. */
  const directory = async (rel: string): Promise<string[]> => {
    const at = await listed(join(base, ...rel.split('/')));
    if (at.kind === 'absent') return [];
    if (at.kind === 'link') {
      refusals.push({ path: rel, code: 'not-regular', message: `'${rel}' is a link; a repository instruction path is read only through directories and files of the base itself` });
      return [];
    }
    if (at.kind === 'error') {
      refusals.push({ path: rel, code: 'unreadable', message: `'${rel}' could not be read: ${describe(at.error)}` });
      return [];
    }
    if (!at.stats.isDirectory()) return [];
    try {
      return (await readdir(join(base, ...rel.split('/')))).sort();
    } catch (error) {
      refusals.push({ path: rel, code: 'unreadable', message: `'${rel}' could not be read: ${describe(error)}` });
      return [];
    }
  };

  /** A listed file: read where present, refused where it is a link or anything but a regular file. */
  const file = async (rel: string): Promise<void> => {
    if (cap.passed) return;
    const path = join(base, ...rel.split('/'));
    const at = await listed(path);
    if (at.kind === 'absent') return;
    if (at.kind === 'error') {
      refusals.push({ path: rel, code: 'unreadable', message: `repository instruction file '${rel}' could not be read: ${describe(at.error)}` });
      return;
    }
    if (at.kind === 'link' || !at.stats.isFile()) {
      refusals.push({ path: rel, code: 'not-regular', message: `repository instruction path '${rel}' is not a regular file` });
      return;
    }
    const read = await readListed(path, at.stats, REPO_INSTRUCTION_FILE_MAX_BYTES, `repository instruction file '${rel}'`);
    if (!read.ok) {
      refusals.push({ path: rel, code: read.code, message: read.message });
      return;
    }
    total += read.bytes.byteLength + Buffer.byteLength(rel, 'utf8') + REPO_INSTRUCTION_HEADING_BYTES;
    if (total > REPO_INSTRUCTIONS_MAX_BYTES) {
      cap.passed = true;
      refusals.push({ path: rel, code: 'set-too-large', message: `with '${rel}' the repository instructions take ${String(total)} bytes or more as rendered, paths and headings included; the limit for the set is ${String(REPO_INSTRUCTIONS_MAX_BYTES)}` });
      return;
    }
    files.push({ path: rel, sha256: createHash('sha256').update(read.bytes).digest('hex'), text: read.text, frontMatterDropped: splitFrontMatter(read.text).dropped });
  };

  await file('CLAUDE.md');
  await file('AGENTS.md');
  const claude = await directory('.claude');
  if (claude.includes('rules')) {
    for (const name of await directory('.claude/rules')) {
      if (cap.passed) break;
      if (name.endsWith('.md')) await file(`.claude/rules/${name}`);
    }
  }
  const roots: string[] = [];
  if (claude.includes('skills')) roots.push('.claude/skills');
  if ((await directory('.agents')).includes('skills')) roots.push('.agents/skills');
  for (const root of roots) {
    for (const name of await directory(root)) {
      if (cap.passed) break;
      const rel = `${root}/${name}`;
      const at = await listed(join(base, ...rel.split('/')));
      // A link in a skills directory is refused wherever it points; a file there is no skill, and holds nothing.
      if (at.kind === 'link') refusals.push({ path: rel, code: 'not-regular', message: `'${rel}' is a link; a skill is a directory of the base itself` });
      else if (at.kind === 'error') refusals.push({ path: rel, code: 'unreadable', message: `'${rel}' could not be read: ${describe(at.error)}` });
      else if (at.kind === 'other' && at.stats.isDirectory()) await file(`${rel}/SKILL.md`);
    }
  }
  const [first, ...rest] = refusals;
  if (first !== undefined) return { ok: false, refused: [first, ...rest] };
  return { ok: true, files };
}
