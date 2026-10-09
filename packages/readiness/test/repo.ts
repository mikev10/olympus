/**
 * Fixture repositories and a real provider for the scan tests. These need a
 * Docker daemon and fail without one (D-P2-02): a scan test that skipped
 * itself would report a ceiling derived from nothing.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { promisify } from 'node:util';
import { EGRESS_PROXY_IMAGE, LocalDockerProvider } from '@olympus-ai/sandbox';
import { NPM_REGISTRY, SECRET_SCAN_IMAGE, type BranchProtectionChecker, type ScanOptions } from '../src/index.js';

const run = promisify(execFile);

export const IMAGE = EGRESS_PROXY_IMAGE;

export interface Workbench {
  readonly provider: LocalDockerProvider;
  readonly base: string;
}

export async function withWorkbench<T>(body: (bench: Workbench) => Promise<T>): Promise<T> {
  const base = await mkdtemp(join(tmpdir(), 'readiness-test-'));
  try {
    await mkdir(join(base, 'vault'));
    const provider = await LocalDockerProvider.create({ vaultPaths: [join(base, 'vault')] });
    return await body({ provider, base });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

export async function writeFiles(root: string, files: Readonly<Record<string, string>>): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
}

/** A git repository at `root` with `files` committed. */
export async function gitRepository(root: string, files: Readonly<Record<string, string>>): Promise<void> {
  await writeFiles(root, files);
  const git = (...args: string[]) => run('git', ['-C', root, '-c', 'user.email=readiness@example.invalid', '-c', 'user.name=readiness', ...args]);
  await git('init', '--quiet', '--initial-branch=main');
  await git('add', '--all');
  await git('commit', '--quiet', '--message', 'fixture');
}

export function manifest(fields: Readonly<Record<string, unknown>>): string {
  return JSON.stringify({ name: 'fixture', version: '1.0.0', private: true, ...fields }, null, 2);
}

/** A lockfile for a package with no dependencies: `npm ci` installs it without reaching the registry. */
export const EMPTY_LOCK = JSON.stringify({
  name: 'fixture', version: '1.0.0', lockfileVersion: 3, requires: true,
  packages: { '': { name: 'fixture', version: '1.0.0' } },
});

/**
 * A lockfile for `dir`'s package.json, resolved in a sandbox on the scan's
 * own image with egress to the registry only, so the fixture's dependency
 * tree is the one an install in that image reproduces.
 */
export async function lockfileFor(bench: Workbench, dir: string): Promise<void> {
  const handle = await bench.provider.provision({
    image: IMAGE,
    mounts: { workspace: { source: dir, target: '/workspace', mode: 'rw' }, others: [] },
    egress: { mode: 'allowlist', allow: [...NPM_REGISTRY] },
    limits: { cpus: 1, memoryMb: 1024, pids: 256, wallClockMs: 300_000 },
    user: { uid: 0, gid: 0 },
  });
  try {
    const result = await bench.provider.exec(handle, ['npm', 'install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], {
      env: { HOME: '/tmp', npm_config_update_notifier: 'false' },
    });
    if (result.exitCode !== 0) throw new Error(`fixture lockfile: npm exited ${String(result.exitCode)}: ${result.stderr}`);
  } finally {
    await bench.provider.destroy(handle);
  }
}

export function options(bench: Workbench, checkout: string, overrides: Partial<ScanOptions> = {}): ScanOptions {
  return {
    checkout,
    revision: 'HEAD',
    provider: bench.provider,
    image: IMAGE,
    secretScanImage: SECRET_SCAN_IMAGE,
    limits: { cpus: 2, memoryMb: 2048, pids: 512 },
    user: { uid: 0, gid: 0 },
    timeouts: { installMs: 300_000, probeMs: 180_000, coldProvisionMs: 60_000 },
    registries: NPM_REGISTRY,
    protectedPaths: ['package.json', '.github/**'],
    branchProtection: null,
    ...overrides,
  };
}

export const PROTECTED: BranchProtectionChecker = {
  name: 'fixture:protected',
  check: () => Promise.resolve({ protected: true, detail: 'main requires a review and passing checks' }),
};

/** Every file under `root`, `.git` included, with its content hash: what "byte-identical" is checked against. */
export async function treeHash(root: string): Promise<string> {
  const entries: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else entries.push(`${relative(root, path)}\0${createHash('sha256').update(await readFile(path)).digest('hex')}`);
    }
  };
  await walk(root);
  return createHash('sha256').update(entries.sort().join('\n')).digest('hex');
}
