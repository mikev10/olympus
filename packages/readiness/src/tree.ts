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
import { chmod, mkdir, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

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
  const { stdout } = await run('git', gitArgs(checkout, 'ls-tree', '-r', '-z', '--full-tree', commit), { maxBuffer: 256 * 1024 * 1024 });
  const entries: TreeEntry[] = [];
  const skipped: string[] = [];
  for (const record of stdout.split('\0')) {
    if (record === '') continue;
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
  const code = await exited;
  if (code !== 0 || index !== entries.length) {
    throw new Error(`readiness: git cat-file exited ${String(code)} after ${String(index)} of ${String(entries.length)} objects: ${stderr.trim()}`);
  }
  return { files: entries.map((e) => e.path).sort(), skipped };
}

/** Git refuses these paths itself; a tree that carries one anyway is refused before anything is written. */
function checkPath(path: string): void {
  const segments = path.split('/');
  if (path.startsWith('/') || segments.some((s) => s === '' || s === '.' || s === '..' || s.toLowerCase() === '.git' || s.includes('\\'))) {
    throw new Error(`readiness: tree path '${path}' could escape the copy; refused`);
  }
}

async function writeEntry(dest: string, entry: TreeEntry, body: Buffer): Promise<void> {
  const target = join(dest, ...entry.path.split('/'));
  await mkdir(dirname(target), { recursive: true });
  if (entry.mode === '120000') {
    // A link that cannot be created is a tree the copy does not reproduce, and a scan of a different tree is refused (I5).
    await symlink(body.toString('utf8'), target);
    return;
  }
  await writeFile(target, body);
  if (entry.mode === '100755') await chmod(target, 0o755);
}
