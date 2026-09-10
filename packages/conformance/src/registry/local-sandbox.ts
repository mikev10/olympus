/**
 * Support for the registry assertions that exercise the real sandbox (P2).
 *
 * The provider is reached through the same published-entry map the fixtures
 * typecheck against, so the conformance package keeps no `package.json`
 * dependency on it and no workspace cycle forms (D-F3-04, and the precedent
 * `local-vault.ts` set for P1).
 *
 * **These assertions require a Docker daemon and fail without one** (D-P2-02).
 * The mount layer is where I1 is enforced, and there is no way to observe an
 * enforcement that has no container to enforce it in. An assertion that
 * skipped itself here would leave the registry reporting I1 as asserted on the
 * strength of a test that did not run, which is worse than reporting it
 * pending: the pending entry at least names what is owed.
 */
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LocalDockerProvider, SandboxHandle, SandboxSpec } from '@olympus-ai/sandbox';

/**
 * Pinned by digest so the container the registry proves things about is the
 * container CI proved them about. `packages/sandbox/test/image.ts` pins the
 * same digest for that package's own suite; the two are independent and
 * neither has to follow the other.
 */
export const TEST_IMAGE = 'alpine@sha256:28bd5fe8b56d1bd048e5babf5b10710ebe0bae67db86916198a6eec434943f8b';

/** The three roots an I1 assertion needs, each a sibling so none contains another. */
export interface SandboxDirs {
  /** The tree the workspace mount points at. */
  readonly workspace: string;
  /** What the Vault owns. No mount may be it, sit inside it, or contain it. */
  readonly vault: string;
  /** An ordinary directory, for the `others` mounts. Not the Vault, so it is allowed to be mounted ro. */
  readonly readable: string;
}

/** The directory names under the base, so an assertion can tell a leak from the tree it built. */
export const DIR_NAMES: readonly string[] = ['workspace', 'vault', 'readable'];

/** A fresh workspace, Vault root, and readable directory under one base, removed when `body` settles. */
export async function withSandboxDirs<T>(prefix: string, body: (dirs: SandboxDirs, base: string) => Promise<T>): Promise<T> {
  const base = await mkdtemp(join(tmpdir(), prefix));
  const dirs: SandboxDirs = {
    workspace: join(base, 'workspace'),
    vault: join(base, 'vault'),
    readable: join(base, 'readable'),
  };
  await mkdir(dirs.workspace, { recursive: true });
  await mkdir(dirs.vault, { recursive: true });
  await mkdir(dirs.readable, { recursive: true });
  try {
    return await body(dirs, base);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

/**
 * A provider over a real daemon, with the Vault root declared. `create`
 * refuses outright when there is no daemon, when it is not a Linux-container
 * daemon, or when it is not local, so nothing below has to check.
 */
export async function withProvider<T>(
  prefix: string,
  body: (provider: LocalDockerProvider, dirs: SandboxDirs, base: string) => Promise<T>,
): Promise<T> {
  return withSandboxDirs(prefix, async (dirs, base) => {
    const { LocalDockerProvider: Provider } = await import('@olympus-ai/sandbox');
    const provider = await Provider.create({ vaultPaths: [dirs.vault] });
    return body(provider, dirs, base);
  });
}

/** A workspace-only spec at the given mode, with modest limits and no egress. */
export function specFor(dirs: SandboxDirs, mode: 'rw' | 'ro' = 'rw', overrides: Partial<SandboxSpec> = {}): SandboxSpec {
  return {
    image: TEST_IMAGE,
    mounts: { workspace: { source: dirs.workspace, target: '/workspace', mode }, others: [] },
    egress: { mode: 'deny-all', allow: [] },
    limits: { cpus: 0.5, memoryMb: 256, pids: 64, wallClockMs: 60_000 },
    ...overrides,
  };
}

/** Provisions, runs `body`, and destroys the sandbox even when `body` throws. */
export async function withSandbox<T>(
  provider: LocalDockerProvider,
  spec: SandboxSpec,
  body: (handle: SandboxHandle) => Promise<T>,
): Promise<T> {
  const handle = await provider.provision(spec);
  try {
    return await body(handle);
  } finally {
    try {
      await provider.destroy(handle);
    } catch {
      // The wall clock may have destroyed it already; the assertion body decides what that means.
    }
  }
}

/**
 * Runs `body` and returns the refusal it produced. A test that accepts any
 * throw passes when the daemon is missing or the code has a typo, so the
 * layer is checked by the caller against what it actually asked for.
 */
export async function refusalFrom(body: () => unknown): Promise<{ layer: string; message: string }> {
  const { SandboxRefusal } = await import('@olympus-ai/sandbox');
  try {
    await body();
  } catch (error) {
    if (error instanceof SandboxRefusal) return { layer: error.layer, message: error.message };
    throw new Error(`expected a SandboxRefusal, got ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`, {
      cause: error,
    });
  }
  throw new Error('expected a SandboxRefusal, but the call returned');
}

/**
 * How a path inside one tree is made to resolve into another. Windows grants a
 * directory junction without elevation and withholds a symlink; POSIX has no
 * junctions and takes the symlink. Both reach the same `realpath` in the mount
 * layer, which is the thing under test.
 *
 * Chosen by platform, never skipped and never wrapped in a catch: if a
 * platform's own mechanism cannot be created the assertion fails there. A
 * containment check that silently goes unexercised on a platform is worse than
 * none, because the registry reports it as asserted. The mechanism appears in
 * the assertion's title so a CI log says which one ran.
 */
export const ESCAPE_MECHANISM: 'junction' | 'symlink' = process.platform === 'win32' ? 'junction' : 'symlink';

/** Creates `link` pointing at `target`, by whichever mechanism this platform grants. */
export async function linkTo(target: string, link: string): Promise<void> {
  await symlink(target, link, ESCAPE_MECHANISM === 'junction' ? 'junction' : 'dir');
}
