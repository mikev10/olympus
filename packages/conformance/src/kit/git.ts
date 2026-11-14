/**
 * A fixture as a commit. Admission takes a run's base from the tree of its
 * base commit, read from git's object store (D-R36a-04), so a fixture a test
 * admits a run over is committed first, and the run names that commit.
 *
 * The commit is a function of the tree alone: a fixed identity, fixed dates,
 * no parent, and `core.autocrlf=false`, so the blobs are the fixture's bytes
 * whatever the host's git config says, and committing the same tree twice
 * names the same commit. No ref is moved; the object is enough for
 * admission to read it. Test code only.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const IDENTITY = {
  GIT_AUTHOR_NAME: 'fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
  GIT_COMMITTER_NAME: 'fixture',
  GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
};

export interface CommitOptions {
  /**
   * Whether files the fixture's own `.gitignore` ignores are committed too.
   * Defaults to true, so a fixture's base holds every file it lays out, as a
   * copy of it did; false commits what `git add -A` would, and no more.
   */
  readonly includeIgnored?: boolean;
  /** Commit text files with LF endings whatever the checkout holds, as `core.autocrlf=input` does. Defaults to false: bytes as they are. */
  readonly normalizeEndings?: boolean;
  /** Commit only these paths, leaving the rest of the directory untracked. Defaults to everything. */
  readonly paths?: readonly string[];
}

function git(dir: string, args: readonly string[], autocrlf = 'false'): string {
  return execFileSync('git', ['-C', dir, '-c', `core.autocrlf=${autocrlf}`, '-c', 'core.safecrlf=false', '-c', 'core.fsmonitor=false', '-c', 'core.longpaths=true', ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...IDENTITY },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/** Commits everything under `dir` and returns the commit's full object name. */
export function commitFixture(dir: string, options: CommitOptions = {}): string {
  if (!existsSync(join(dir, '.git'))) git(dir, ['init', '-q']);
  git(dir, ['add', '-A', ...(options.includeIgnored === false ? [] : ['-f']), '--', ...(options.paths ?? ['.'])], options.normalizeEndings === true ? 'input' : 'false');
  const tree = git(dir, ['write-tree']);
  return git(dir, ['commit-tree', tree, '-m', 'fixture']);
}

/**
 * Rewrites the working files of `dir` from `commit` as a checkout with
 * `core.autocrlf=true` writes them, on any OS: every text file with CRLF
 * endings, while the commit's blobs keep LF (#154).
 */
export function checkOutWithCrlf(dir: string, commit: string): void {
  git(dir, ['config', 'core.autocrlf', 'true']);
  git(dir, ['rm', '-r', '-q', '--cached', '.'], 'true');
  for (const file of committedFiles(dir, commit)) rmSync(join(dir, ...file.path.split('/')), { force: true });
  execFileSync('git', ['-C', dir, '-c', 'core.autocrlf=true', 'checkout', commit, '--', '.'], { stdio: ['ignore', 'pipe', 'pipe'] });
}

/** One file a commit's tree holds, as git stores it: its mode, and its blob's bytes (a link's are its target). */
export interface CommittedFile {
  readonly path: string;
  readonly mode: string;
  readonly bytes: Uint8Array;
}

/** Every file in the tree of `commit` in the repository at `dir`, read raw from the object store. */
export function committedFiles(dir: string, commit: string): CommittedFile[] {
  const listing = execFileSync('git', ['-C', dir, '-c', 'core.fsmonitor=false', 'ls-tree', '-r', '-z', '--full-tree', commit], { encoding: 'utf8' });
  const files: CommittedFile[] = [];
  for (const record of listing.split('\0')) {
    if (record === '') continue;
    const tab = record.indexOf('\t');
    const [mode, type, oid] = record.slice(0, tab).split(' ');
    if (type !== 'blob' || mode === undefined || oid === undefined) throw new Error(`git kit: ${record} is not a blob entry`);
    const bytes = execFileSync('git', ['-C', dir, 'cat-file', 'blob', oid]);
    files.push({ path: record.slice(tab + 1), mode, bytes: new Uint8Array(bytes) });
  }
  return files;
}
