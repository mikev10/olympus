/**
 * The default branch's history, read from a host-side checkout (R8a). It
 * lists first-parent commits, reads a change's diff, and decides whether a
 * later commit undoes one: a rollback when the later commit's patch id is the
 * change's inverse, a partial reversal when it inverts some of the change's
 * hunks and not all (D-A-OB-04, D-R8a-06). Nothing here reads a commit
 * message: a revert is found by what it does, never by what it says.
 *
 * Only plumbing commands run, each with `core.fsmonitor=false`, and every
 * diff with `--text`, `--no-ext-diff`, and `--no-textconv`, so no command the
 * repository's configuration names runs on a read.
 */
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const MAX_BUFFER = 256 * 1024 * 1024;
const OID = /^[0-9a-f]{40,64}$/u;

function gitArgs(checkout: string, ...args: string[]): string[] {
  return ['-C', checkout, '-c', 'core.fsmonitor=false', '-c', 'core.quotePath=false', ...args];
}

async function git(checkout: string, ...args: string[]): Promise<string> {
  const { stdout } = await run('git', gitArgs(checkout, ...args), { maxBuffer: MAX_BUFFER, encoding: 'utf8' });
  return stdout;
}

/** `git` with `input` on its standard input. */
function gitWith(checkout: string, input: string, ...args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', gitArgs(checkout, ...args), { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (text: string) => { stdout += text; });
    child.stderr.setEncoding('utf8').on('data', (text: string) => { stderr += text; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`git ${args[0] ?? ''} exited ${String(code)}: ${stderr.trim()}`));
    });
    child.stdin.end(input);
  });
}

function requireOid(value: string, what: string): string {
  if (!OID.test(value)) throw new Error(`history: ${what} '${value}' is not an object name`);
  return value;
}

/** One first-parent commit of the default branch, as git stores it. */
export interface BranchCommit {
  readonly commit: string;
  readonly parents: readonly string[];
  /** The committer date: committer-claimed (D-A-OB-06). */
  readonly committedAt: string;
}

/** Whether `ancestor` is `descendant` or one of its ancestors. */
export async function isAncestor(checkout: string, ancestor: string, descendant: string): Promise<boolean> {
  requireOid(ancestor, 'ancestor');
  requireOid(descendant, 'descendant');
  try {
    await run('git', gitArgs(checkout, 'merge-base', '--is-ancestor', ancestor, descendant));
    return true;
  } catch (error) {
    // Exit 1 is "not an ancestor"; anything else is a read that failed, never an answer (I5).
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 1) return false;
    throw error;
  }
}

/**
 * Every commit on `head`'s first-parent chain: the default branch's own
 * history, which a commit reachable only through a merge's second parent is
 * not on (codex-1).
 */
export async function firstParentChain(checkout: string, head: string): Promise<Set<string>> {
  const out = await git(checkout, 'rev-list', '--first-parent', requireOid(head, 'head'));
  return new Set(out.split('\n').filter((l) => l !== '').map((l) => requireOid(l, 'commit')));
}

/** A commit's parents and committer date. */
export async function commitOf(checkout: string, commit: string): Promise<BranchCommit> {
  const out = (await git(checkout, 'rev-list', '--no-walk', '--parents', '--format=%cI', requireOid(commit, 'commit'))).trim().split('\n');
  return parseCommit(out[0] ?? '', out[1] ?? '');
}

function parseCommit(header: string, date: string): BranchCommit {
  // `rev-list --format` prints `commit <oid> <parents...>`, then the format line.
  const [word, commit = '', ...parents] = header.trim().split(' ');
  if (word !== 'commit') throw new Error(`history: unreadable rev-list header '${header}'`);
  const committedAt = new Date(date.trim()).toISOString();
  return { commit: requireOid(commit, 'commit'), parents: parents.map((p) => requireOid(p, 'parent')), committedAt };
}

/** First-parent commits after `from` up to and including `to`, oldest first; every first-parent commit of `to` where `from` is null. */
export async function firstParents(checkout: string, from: string | null, to: string): Promise<BranchCommit[]> {
  const range = from === null ? [requireOid(to, 'head')] : [requireOid(to, 'head'), `^${requireOid(from, 'start')}`];
  const lines = (await git(checkout, 'rev-list', '--first-parent', '--reverse', '--parents', '--format=%cI', ...range)).split('\n').filter((l) => l !== '');
  const out: BranchCommit[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) out.push(parseCommit(lines[i] ?? '', lines[i + 1] ?? ''));
  return out;
}

/** The empty tree's name in this repository's hash: a root commit's diff is against it. */
async function emptyTree(checkout: string): Promise<string> {
  return requireOid((await gitWith(checkout, '', 'mktree')).trim(), 'empty tree');
}

/**
 * The patch from `a` to `b`, with no external diff or text conversion; `a` null is the empty tree.
 * `--text` diffs every file as text, so a `.gitattributes` marking files `-diff` or `binary` cannot empty
 * the hunks a partial reversal is matched on (gemini-3).
 */
async function patch(checkout: string, a: string | null, b: string, context: 'default' | 'none'): Promise<string> {
  const left = a ?? (await emptyTree(checkout));
  return git(
    checkout, 'diff-tree', '-p', '-r', '--text', '--no-ext-diff', '--no-textconv', '--no-color', '--no-renames', '--full-index',
    ...(context === 'none' ? ['-U0'] : []), requireOid(left, 'tree'), requireOid(b, 'tree'),
  );
}

/** The `patch-id --stable` of a patch, or null for an empty one. */
async function patchId(checkout: string, text: string): Promise<string | null> {
  if (text.trim() === '') return null;
  const out = (await gitWith(checkout, text, 'patch-id', '--stable')).trim();
  const id = out.split(' ')[0] ?? '';
  return id === '' ? null : requireOid(id, 'patch id');
}

/**
 * One hunk at zero context: its file and the lines it removes and adds,
 * whitespace at each end trimmed as `patch-id` ignores it. Its inverse swaps
 * the two.
 */
function hunkKeys(text: string, inverse: boolean): string[] {
  const keys: string[] = [];
  let minus = '';
  let plus = '';
  let removed: string[] = [];
  let added: string[] = [];
  let inHunk = false;
  const flush = (): void => {
    if (inHunk && (removed.length > 0 || added.length > 0)) {
      const path = plus !== '/dev/null' ? plus : minus;
      const [from, to] = inverse ? [added, removed] : [removed, added];
      keys.push(JSON.stringify([path, from, to]));
    }
    removed = [];
    added = [];
  };
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      flush();
      inHunk = false;
    } else if (line.startsWith('--- ') && !inHunk) {
      minus = line.slice(4).replace(/^a\//u, '');
    } else if (line.startsWith('+++ ') && !inHunk) {
      plus = line.slice(4).replace(/^b\//u, '');
    } else if (line.startsWith('@@')) {
      flush();
      inHunk = true;
    } else if (inHunk && line.startsWith('-')) {
      removed.push(line.slice(1).trim());
    } else if (inHunk && line.startsWith('+')) {
      added.push(line.slice(1).trim());
    }
  }
  flush();
  return keys;
}

/** What `classifyReversal` compares a later commit against: a change's inverse, read once. */
export interface ChangeInverse {
  readonly change: string;
  /** Null for a change with an empty diff, which nothing can revert. */
  readonly inversePatchId: string | null;
  readonly inverseHunks: readonly string[];
}

/** A first-parent commit's own diff, as `classifyReversal` reads it. */
export interface CommitDiff {
  readonly commit: string;
  readonly patchId: string | null;
  readonly hunks: readonly string[];
}

/** A change's inverse: the diff from the change's merge commit back to its first parent. */
export async function changeInverse(checkout: string, change: BranchCommit): Promise<ChangeInverse> {
  const parent = change.parents[0] ?? null;
  const base = parent ?? (await emptyTree(checkout));
  return {
    change: change.commit,
    inversePatchId: await patchId(checkout, await patch(checkout, change.commit, base, 'default')),
    inverseHunks: hunkKeys(await patch(checkout, parent, change.commit, 'none'), true),
  };
}

/** A later commit's diff against its first parent. */
export async function commitDiff(checkout: string, commit: BranchCommit): Promise<CommitDiff> {
  const parent = commit.parents[0] ?? null;
  return {
    commit: commit.commit,
    patchId: await patchId(checkout, await patch(checkout, parent, commit.commit, 'default')),
    hunks: hunkKeys(await patch(checkout, parent, commit.commit, 'none'), false),
  };
}

export type Reversal =
  | { readonly kind: 'rollback'; readonly match: 'patch-id' | 'all-hunks' }
  | { readonly kind: 'partial-reversal'; readonly hunks: number; readonly of: number }
  | { readonly kind: 'none' };

/**
 * Whether `later` undoes `change`, by diff alone (D-A-OB-04). A rollback is
 * an exact inverse by patch id, or a commit that inverts every one of the
 * change's hunks and edits something else besides: the change is undone
 * either way, and an edit beside it must not hide that (codex-5, gemini-1).
 * A partial reversal inverts at least one and not every one of the change's
 * hunks; it is never a rollback.
 */
export function classifyReversal(change: ChangeInverse, later: CommitDiff): Reversal {
  if (change.inversePatchId === null || later.commit === change.change) return { kind: 'none' };
  if (later.patchId !== null && later.patchId === change.inversePatchId) return { kind: 'rollback', match: 'patch-id' };
  const theirs = new Set(later.hunks);
  const hunks = change.inverseHunks.filter((h) => theirs.has(h)).length;
  if (hunks === 0) return { kind: 'none' };
  return hunks === change.inverseHunks.length ? { kind: 'rollback', match: 'all-hunks' } : { kind: 'partial-reversal', hunks, of: change.inverseHunks.length };
}

/**
 * A change's lead time, from its first commit's author date to its merge
 * commit's committer date, both committer-claimed. A commit with one parent
 * keeps no first commit (D-A-BR-04).
 */
export async function leadTimeOf(checkout: string, change: BranchCommit): Promise<{ kind: 'measured'; ms: number; source: 'committer-claimed' } | { kind: 'not-measurable'; why: 'one-parent' }> {
  const [first, second] = change.parents;
  if (first === undefined || second === undefined) return { kind: 'not-measurable', why: 'one-parent' };
  const dates = (await git(checkout, 'rev-list', '--reverse', '--format=%aI', '--no-commit-header', requireOid(second, 'parent'), `^${requireOid(first, 'parent')}`))
    .split('\n').filter((l) => l !== '');
  const earliest = dates[0];
  if (earliest === undefined) return { kind: 'not-measurable', why: 'one-parent' };
  return { kind: 'measured', ms: Date.parse(change.committedAt) - Date.parse(earliest), source: 'committer-claimed' };
}
