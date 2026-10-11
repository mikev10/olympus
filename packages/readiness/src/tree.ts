/**
 * The copy a scan runs against: the commit's tree as git stores it, written to
 * a directory the scan owns, so the target repository is read and never
 * written (R1 §5) and nothing untracked in a working directory — a stale
 * `dist/`, an installed `node_modules/` — can make a build look clean that is
 * not (D-R1-11).
 *
 * Blobs are read raw through `git cat-file --batch`. `git archive` and a
 * checkout would apply the repository's attributes and configured filters,
 * which are commands the repository's own configuration names; reading object
 * contents runs none.
 */
import { execFile, spawn } from 'node:child_process';
import { chmod, lstat, mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const UTF8 = new TextDecoder('utf-8', { fatal: true });

/** `git` against `checkout`, with the one setting that could start a configured process on a read turned off. */
function gitArgs(checkout: string, ...args: string[]): string[] {
  return ['-C', checkout, '-c', 'core.fsmonitor=false', ...args];
}

/** The full object name `revision` names, or a refusal saying why it names none. */
export async function resolveCommit(checkout: string, revision: string): Promise<string> {
  if (revision === '' || revision.startsWith('-')) {
    throw new Error(`readiness: '${revision}' is not a revision; refused rather than passed to git as an option`);
  }
  try {
    const { stdout } = await run('git', gitArgs(checkout, 'rev-parse', '--verify', '--quiet', `${revision}^{commit}`));
    const commit = stdout.trim();
    if (!/^[0-9a-f]{40,64}$/u.test(commit)) throw new Error(`git printed '${commit}'`);
    return commit;
  } catch (error) {
    throw new Error(`readiness: ${checkout} has no commit '${revision}': ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

interface TreeEntry {
  readonly mode: string;
  readonly type: string;
  readonly oid: string;
  readonly path: string;
}

export interface Materialized {
  /** Every regular file and symlink written, by its path in the tree, POSIX separators, sorted. */
  readonly files: readonly string[];
  /** Entries not reproduced, each named with why. */
  readonly skipped: readonly string[];
}

/** Writes the tree of `commit` under `dest`. */
export async function materialize(checkout: string, commit: string, dest: string): Promise<Materialized> {
  // Read as bytes: `-z` names are raw, and decoding them leniently would map distinct names to one path.
  const { stdout } = await run('git', gitArgs(checkout, 'ls-tree', '-r', '-z', '--full-tree', commit), { maxBuffer: 256 * 1024 * 1024, encoding: 'buffer' });
  const entries: TreeEntry[] = [];
  const skipped: string[] = [];
  for (const record of records(stdout)) {
    const tab = record.indexOf('\t');
    const [mode, type, oid] = record.slice(0, tab).split(' ');
    const path = record.slice(tab + 1);
    if (tab < 0 || mode === undefined || type === undefined || oid === undefined) throw new Error(`readiness: unreadable tree entry '${record}'`);
    checkPath(path);
    if (type === 'commit') skipped.push(`${path}: a submodule (${oid}); a clean checkout does not initialise it`);
    else if (type === 'blob') entries.push({ mode, type, oid, path });
    else throw new Error(`readiness: tree entry ${path} has type ${type}`);
  }

  await mkdir(dest, { recursive: true });
  const child = spawn('git', gitArgs(checkout, 'cat-file', '--batch'), { stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', (text: string) => { stderr += text; });
  const exited = new Promise<number | null>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  child.stdin.end(entries.map((e) => `${e.oid}\n`).join(''));

  let pending = Buffer.alloc(0);
  let index = 0;
  try {
    for await (const chunk of child.stdout as AsyncIterable<Buffer>) {
      pending = Buffer.concat([pending, chunk]);
      for (;;) {
        const entry = entries[index];
        if (entry === undefined) break;
        const newline = pending.indexOf(0x0a);
        if (newline < 0) break;
        const header = pending.subarray(0, newline).toString('utf8').split(' ');
        const size = Number(header[2]);
        if (header[0] !== entry.oid || header[1] !== 'blob' || !Number.isSafeInteger(size)) {
          child.kill();
          throw new Error(`readiness: git cat-file answered '${header.join(' ')}' for ${entry.path} (${entry.oid})`);
        }
        if (pending.length < newline + 1 + size + 1) break;
        const body = pending.subarray(newline + 1, newline + 1 + size);
        pending = pending.subarray(newline + 1 + size + 1);
        await writeEntry(dest, entry, body);
        index++;
      }
    }
  } catch (error) {
    // A refused entry ends the copy; git must not outlive it holding the repository open.
    child.kill();
    await exited.catch(() => null);
    throw error;
  }
  const code = await exited;
  if (code !== 0 || index !== entries.length) {
    throw new Error(`readiness: git cat-file exited ${String(code)} after ${String(index)} of ${String(entries.length)} objects: ${stderr.trim()}`);
  }
  return { files: entries.map((e) => e.path).sort(), skipped };
}

function* records(listing: Buffer): Generator<string> {
  let start = 0;
  for (let end = listing.indexOf(0); end >= 0; start = end + 1, end = listing.indexOf(0, start)) {
    if (end === start) continue;
    try {
      yield UTF8.decode(listing.subarray(start, end));
    } catch {
      throw new Error(`readiness: a tree entry's name is not UTF-8 (${listing.subarray(start, end).toString('hex')}); refused rather than written under a name it does not have`);
    }
  }
}

/** Git refuses these paths itself; a tree that carries one anyway is refused before anything is written. */
function checkPath(path: string): void {
  const segments = path.split('/');
  if (path.startsWith('/') || segments.some((s) => s === '' || s === '.' || s === '..' || s.toLowerCase() === '.git' || s.includes('\\'))) {
    throw new Error(`readiness: tree path '${path}' could escape the copy; refused`);
  }
}

/**
 * A link's target, if following it from inside the copy can only land inside
 * the copy: relative, and climbing only at its start, no higher than the
 * link's own directory sits. A `..` after a name could climb out of whatever
 * that name links to, so it is refused wherever it appears.
 */
function checkLink(path: string, body: Buffer): string {
  let target: string;
  try {
    target = UTF8.decode(body);
  } catch {
    throw new Error(`readiness: symlink '${path}' has a target that is not UTF-8; refused`);
  }
  const depth = path.split('/').length - 1;
  const segments = target.split('/').filter((s) => s !== '' && s !== '.');
  const climbs = segments.findIndex((s) => s !== '..');
  const up = climbs < 0 ? segments.length : climbs;
  if (target.startsWith('/') || /[\\:]/u.test(target) || up > depth || segments.slice(up).includes('..')) {
    throw new Error(`readiness: symlink '${path}' -> '${target}' could escape the copy; refused`);
  }
  return target;
}

/**
 * Creates each missing directory between `dest` and the entry one at a time,
 * refusing any that already exists as something other than a directory. A
 * filesystem that folds case or trailing characters can make a later name an
 * earlier symlink, and writing through it would land wherever the link points.
 */
async function parentsOf(dest: string, path: string): Promise<void> {
  let at = dest;
  for (const segment of path.split('/').slice(0, -1)) {
    at = join(at, segment);
    let stat;
    try {
      stat = await lstat(at);
    } catch {
      await mkdir(at);
      continue;
    }
    if (!stat.isDirectory()) {
      throw new Error(`readiness: '${path}' would be written through '${segment}', which the copy already holds as a ${stat.isSymbolicLink() ? 'symlink' : 'file'}; refused`);
    }
  }
}

async function writeEntry(dest: string, entry: TreeEntry, body: Buffer): Promise<void> {
  const target = join(dest, ...entry.path.split('/'));
  await parentsOf(dest, entry.path);
  if (entry.mode === '120000') {
    // A link that cannot be created is a tree the copy does not reproduce, and a scan of a different tree is refused (I5).
    await symlink(checkLink(entry.path, body), target);
    return;
  }
  // `wx`: a path the copy already holds, under this name or one the filesystem folds into it, is never written through.
  await writeFile(target, body, { flag: 'wx' });
  if (entry.mode === '100755') await chmod(target, 0o755);
}
