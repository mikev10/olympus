/**
 * The dependency installs the runtime runs before any check (R34, D-R34-06).
 * Each is declared once, here: the lockfile it reads, the files copied into
 * its sandbox, the image it is pinned to, the arguments, and how its
 * lockfile lists each package and the hash it records. A policy names the
 * registries the install may reach and nothing else about it (A-R34-01).
 *
 * No lifecycle script runs: npm's and pnpm's are disabled by flag, and pnpm's
 * `.pnpmfile.cjs`, which pnpm executes despite `--ignore-scripts`, is
 * disabled by its own flag and is never copied in. Every package must carry
 * an integrity hash and resolve from a registry, so the installer verifies
 * every byte it writes; a lockfile where one does not is refused (I5).
 */
import { DEPENDENCY_AUDIT_IMAGE, PNPM_AUDIT_VERSION } from './audit.js';
import type { DependencyInstaller, LockedPackage } from './types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Why a package resolved from `resolved` cannot be verified as a registry download, or null when it can. */
function notRegistry(resolved: string): string | null {
  return resolved.startsWith('https://') ? null : `it resolves from ${resolved}, not from a registry`;
}

/** An integrity string as both lockfiles write one: `<algorithm>-<base64>`, several separated by spaces. */
const INTEGRITY = /^(?:sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2})(?: sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2})*$/u;

function integrityOf(value: unknown): string | null {
  return typeof value === 'string' && INTEGRITY.test(value) ? value : null;
}

/** The failures a whole install's output can name, by the code npm or pnpm prints. */
const HASH_FAILED = /\bEINTEGRITY\b|ERR_PNPM_TARBALL_INTEGRITY|integrity checksum failed/u;
const NO_LOCKFILE_MATCH = /\bEUSAGE\b|ERR_PNPM_OUTDATED_LOCKFILE|ERR_PNPM_LOCKFILE_CONFIG_MISMATCH|ERR_PNPM_NO_LOCKFILE/u;
const UNREACHABLE = /ECONNREFUSED|ECONNRESET|EAI_AGAIN|ENOTFOUND|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|getaddrinfo|socket hang up|\b40[37]\b|ERR_PNPM_META_FETCH_FAIL|ERR_PNPM_FETCH_40[37]/u;

function failure(output: string): string | null {
  if (HASH_FAILED.test(output)) return 'a package failed the integrity hash its lockfile records';
  if (NO_LOCKFILE_MATCH.test(output)) return 'the lockfile does not match the manifest it was installed with';
  if (UNREACHABLE.test(output)) return 'a granted registry could not be reached';
  return null;
}

/**
 * `package-lock.json`, lockfile version 2 or 3: `packages` keyed by install
 * path. The root (`""`) is the project, a `link` is a workspace package in
 * the tree, and an `inBundle` package arrives inside its parent's tarball,
 * which is hashed; none of the three is downloaded on its own.
 */
function npmPackages(document: unknown): ReturnType<DependencyInstaller['packages']> {
  if (!isRecord(document)) return { ok: false, reason: 'package-lock.json is not a JSON object' };
  const version = document.lockfileVersion;
  if (version !== 2 && version !== 3) return { ok: false, reason: `package-lock.json is lockfile version ${JSON.stringify(version)}; only versions 2 and 3 record a hash per installed package` };
  if (!isRecord(document.packages)) return { ok: false, reason: 'package-lock.json has no packages map' };
  const packages: LockedPackage[] = [];
  for (const [key, entry] of Object.entries(document.packages)) {
    if (key === '') continue;
    if (!isRecord(entry)) return { ok: false, reason: `package-lock.json's entry ${key} is not an object` };
    if (entry.inBundle === true) continue;
    const integrity = integrityOf(entry.integrity);
    // A link installs a symlink into the tree, and an entry outside node_modules is a directory of the tree: either puts
    // code the change can write where a check loads a dependency, whatever hash it carries (external review, codex-1, gemini-2).
    let unverifiable: string | null;
    if (entry.link === true) unverifiable = `it links to ${typeof entry.resolved === 'string' ? entry.resolved : 'a directory'} in the tree, not a registry download`;
    else if (!key.startsWith('node_modules/') && !key.includes('/node_modules/')) unverifiable = 'it is a directory of the tree, not a registry download';
    else if (integrity === null) unverifiable = 'it records no integrity hash';
    else unverifiable = typeof entry.resolved === 'string' ? notRegistry(entry.resolved) : null;
    packages.push({ key, integrity, unverifiable });
  }
  return { ok: true, packages: packages.sort((a, b) => a.key.localeCompare(b.key)) };
}

/**
 * `pnpm-lock.yaml`, lockfile version 9: `packages` keyed by `name@version`,
 * each with its `resolution`. A registry package's resolution is its
 * integrity alone; a tarball, git, or directory resolution is not a
 * registry download, whatever hash it carries.
 */
function pnpmPackages(document: unknown): ReturnType<DependencyInstaller['packages']> {
  if (!isRecord(document)) return { ok: false, reason: 'pnpm-lock.yaml is not a mapping' };
  if (document.lockfileVersion !== '9.0') return { ok: false, reason: `pnpm-lock.yaml is lockfile version ${JSON.stringify(document.lockfileVersion)}; only 9.0 is read` };
  // A patch changes a package after its tarball's hash is verified, from a file the change can write (external review, codex-2).
  if (document.patchedDependencies !== undefined && document.patchedDependencies !== null) {
    const patched = isRecord(document.patchedDependencies) ? Object.keys(document.patchedDependencies).join(', ') : 'an unreadable set';
    return { ok: false, reason: `pnpm-lock.yaml declares patchedDependencies (${patched}), which change a package's code after its hash is verified` };
  }
  const packages: LockedPackage[] = [];
  // An importer's dependency on link: or file: is a directory of the tree, installed as a symlink into it (external review, codex-1).
  if (document.importers !== undefined && document.importers !== null) {
    if (!isRecord(document.importers)) return { ok: false, reason: "pnpm-lock.yaml's importers is not a mapping" };
    for (const [importer, deps] of Object.entries(document.importers)) {
      if (!isRecord(deps)) return { ok: false, reason: `pnpm-lock.yaml's importer ${importer} is not a mapping` };
      for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
        const listed = deps[field];
        if (listed === undefined || listed === null) continue;
        if (!isRecord(listed)) return { ok: false, reason: `pnpm-lock.yaml's importer ${importer} ${field} is not a mapping` };
        for (const [name, dep] of Object.entries(listed)) {
          const version = isRecord(dep) ? dep.version : undefined;
          if (typeof version !== 'string') return { ok: false, reason: `pnpm-lock.yaml's importer ${importer} names ${name} with no version` };
          if (version.startsWith('link:') || version.startsWith('file:')) {
            packages.push({ key: `${importer} > ${name}`, integrity: null, unverifiable: `it is ${version}, a directory of the tree, not a registry download` });
          }
        }
      }
    }
  }
  if (document.packages === undefined || document.packages === null) return { ok: true, packages: packages.sort((a, b) => a.key.localeCompare(b.key)) };
  if (!isRecord(document.packages)) return { ok: false, reason: "pnpm-lock.yaml's packages is not a mapping" };
  for (const [key, entry] of Object.entries(document.packages)) {
    if (!isRecord(entry) || !isRecord(entry.resolution)) return { ok: false, reason: `pnpm-lock.yaml's entry ${key} has no resolution` };
    const resolution = entry.resolution;
    const integrity = integrityOf(resolution.integrity);
    let unverifiable: string | null = integrity === null ? 'it records no integrity hash' : null;
    if (typeof resolution.type === 'string') unverifiable = `it is a ${resolution.type} dependency, not a registry download`;
    else if (typeof resolution.tarball === 'string') unverifiable ??= notRegistry(resolution.tarball);
    packages.push({ key, integrity, unverifiable });
  }
  return { ok: true, packages: packages.sort((a, b) => a.key.localeCompare(b.key)) };
}

/** The environment both installs run with: no prompt, no script, a home they may write. */
const ENV = Object.freeze({ HOME: '/tmp', COREPACK_ENABLE_DOWNLOAD_PROMPT: '0', npm_config_ignore_scripts: 'true' });

/** `npm ci`: the lockfile exactly, no script, no audit or funding request, no retry. */
export const NPM_INSTALLER: DependencyInstaller = Object.freeze({
  stack: 'npm',
  lockfile: 'package-lock.json',
  format: 'json',
  manifest: 'package.json',
  files: Object.freeze(['package.json', 'package-lock.json']),
  nested: 'package.json',
  trees: Object.freeze(['node_modules']),
  image: DEPENDENCY_AUDIT_IMAGE,
  invocation: Object.freeze(['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund', '--fetch-retries=0'] as const),
  env: ENV,
  packages: npmPackages,
  failure,
});

/** `pnpm install --frozen-lockfile`: the lockfile exactly, no script, no pnpmfile, no retry. */
export const PNPM_INSTALLER: DependencyInstaller = Object.freeze({
  stack: 'pnpm',
  lockfile: 'pnpm-lock.yaml',
  format: 'yaml',
  manifest: 'package.json',
  files: Object.freeze(['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']),
  nested: 'package.json',
  trees: Object.freeze(['node_modules']),
  image: DEPENDENCY_AUDIT_IMAGE,
  invocation: Object.freeze(['corepack', `pnpm@${PNPM_AUDIT_VERSION}`, 'install', '--frozen-lockfile', '--ignore-scripts', '--ignore-pnpmfile', '--config.fetch-retries=0'] as const),
  env: ENV,
  packages: pnpmPackages,
  failure,
});

/** Every installer, by the lockfile that selects it. */
export const INSTALLERS: readonly DependencyInstaller[] = Object.freeze([NPM_INSTALLER, PNPM_INSTALLER]);
