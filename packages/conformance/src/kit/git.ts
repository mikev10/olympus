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
import { existsSync } from 'node:fs';
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
}

function git(dir: string, args: readonly string[]): string {
  return execFileSync('git', ['-C', dir, '-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false', '-c', 'core.fsmonitor=false', ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...IDENTITY },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/** Commits everything under `dir` and returns the commit's full object name. */
export function commitFixture(dir: string, options: CommitOptions = {}): string {
  if (!existsSync(join(dir, '.git'))) git(dir, ['init', '-q']);
  git(dir, ['add', '-A', ...(options.includeIgnored === false ? [] : ['-f']), '.']);
  const tree = git(dir, ['write-tree']);
  return git(dir, ['commit-tree', tree, '-m', 'fixture']);
}
