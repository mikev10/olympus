/**
 * The trees a run is built over, owned by the runtime and by nothing else
 * (D-P6-02). A task never runs over `run.repo`, the author's working copy:
 *
 * - at admission the working tree is snapshotted as the run's **base**, and
 *   its digest is recorded in the admission record;
 * - each build attempt gets a pristine **start** tree, base plus the diff
 *   accepted so far, and a **work** copy of it, which is what is mounted;
 * - when the task has ended its **own diff** is `work` against `start`,
 *   compared in process by the adapters' `diffTrees` — never by `git`, whose
 *   repository config an agent can write (D-P8-04);
 * - verification runs over a **tree** built from base and the cumulative
 *   diff, content-addressed by that diff's digest, and the next task starts
 *   from the latest one that passed.
 *
 * The diff is the only channel from a task to anything after it. A write it
 * does not carry does not propagate, whatever a driver reports, and `.git` is
 * copied into every workspace and excluded from every diff, so nothing
 * written under it outlives the task.
 *
 * Nothing here is mounted except a `work` copy (rw, to one task) and a tree or
 * a review view (ro). The base, the start copies, and the store's root are
 * never mounted anywhere.
 */
import { createHash } from 'node:crypto';
import { copyFile, cp, lstat, mkdir, readlink, rename, rm, symlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { diffTrees, hashRegularFile, walkTree, type WalkOptions } from '@olympus-ai/adapters';
import type { RunId, TaskId } from '@olympus-ai/core';
import type { DiffEntry } from '@olympus-ai/vault';

/** Who a container runs as, and so who every workspace the store hands out must be writable by. */
export interface ContainerUser {
  readonly uid: number;
  readonly gid: number;
}

export interface WorkspaceStore {
  /** Absolute. Outside every mount, outside the Vault, and outside every run's workspace. */
  readonly root: string;
  readonly user: ContainerUser;
}

/** The directory names no diff enters. What is under one is copied into a workspace and never leaves it. */
const EXCLUDED = '.git';

const WALK: WalkOptions = { skipDirectory: () => false };
const DIFF_WALK: WalkOptions = { skipDirectory: (name) => name === EXCLUDED };

function excluded(path: string): boolean {
  return path === EXCLUDED || path.startsWith(`${EXCLUDED}/`) || path.includes(`/${EXCLUDED}/`) || path.endsWith(`/${EXCLUDED}`);
}

/**
 * A store over a directory the runtime owns. On a host with uids the user is
 * the runtime's own, because that is who the copies it makes are writable
 * by; naming any other is refused, since making a tree writable by another
 * uid takes either root or a world-write bit. On a host without uids there is
 * nothing to derive it from, so it must be given (I5).
 */
export function localWorkspaceStore(options: { readonly root: string; readonly user?: ContainerUser }): WorkspaceStore {
  if (!isAbsolute(options.root)) throw new Error(`workspace store: root must be an absolute path, not ${options.root}`);
  const own = process.getuid !== undefined && process.getgid !== undefined ? { uid: process.getuid(), gid: process.getgid() } : undefined;
  const user = options.user ?? own;
  if (user === undefined) {
    throw new Error('workspace store: this host has no uids to derive a container user from, so one must be given');
  }
  if (own !== undefined && (user.uid !== own.uid || user.gid !== own.gid)) {
    throw new Error(
      `workspace store: copies are made by uid ${String(own.uid)} gid ${String(own.gid)}, so a container running as ` +
        `${String(user.uid)}:${String(user.gid)} could not write them; refused rather than made world-writable`,
    );
  }
  return { root: resolve(options.root), user: { uid: user.uid, gid: user.gid } };
}

/** Whether `inner` is `outer` or lies beneath it. */
export function within(outer: string, inner: string): boolean {
  const path = relative(resolve(outer), resolve(inner));
  return path === '' || (!isAbsolute(path) && path.split(sep)[0] !== '..');
}

function runDir(store: WorkspaceStore, runId: RunId): string {
  return join(store.root, runId);
}

export function basePath(store: WorkspaceStore, runId: RunId): string {
  return join(runDir(store, runId), 'base');
}

export function attemptPaths(store: WorkspaceStore, runId: RunId, task: TaskId, iteration: number): { start: string; work: string } {
  const dir = join(runDir(store, runId), 'tasks', `${task}.${String(iteration)}`);
  return { start: join(dir, 'start'), work: join(dir, 'work') };
}

export function treePath(store: WorkspaceStore, runId: RunId, diffSha256: string): string {
  return join(runDir(store, runId), 'trees', diffSha256);
}

export function reviewPath(store: WorkspaceStore, runId: RunId, task: TaskId, iteration: number): string {
  return join(runDir(store, runId), 'review', `${task}.${String(iteration)}`);
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** What a diff entry records for an entry's content: a file's bytes, or a link's text. */
async function contentHash(absolute: string): Promise<string> {
  const facts = await lstat(absolute);
  if (facts.isSymbolicLink()) return sha256(`symlink:${await readlink(absolute)}`);
  if (facts.isFile()) return hashRegularFile(absolute);
  throw new Error(`workspace: ${absolute} is neither a file nor a link, and a special file cannot be carried by a diff`);
}

async function present(absolute: string): Promise<boolean> {
  try {
    await lstat(absolute);
    return true;
  } catch {
    return false;
  }
}

/**
 * The first parent of `path` under `root` that is a link, or undefined. A
 * diff path names an entry *in* the tree, and a path beneath a link names
 * whatever the link points at, which may be anywhere on the host. The walk
 * that collects a diff never follows a link, so no honest entry lies beneath
 * one (codex-1).
 */
async function linkedParent(root: string, path: string): Promise<string | undefined> {
  const parts = path.split('/');
  for (let i = 1; i < parts.length; i++) {
    const facts = await lstat(join(root, ...parts.slice(0, i))).catch(() => null);
    // An absent parent has nothing beneath it, through a link or otherwise.
    if (facts === null) return undefined;
    if (facts.isSymbolicLink()) return parts.slice(0, i).join('/');
  }
  return undefined;
}

/** Refuses an operation on `path` in `root` that would pass through a link to reach it (I5). */
async function refuseLinkedParent(root: string, path: string, doing: string): Promise<void> {
  const link = await linkedParent(root, path);
  if (link !== undefined) {
    throw new Error(`workspace: refusing to ${doing} ${path}, because its parent ${link} is a link and the path would resolve outside the tree`);
  }
}

/** The content hash of `path` in `root`, or null when it is absent there. A path beneath a link is absent: what it reaches is not in the tree. */
async function hashIn(root: string, path: string): Promise<string | null> {
  if ((await linkedParent(root, path)) !== undefined) return null;
  const absolute = join(root, ...path.split('/'));
  return (await present(absolute)) ? contentHash(absolute) : null;
}

/** A digest of every entry under `root`: its path, its kind, and its content. */
export async function treeDigest(root: string): Promise<string> {
  const entries = await walkTree(root, WALK);
  const hash = createHash('sha256');
  for (const path of [...entries.keys()].sort()) {
    const entry = entries.get(path);
    // Every key came from the map just walked.
    if (entry === undefined) continue;
    if (entry.kind === 'other') throw new Error(`workspace: ${path} is a special file, which cannot be hashed and so cannot be part of a base`);
    hash.update(`${entry.kind}\0${path}\0${await contentHash(entry.absolute)}\n`);
  }
  return hash.digest('hex');
}

/** The digest a bundle records for a diff: over its entries, sorted by path. */
export function diffDigest(diff: readonly DiffEntry[]): string {
  const sorted = [...diff].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return sha256(JSON.stringify(sorted.map(({ path, change, sha256: content }) => [path, change, content])));
}

/**
 * Copies `source` in as the run's base and returns its digest. A run that
 * already has a base is refused: a second snapshot would replace the tree the
 * admission record's digest names.
 */
export async function snapshotBase(store: WorkspaceStore, runId: RunId, source: string): Promise<string> {
  const base = basePath(store, runId);
  if (await present(base)) {
    throw new Error(`workspace: run ${runId} already has a base at ${base}; refusing to replace it`);
  }
  await mkdir(dirname(base), { recursive: true, mode: 0o700 });
  await cp(source, base, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
  return treeDigest(base);
}

/** Removes everything the store holds for a run. For a run refused after its base was taken, so a refusal leaves nothing behind. */
export async function discardRun(store: WorkspaceStore, runId: RunId): Promise<void> {
  await rm(runDir(store, runId), { recursive: true, force: true });
}

/** A task's own diff: every path outside `.git` whose content differs between the tree it was handed and the tree it left. */
export async function ownDiff(start: string, work: string): Promise<DiffEntry[]> {
  const changes = await diffTrees(start, work, (path) => !excluded(path), DIFF_WALK);
  const entries: DiffEntry[] = [];
  for (const { path, change } of changes) {
    entries.push({ path, change, sha256: change === 'removed' ? null : await contentHash(join(work, ...path.split('/'))) });
  }
  return entries;
}

/**
 * Folds a task's own diff into the cumulative diff accepted before it, both
 * relative to base. A path the task returned to its base content leaves the
 * cumulative diff, so a tree built from base and the result is the tree the
 * task left.
 */
export async function composeDiff(base: string, accepted: readonly DiffEntry[], own: readonly DiffEntry[]): Promise<DiffEntry[]> {
  const byPath = new Map(accepted.map((entry) => [entry.path, entry]));
  for (const entry of own) {
    const atBase = await hashIn(base, entry.path);
    if (entry.sha256 === null) {
      if (atBase === null) byPath.delete(entry.path);
      else byPath.set(entry.path, { path: entry.path, change: 'removed', sha256: null });
    } else if (atBase === entry.sha256) {
      byPath.delete(entry.path);
    } else {
      byPath.set(entry.path, { path: entry.path, change: atBase === null ? 'added' : 'modified', sha256: entry.sha256 });
    }
  }
  return [...byPath.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * Builds `target` from base and a cumulative diff. The bytes for each changed
 * path come from `sourceOf(path)`, and each is hashed where it lands and held
 * to the diff: a source that changed after the diff was taken is refused,
 * never copied as if it had not.
 *
 * The tree is built beside `target` and moved into place only when it is
 * whole, because a source may be `target` itself: a task that changed
 * nothing has the cumulative diff of the task before it, and so the same
 * content-addressed tree.
 */
export async function materialize(
  store: WorkspaceStore, runId: RunId, target: string, diff: readonly DiffEntry[], sourceOf: (path: string) => string,
): Promise<void> {
  const building = `${target}.building`;
  await rm(building, { recursive: true, force: true });
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await cp(basePath(store, runId), building, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
  await apply(building, diff, sourceOf);
  await rm(target, { recursive: true, force: true });
  await rename(building, target);
}

async function apply(target: string, diff: readonly DiffEntry[], sourceOf: (path: string) => string): Promise<void> {
  // Each operation is checked where it lands, at the moment it runs: an earlier entry can put a
  // link where a later entry's parent is.
  for (const entry of diff) {
    if (entry.sha256 !== null) continue;
    await refuseLinkedParent(target, entry.path, 'remove');
    await rm(join(target, ...entry.path.split('/')), { recursive: true, force: true });
  }
  for (const entry of diff) {
    if (entry.sha256 === null) continue;
    await refuseLinkedParent(target, entry.path, 'write');
    await refuseLinkedParent(sourceOf(entry.path), entry.path, 'read');
    const destination = join(target, ...entry.path.split('/'));
    const source = join(sourceOf(entry.path), ...entry.path.split('/'));
    await rm(destination, { recursive: true, force: true });
    await mkdir(dirname(destination), { recursive: true });
    const facts = await lstat(source);
    if (facts.isSymbolicLink()) await symlink(await readlink(source), destination);
    else if (facts.isFile()) await copyFile(source, destination);
    else throw new Error(`workspace: ${entry.path} is neither a file nor a link in its source, so it cannot be carried`);
    const landed = await contentHash(destination);
    if (landed !== entry.sha256) {
      throw new Error(`workspace: ${entry.path} is ${landed} where it landed and ${entry.sha256} in the diff; its source changed after the diff was taken`);
    }
  }
}

/** A fresh copy of `source` at `target`. */
export async function copyTree(source: string, target: string): Promise<void> {
  await rm(target, { recursive: true, force: true });
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await cp(source, target, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
}

/** The content hash of one path in a tree, or null when it is absent. */
export async function hashAt(tree: string, path: string): Promise<string | null> {
  return hashIn(tree, path);
}

/**
 * A fresh tree at `target` holding only `paths`, each copied from `source`
 * and skipped where `source` does not have it.
 */
export async function copyOnly(source: string, target: string, paths: readonly string[]): Promise<void> {
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true, mode: 0o700 });
  for (const path of paths) {
    await refuseLinkedParent(source, path, 'read');
    await refuseLinkedParent(target, path, 'write');
    const from = join(source, ...path.split('/'));
    if (!(await present(from))) continue;
    const to = join(target, ...path.split('/'));
    await mkdir(dirname(to), { recursive: true });
    const facts = await lstat(from);
    if (facts.isSymbolicLink()) await symlink(await readlink(from), to);
    else if (facts.isFile()) await copyFile(from, to);
    else throw new Error(`workspace: ${path} is neither a file nor a link, so it cannot be put in a view`);
  }
}
