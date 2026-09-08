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
  /** package.json `types` (or `main`) as written: the published entry. */
  entry: string | undefined;
  /** package.json `private`. */
  isPrivate: boolean;
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
 * Every package the workspace glob `packages/*` matches, in directory order.
 * The list is read from disk on each call so a test that creates a package
 * in a temporary tree sees it.
 */
export function workspacePackages(root: string = workspaceRoot()): WorkspacePackage[] {
  const packagesDir = join(root, 'packages');
  if (!existsSync(packagesDir)) return [];
  const result: WorkspacePackage[] = [];
  for (const name of readdirSync(packagesDir).sort()) {
    const dir = join(packagesDir, name);
    if (!statSync(dir).isDirectory()) continue;
    const pkg = readPackageJson(dir);
    if (pkg === undefined || typeof pkg.name !== 'string') continue;
    const entry = typeof pkg.types === 'string' ? pkg.types : typeof pkg.main === 'string' ? pkg.main : undefined;
    result.push({
      name: pkg.name,
      dir,
      relativeDir: toPosix(relative(root, dir)),
      entry,
      isPrivate: pkg.private === true,
    });
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
