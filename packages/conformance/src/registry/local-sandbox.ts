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
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { AppliedControls, LocalDockerProvider, SandboxHandle, SandboxSpec } from '@olympus-ai/sandbox';

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
    // alpine's own default user; what these assertions ran as before SandboxSpec named one
    user: { uid: 0, gid: 0 },
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

const docker = promisify(execFile);

/** What the origin container answers with, so a body that arrives is known to have come from it and not from the proxy. */
export const ORIGIN_BODY = 'origin-reached';

/** The port the origin listens on inside its own container. Nothing is published to the host. */
export const ORIGIN_PORT = 8080;

/**
 * A host that is on no allowlist and resolves nowhere, and an address from the
 * documentation range (RFC 5737). Both are refused by name and by address
 * respectively, so a refusal cannot be an accident of the local network.
 */
export const BLOCKED_NAME = 'blocked.invalid';
export const BLOCKED_ADDRESS = '198.51.100.9';

const ORIGIN_SOURCE =
  "require('node:http').createServer(function (q, s) { s.end('" + ORIGIN_BODY + "'); })" +
  '.listen(' + String(ORIGIN_PORT) + ", '0.0.0.0');";

/** The allowlist branch of one sandbox's applied controls, or a failure. A `deny-all` sandbox must never satisfy an assertion written about an allowlist. */
export function allowlistControls(provider: LocalDockerProvider, handle: SandboxHandle): AppliedControls & { egress: { mode: 'allowlist' } } {
  const controls = provider.appliedControls(handle);
  if (controls.egress.mode !== 'allowlist') {
    throw new Error(`expected an allowlist sandbox; appliedControls records ${controls.egress.mode}`);
  }
  return controls as AppliedControls & { egress: { mode: 'allowlist' } };
}

/**
 * An origin server the sandbox is allowed to reach, on the proxy's outbound
 * network. The sandbox is never on that network, so the only way to it is
 * through the proxy — which is what makes "reached the allowlisted host"
 * evidence rather than a coincidence.
 *
 * Returns the name it is allowlisted under and the address it also answers on,
 * so the same reachable host can be refused when it is named by address.
 */
export async function withOrigin<T>(
  network: string,
  name: string,
  body: (origin: { readonly name: string; readonly address: string }) => Promise<T>,
): Promise<T> {
  const { EGRESS_PROXY_IMAGE } = await import('@olympus-ai/sandbox');
  await docker('docker', [
    'run', '--detach', '--init', '--name', name,
    '--network', network, '--network-alias', name,
    EGRESS_PROXY_IMAGE, 'node', '--eval', ORIGIN_SOURCE,
  ]);
  try {
    const address = await originAddress(name, network);
    return await body({ name, address });
  } finally {
    try {
      await docker('docker', ['rm', '--force', '--volumes', name]);
    } catch {
      // Already gone; the leak assertions are elsewhere and read the proxy, not this.
    }
  }
}

async function originAddress(name: string, network: string): Promise<string> {
  const probe =
    `require('node:net').connect(${String(ORIGIN_PORT)}, '127.0.0.1')` +
    ".on('connect', function () { process.exit(0); }).on('error', function () { process.exit(1); });";
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await docker('docker', ['exec', name, 'node', '--eval', probe]);
      const { stdout } = await docker('docker', [
        'inspect', '--format', `{{(index .NetworkSettings.Networks "${network}").IPAddress}}`, name,
      ]);
      return stdout.trim();
    } catch {
      await new Promise((done) => {
        setTimeout(done, 250).unref();
      });
    }
  }
  throw new Error(`the origin container ${name} never listened on port ${String(ORIGIN_PORT)}`);
}

/** A name for one assertion's origin container, distinct per run so a leaked one is traceable (I10: nothing Greek reaches `docker ps`). */
export function originName(): string {
  return `egress-origin-${randomUUID()}`;
}

/** One raw request spoken from inside the sandbox to the proxy, so the proxy's own answer is read rather than a client's summary of it. */
export async function throughProxy(provider: LocalDockerProvider, handle: SandboxHandle, request: string): Promise<string> {
  const { PROXY_ALIAS, PROXY_PORT } = await import('@olympus-ai/sandbox');
  const result = await provider.exec(handle, [
    'sh', '-c', `printf '${request}\\r\\n\\r\\n' | nc -w 4 ${PROXY_ALIAS} ${String(PROXY_PORT)}`,
  ]);
  return result.stdout + result.stderr;
}

/** Whether Docker still holds an object of this kind by this name. A leaked proxy or network is a failing assertion, not a thing noticed later in `docker ps`. */
export async function dockerHas(kind: 'container' | 'network', name: string): Promise<boolean> {
  try {
    await docker('docker', kind === 'container' ? ['inspect', '--type', 'container', name] : ['network', 'inspect', name]);
    return true;
  } catch {
    return false;
  }
}
