/**
 * Reading an agent-writable tree from the host without letting the tree
 * choose what the host reads.
 *
 * Everything under `base` and `head` was written by, or could have been
 * written by, an agent. A symbolic link in it can name any file the runtime's
 * user can read — a credential, another run's evidence, a device that never
 * ends — so no function here follows one: a link is recorded as a link and
 * compared by its target text, and a file read through one is refused. Files
 * are opened with `O_NOFOLLOW` where the platform has it, so a link swapped in
 * after the check is refused by the kernel rather than followed.
 */
import { createHash } from 'node:crypto';
import { constants, type Dirent } from 'node:fs';
import { lstat, open, readdir, readlink, type FileHandle } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { describe, refuse } from './refusal.js';

/** The cap on one source, test, or config file the adapters parse. */
export const SOURCE_FILE_CAP = 4 * 1024 * 1024;

/** Undefined on Windows, where the `lstat` beside each open carries the check alone. */
const NO_FOLLOW: number = (constants as Partial<typeof constants>).O_NOFOLLOW ?? 0;

/** Directories no framework treats as part of the project tree, and no adapter walks. */
export const VCS_DIRECTORIES: ReadonlySet<string> = new Set(['.git', '.hg', '.sl', '.svn']);

/** Whether anything, a link included, exists at `path`. Any failure other than absence is a refusal. */
export async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    refuse('unsafe-path', `${path} cannot be inspected: ${describe(error)}`);
  }
}

export function toPosix(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/');
}

async function openRegular(path: string): Promise<FileHandle> {
  let link;
  try {
    link = await lstat(path);
  } catch (error) {
    refuse('unsafe-path', `${path} cannot be read: ${describe(error)}`);
  }
  if (link.isSymbolicLink()) {
    refuse('unsafe-path', `${path} is a symbolic link, which is never followed: it can name any file on the host`);
  }
  if (!link.isFile()) refuse('unsafe-path', `${path} is not a regular file`);
  try {
    return await open(path, constants.O_RDONLY | NO_FOLLOW);
  } catch (error) {
    // ELOOP here means a link replaced the file after the lstat above.
    refuse('unsafe-path', `${path} could not be opened without following a link: ${describe(error)}`);
  }
}

/**
 * The file's text, decoded as UTF-8 with no replacement: a byte sequence that
 * is not UTF-8 is refused rather than parsed as something it is not.
 */
export async function readRegularFile(path: string, capBytes: number): Promise<string> {
  const handle = await openRegular(path);
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) refuse('unsafe-path', `${path} is not a regular file`);
    if (stats.size > capBytes) {
      refuse('too-large', `${path} is ${String(stats.size)} bytes, over the ${String(capBytes)}-byte cap for a file the adapters read whole`);
    }
    const bytes = await handle.readFile();
    // The file can grow between the stat and the read.
    if (bytes.length > capBytes) refuse('too-large', `${path} grew past the ${String(capBytes)}-byte cap while it was read`);
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      refuse('unparseable', `${path} is not valid UTF-8`);
    }
  } finally {
    await handle.close();
  }
}

/** SHA-256 of a regular file, streamed, so a large asset costs memory proportional to nothing. */
async function hashRegularFile(path: string): Promise<string> {
  const handle = await openRegular(path);
  try {
    const hash = createHash('sha256');
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk as Buffer);
    return hash.digest('hex');
  } finally {
    await handle.close();
  }
}

export type TreeEntry =
  | { readonly kind: 'file'; readonly absolute: string }
  | { readonly kind: 'symlink'; readonly absolute: string }
  | { readonly kind: 'other'; readonly absolute: string };

export interface WalkOptions {
  /** A directory name, at any depth, the walk does not enter. */
  readonly skipDirectory: (name: string) => boolean;
}

/**
 * Every entry under `root`, keyed by its path relative to `root` with POSIX
 * separators. Symbolic links are entries in their own right and never
 * traversed; FIFOs, sockets, and devices are recorded as `other` and never
 * opened.
 */
export async function walkTree(root: string, options: WalkOptions): Promise<Map<string, TreeEntry>> {
  let top;
  try {
    top = await lstat(root);
  } catch (error) {
    refuse('unsafe-path', `${root} cannot be read: ${describe(error)}`);
  }
  if (top.isSymbolicLink() || !top.isDirectory()) refuse('unsafe-path', `${root} is not a directory`);

  const entries = new Map<string, TreeEntry>();
  const visit = async (dir: string, prefix: string): Promise<void> => {
    let children: Dirent[];
    try {
      children = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      refuse('unsafe-path', `${dir} cannot be listed: ${describe(error)}`);
    }
    for (const child of children) {
      const relative = prefix === '' ? child.name : `${prefix}/${child.name}`;
      const absolute = join(dir, child.name);
      if (child.isSymbolicLink()) entries.set(relative, { kind: 'symlink', absolute });
      else if (child.isDirectory()) {
        if (!options.skipDirectory(child.name)) await visit(absolute, relative);
      } else if (child.isFile()) entries.set(relative, { kind: 'file', absolute });
      else entries.set(relative, { kind: 'other', absolute });
    }
  };
  await visit(root, '');
  return entries;
}

export type ChangeKind = 'added' | 'removed' | 'modified';

export interface TreeChange {
  /** Relative to the tree roots, POSIX separators. */
  readonly path: string;
  readonly change: ChangeKind;
}

async function sameEntry(before: TreeEntry, after: TreeEntry): Promise<boolean> {
  if (before.kind !== after.kind) return false;
  switch (before.kind) {
    case 'symlink':
      return (await readlink(before.absolute)) === (await readlink(after.absolute));
    case 'file':
      return (await hashRegularFile(before.absolute)) === (await hashRegularFile(after.absolute));
    case 'other':
      // Never opened: a FIFO would block the read forever. Presence on both sides is all that is compared.
      return true;
  }
}

/**
 * The entries `include` selects that differ between two trees: added, removed,
 * or with different bytes, link text, or kind. Sorted by path. Content is
 * compared only for selected entries, so a caller that needs a handful of
 * config files does not hash the whole tree.
 */
export async function diffTrees(
  base: string,
  head: string,
  include: (relative: string) => boolean,
  options: WalkOptions,
): Promise<TreeChange[]> {
  const [before, after] = await Promise.all([walkTree(base, options), walkTree(head, options)]);
  const paths = new Set([...before.keys(), ...after.keys()].filter(include));
  const changes: TreeChange[] = [];
  for (const path of [...paths].sort()) {
    const was = before.get(path);
    const now = after.get(path);
    if (was === undefined) changes.push({ path, change: 'added' });
    else if (now === undefined) changes.push({ path, change: 'removed' });
    else if (!(await sameEntry(was, now))) changes.push({ path, change: 'modified' });
  }
  return changes;
}
