/**
 * A GitHub REST server in process, for the endpoints `GitHubIntegrator` calls:
 * refs, blobs, trees, commits, and pull requests. Objects are hashed as git
 * hashes them, so a commit built twice from the same inputs is one commit,
 * and a blob sha the runtime computes is the sha this server answers with.
 *
 * It holds one repository, seeded from a directory, and records every request
 * with the credential it bore, so an assertion can say who reached it.
 */
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { lstat, readFile, readdir, readlink } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

interface Blob { readonly type: 'blob'; readonly bytes: Uint8Array }
interface TreeObject { readonly type: 'tree'; readonly entries: ReadonlyArray<{ name: string; mode: string; sha: string }> }
interface Commit { readonly type: 'commit'; readonly tree: string; readonly parents: readonly string[]; readonly message: string }
type GitObject = Blob | TreeObject | Commit;

interface Pull {
  readonly number: number;
  readonly headRef: string;
  base: string;
  state: 'open' | 'closed';
  mergedAt: string | null;
  mergeCommit: string | null;
}

export interface FakeGitHubRequest {
  readonly method: string;
  readonly path: string;
  readonly authorization: string | null;
}

export interface FakeGitHubOptions {
  /** `owner/name`. Defaults to `conformance/canary`. */
  readonly repository?: string;
  readonly baseBranch?: string;
  /** The token every request must bear. Any other is answered 401. */
  readonly token: string;
  /** Directory names left out of the seeded commit, as `.gitignore` would leave them untracked. */
  readonly untracked?: readonly string[];
}

export interface FileEntry { readonly mode: string; readonly bytes: Uint8Array }

function sha1(type: string, body: Uint8Array): string {
  return createHash('sha1').update(`${type} ${String(body.byteLength)}\0`).update(body).digest('hex');
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

const encoder = new TextEncoder();

export class FakeGitHub {
  readonly repository: string;
  readonly baseBranch: string;
  readonly requests: FakeGitHubRequest[] = [];
  /** Set to make the next merge answer 405, as GitHub does for a merge it will not make. */
  failMerge = false;
  /** Called inside the next merge request, before it merges: a push that lands between the runtime's base check and its merge. */
  beforeNextMerge: (() => void) | null = null;
  readonly #token: string;
  readonly #untracked: ReadonlySet<string>;
  readonly #objects = new Map<string, GitObject>();
  readonly #refs = new Map<string, string>();
  readonly #pulls: Pull[] = [];
  #server: Server | null = null;
  #url = '';

  constructor(options: FakeGitHubOptions) {
    this.repository = options.repository ?? 'conformance/canary';
    this.baseBranch = options.baseBranch ?? 'main';
    this.#token = options.token;
    this.#untracked = new Set(['.git', ...(options.untracked ?? [])]);
  }

  /** The API base an integrator is pointed at. */
  get apiBase(): string {
    return this.#url;
  }

  async start(): Promise<void> {
    const server = createServer((req, res) => {
      this.#handle(req, res).catch((error: unknown) => {
        send(res, 500, { message: error instanceof Error ? error.message : 'error' });
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    this.#server = server;
    this.#url = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  }

  async stop(): Promise<void> {
    const server = this.#server;
    if (server === null) return;
    await new Promise<void>((resolve) => server.close(() => { resolve(); }));
  }

  /** Commits the files under `dir` as the base branch's head, with no parent, and returns its sha. */
  async seed(dir: string): Promise<string> {
    const files = new Map<string, FileEntry>();
    const walk = async (rel: string): Promise<void> => {
      for (const name of await readdir(join(dir, rel))) {
        if (this.#untracked.has(name)) continue;
        const path = rel === '' ? name : `${rel}/${name}`;
        const stat = await lstat(join(dir, path));
        if (stat.isDirectory()) await walk(path);
        else if (stat.isSymbolicLink()) files.set(path, { mode: '120000', bytes: encoder.encode(await readlink(join(dir, path))) });
        else if (stat.isFile()) files.set(path, { mode: '100644', bytes: await readFile(join(dir, path)) });
      }
    };
    await walk('');
    const commit = this.#commit(this.#treeFrom(files), [], 'base');
    this.#refs.set(this.baseBranch, commit);
    return commit;
  }

  /** Moves the base branch to a new commit over the same tree, as a push by someone else would. */
  moveBase(): string {
    const head = this.head(this.baseBranch);
    const tree = (this.#object(head, 'commit')).tree;
    const moved = this.#commit(tree, [head], 'someone else pushed');
    this.#refs.set(this.baseBranch, moved);
    return moved;
  }

  /** Merges a pull request onto its base as it now stands, as a collaborator pressing the button would. */
  mergeAsSomeoneElse(number: number): string {
    const pull = this.#pulls[number - 1];
    if (pull === undefined) throw new Error(`fake GitHub: no pull request #${String(number)}`);
    return this.#merge(pull);
  }

  /** Points a pull request at another base branch, creating it at the current base head if absent. */
  retarget(number: number, base: string): void {
    const pull = this.#pulls[number - 1];
    if (pull === undefined) throw new Error(`fake GitHub: no pull request #${String(number)}`);
    if (!this.#refs.has(base)) this.#refs.set(base, this.head(this.baseBranch));
    pull.base = base;
  }

  head(branch: string): string {
    const sha = this.#refs.get(branch);
    if (sha === undefined) throw new Error(`fake GitHub: no branch ${branch}`);
    return sha;
  }

  hasBranch(branch: string): boolean {
    return this.#refs.has(branch);
  }

  /** Every file in a commit's tree, by path. */
  files(commit: string): Map<string, FileEntry> {
    const out = new Map<string, FileEntry>();
    const walk = (sha: string, prefix: string): void => {
      for (const e of this.#object(sha, 'tree').entries) {
        const path = prefix === '' ? e.name : `${prefix}/${e.name}`;
        if (e.mode === '40000') walk(e.sha, path);
        else out.set(path, { mode: e.mode, bytes: this.#object(e.sha, 'blob').bytes });
      }
    };
    walk(this.#object(commit, 'commit').tree, '');
    return out;
  }

  parents(commit: string): readonly string[] {
    return this.#object(commit, 'commit').parents;
  }

  pulls(): ReadonlyArray<{ number: number; headRef: string; merged: boolean; mergeCommit: string | null }> {
    return this.#pulls.map((p) => ({ number: p.number, headRef: p.headRef, merged: p.mergedAt !== null, mergeCommit: p.mergeCommit }));
  }

  #object<K extends GitObject['type']>(sha: string, type: K): Extract<GitObject, { type: K }> {
    const o = this.#objects.get(sha);
    if (o?.type !== type) throw new NotFound(`no ${type} ${sha}`);
    return o as Extract<GitObject, { type: K }>;
  }

  #blob(bytes: Uint8Array): string {
    const sha = sha1('blob', bytes);
    this.#objects.set(sha, { type: 'blob', bytes });
    return sha;
  }

  #tree(entries: ReadonlyArray<{ name: string; mode: string; sha: string }>): string {
    // Git orders a tree's entries by name, a subtree's name compared as if it ended in '/'.
    const key = (e: { name: string; mode: string }): string => (e.mode === '40000' ? `${e.name}/` : e.name);
    const sorted = [...entries].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
    const body = concat(sorted.flatMap((e) => [encoder.encode(`${e.mode} ${e.name}\0`), Buffer.from(e.sha, 'hex')]));
    const sha = sha1('tree', body);
    this.#objects.set(sha, { type: 'tree', entries: sorted });
    return sha;
  }

  #treeFrom(files: ReadonlyMap<string, { mode: string; sha?: string; bytes?: Uint8Array }>): string {
    interface Dir { files: Map<string, { mode: string; sha: string }>; dirs: Map<string, Dir> }
    const root: Dir = { files: new Map(), dirs: new Map() };
    for (const [path, entry] of files) {
      const parts = path.split('/');
      const name = parts.pop() ?? '';
      let dir = root;
      for (const part of parts) {
        let next = dir.dirs.get(part);
        if (next === undefined) {
          next = { files: new Map(), dirs: new Map() };
          dir.dirs.set(part, next);
        }
        dir = next;
      }
      const sha = entry.sha ?? this.#blob(entry.bytes ?? new Uint8Array());
      dir.files.set(name, { mode: entry.mode, sha });
    }
    const write = (dir: Dir): string => this.#tree([
      ...[...dir.files].map(([name, e]) => ({ name, mode: e.mode, sha: e.sha })),
      ...[...dir.dirs].map(([name, d]) => ({ name, mode: '40000', sha: write(d) })),
    ]);
    return write(root);
  }

  #flat(tree: string): Map<string, { mode: string; sha: string; type: 'blob' | 'tree' }> {
    const out = new Map<string, { mode: string; sha: string; type: 'blob' | 'tree' }>();
    const walk = (sha: string, prefix: string): void => {
      for (const e of this.#object(sha, 'tree').entries) {
        const path = prefix === '' ? e.name : `${prefix}/${e.name}`;
        if (e.mode === '40000') {
          out.set(path, { mode: '040000', sha: e.sha, type: 'tree' });
          walk(e.sha, path);
        } else out.set(path, { mode: e.mode, sha: e.sha, type: 'blob' });
      }
    };
    walk(tree, '');
    return out;
  }

  #commit(tree: string, parents: readonly string[], message: string, who = 'Fake <fake@example.invalid> 0 +0000'): string {
    const text = [`tree ${tree}`, ...parents.map((p) => `parent ${p}`), `author ${who}`, `committer ${who}`, '', message].join('\n');
    const sha = sha1('commit', encoder.encode(text));
    this.#objects.set(sha, { type: 'commit', tree, parents: [...parents], message });
    return sha;
  }

  /** A merge commit of the pull request's head over its base's current head, as `merge_method: 'merge'` makes. */
  #merge(pull: Pull): string {
    const head = this.head(pull.headRef);
    const merged = this.#commit(this.#object(head, 'commit').tree, [this.head(pull.base), head], `Merge pull request #${String(pull.number)}`);
    this.#refs.set(pull.base, merged);
    pull.state = 'closed';
    pull.mergedAt = new Date(0).toISOString();
    pull.mergeCommit = merged;
    return merged;
  }

  #pullView(p: Pull): unknown {
    const [owner] = this.repository.split('/');
    return {
      number: p.number,
      html_url: `https://github.invalid/${this.repository}/pull/${String(p.number)}`,
      state: p.state,
      merged_at: p.mergedAt,
      merge_commit_sha: p.mergeCommit,
      head: { ref: p.headRef, sha: this.#refs.get(p.headRef) ?? '', label: `${owner ?? ''}:${p.headRef}` },
      base: { ref: p.base },
    };
  }

  async #handle(req: IncomingMessage, res: ServerResponse): Promise<true> {
    const url = new URL(req.url ?? '/', 'http://fake.invalid');
    const method = req.method ?? 'GET';
    const authorization = req.headers.authorization ?? null;
    this.requests.push({ method, path: url.pathname, authorization });
    if (authorization !== `Bearer ${this.#token}`) return send(res, 401, { message: 'Bad credentials' });
    const prefix = `/repos/${this.repository}/`;
    if (!url.pathname.startsWith(prefix)) return send(res, 404, { message: 'Not Found' });
    const path = url.pathname.slice(prefix.length);
    const body = method === 'GET' ? null : (JSON.parse(await text(req)) as Record<string, unknown>);
    try {
      return this.#route(method, path, url.searchParams, body, res);
    } catch (error) {
      if (error instanceof NotFound) return send(res, 404, { message: error.message });
      throw error;
    }
  }

  #route(method: string, path: string, query: URLSearchParams, body: Record<string, unknown> | null, res: ServerResponse): true {
    let m: RegExpExecArray | null;
    if (method === 'GET' && (m = /^git\/ref\/heads\/(.+)$/.exec(path)) !== null) {
      const sha = this.#refs.get(m[1] ?? '');
      return sha === undefined ? send(res, 404, { message: 'Not Found' }) : send(res, 200, { ref: `refs/heads/${m[1] ?? ''}`, object: { sha, type: 'commit' } });
    }
    if (method === 'GET' && (m = /^git\/commits\/([0-9a-f]{40})$/.exec(path)) !== null) {
      const c = this.#object(m[1] ?? '', 'commit');
      return send(res, 200, { sha: m[1], tree: { sha: c.tree }, parents: c.parents.map((sha) => ({ sha })) });
    }
    if (method === 'GET' && (m = /^git\/trees\/([0-9a-f]{40})$/.exec(path)) !== null) {
      const sha = m[1] ?? '';
      const tree = query.get('recursive') === null
        ? this.#object(sha, 'tree').entries.map((e) => ({ path: e.name, mode: e.mode === '40000' ? '040000' : e.mode, type: e.mode === '40000' ? 'tree' : 'blob', sha: e.sha }))
        : [...this.#flat(sha)].map(([p, e]) => ({ path: p, ...e }));
      return send(res, 200, { sha, tree, truncated: false });
    }
    if (method === 'POST' && path === 'git/blobs' && body !== null) {
      if (body.encoding !== 'base64' || typeof body.content !== 'string') return send(res, 422, { message: 'bad blob' });
      return send(res, 201, { sha: this.#blob(Buffer.from(body.content, 'base64')) });
    }
    if (method === 'POST' && path === 'git/trees' && body !== null) {
      const files = new Map<string, { mode: string; sha: string }>();
      if (typeof body.base_tree === 'string') {
        for (const [p, e] of this.#flat(body.base_tree)) if (e.type === 'blob') files.set(p, { mode: e.mode, sha: e.sha });
      }
      for (const e of body.tree as Array<{ path: string; mode: string; sha: string | null }>) {
        if (e.sha === null) files.delete(e.path);
        else {
          this.#object(e.sha, 'blob');
          files.set(e.path, { mode: e.mode, sha: e.sha });
        }
      }
      return send(res, 201, { sha: this.#treeFrom(files) });
    }
    if (method === 'POST' && path === 'git/commits' && body !== null) {
      const author = body.author as { name: string; email: string; date: string };
      const who = `${author.name} <${author.email}> ${String(Math.floor(Date.parse(author.date) / 1000))} +0000`;
      this.#object(body.tree as string, 'tree');
      return send(res, 201, { sha: this.#commit(body.tree as string, body.parents as string[], body.message as string, who) });
    }
    if (method === 'POST' && path === 'git/refs' && body !== null) {
      const ref = String(body.ref).replace(/^refs\/heads\//u, '');
      if (this.#refs.has(ref)) return send(res, 422, { message: 'Reference already exists' });
      this.#object(String(body.sha), 'commit');
      this.#refs.set(ref, String(body.sha));
      return send(res, 201, { ref: body.ref, object: { sha: body.sha } });
    }
    if (method === 'GET' && path === 'pulls') {
      const head = query.get('head');
      const [owner] = this.repository.split('/');
      const found = this.#pulls.filter((p) => head === null || head === `${owner ?? ''}:${p.headRef}`);
      return send(res, 200, found.map((p) => this.#pullView(p)));
    }
    if (method === 'POST' && path === 'pulls' && body !== null) {
      const headRef = String(body.head);
      if (!this.#refs.has(headRef)) return send(res, 422, { message: 'head does not exist' });
      const pull: Pull = { number: this.#pulls.length + 1, headRef, base: String(body.base), state: 'open', mergedAt: null, mergeCommit: null };
      this.#pulls.push(pull);
      return send(res, 201, this.#pullView(pull));
    }
    if ((m = /^pulls\/(\d+)(\/merge)?$/.exec(path)) !== null) {
      const pull = this.#pulls[Number(m[1]) - 1];
      if (pull === undefined) return send(res, 404, { message: 'Not Found' });
      if (method === 'GET' && m[2] === undefined) return send(res, 200, this.#pullView(pull));
      if (method === 'PUT' && m[2] !== undefined && body !== null) {
        const head = this.head(pull.headRef);
        if (this.failMerge) return send(res, 405, { message: 'Pull Request is not mergeable' });
        if (pull.mergedAt !== null) return send(res, 405, { message: 'Pull Request is already merged' });
        if (body.sha !== head) return send(res, 409, { message: 'Head branch was modified' });
        const before = this.beforeNextMerge;
        this.beforeNextMerge = null;
        before?.();
        return send(res, 200, { merged: true, sha: this.#merge(pull), message: 'Pull Request successfully merged' });
      }
    }
    return send(res, 404, { message: `no route ${method} ${path}` });
  }
}

class NotFound extends Error {}

/** Answers, and returns true so a route can end with `return send(...)`. */
function send(res: ServerResponse, status: number, body: unknown): true {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
  return true;
}

async function text(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/** A fake GitHub seeded from `dir`, started, and stopped after `body`. */
export async function withFakeGitHub<T>(dir: string, options: FakeGitHubOptions, body: (github: FakeGitHub, base: string) => Promise<T>): Promise<T> {
  const github = new FakeGitHub(options);
  await github.start();
  try {
    return await body(github, await github.seed(dir));
  } finally {
    await github.stop();
  }
}
