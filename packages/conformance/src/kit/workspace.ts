/**
 * Workspace discovery. Every helper in the kit locates files relative to the
 * pnpm workspace root so an assertion behaves the same from any package's
 * working directory and from CI.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKSPACE_MARKER = 'pnpm-workspace.yaml';

let cachedRoot: string | undefined;

/** Absolute path of the workspace root: the directory holding pnpm-workspace.yaml. */
export function workspaceRoot(): string {
  if (cachedRoot !== undefined) return cachedRoot;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(dir, WORKSPACE_MARKER))) {
      cachedRoot = dir;
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`conformance: no ${WORKSPACE_MARKER} above ${fileURLToPath(import.meta.url)}`);
    }
    dir = parent;
  }
}

/** Absolute path of the conformance package itself. */
export function conformanceRoot(): string {
  return join(workspaceRoot(), 'packages', 'conformance');
}

export interface WorkspacePackage {
  /** package.json `name`. */
  name: string;
  /** Absolute directory. */
  dir: string;
  /** Directory relative to the workspace root, POSIX separators. */
  relativeDir: string;
  /** package.json `main` as written: what the runtime loads. */
  main: string | undefined;
  /** package.json `types` as written: what the compiler reads. */
  types: string | undefined;
  /** `types`, or else `main`: the published entry. */
  entry: string | undefined;
  /** package.json `private`. */
  isPrivate: boolean;
}

/**
 * A package whose `main` and `types` name different files, so a fixture
 * would typecheck against one while the runtime loads the other. Undefined
 * when they agree or only one is set. (S1 external review, configuration note.)
 */
export function entryDivergence(pkg: WorkspacePackage): string | undefined {
  if (pkg.main === undefined || pkg.types === undefined) return undefined;
  if (toPosix(resolve(pkg.dir, pkg.main)) === toPosix(resolve(pkg.dir, pkg.types))) return undefined;
  return `${pkg.name}: main (${pkg.main}) and types (${pkg.types}) resolve to different files`;
}

interface PackageJson {
  name?: unknown;
  main?: unknown;
  types?: unknown;
  private?: unknown;
}

function readPackageJson(dir: string): PackageJson | undefined {
  const file = join(dir, 'package.json');
  if (!existsSync(file)) return undefined;
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
  return typeof parsed === 'object' && parsed !== null ? parsed : undefined;
}

/**
 * The globs under `packages:` in pnpm-workspace.yaml, in file order.
 *
 * Read rather than assumed. `packages/*` was the whole list until the first
 * driver arrived under `packages/drivers/`, and a helper that hard-codes one
 * level would have stopped seeing a package the workspace does see — quietly,
 * which is the failure that matters: every scan built on this list would have
 * skipped that package and reported clean.
 *
 * Parsed by line, because the file is a list of strings and nothing else and
 * a YAML dependency here would be a dependency in every package that runs an
 * assertion. Anything richer than a flat list under `packages:` is refused by
 * `expandWorkspaceGlob` rather than half-read.
 */
export function workspaceGlobs(root: string = workspaceRoot()): string[] {
  const file = join(root, WORKSPACE_MARKER);
  const globs: string[] = [];
  let inPackages = false;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (/^packages\s*:/.test(line)) {
      inPackages = true;
      continue;
    }
    if (!inPackages) continue;
    const item = /^\s+-\s*['"]?([^'"#\s]+)['"]?\s*$/.exec(line);
    if (item?.[1] !== undefined) {
      globs.push(item[1]);
      continue;
    }
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    break; // a key at any other indentation ends the list
  }
  if (globs.length === 0) throw new Error(`conformance: ${WORKSPACE_MARKER} lists no packages`);
  return globs;
}

/**
 * The directories one glob matches. Only a trailing `/*` is supported, which
 * is every pattern the workspace uses; anything else throws rather than
 * matching nothing, so an unsupported pattern is a loud failure and not a
 * silently empty result (I5).
 */
function expandWorkspaceGlob(root: string, glob: string): string[] {
  const prefix = glob.endsWith('/*') ? glob.slice(0, -2) : undefined;
  if (prefix === undefined || prefix.includes('*')) {
    throw new Error(
      `conformance: ${WORKSPACE_MARKER} pattern '${glob}' is not supported; the kit expands a trailing '/*' and nothing else`,
    );
  }
  const dir = join(root, ...prefix.split('/'));
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort()
    .map((name) => join(dir, name))
    .filter((path) => statSync(path).isDirectory());
}

/**
 * Every package the workspace globs match, in glob order then directory
 * order. The list is read from disk on each call so a test that creates a
 * package in a temporary tree sees it.
 */
export function workspacePackages(root: string = workspaceRoot()): WorkspacePackage[] {
  const result: WorkspacePackage[] = [];
  const seen = new Set<string>();
  for (const glob of workspaceGlobs(root)) {
    for (const dir of expandWorkspaceGlob(root, glob)) {
      if (seen.has(dir)) continue;
      const pkg = readPackageJson(dir);
      if (pkg === undefined || typeof pkg.name !== 'string') continue;
      seen.add(dir);
      const main = typeof pkg.main === 'string' ? pkg.main : undefined;
      const types = typeof pkg.types === 'string' ? pkg.types : undefined;
      result.push({
        name: pkg.name,
        dir,
        relativeDir: toPosix(relative(root, dir)),
        main,
        types,
        entry: types ?? main,
        isPrivate: pkg.private === true,
      });
    }
  }
  return result;
}

/** Path with forward slashes, for display and for comparing against fixture text. */
export function toPosix(path: string): string {
  return path.split(sep).join('/');
}

/** `path` relative to the workspace root, POSIX separators. */
export function workspaceRelative(path: string, root: string = workspaceRoot()): string {
  return toPosix(relative(root, resolve(path)));
}

export interface WalkOptions {
  /** File extensions to keep, with the dot. Default: ['.ts']. */
  extensions?: readonly string[];
  /** Directory names never descended into. Default: node_modules, dist, coverage, .git. */
  skipDirs?: readonly string[];
}

const DEFAULT_SKIP = ['node_modules', 'dist', 'coverage', '.git'];

/** Absolute paths of every file under `dir` with a kept extension, sorted. */
export function walkFiles(dir: string, options: WalkOptions = {}): string[] {
  const extensions = options.extensions ?? ['.ts'];
  const skip = new Set(options.skipDirs ?? DEFAULT_SKIP);
  const out: string[] = [];
  const visit = (current: string): void => {
    for (const name of readdirSync(current).sort()) {
      const full = join(current, name);
      if (statSync(full).isDirectory()) {
        if (!skip.has(name)) visit(full);
      } else if (extensions.some((ext) => name.endsWith(ext))) {
        out.push(full);
      }
    }
  };
  if (existsSync(dir)) visit(dir);
  return out;
}
