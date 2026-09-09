/**
 * The conformance tsconfig's `paths` map: each sibling package name to its
 * published entry, relative to this package. The kit has no package.json
 * dependency on any sibling (D-F3-04), so this map is how a fixture reaches
 * a contract. It has two readers that must agree: the compiler, for
 * typecheck and the fixture compiler; and vitest.config.ts, which turns it
 * into `resolve.alias` so a runtime assertion's `import('@olympus-ai/api')`
 * resolves to the same file a fixture typechecks against. One map, two
 * readers. I8.fixture-paths-match-published-entries asserts the map and the
 * package manifests agree.
 */
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { conformanceRoot } from './workspace.js';

/** Every `paths` entry of packages/conformance/tsconfig.json whose targets are all strings. */
export function conformancePathsMap(): Record<string, string[]> {
  const file = join(conformanceRoot(), 'tsconfig.json');
  const read = ts.readConfigFile(file, (path) => ts.sys.readFile(path));
  const config: unknown = read.config;
  if (typeof config !== 'object' || config === null || !('compilerOptions' in config)) return {};
  const options: unknown = config.compilerOptions;
  if (typeof options !== 'object' || options === null || !('paths' in options)) return {};
  const paths: unknown = options.paths;
  if (typeof paths !== 'object' || paths === null) return {};
  const out: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(paths)) {
    if (Array.isArray(value) && value.every((v) => typeof v === 'string')) out[key] = value;
  }
  return out;
}

/**
 * The map as vitest `resolve.alias`: each package name to the absolute path
 * of its single target. A name mapped to zero or several targets is an
 * error here, as it is in I8.fixture-paths-match-published-entries.
 */
export function conformanceAliases(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, targets] of Object.entries(conformancePathsMap())) {
    const target = targets[0];
    if (targets.length !== 1 || target === undefined) {
      throw new Error(`conformance: ${name} must map to exactly one target in packages/conformance/tsconfig.json`);
    }
    out[name] = resolve(conformanceRoot(), target);
  }
  return out;
}
