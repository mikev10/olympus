/**
 * Python's dependency installs (D-A-PY-04, A-R29-02, D-R29-05). Each makes a
 * virtualenv with copies, since a linked interpreter points out of the tree
 * and R34 refuses the link, then installs into it what the lockfile pins,
 * every package verified against the lockfile's hash. Nothing is built: a
 * package with no wheel, and the project itself, would run their own code to
 * build, so neither is installed and a lockfile that needs either is
 * refused, naming it.
 */
import { parse as parseToml } from 'smol-toml';
import type { DependencyInstaller, LockedPackage } from '../types.js';
import { PYTHON_DEPENDENCY_TREES } from '../trees.js';
import { requirementLines, requirementName } from './config.js';

/** Python 3.13 with uv 0.9.13, pinned by digest: where a Python tree is installed and every check over it runs (D-A-PY-07). */
export const PYTHON_IMAGE = 'ghcr.io/astral-sh/uv@sha256:c5db46150ecdfa1dcb35f2c666cb027624ebaad1781d0d7740ccccbdb53b2460';

/** The hosts a Python install downloads from: the index and the files it links to. */
export const PYPI_REGISTRIES: readonly string[] = Object.freeze(['pypi.org', 'files.pythonhosted.org']);

/** The first step of both: a virtualenv whose interpreter is a copy, inside the tree. */
const VENV = Object.freeze(['python', '-m', 'venv', '--copies', '.venv'] as const);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

const SHA256 = /^sha256:[0-9a-f]{64}$/u;

/**
 * `uv.lock`, version 1. The project and its workspace members are not
 * installed (`--no-install-workspace`); every other package must come from
 * an `https` registry with a wheel, each wheel hashed.
 */
function uvPackages(document: unknown): ReturnType<DependencyInstaller['packages']> {
  if (typeof document !== 'string') return { ok: false, reason: 'uv.lock was not read as text' };
  let lock: Record<string, unknown>;
  try {
    lock = parseToml(document);
  } catch (error) {
    return { ok: false, reason: `uv.lock is not TOML: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (lock.version !== 1) return { ok: false, reason: `uv.lock is lockfile version ${JSON.stringify(lock.version)}; only version 1 is read` };
  const manifest = isRecord(lock.manifest) ? lock.manifest : {};
  const members = new Set(Array.isArray(manifest.members) ? manifest.members.filter((m): m is string => typeof m === 'string').map((m) => requirementName(m) ?? m) : []);
  if (!Array.isArray(lock.package)) return { ok: true, packages: [] };
  const packages: LockedPackage[] = [];
  for (const entry of lock.package) {
    if (!isRecord(entry) || typeof entry.name !== 'string' || typeof entry.version !== 'string' && entry.version !== undefined) return { ok: false, reason: 'uv.lock has a package with no name' };
    const key = `${entry.name}@${typeof entry.version === 'string' ? entry.version : '(no version)'}`;
    const source = isRecord(entry.source) ? entry.source : {};
    const local = source.virtual ?? source.editable;
    if (members.has(requirementName(entry.name) ?? entry.name) || local === '.') continue;
    let unverifiable: string | null = null;
    const wheels = Array.isArray(entry.wheels) ? entry.wheels : [];
    const hashes = wheels.map((w) => (isRecord(w) && typeof w.hash === 'string' ? w.hash : null));
    if (typeof source.registry !== 'string') unverifiable = `it comes from ${Object.keys(source).join(', ') || 'no source'}, not a registry`;
    else if (!source.registry.startsWith('https://')) unverifiable = `it comes from ${source.registry}, not an https registry`;
    else if (wheels.length === 0) unverifiable = 'it has no wheel, and building it from source runs its code';
    else if (hashes.some((h) => h === null || !SHA256.test(h))) unverifiable = 'a wheel of it records no sha256 hash';
    const integrity = hashes.every((h): h is string => h !== null) && hashes.length > 0 ? [...hashes].sort().join(' ') : null;
    packages.push({ key, integrity, unverifiable });
  }
  return { ok: true, packages: packages.sort((a, b) => a.key.localeCompare(b.key)) };
}

/**
 * A hashed `requirements.txt`: one `name==version` per line with a
 * `--hash=sha256:` for each file it may install. An option line, a URL, an
 * editable, or a nested file is a document this installer does not read,
 * since each names code from somewhere the hashes do not cover.
 */
function pipPackages(document: unknown): ReturnType<DependencyInstaller['packages']> {
  if (typeof document !== 'string') return { ok: false, reason: 'requirements.txt was not read as text' };
  const packages: LockedPackage[] = [];
  for (const { line, text } of requirementLines(document)) {
    if (text.startsWith('-')) return { ok: false, reason: `requirements.txt line ${String(line)} is the option ${text.split(/\s/u)[0] ?? text}, which names packages or an index outside the file's hashes` };
    const tokens = text.split(/\s+/u);
    const hashes = tokens.filter((t) => t.startsWith('--hash=')).map((t) => t.slice('--hash='.length));
    const other = tokens.filter((t) => t.startsWith('--') && !t.startsWith('--hash='));
    if (other.length > 0) return { ok: false, reason: `requirements.txt line ${String(line)} passes ${other.join(' ')}` };
    const spec = tokens.filter((t) => !t.startsWith('--')).join(' ');
    const name = requirementName(spec);
    if (name === undefined) return { ok: false, reason: `requirements.txt line ${String(line)} names no package` };
    const pin = /^[A-Za-z0-9._-]+(?:\[[^\]]*\])?\s*==\s*([0-9][0-9A-Za-z.+!-]*)\s*(?:;.*)?$/u.exec(spec);
    let unverifiable: string | null = null;
    if (/@|:\/\//u.test(spec.split(';')[0] ?? '')) unverifiable = 'it is a direct reference, not a registry download';
    else if (pin?.[1] === undefined) unverifiable = 'it is not pinned to one version with ==';
    else if (hashes.length === 0) unverifiable = 'it records no hash';
    else if (hashes.some((h) => !SHA256.test(h))) unverifiable = 'a hash of it is not sha256';
    packages.push({ key: `${name}@${pin?.[1] ?? '(unpinned)'}`, integrity: hashes.length === 0 ? null : [...hashes].sort().join(' '), unverifiable });
  }
  return { ok: true, packages: packages.sort((a, b) => a.key.localeCompare(b.key)) };
}

const HASH_FAILED = /Hash mismatch for|DO NOT MATCH THE HASHES/u;
const NO_WHEEL = /Building source distributions is disabled|can't be installed because it doesn't have a source distribution or wheel|from versions: none/u;
const UNREACHABLE = /Failed to fetch|error sending request|Could not connect|ConnectError|ProxyError|NewConnectionError|Temporary failure in name resolution|Name or service not known|\b40[37]\b/u;
const NO_INTERPRETER = /No interpreter found|requires-python|is incompatible with the project's Python requirement/u;

function failure(output: string): string | null {
  if (HASH_FAILED.test(output)) return 'a package failed the hash its lockfile records';
  if (NO_WHEEL.test(output)) return 'a package has no wheel for the install image, and building one from source is refused';
  if (NO_INTERPRETER.test(output)) return "the install image's Python does not satisfy the project's requires-python";
  if (UNREACHABLE.test(output)) return 'a granted registry could not be reached';
  return null;
}

/** `uv.lock`: a copied virtualenv, then uv installs exactly the lockfile into it, building nothing and installing no project. */
export const UV_INSTALLER: DependencyInstaller = Object.freeze({
  stack: 'uv',
  lockfile: 'uv.lock',
  format: 'text',
  manifest: 'pyproject.toml',
  files: Object.freeze(['pyproject.toml', 'uv.lock', '.python-version']),
  nested: 'pyproject.toml',
  trees: PYTHON_DEPENDENCY_TREES,
  image: PYTHON_IMAGE,
  steps: Object.freeze([
    VENV,
    Object.freeze(['uv', 'sync', '--frozen', '--no-install-workspace', '--no-build', '--all-extras', '--all-groups'] as const),
  ] as const),
  env: Object.freeze({
    HOME: '/tmp', UV_CACHE_DIR: '/tmp/uv-cache', UV_NO_CONFIG: '1', UV_PYTHON_DOWNLOADS: 'never', UV_LINK_MODE: 'copy', UV_NO_PROGRESS: '1',
  }),
  packages: uvPackages,
  failure,
});

/** A hashed `requirements.txt`: a copied virtualenv, then pip installs each pinned wheel by hash, and nothing it depends on unlisted. */
export const PIP_INSTALLER: DependencyInstaller = Object.freeze({
  stack: 'pip',
  lockfile: 'requirements.txt',
  format: 'text',
  manifest: 'pyproject.toml',
  files: Object.freeze(['requirements.txt', '.python-version']),
  nested: null,
  trees: PYTHON_DEPENDENCY_TREES,
  image: PYTHON_IMAGE,
  steps: Object.freeze([
    VENV,
    Object.freeze([
      '.venv/bin/python', '-m', 'pip', 'install', '--require-hashes', '--no-deps', '--only-binary', ':all:', '--no-input',
      '--disable-pip-version-check', '--no-cache-dir', '-r', 'requirements.txt',
    ] as const),
  ] as const),
  env: Object.freeze({ HOME: '/tmp', PIP_CONFIG_FILE: '/dev/null', PIP_NO_INPUT: '1', PIP_DISABLE_PIP_VERSION_CHECK: '1' }),
  packages: pipPackages,
  failure,
});
