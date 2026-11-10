/**
 * The one supported way to run Olympus from a checkout (R35, #55): build every
 * released package to JavaScript, pack each as npm would publish it, and
 * install the tarballs into an empty directory. The result is what a user
 * gets from the registry: `node_modules/.bin/factory-host` and
 * `node_modules/.bin/olympus-ai`, both JavaScript, neither reaching back into
 * the checkout.
 *
 *     node scripts/local-release.ts <empty directory>
 *
 * The conformance assertion `I9.packaged-host-runs` runs this script and then
 * the two executables it installed, so the path a user follows is the path
 * that is tested. Publishing to npm is the maintainer's and is not done here.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export interface ReleasedPackage {
  readonly name: string;
  readonly dir: string;
}

/** Every workspace package with a `build` script: the packages the release ships. */
export function releasedPackages(root: string = ROOT): ReleasedPackage[] {
  const out: ReleasedPackage[] = [];
  for (const parent of [join(root, 'packages'), join(root, 'packages', 'drivers')]) {
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      const file = join(parent, entry.name, 'package.json');
      if (!entry.isDirectory() || !existsSync(file)) continue;
      const pkg = JSON.parse(readFileSync(file, 'utf8')) as { name?: unknown; scripts?: Record<string, unknown> };
      if (typeof pkg.name === 'string' && typeof pkg.scripts?.build === 'string') out.push({ name: pkg.name, dir: join(parent, entry.name) });
    }
  }
  return out;
}

function run(command: string, args: readonly string[], cwd: string): string {
  // One command line, each argument quoted: on Windows pnpm and npm are .cmd shims that only a shell starts.
  const line = [command, ...args.map((a) => JSON.stringify(a))].join(' ');
  const result = spawnSync(line, { cwd, shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) {
    throw new Error(`local-release: ${command} ${args.join(' ')} exited ${String(result.status)} in ${cwd}\n${result.stdout}${result.stderr}`);
  }
  return result.stdout;
}

/**
 * Builds, packs, and installs into `target`, which must be absent or empty:
 * a directory that already holds an install could hide a file the tarballs
 * lack. Every workspace package is installed from its tarball by `overrides`,
 * so none is looked up on the registry by name (D-R35-05).
 */
export function localRelease(target: string, root: string = ROOT): void {
  const dest = resolve(target);
  if (existsSync(dest) && readdirSync(dest).length > 0) throw new Error(`local-release: ${dest} is not empty`);
  const packages = releasedPackages(root);
  if (packages.length === 0) throw new Error('local-release: no workspace package has a build script');
  // A file deleted from src/ must not survive in dist/ from an earlier build.
  for (const pkg of packages) rmSync(join(pkg.dir, 'dist'), { recursive: true, force: true });
  run('pnpm', ['build'], root);
  const tarballs = join(dest, 'tarballs');
  mkdirSync(tarballs, { recursive: true });
  const deps: Record<string, string> = {};
  for (const pkg of packages) {
    const before = new Set(readdirSync(tarballs));
    run('pnpm', ['pack', '--pack-destination', tarballs], pkg.dir);
    const made = readdirSync(tarballs).filter((f) => !before.has(f));
    if (made.length !== 1 || made[0] === undefined) throw new Error(`local-release: packing ${pkg.name} made ${String(made.length)} tarballs`);
    deps[pkg.name] = `file:./tarballs/${made[0]}`;
  }
  writeFileSync(join(dest, 'package.json'), `${JSON.stringify({ name: 'olympus-local-release', private: true, dependencies: deps, overrides: deps }, null, 2)}\n`);
  run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], dest);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = process.argv[2];
  if (target === undefined || target === '') {
    process.stderr.write('usage: node scripts/local-release.ts <empty directory>\n');
    process.exitCode = 2;
  } else {
    try {
      localRelease(target);
      process.stdout.write(`installed into ${resolve(target)}: node_modules/.bin/factory-host and node_modules/.bin/olympus-ai\n`);
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    }
  }
}
