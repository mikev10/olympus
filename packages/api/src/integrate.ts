/**
 * `integrate`'s one write outside the Vault: the run's accepted change pushed
 * to the remote, opened as a pull request, and merged after the human approved
 * the exit (D-I1b-01). The runtime does it from the host, with a token no
 * sandbox and no task is ever given (D-A-I1-07).
 *
 * Everything goes through the GitHub REST API. No `git` executable runs, so no
 * git config — which an agent could have written into a workspace's `.git` —
 * is ever executed (D-P8-04, D-I1b-02).
 *
 * What merges is what was verified, or nothing merges (D-I1b-03):
 * - every file `baseCommit` tracks must hash, as a git blob, to the same bytes
 *   and be the same kind, symlink or regular file, in the base the runtime
 *   snapshotted at admission;
 * - the base branch must still point at `baseCommit` when the pull request is
 *   opened and when it is merged, and the merge names the pushed commit, so a
 *   head moved in between is refused by GitHub itself;
 * - the pull request must target the base branch, and the merge commit must
 *   have `baseCommit` and the pushed commit as its parents.
 * Any failure throws, and the run halts at `integrate` (D-I1b-04).
 */
import { createHash } from 'node:crypto';
import { lstat, readFile, readlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunId } from '@olympus-ai/core';
import type { DiffEntry, IntegrationMerged, IntegrationOpened } from '@olympus-ai/vault';

export interface OpenRequest {
  readonly runId: RunId;
  readonly baseCommit: string;
  /** The base the runtime snapshotted at admission. */
  readonly base: string;
  /** The tree the accepted diff was verified over; its bytes are what is pushed. */
  readonly tree: string;
  /** The accepted cumulative diff, relative to base. */
  readonly diff: readonly DiffEntry[];
  /** The run's admission time: the commit's dates, so a resume rebuilds the same commit. */
  readonly admittedAt: string;
}

/** What opens and merges a run's pull request. Only `GitHubIntegrator` is attested by the graph builder (D-I1b-05). */
export interface Integrator {
  readonly repository: string;
  readonly baseBranch: string;
  /**
   * The domains the remote is reached on. Admission refuses a policy whose
   * egress allowlist names one of them or a host under one, so no sandbox the
   * line provisions can reach the remote (D-I1b-05).
   */
  readonly remoteDomains: readonly string[];
  open(req: OpenRequest): Promise<IntegrationOpened>;
  merge(opened: IntegrationOpened): Promise<IntegrationMerged>;
}

export interface GitHubIntegratorOptions {
  /** `owner/name`. */
  readonly repository: string;
  readonly baseBranch: string;
  /** A fine-grained token scoped to `repository`: contents and pull requests, read and write (D-I1b-06). */
  readonly token: string;
  /** Defaults to `https://api.github.com`. */
  readonly apiBase?: string;
  /** Per request. Defaults to 30 s. */
  readonly timeoutMs?: number;
}

const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** A run id is already a safe directory name (`LocalVault`); a ref also may not hold `..` or end in `.lock` or `.`. */
function branchFor(runId: RunId): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(runId) || runId.includes('..') || runId.endsWith('.lock') || runId.endsWith('.')) {
    throw new Error(`integrate: run id ${runId} cannot name a git branch`);
  }
  return `factory/${runId}`;
}

/** The sha a git blob of these bytes has. */
export function gitBlobSha(bytes: Uint8Array): string {
  return createHash('sha1').update(`blob ${String(bytes.byteLength)}\0`).update(bytes).digest('hex');
}

/** A file's bytes as git stores them: a symlink's are its target. Null when the path holds neither. */
async function blobOf(root: string, path: string): Promise<{ bytes: Uint8Array; symlink: boolean } | null> {
  const at = join(root, ...path.split('/'));
  let stat;
  try {
    stat = await lstat(at);
  } catch {
    return null;
  }
  if (stat.isSymbolicLink()) return { bytes: new TextEncoder().encode(await readlink(at)), symlink: true };
  if (!stat.isFile()) return null;
  return { bytes: await readFile(at), symlink: false };
}

const SYMLINK = '120000';

/** A file's kind as git names it. */
function kindOf(symlink: boolean): string {
  return symlink ? 'a symlink' : 'a regular file';
}

interface TreeEntry {
  readonly path: string;
  readonly mode: string;
  readonly type: string;
  readonly sha: string;
}

/**
 * Every file `baseCommit` tracks, compared with the base snapshot by git blob
 * sha and by kind, symlink or regular file, since a symlink's blob is its
 * target text. Untracked files in the snapshot are not compared, and neither
 * is the executable bit (D-I1b-03, known limits).
 */
export async function baseMismatches(base: string, tracked: readonly TreeEntry[]): Promise<string[]> {
  const problems: string[] = [];
  for (const entry of tracked) {
    if (entry.type === 'tree') continue;
    if (entry.type !== 'blob') {
      problems.push(`${entry.path} is a ${entry.type}, which the runtime does not snapshot`);
      continue;
    }
    const blob = await blobOf(base, entry.path);
    if (blob === null) problems.push(`${entry.path} is tracked at the base commit and absent from the base the run was built over`);
    else if (gitBlobSha(blob.bytes) !== entry.sha) problems.push(`${entry.path} differs between the base commit and the base the run was built over`);
    else if ((entry.mode === SYMLINK) !== blob.symlink) {
      problems.push(`${entry.path} is ${kindOf(entry.mode === SYMLINK)} at the base commit and ${kindOf(blob.symlink)} in the base the run was built over`);
    }
  }
  return problems;
}

class GitHubError extends Error {}

export class GitHubIntegrator implements Integrator {
  readonly repository: string;
  readonly baseBranch: string;
  readonly remoteDomains: readonly string[];
  readonly #token: string;
  readonly #api: string;
  readonly #timeoutMs: number;

  constructor(options: GitHubIntegratorOptions) {
    if (!REPOSITORY.test(options.repository)) throw new Error(`integrate: ${options.repository} is not owner/name`);
    if (options.baseBranch === '' || options.baseBranch.includes('..')) throw new Error('integrate: the base branch is not a branch name');
    if (options.token === '') throw new Error('integrate: no token');
    this.repository = options.repository;
    this.baseBranch = options.baseBranch;
    this.#token = options.token;
    this.#api = (options.apiBase ?? 'https://api.github.com').replace(/\/+$/u, '');
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    const apiHost = new URL(this.#api).hostname.toLowerCase();
    this.remoteDomains = Object.freeze([...new Set(['github.com', 'githubusercontent.com', apiHost])]);
  }

  async open(req: OpenRequest): Promise<IntegrationOpened> {
    const branch = branchFor(req.runId);
    if (req.diff.length === 0) throw new Error(`integrate: run ${req.runId} accepted no change, so there is nothing to merge`);
    await this.#baseUnmoved(req.baseCommit);

    const baseTree = (await this.#call<{ tree: { sha: string } }>('GET', `/git/commits/${req.baseCommit}`)).tree.sha;
    const listing = await this.#call<{ tree: TreeEntry[]; truncated: boolean }>('GET', `/git/trees/${baseTree}?recursive=1`);
    if (listing.truncated) throw new Error(`integrate: the tree of ${req.baseCommit} is too large to list whole, so the base cannot be compared`);
    const mismatches = await baseMismatches(req.base, listing.tree);
    if (mismatches.length > 0) {
      throw new Error(`integrate: the base commit is not the base the run was verified over (D-I1b-03): ${mismatches.slice(0, 10).join('; ')}`);
    }

    const modes = new Map(listing.tree.map((e) => [e.path, e.mode]));
    const entries: Array<{ path: string; mode: string; type: 'blob'; sha: string | null }> = [];
    for (const change of [...req.diff].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
      if (change.change === 'removed') {
        entries.push({ path: change.path, mode: modes.get(change.path) ?? '100644', type: 'blob', sha: null });
        continue;
      }
      const verified = await blobOf(req.tree, change.path);
      if (verified === null) throw new Error(`integrate: ${change.path} is in the accepted diff and not in the tree it was verified over`);
      const blob = await this.#call<{ sha: string }>('POST', '/git/blobs', { content: Buffer.from(verified.bytes).toString('base64'), encoding: 'base64' });
      if (blob.sha !== gitBlobSha(verified.bytes)) throw new Error(`integrate: the remote stored ${change.path} as other bytes than were sent`);
      // The kind is the verified tree's; a regular file keeps the base's executable bit, which is not compared (D-I1b-03).
      const mode = verified.symlink ? SYMLINK : modes.get(change.path) === '100755' ? '100755' : '100644';
      entries.push({ path: change.path, mode, type: 'blob', sha: blob.sha });
    }
    const tree = await this.#call<{ sha: string }>('POST', '/git/trees', { base_tree: baseTree, tree: entries });
    const who = { name: 'Factory runtime', email: 'runtime@factory.invalid', date: req.admittedAt };
    const commit = (await this.#call<{ sha: string }>('POST', '/git/commits', {
      message: `factory: run ${req.runId}\n\nBuilt over ${req.baseCommit}. Every check and review gate passed; merged by the runtime after a human approved integrate.`,
      tree: tree.sha,
      parents: [req.baseCommit],
      author: who,
      committer: who,
    })).sha;

    const existing = await this.#call<{ object: { sha: string } } | null>('GET', `/git/ref/heads/${branch}`, undefined, true);
    if (existing === null) await this.#call('POST', '/git/refs', { ref: `refs/heads/${branch}`, sha: commit });
    else if (existing.object.sha !== commit) {
      throw new Error(`integrate: ${branch} already exists at ${existing.object.sha}, not at the commit this run built (${commit}); refused rather than forced`);
    }

    const owner = this.repository.split('/')[0] ?? '';
    const found = await this.#call<PullRequest[]>('GET', `/pulls?state=all&head=${encodeURIComponent(`${owner}:${branch}`)}`);
    const pull = found.find((p) => p.head.ref === branch) ?? await this.#call<PullRequest>('POST', '/pulls', {
      title: `factory: run ${req.runId}`,
      head: branch,
      base: this.baseBranch,
      body: `Opened by the factory runtime for run \`${req.runId}\`, built over \`${req.baseCommit}\`. It merges after a human approves the run's integrate gate.`,
    });
    this.#targetsBase(pull);
    if (pull.state === 'closed' && pull.merged_at === null) throw new Error(`integrate: pull request #${String(pull.number)} was closed without merging`);
    if (pull.head.sha !== commit) throw new Error(`integrate: pull request #${String(pull.number)} is at ${pull.head.sha}, not at ${commit}`);
    return {
      runId: req.runId,
      kind: 'opened',
      repository: this.repository,
      baseBranch: this.baseBranch,
      baseCommit: req.baseCommit,
      branch,
      commit,
      pullRequest: pull.number,
      url: pull.html_url,
      collectedBy: 'runtime',
    };
  }

  async merge(opened: IntegrationOpened): Promise<IntegrationMerged> {
    if (opened.repository !== this.repository) throw new Error(`integrate: the run opened its pull request on ${opened.repository}, not ${this.repository}`);
    const pull = await this.#call<PullRequest>('GET', `/pulls/${String(opened.pullRequest)}`);
    this.#targetsBase(pull);
    if (pull.head.sha !== opened.commit) throw new Error(`integrate: pull request #${String(pull.number)} moved to ${pull.head.sha} from ${opened.commit}`);
    let mergeCommit: string;
    if (pull.merged_at !== null) {
      // Merged by an earlier drive whose record was lost to a stop: the same act, recorded now.
      if (pull.merge_commit_sha === null) throw new Error(`integrate: pull request #${String(pull.number)} is merged and names no merge commit`);
      mergeCommit = pull.merge_commit_sha;
    } else {
      if (pull.state !== 'open') throw new Error(`integrate: pull request #${String(pull.number)} is closed`);
      await this.#baseUnmoved(opened.baseCommit);
      const merged = await this.#call<{ merged: boolean; sha: string }>('PUT', `/pulls/${String(opened.pullRequest)}/merge`, { sha: opened.commit, merge_method: 'merge' });
      if (!merged.merged) throw new Error(`integrate: GitHub did not merge pull request #${String(opened.pullRequest)}`);
      mergeCommit = merged.sha;
    }
    // Either way, the merge must be over the commit the run was verified over. GitHub's merge pins the
    // head and not the base, so a push between `#baseUnmoved` and the merge is merged in; this refuses
    // to record it, and the run halts (D-I1b-04). The merge itself is not undone (D-I1b-13).
    const parents = (await this.#call<{ parents: Array<{ sha: string }> }>('GET', `/git/commits/${mergeCommit}`)).parents.map((p) => p.sha);
    if (parents.length !== 2 || parents[0] !== opened.baseCommit || parents[1] !== opened.commit) {
      throw new Error(`integrate: pull request #${String(pull.number)} merged as ${mergeCommit} over ${parents.join(', ')}, not over ${opened.baseCommit}, the commit the run was verified over (D-I1b-03)`);
    }
    return { ...opened, kind: 'merged', mergeCommit };
  }

  /** The pull request merges into the base branch, not another a collaborator retargeted it to. */
  #targetsBase(pull: PullRequest): void {
    if (pull.base.ref !== this.baseBranch) throw new Error(`integrate: pull request #${String(pull.number)} targets ${pull.base.ref}, not ${this.baseBranch}`);
  }

  /** The base branch still points at the commit the run was built over ("evidence is void if the base moves"). */
  async #baseUnmoved(baseCommit: string): Promise<void> {
    const head = await this.#call<{ object: { sha: string } }>('GET', `/git/ref/heads/${this.baseBranch}`);
    if (head.object.sha !== baseCommit) {
      throw new Error(`integrate: ${this.baseBranch} moved to ${head.object.sha} from ${baseCommit}, the commit the run was verified over (D-I1b-03)`);
    }
  }

  /** One request. A 404 is null only where `absentIsNull`; any other failure throws, without the token. */
  async #call<T>(method: string, path: string, body?: unknown, absentIsNull = false): Promise<T> {
    const response = await fetch(`${this.#api}/repos/${this.repository}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.#token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    if (absentIsNull && response.status === 404) return null as T;
    const text = await response.text();
    if (!response.ok) throw new GitHubError(`integrate: GitHub answered ${method} ${path} with ${String(response.status)}: ${text.slice(0, 300)}`);
    return JSON.parse(text) as T;
  }
}

interface PullRequest {
  readonly number: number;
  readonly html_url: string;
  readonly state: 'open' | 'closed';
  readonly merged_at: string | null;
  readonly merge_commit_sha: string | null;
  readonly head: { readonly ref: string; readonly sha: string };
  readonly base: { readonly ref: string };
}

/** Whether an egress host is one of the remote's domains or lies under one. */
export function reachesRemote(host: string, domains: readonly string[]): boolean {
  const h = host.toLowerCase().replace(/\.$/u, '');
  return domains.some((d) => h === d || h.endsWith(`.${d}`));
}
