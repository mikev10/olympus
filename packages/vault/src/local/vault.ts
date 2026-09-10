/**
 * LocalVault: the Vault contract over the local filesystem.
 *
 * Files, not a database. An evidence bundle, a lock manifest, and a violation
 * are written once and never edited, and the claim this runtime makes is that
 * an auditor can verify one *without trusting the tool that produced it*: the
 * bytes on disk are exactly the bytes that were hashed, so `sha256sum` over an
 * object file reproduces the hash in its name with no Olympus and no schema in
 * the way. A row inside an opaque database would put the tool back in the
 * trust path.
 *
 * Nothing here compares-then-writes. Every record that must not be silently
 * overwritten is created with the `wx` flag, so the filesystem arbitrates and
 * the loser gets `EEXIST`. Hand-rolled concurrency is this file's real risk:
 * the exclusive create is the only reason the race is safe, and any change
 * that reads a version, decides, and then writes reintroduces the lost update
 * that `I5.stale-commit-is-refused-under-contention` exists to catch.
 *
 * Two roots, never one. `store` is what the Vault owns; `artifacts` is the
 * tree a locked path resolves against, which is the tree an agent can write.
 * Collapsing them would place the Vault inside the workspace, which is the
 * arrangement I1 exists to prevent, so the constructor refuses a nested pair.
 *
 * Every cross-file import below is type-only. That is load-bearing, not
 * incidental: it keeps the module free of run-time coupling to any sibling
 * package, which is what lets a child process load this file directly and
 * contend on the real `commitRunState` rather than on a re-implementation of
 * it (`I5.stale-commit-is-refused-under-contention`).
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, posix, relative, resolve, win32 } from 'node:path';
import type { RunId, RunState, StationId, VaultRef, VaultRefKind } from '@olympus-ai/core';
import type { IntegrityViolation } from '@olympus-ai/integrity';
import type { EvidenceBundle, LockEntry, LockManifest, LockVerdict, Vault } from '../types.js';

/** Reported as `actual` for a locked path that no longer exists: a deleted artifact is a mismatch, not an empty file (D-S1-02). */
const MISSING = 'missing';

/**
 * Reported as `actual` for a locked path that now resolves outside the
 * artifact root. Replacing a locked file with a symlink to somewhere else is a
 * tamper, and reporting it as one keeps it on the path that records a
 * violation and refuses, rather than throwing past it.
 */
const ESCAPED = 'escaped';

/**
 * Reported as `actual` for a locked path that is present but cannot be read
 * as bytes: replaced by a directory (EISDIR), a symlink loop (ELOOP), or a
 * file whose permissions were removed (EACCES).
 *
 * A sentinel rather than a thrown error, because D-S1-15 records exactly this
 * shape: an exception that happens to stop a run is not a control. It holds
 * only until someone adds a catch, and it ends the run with no violation
 * recorded and the state left mid-flight. An artifact that cannot be read is
 * not the artifact that was locked, so it is a mismatch like any other, and
 * the line records it and refuses.
 */
const UNREADABLE = 'unreadable';

/** A run state version, and the name of the file that holds it. Zero means "nothing committed yet" and is never a file. */
const VERSION = /^(0|[1-9][0-9]*)$/;

const NUMBERED_JSON = /^(0|[1-9][0-9]*)\.json$/;

/**
 * A run id becomes a directory name. Anything that could climb out of the
 * store (`..`, a separator, a drive letter) is refused rather than sanitised:
 * a caller that can steer a write out of the store is the write path I1 denies.
 */
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const KINDS: readonly VaultRefKind[] = [
  'spec', 'acceptance-tests', 'task-graph', 'lock-manifest', 'policy',
  'verification-manifest', 'evidence', 'violation', 'run-state', 'rubric', 'learning',
];

export interface VaultRoots {
  /** What the Vault owns. Never inside `artifacts`, and never the same directory. */
  readonly store: string;
  /** What a locked path resolves against: the tree holding the artifacts. */
  readonly artifacts: string;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

function isAbsent(error: unknown): boolean {
  return hasCode(error, 'ENOENT') || hasCode(error, 'ENOTDIR');
}

/** True when `child` is `parent` or sits beneath it. */
function contains(parent: string, child: string): boolean {
  const step = relative(parent, child);
  return step === '' || (!step.startsWith('..') && !posix.isAbsolute(step) && !win32.isAbsolute(step));
}

function requireRunId(runId: string): string {
  if (!RUN_ID.test(runId) || runId === '.' || runId === '..') {
    throw new Error(`LocalVault: '${runId}' is not a usable run id; a run id names a directory and must match ${String(RUN_ID)}`);
  }
  return runId;
}

function runDir(store: string, runId: string): string {
  return join(store, 'runs', requireRunId(runId));
}

/**
 * Creates `file` only if it does not exist. Returns false when it already
 * does. The `wx` flag is the concurrency control for every record in this
 * store: it is one filesystem operation, so two writers cannot both succeed.
 */
async function createExclusive(file: string, bytes: Uint8Array): Promise<boolean> {
  await mkdir(dirname(file), { recursive: true });
  try {
    await writeFile(file, bytes, { flag: 'wx' });
    return true;
  } catch (error) {
    if (hasCode(error, 'EEXIST')) return false;
    throw error;
  }
}

/** The numbers of the `<n>.json` files in `dir`, ascending. An absent directory has none. */
async function numbersIn(dir: string): Promise<number[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if (isAbsent(error)) return [];
    throw error;
  }
  const numbers: number[] = [];
  for (const name of names) {
    const digits = NUMBERED_JSON.exec(name)?.[1];
    if (digits !== undefined) numbers.push(Number(digits));
  }
  return numbers.sort((a, b) => a - b);
}

/**
 * The highest `<n>.json` in `dir`, or null when there is none. Derived by
 * scanning rather than read from a pointer file: a pointer written after the
 * record it points at is a second, non-atomic step, and a writer that dies
 * between the two would leave a record no reader can see and a version no
 * writer can take.
 */
async function highestIn(dir: string): Promise<number | null> {
  const numbers = await numbersIn(dir);
  return numbers.at(-1) ?? null;
}

async function readJson(file: string): Promise<unknown> {
  const text = await readFile(file, 'utf8');
  const parsed: unknown = JSON.parse(text);
  return parsed;
}

function encode(record: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(record));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasString(value: Record<string, unknown>, key: string): boolean {
  return typeof value[key] === 'string';
}

/**
 * Every field a consumer reads without checking, checked here. A record that
 * satisfies part of the shape is refused rather than returned: a state whose
 * `evidenceRefs` is absent survives this function and then throws `is not
 * iterable` in whichever caller spreads it, which turns a corrupt store into
 * a crash somewhere else entirely. Found by the P1 external review, finding 2.
 */
function requireRunState(value: unknown, file: string): RunState {
  const ok =
    isRecord(value) &&
    hasString(value, 'runId') && hasString(value, 'station') && hasString(value, 'version') &&
    isRecord(value.tasks) && !Array.isArray(value.tasks) &&
    Array.isArray(value.evidenceRefs) && Array.isArray(value.violations);
  if (!ok) throw new Error(`LocalVault: ${file} does not hold a run state; refusing to return a partial record`);
  return value as unknown as RunState;
}

function isLockEntry(value: unknown): boolean {
  return isRecord(value) && hasString(value, 'path') && hasString(value, 'sha256') && hasString(value, 'lockedAt') && hasString(value, 'lockedBy');
}

/** As above: an entry list whose elements are not entries is refused here, not resolved as a path later. */
function requireManifest(value: unknown, file: string): LockManifest {
  const ok = isRecord(value) && hasString(value, 'runId') && Array.isArray(value.entries) && value.entries.every(isLockEntry);
  if (!ok) throw new Error(`LocalVault: ${file} does not hold a lock manifest; refusing to report on an unreadable one`);
  return value as unknown as LockManifest;
}

/**
 * Locked paths are artifact-root-relative. An absolute path or a `..` segment
 * would let the Vault and any later reader name different files, which is the
 * shape D-S1-15 records; symlink containment is resolved separately, at hash
 * time, because a path can become an escape after it was locked.
 */
function refuseUnusablePaths(runId: string, paths: readonly string[]): void {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    if (path === '') {
      problems.push('an empty path');
      continue;
    }
    if (posix.isAbsolute(path) || win32.isAbsolute(path) || /^[A-Za-z]:/.test(path)) {
      problems.push(`'${path}' is absolute; locked paths are relative to the artifact root`);
    }
    if (path.split(/[\\/]/).includes('..')) {
      problems.push(`'${path}' contains a '..' segment and could leave the artifact root`);
    }
    if (seen.has(path)) problems.push(`'${path}' is listed twice`);
    seen.add(path);
  }
  if (problems.length > 0) {
    throw new Error(`LocalVault: refusing to lock for run ${runId}: ${problems.join('; ')}`);
  }
}

/**
 * The SHA-256 of a locked artifact, or a sentinel saying why there is none.
 * `realpath` is what closes the symlink case: a locked file swapped for a link
 * out of the tree resolves outside the artifact root and is reported as a
 * tamper rather than silently hashed.
 */
async function artifactRoot(artifacts: string): Promise<string> {
  try {
    return await realpath(artifacts);
  } catch (error) {
    throw new Error(
      `LocalVault: the artifact root ${artifacts} cannot be resolved, so no locked path can be verified against it`,
      { cause: error },
    );
  }
}

/**
 * The SHA-256 of a locked artifact, or a sentinel saying why there is none.
 * Resolving the real path is what closes the symlink case: a locked file
 * swapped for a link out of the tree resolves outside the root and is
 * reported as a tamper rather than silently hashed.
 *
 * No failure here throws. Every way of failing to resolve or read the
 * artifact is a mismatch the caller records and refuses on, because a locked
 * artifact the runtime cannot read is not the locked artifact. The root is
 * resolved once by the caller: it is the same for every entry, and losing it
 * is an operational failure rather than a verdict about one path.
 */
async function hashArtifact(root: string, path: string): Promise<string> {
  const target = resolve(root, path);
  let real: string;
  try {
    real = await realpath(target);
  } catch (error) {
    return isAbsent(error) ? MISSING : UNREADABLE;
  }
  if (!contains(root, real)) return ESCAPED;
  try {
    return sha256(await readFile(real));
  } catch (error) {
    return isAbsent(error) ? MISSING : UNREADABLE;
  }
}

function objectFile(store: string, ref: VaultRef): string {
  if (!KINDS.includes(ref.kind)) throw new Error(`LocalVault: '${ref.kind}' is not a Vault reference kind`);
  if (!/^[0-9a-f]{64}$/.test(ref.hash)) throw new Error(`LocalVault: '${ref.hash}' is not a SHA-256 digest`);
  return join(runDir(store, ref.runId), 'objects', ref.kind, `${ref.hash}.json`);
}

/**
 * Stores a record under its own SHA-256. Writing the same bytes twice for the
 * same run and kind yields the same reference and leaves the first copy in
 * place: the object is the hash of its content, so a second write has nothing
 * to change (D-S1-03).
 */
async function storeObject(store: string, runId: RunId, kind: VaultRefKind, record: unknown): Promise<VaultRef> {
  const bytes = encode(record);
  const ref: VaultRef = { runId, kind, hash: sha256(bytes) };
  await createExclusive(objectFile(store, ref), bytes);
  return ref;
}

export class LocalVault implements Vault {
  readonly #store: string;
  readonly #artifacts: string;

  constructor(roots: VaultRoots) {
    const store = resolve(roots.store);
    const artifacts = resolve(roots.artifacts);
    if (contains(store, artifacts) || contains(artifacts, store)) {
      throw new Error(
        `LocalVault: the store (${store}) and the artifact root (${artifacts}) overlap. The artifact root is the tree ` +
          'an agent writes; a store inside it, or holding it, is a Vault an agent can reach, which is exactly what I1 denies.',
      );
    }
    this.#store = store;
    this.#artifacts = artifacts;
  }

  async read(ref: VaultRef): Promise<Uint8Array> {
    try {
      return await readFile(objectFile(this.#store, ref));
    } catch (error) {
      if (isAbsent(error)) throw new Error(`LocalVault: no ${ref.kind} ${ref.hash} for run ${ref.runId}`, { cause: error });
      throw error;
    }
  }

  /**
   * Adds to the run's manifest; never replaces it. `spec` locks the spec and
   * `test-design` locks the acceptance tests, and I3 requires both still
   * verified at every later transition, so a later lock that dropped the
   * earlier one would make the invariant unsatisfiable. An already-locked path
   * is refused rather than re-hashed: re-locking is how a tamper would launder
   * itself, and the station and instant of the first lock are the audit record.
   */
  async lock(runId: RunId, paths: string[], by: StationId): Promise<LockManifest> {
    if (paths.length === 0) {
      throw new Error(`LocalVault: refusing to lock nothing for run ${runId}; an empty manifest would verify as intact`);
    }
    refuseUnusablePaths(runId, paths);

    const locks = join(runDir(this.#store, runId), 'locks');
    const generation = await highestIn(locks);
    const existing: LockEntry[] =
      generation === null ? [] : [...requireManifest(await readJson(join(locks, `${String(generation)}.json`)), `${String(generation)}.json`).entries];

    const already = paths.filter((path) => existing.some((entry) => entry.path === path));
    if (already.length > 0) {
      const held = already.map((path) => {
        const entry = existing.find((e) => e.path === path);
        return `'${path}' (locked at ${entry === undefined ? 'an earlier station' : entry.lockedBy})`;
      });
      throw new Error(
        `LocalVault: refusing to lock ${held.join(', ')} again for run ${runId}. An artifact is fixed from its first ` +
          'lock; re-locking would rebase its hash onto whatever the bytes are now.',
      );
    }

    const root = await artifactRoot(this.#artifacts);
    const lockedAt = new Date().toISOString();
    const added: LockEntry[] = [];
    for (const path of paths) {
      const hash = await hashArtifact(root, path);
      if (hash === MISSING) throw new Error(`LocalVault: cannot lock ${path} for run ${runId}: no such file under ${this.#artifacts}`);
      if (hash === ESCAPED) throw new Error(`LocalVault: cannot lock ${path} for run ${runId}: it resolves outside ${this.#artifacts}`);
      if (hash === UNREADABLE) throw new Error(`LocalVault: cannot lock ${path} for run ${runId}: it exists but cannot be read as bytes`);
      added.push({ path, sha256: hash, lockedAt, lockedBy: by });
    }

    const manifest: LockManifest = { runId, entries: [...existing, ...added] };
    const next = (generation ?? 0) + 1;
    if (!(await createExclusive(join(locks, `${String(next)}.json`), encode(manifest)))) {
      throw new Error(
        `LocalVault: another writer locked generation ${String(next)} for run ${runId} first; nothing was stored. ` +
          'Re-read the manifest and lock again.',
      );
    }
    return manifest;
  }

  async verifyLocks(runId: RunId): Promise<LockVerdict> {
    const locks = join(runDir(this.#store, runId), 'locks');
    const generation = await highestIn(locks);
    if (generation === null) {
      throw new Error(`LocalVault: nothing is locked for run ${runId}; refusing to report intact`);
    }
    const file = join(locks, `${String(generation)}.json`);
    const manifest = requireManifest(await readJson(file), file);

    const root = await artifactRoot(this.#artifacts);
    const tampered: Array<{ path: string; expected: string; actual: string }> = [];
    for (const entry of manifest.entries) {
      const actual = await hashArtifact(root, entry.path);
      if (actual !== entry.sha256) tampered.push({ path: entry.path, expected: entry.sha256, actual });
    }
    return tampered.length === 0 ? { ok: true } : { ok: false, tampered };
  }

  writeEvidence(b: EvidenceBundle): Promise<VaultRef> {
    return storeObject(this.#store, b.runId, 'evidence', b);
  }

  recordViolation(v: IntegrityViolation): Promise<VaultRef> {
    return storeObject(this.#store, v.runId, 'violation', v);
  }

  async readRunState(runId: RunId): Promise<RunState> {
    const states = join(runDir(this.#store, runId), 'state');
    const version = await highestIn(states);
    if (version === null) throw new Error(`LocalVault: no run state for ${runId}`);
    const file = join(states, `${String(version)}.json`);
    return requireRunState(await readJson(file), file);
  }

  /**
   * Compare-and-swap, arbitrated by the filesystem. The next version's file is
   * created with `wx`, so of any number of writers holding the same
   * `ifVersion` exactly one creates it and the rest are refused with `EEXIST`.
   * There is deliberately no read-then-compare here: that shape loses an
   * update whenever two writers interleave between the read and the write, and
   * it passes a sequential test while doing so.
   *
   * `ifVersion` is authoritative and `s.version` is ignored; the contract left
   * the choice to this unit (D-S1, S1 spec section 2). The precondition below
   * is an extra refusal, not the concurrency control: it rejects a version
   * that never existed, so a caller cannot jump the run forward and leave a
   * hole in its history.
   */
  async commitRunState(s: RunState, ifVersion: string): Promise<RunState> {
    if (!VERSION.test(ifVersion)) {
      throw new Error(`LocalVault: '${ifVersion}' is not a run state version`);
    }
    const states = join(runDir(this.#store, s.runId), 'state');
    const current = Number(ifVersion);
    if (!Number.isSafeInteger(current)) throw new Error(`LocalVault: run state version ${ifVersion} is out of range`);

    const held = await highestIn(states);
    if (current === 0 ? held !== null : held === null || held < current) {
      const at = held === null ? 'no committed state' : `version ${String(held)}`;
      throw new Error(`LocalVault: run ${s.runId} has ${at}, so version ${ifVersion} was never current; nothing stored`);
    }

    const next = String(current + 1);
    const stored: RunState = { ...s, version: next };
    if (!(await createExclusive(join(states, `${next}.json`), encode(stored)))) {
      throw new Error(
        `LocalVault: run ${s.runId} has already moved past version ${ifVersion}; another writer committed ${next} first. ` +
          'Nothing was stored. Re-read the state and commit again.',
      );
    }
    return stored;
  }
}
