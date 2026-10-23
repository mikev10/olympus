/**
 * Compiles the roles directory into the instructions each seat runs under
 * (D-A-RC-01, D-A-RC-02).
 *
 * A role is one file, `<role-id>.md`, whose whole content is its
 * instructions. There is no front matter, so nothing in a role file can be
 * read as a grant, a model, or a tier: what a role may do comes from policy
 * through `TaskRequest` and nowhere else (I4). The role's version is the
 * SHA-256 of the file's bytes as read.
 *
 * The only input is a directory, and only the bytes of the files in it are
 * read. No parameter exists through which an `UntrustedPayload`, an extracted
 * trigger field, a rubric, an acceptance check, or a corpus could arrive, so
 * untrusted text never reaches a role (I7) and nothing that judges an agent
 * is written into its instructions (I3, D-A-RC-05).
 *
 * Every limit is a refusal that names the entry, never a skip or a truncation
 * (I5): an entry that is not a regular file, a name that is not a role id, a
 * file over the byte cap (checked before a byte is decoded), bytes that are
 * not UTF-8, and a file with no instructions in it.
 */
import { createHash } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import { lstat, open, readdir, stat, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import type { CompiledRole, RoleId } from '@olympus-ai/core';

/**
 * The most bytes one role file may hold. A role reaches the CLI as one argv
 * element, JSON-escaped, and Linux refuses a single argument past 128 KiB;
 * half that leaves room for the escaping a prose file needs (D-R20-03).
 */
export const ROLE_FILE_MAX_BYTES = 32 * 1024;

/**
 * A role id as a file name can carry it: lowercase ASCII words joined by
 * single hyphens, at most 64 characters. Lowercase only, so two roles cannot
 * collide on a filesystem that ignores case (D-R20-02).
 */
const ROLE_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const ROLE_ID_MAX_LENGTH = 64;
const EXTENSION = '.md';

/** Whether `name` is a role id a role file can be named for. */
export function isRoleId(name: string): name is RoleId {
  return name.length <= ROLE_ID_MAX_LENGTH && ROLE_ID.test(name);
}

export type RoleFileCode =
  /** The directory, or an entry in it, could not be read. */
  | 'unreadable'
  /** A directory, a symbolic link, or anything else that is not a regular file. */
  | 'not-regular'
  /** Not `<role-id>.md`. */
  | 'invalid-name'
  /** Past `ROLE_FILE_MAX_BYTES`. */
  | 'too-large'
  | 'not-utf8'
  /** No bytes, or nothing but whitespace: instructions of nothing. */
  | 'empty';

/**
 * One entry the compiler refused. `entry` is its name inside the directory,
 * or `.` for the directory itself.
 */
export interface RoleFileRefusal {
  readonly entry: string;
  readonly code: RoleFileCode;
  readonly message: string;
}

/** Every role in the directory, sorted by id, or every entry refused. Never some of each. */
export type RoleCompilation =
  | { readonly ok: true; readonly roles: readonly CompiledRole[] }
  | { readonly ok: false; readonly refused: readonly [RoleFileRefusal, ...RoleFileRefusal[]] };

type EntryOutcome = { readonly ok: true; readonly role: CompiledRole } | { readonly ok: false; readonly refusal: RoleFileRefusal };

function refused(entry: string, code: RoleFileCode, message: string): { ok: false; refusal: RoleFileRefusal } {
  return { ok: false, refusal: { entry, code, message } };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Follows no link where the platform can refuse one at open; elsewhere the identity check below catches a swap. */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- typed as a number, and undefined at run time on Windows, which has no such flag.
const OPEN_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);

/** At most `max + 1` bytes: enough to tell a file at the cap from one past it, and never the whole of an oversized one. */
async function readCapped(handle: FileHandle, max: number): Promise<Uint8Array> {
  const buffer = new Uint8Array(max + 1);
  let filled = 0;
  while (filled < buffer.byteLength) {
    const { bytesRead } = await handle.read(buffer, filled, buffer.byteLength - filled, null);
    if (bytesRead === 0) break;
    filled += bytesRead;
  }
  return buffer.subarray(0, filled);
}

function sameFile(a: BigIntStats, b: BigIntStats): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}

async function compileEntry(directory: string, entry: string): Promise<EntryOutcome> {
  const path = join(directory, entry);
  let listed: BigIntStats;
  try {
    listed = await lstat(path, { bigint: true });
  } catch (error) {
    return refused(entry, 'unreadable', `role entry '${entry}' could not be read: ${describe(error)}`);
  }
  // A link is refused whatever it points at: one into a workspace would hand a role to the agent it instructs (I1).
  if (!listed.isFile()) return refused(entry, 'not-regular', `role entry '${entry}' is not a regular file; the roles directory holds only <role-id>.md files`);
  if (!entry.endsWith(EXTENSION) || !isRoleId(entry.slice(0, -EXTENSION.length))) {
    return refused(entry, 'invalid-name', `role file '${entry}' is not named <role-id>.md, where a role id is lowercase words joined by hyphens, at most ${String(ROLE_ID_MAX_LENGTH)} characters`);
  }
  const role = entry.slice(0, -EXTENSION.length) as RoleId;
  let bytes: Uint8Array;
  let handle: FileHandle;
  try {
    handle = await open(path, OPEN_FLAGS);
  } catch (error) {
    // ELOOP is the platform refusing a link that replaced the file after it was listed.
    const code = (error as { code?: unknown }).code === 'ELOOP' ? 'not-regular' : 'unreadable';
    return refused(entry, code, `role file '${entry}' could not be opened: ${describe(error)}`);
  }
  try {
    // The file opened is the file listed: a swap between the two is refused, not followed.
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || !sameFile(listed, opened)) {
      return refused(entry, 'not-regular', `role file '${entry}' changed between being listed and being opened`);
    }
    if (opened.size > BigInt(ROLE_FILE_MAX_BYTES)) {
      return refused(entry, 'too-large', `role file '${entry}' is ${String(opened.size)} bytes; the limit is ${String(ROLE_FILE_MAX_BYTES)}`);
    }
    bytes = await readCapped(handle, ROLE_FILE_MAX_BYTES);
  } catch (error) {
    return refused(entry, 'unreadable', `role file '${entry}' could not be read: ${describe(error)}`);
  } finally {
    await handle.close();
  }
  // Checked again on what was read, before a byte is decoded: a file that grew after the stat is still refused.
  if (bytes.byteLength > ROLE_FILE_MAX_BYTES) {
    return refused(entry, 'too-large', `role file '${entry}' is more than ${String(ROLE_FILE_MAX_BYTES)} bytes, the limit`);
  }
  let instructions: string;
  try {
    // `ignoreBOM` keeps a byte-order mark in the text, so the text encodes back to exactly the bytes hashed.
    instructions = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return refused(entry, 'not-utf8', `role file '${entry}' is not UTF-8`);
  }
  // `trim` removes a byte-order mark with the rest of the whitespace.
  if (instructions.trim() === '') {
    return refused(entry, 'empty', `role file '${entry}' holds no instructions`);
  }
  return { ok: true, role: { role, instructions, sha256: createHash('sha256').update(bytes).digest('hex') } };
}

/**
 * Reads and compiles every entry in `directory`. A refused entry refuses the
 * whole directory: a run is never admitted with some of its roles.
 */
export async function compileRoles(directory: string): Promise<RoleCompilation> {
  let entries: string[];
  try {
    if (!(await stat(directory)).isDirectory()) {
      return { ok: false, refused: [{ entry: '.', code: 'unreadable', message: `the roles directory '${directory}' is not a directory` }] };
    }
    entries = await readdir(directory);
  } catch (error) {
    return { ok: false, refused: [{ entry: '.', code: 'unreadable', message: `the roles directory '${directory}' could not be read: ${describe(error)}` }] };
  }
  entries.sort();
  const roles: CompiledRole[] = [];
  const refusals: RoleFileRefusal[] = [];
  for (const entry of entries) {
    const outcome = await compileEntry(directory, entry);
    if (outcome.ok) roles.push(outcome.role);
    else refusals.push(outcome.refusal);
  }
  const [first, ...rest] = refusals;
  if (first !== undefined) return { ok: false, refused: [first, ...rest] };
  return { ok: true, roles };
}
