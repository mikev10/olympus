/**
 * Support for the registry assertions that exercise the real Vault (P1).
 *
 * The Vault is reached through the same published-entry map the fixtures
 * typecheck against, so the conformance package keeps no `package.json`
 * dependency on it and no workspace cycle forms (D-F3-04, and the precedent
 * `I5.unsafe-component-refused-above-l1` set in S1).
 *
 * Two roots, never one. The store holds what the Vault owns; the artifact
 * root is what a locked path resolves against and is the tree an agent can
 * write. Handing both jobs to one directory would put the Vault inside the
 * workspace, which is the arrangement I1 exists to prevent, so every helper
 * here keeps them apart and `LocalVault` refuses a nested pair outright.
 */
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { LocalVault } from '@olympus-ai/vault';
import { workspaceRoot } from '../kit/workspace.js';

export interface VaultDirs {
  /** What the Vault owns. Never inside `artifacts`. */
  readonly store: string;
  /** What a locked path resolves against: the tree holding the artifacts. */
  readonly artifacts: string;
}

/** A fresh store and artifact root under one base, removed when `body` settles. */
export async function withVaultDirs<T>(prefix: string, body: (dirs: VaultDirs, base: string) => Promise<T>): Promise<T> {
  const base = await mkdtemp(join(tmpdir(), prefix));
  const dirs: VaultDirs = { store: join(base, 'vault'), artifacts: join(base, 'workspace') };
  await mkdir(dirs.store, { recursive: true });
  await mkdir(dirs.artifacts, { recursive: true });
  try {
    return await body(dirs, base);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

/** The same, with a `LocalVault` already open over the two roots. `base` holds both, and is the place to build a tree that is deliberately outside the artifact root. */
export async function withVault<T>(
  prefix: string,
  body: (vault: LocalVault, dirs: VaultDirs, base: string) => Promise<T>,
): Promise<T> {
  return withVaultDirs(prefix, async (dirs, base) => {
    const { LocalVault: Ctor } = await import('@olympus-ai/vault');
    return body(new Ctor(dirs), dirs, base);
  });
}

/**
 * How a contained path is made to resolve outside the tree. Windows grants a
 * directory junction without elevation and withholds a file symlink; POSIX has
 * no junctions and takes the file symlink, which is the more direct form of
 * the substitution. Both reach the same `realpath` containment check.
 *
 * Chosen by platform, never skipped, and never wrapped in a catch: if a
 * platform's own mechanism cannot be created, the assertion fails there. A
 * containment check that silently goes unexercised on a platform is worse than
 * no check at all. The mechanism appears in the assertion's title so a CI log
 * says which one ran instead of leaving it to be assumed.
 */
export const ESCAPE_MECHANISM: 'junction' | 'symlink' = process.platform === 'win32' ? 'junction' : 'symlink';

/**
 * The implementation module a contending child loads.
 *
 * Not the package entry: `src/index.ts` re-exports `./types.js` at run time
 * and Node's type stripping does not rewrite a `.js` specifier to the `.ts`
 * file beside it, so the entry is unloadable outside a bundler. The
 * implementation module is loadable because every cross-file import in it is
 * type-only and therefore erased. That is a standing requirement on the file,
 * not an accident: it is what lets this assertion contend on the real
 * `commitRunState` instead of a re-implementation of it.
 */
export function vaultModuleUrl(): string {
  return pathToFileURL(join(workspaceRoot(), 'packages', 'vault', 'src', 'local', 'vault.ts')).href;
}

/**
 * Plain JavaScript, written to the temp directory and run by a child process.
 * Each child spins to a shared wall-clock deadline before committing, so the
 * writes genuinely overlap; without the barrier the children commit in
 * whatever order they finish booting and the race never happens.
 */
const CONTENDER_SOURCE = `const [moduleUrl, store, artifacts, runId, ifVersion, startAt, tag] = process.argv.slice(2);
const { LocalVault } = await import(moduleUrl);
const vault = new LocalVault({ store, artifacts });
// The tag makes this child's bytes identifiable, so the caller can prove the
// state that landed is one winner's whole record and not a blend of several.
const state = { runId, station: 'spec', tasks: { [tag]: 'pending' }, evidenceRefs: [], violations: [], version: ifVersion };
while (Date.now() < Number(startAt)) { /* spin: sleeping to a deadline wakes the children in sequence */ }
try {
  const stored = await vault.commitRunState(state, ifVersion);
  process.stdout.write(JSON.stringify({ ok: true, tag, version: stored.version }));
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, tag, message: String((error && error.message) || error) }));
}
`;

export interface CommitOutcome {
  readonly ok: boolean;
  /** Which child this was; it appears as the sole key of the state's `tasks`. */
  readonly tag: string;
  /** The version the child stored, when it won. */
  readonly version: string | null;
  /** Why it was refused, when it lost. */
  readonly message: string;
}

interface ChildRun {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number | null;
}

function runChild(script: string, args: readonly string[]): Promise<ChildRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => (stdout += chunk));
    child.stderr.on('data', (chunk: string) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ stdout, stderr, code });
    });
  });
}

function parseOutcome(run: ChildRun): CommitOutcome {
  if (run.code !== 0 || run.stdout === '') {
    throw new Error(
      `a contending child exited ${String(run.code)} without printing an outcome. If it failed to load the module, ` +
        `this Node build is not stripping types from the Vault implementation.\n${run.stderr.trim()}`,
    );
  }
  const value: unknown = JSON.parse(run.stdout);
  if (typeof value !== 'object' || value === null || !('ok' in value) || typeof value.ok !== 'boolean') {
    throw new Error(`a contending child printed something that is not a commit outcome: ${run.stdout}`);
  }
  return {
    ok: value.ok,
    tag: 'tag' in value && typeof value.tag === 'string' ? value.tag : '',
    version: 'version' in value && typeof value.version === 'string' ? value.version : null,
    message: 'message' in value && typeof value.message === 'string' ? value.message : '',
  };
}

/**
 * Runs `workers` separate processes that all commit `runId` from the same
 * `ifVersion` at the same instant. Separate processes because two commits in
 * one process interleave only where the code happens to yield, and a
 * compare-then-write that never yields between the two would pass such a test
 * while being broken.
 */
export async function contendOnCommit(
  dirs: VaultDirs,
  base: string,
  runId: string,
  ifVersion: string,
  workers: number,
): Promise<CommitOutcome[]> {
  const script = join(base, 'contend.mjs');
  await writeFile(script, CONTENDER_SOURCE);
  // Enough for every child to boot and import before the barrier opens.
  const startAt = String(Date.now() + 2_000);
  const head = [vaultModuleUrl(), dirs.store, dirs.artifacts, runId, ifVersion, startAt];
  const runs = await Promise.all(
    Array.from({ length: workers }, (_unused, i) => runChild(script, [...head, `w${String(i)}`])),
  );
  return runs.map(parseOutcome);
}
