/**
 * Which files a framework would run as test suites, derived the way that
 * framework derives it and without running anything the repository contains.
 *
 * vitest globs `include` under `test.dir` (or the project root) with
 * `exclude` as the ignore list, through tinyglobby, which is what vitest
 * itself calls (`globFiles`, `dot: true`, `expandDirectories: false`). jest
 * crawls each of `roots`, keeps files whose extension is in
 * `moduleFileExtensions` or is `snap`, drops `node_modules` and
 * `modulePathIgnorePatterns`, and then requires a match against `testMatch`
 * (jest-util's `globsToMatcher`) or `testRegex`, and no match against
 * `testPathIgnorePatterns` (@jest/core `SearchSource`).
 *
 * Two deliberate departures, each safer than the framework and recorded in
 * docs/decisions.md: symbolic links are never followed, and every directory
 * a config names must sit inside the repository, because the host is
 * enumerating a tree an agent wrote.
 */
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import picomatch from 'picomatch';
import { glob } from 'tinyglobby';
import ts from 'typescript';
import { compileLinearPattern, type LinearPattern } from './pattern.js';
import { assertUnlinkedDescent, exists, readRegularFile, SOURCE_FILE_CAP, toPosix, VCS_DIRECTORIES, walkTree } from './files.js';
import { declaredRange, readPackageManifest, type PackageManifest } from './manifest-file.js';
import { refuse } from './refusal.js';
import { JsonSettings, StaticSettings, type Settings } from './settings.js';
import {
  exportedConfig,
  isCallTo,
  parseModule,
  scopeOf,
  syntaxErrors,
  unwrap,
  Unresolvable,
  followBinding,
  type ModuleScope,
} from './static.js';
import { jestRules, VITEST_CONFIG_FILES, VITEST_WORKSPACE_FILES, vitestRules, type JestRules, type VitestRules } from './versions.js';

function resolved<T>(value: T | Unresolvable): T {
  if (value instanceof Unresolvable) refuse('unresolvable-config', value.why);
  return value;
}

/** A path a config names, which must resolve inside the repository it came from. */
function inside(repository: string, candidate: string, label: string): string {
  const path = resolve(candidate);
  const offset = relative(resolve(repository), path);
  if (offset.startsWith('..') || isAbsolute(offset)) {
    refuse('unresolvable-config', `${label} resolves to ${path}, outside the repository at ${repository}; nothing outside it is enumerated`);
  }
  return path;
}

/**
 * A directory a config names: inside the repository lexically, and reached
 * without passing through a link. Containment on the text of a path is not
 * containment on disk, because a link anywhere above the directory leads out
 * of the tree while the text still reads as inside it.
 */
async function insideDirectory(repository: string, candidate: string, label: string): Promise<string> {
  const path = inside(repository, candidate, label);
  await assertUnlinkedDescent(repository, path, label);
  return path;
}

/**
 * A glob a config states, which enumerates inside the repository only. vitest
 * itself globs wherever the pattern reaches; here a pattern that climbs out
 * of the repository, or names an absolute path, is refused instead — the
 * third departure toward the safe side recorded in D-P8-06, for the reason
 * the other two exist: the host is reading a tree an agent wrote.
 */
function assertContainedPattern(pattern: string, label: string): void {
  if (isAbsolute(pattern) || /^[A-Za-z]:[\\/]/.test(pattern)) {
    refuse('unresolvable-config', `${label} names an absolute path (${pattern}); patterns enumerate inside the repository only`);
  }
  if (toPosix(pattern).split('/').includes('..')) {
    refuse('unresolvable-config', `${label} climbs out of the repository (${pattern}); patterns enumerate inside the repository only`);
  }
}

async function requireManifest(root: string): Promise<PackageManifest> {
  const manifest = await readPackageManifest(root);
  if (manifest === null) refuse('unsupported-version', `${root} has no package.json, so no framework version is declared`);
  return manifest;
}

/**
 * A config module is read, never run — but the framework does run it, inside
 * the sandbox, and everything it imports runs with it. A module the
 * repository itself holds is code this package never sees change: it is not
 * a config file by path, so no config change is reported when it is edited,
 * and what it does when the framework loads the config — mutating a default
 * the config spreads, or reaching into the runner — is not in the file being
 * read. So a config that imports repository code is refused.
 *
 * An import of a package is left alone, for the reason `node_modules` is not
 * walked (D-P8-11): what a package contains is decided by the manifests and
 * lockfiles this package does report, and by the install the verification run
 * performs. A type-only import runs nothing.
 */
function assertImportsNoRepositoryCode(sf: ts.SourceFile, label: string): void {
  const refuseSpecifier = (specifier: string, node: ts.Node): void => {
    if (!/^(?:\.\.?[\\/]|[\\/]|[A-Za-z]:[\\/])/.test(specifier)) return;
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    refuse(
      'unsupported-feature',
      `${label} line ${String(line + 1)} imports "${specifier}" from the repository, which runs when the framework loads this config `
      + 'and can change what it yields; only packages and type-only imports are read',
    );
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.importClause?.phaseModifier !== ts.SyntaxKind.TypeKeyword) {
      refuseSpecifier(node.moduleSpecifier.text, node);
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier) && !node.isTypeOnly) {
      refuseSpecifier(node.moduleSpecifier.text, node);
    }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)
      && ts.isStringLiteral(node.moduleReference.expression)) {
      refuseSpecifier(node.moduleReference.expression.text, node);
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
      || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      const first = node.arguments[0];
      if (first !== undefined && ts.isStringLiteral(first)) refuseSpecifier(first.text, node);
    }
    node.forEachChild(visit);
  };
  visit(sf);
}

async function readConfigModule(path: string, known: ModuleScope['known']): Promise<ModuleScope> {
  const sf = parseModule(await readRegularFile(path, SOURCE_FILE_CAP), path);
  const errors = syntaxErrors(sf);
  if (errors.length > 0) refuse('unparseable', `${path} does not parse: ${errors.join('; ')}`);
  assertImportsNoRepositoryCode(sf, path);
  return scopeOf(sf, known);
}

// ---------------------------------------------------------------------------
// vitest

const VITE_MODULES: readonly string[] = ['vitest/config', 'vitest/node', 'vitest', 'vite'];

function vitestKnown(rules: VitestRules): ModuleScope['known'] {
  return (module, imported) => {
    if (!VITE_MODULES.includes(module)) return undefined;
    const pick = (path: readonly string[], name: string, value: readonly string[]): readonly string[] | undefined =>
      path.length === 1 && path[0] === name ? value : undefined;
    switch (imported) {
      case 'configDefaults':
        return (path) => pick(path, 'include', rules.include) ?? pick(path, 'exclude', rules.exclude);
      case 'defaultInclude':
        return (path) => (path.length === 0 ? rules.include : undefined);
      case 'defaultExclude':
        return (path) => (path.length === 0 ? rules.exclude : undefined);
      default:
        return undefined;
    }
  };
}

/**
 * The object a vitest config module exports: a literal, a `const` bound to
 * one, or `defineConfig`/`defineProject` from vitest or vite called with
 * either, or with a synchronous arrow whose body is one. `mergeConfig`, an
 * async factory, or a block-bodied function returns a value only running it
 * can produce, and is refused.
 */
function vitestConfigObject(scope: ModuleScope, label: string): ts.Expression | Unresolvable {
  let expression = exportedConfig(scope, label);
  if (expression instanceof Unresolvable) return expression;
  if (ts.isIdentifier(expression)) {
    const followed = followBinding(expression, scope);
    if (followed instanceof Unresolvable) return followed;
    expression = followed;
  }
  if (isCallTo(expression, scope, 'defineConfig', VITE_MODULES) || isCallTo(expression, scope, 'defineProject', VITE_MODULES)) {
    const [argument, ...extra] = expression.arguments;
    if (argument === undefined || extra.length > 0) return new Unresolvable(`${label} calls defineConfig with other than one argument`);
    const inner = unwrap(argument);
    if (ts.isArrowFunction(inner)) {
      const isAsync = inner.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) === true;
      if (isAsync || ts.isBlock(inner.body)) {
        return new Unresolvable(`${label} exports a config factory whose result only running it can produce`);
      }
      return unwrap(inner.body);
    }
    return inner;
  }
  return expression;
}

export interface VitestDiscovery {
  readonly rules: VitestRules;
  /** The directory `include` and `exclude` are relative to. */
  readonly cwd: string;
  readonly include: readonly string[];
  readonly exclude: readonly string[];
  /** Relative to the repository, or null when no config file exists and the defaults apply. */
  readonly configFile: string | null;
}

export async function vitestDiscovery(root: string): Promise<VitestDiscovery> {
  const manifest = await requireManifest(root);
  const range = declaredRange(manifest, 'vitest');
  if (range === undefined) refuse('unsupported-version', `${manifest.path} does not declare vitest`);
  const rules = vitestRules(range);

  for (const name of VITEST_WORKSPACE_FILES) {
    if (await exists(join(root, name))) {
      refuse('unsupported-feature', `${name} declares several vitest projects, and this package enumerates one project only`);
    }
  }
  let configFile: string | null = null;
  for (const name of VITEST_CONFIG_FILES) {
    if (await exists(join(root, name))) {
      configFile = name;
      break;
    }
  }
  if (configFile === null) return { rules, cwd: resolve(root), include: rules.include, exclude: rules.exclude, configFile };

  const scope = await readConfigModule(join(root, configFile), vitestKnown(rules));
  const config = resolved(StaticSettings.of(resolved(vitestConfigObject(scope, configFile)), scope, configFile));
  const test: Settings | undefined = resolved(config.object('test'));

  for (const key of ['projects', 'workspace']) {
    if (test?.keys().includes(key) === true) {
      refuse('unsupported-feature', `${configFile} sets test.${key}, which declares several vitest projects, and this package enumerates one project only`);
    }
  }
  const includeSource = resolved(test?.strings('includeSource'));
  if (includeSource !== undefined && includeSource.length > 0) {
    refuse('unsupported-feature', `${configFile} sets test.includeSource, and in-source tests are not enumerated by this package`);
  }
  const typecheck = resolved(test?.object('typecheck'));
  if (resolved(typecheck?.boolean('enabled')) === true) {
    refuse('unsupported-feature', `${configFile} enables test.typecheck, and type-level test files are not enumerated by this package`);
  }

  const viteRoot = resolved(config.string('root'));
  const testRoot = resolved(test?.string('root'));
  if (viteRoot !== undefined && testRoot !== undefined && resolve(root, viteRoot) !== resolve(root, testRoot)) {
    refuse('unresolvable-config', `${configFile} sets both root and test.root, to different directories`);
  }
  const projectRoot = await insideDirectory(root, resolve(root, testRoot ?? viteRoot ?? '.'), `${configFile} root`);
  const dir = resolved(test?.string('dir'));
  const cwd = dir === undefined ? projectRoot : await insideDirectory(root, resolve(projectRoot, dir), `${configFile} test.dir`);
  const include = resolved(test?.strings('include')) ?? rules.include;
  include.forEach((pattern, i) => {
    assertContainedPattern(pattern, `${configFile} test.include[${String(i)}]`);
  });
  return {
    rules,
    cwd,
    include,
    exclude: resolved(test?.strings('exclude')) ?? rules.exclude,
    configFile,
  };
}

export async function vitestSuites(root: string): Promise<string[]> {
  const discovery = await vitestDiscovery(root);
  const found = await glob([...discovery.include], {
    cwd: discovery.cwd,
    ignore: [...discovery.exclude],
    dot: true,
    expandDirectories: false,
    followSymbolicLinks: false,
    absolute: true,
  });
  // Containment is asserted again on what came back: the patterns were checked, and this is the
  // answer, which is what the rest of the runtime acts on.
  const label = `${discovery.configFile ?? 'the vitest defaults'} test.include`;
  return found.map((file) => inside(root, resolve(file), label)).sort();
}

// ---------------------------------------------------------------------------
// jest

/**
 * The ts-jest presets, each of which sets `transform` and at most
 * `extensionsToTreatAsEsm` and nothing that decides discovery (ts-jest 29,
 * dist/presets/all-presets.js and create-jest-preset.js). Any other preset
 * is a module that can set `testMatch` or `roots`, and is refused.
 */
const DISCOVERY_NEUTRAL_PRESETS: ReadonlySet<string> = new Set(
  ['default', 'js-with-ts', 'js-with-babel'].flatMap((name) =>
    ['', '-legacy', '-esm', '-esm-legacy'].map((suffix) => `ts-jest/presets/${name}${suffix}`),
  ).concat('ts-jest'),
);

const JEST_DEFAULT_IGNORE = ['/node_modules/'];

function jestKnown(rules: JestRules): ModuleScope['known'] {
  return (module, imported) => {
    if (module !== 'jest-config' || imported !== 'defaults') return undefined;
    return (path) => {
      if (path.length !== 1) return undefined;
      if (path[0] === 'testMatch') return rules.testMatch;
      if (path[0] === 'moduleFileExtensions') return rules.moduleFileExtensions;
      if (path[0] === 'testPathIgnorePatterns') return JEST_DEFAULT_IGNORE;
      return undefined;
    };
  };
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A jest pattern, compiled so that matching it costs the pattern's size times
 * the path's length and never more, and refused where it states syntax that
 * cannot be matched that way.
 *
 * The runtime evaluates these patterns on its own host, against paths the
 * same repository chose, so a pattern that can hang the matcher hangs the
 * service (I9). Refusing the shapes that backtrack exponentially is not
 * enough — `a*a*a*a*a*a*a*a*b$` has no nested quantifier and still costs a
 * high power of the path's length — so the pattern is not handed to a
 * backtracking engine at all. See `pattern.ts`.
 */
export function assertLinearPattern(pattern: string, label: string): LinearPattern {
  return compileLinearPattern(pattern, label);
}

/** jest-util `globsToMatcher`, with the same picomatch options and the same ordering rule for negations. */
export function globsToMatcher(globs: readonly string[]): (path: string) => boolean {
  if (globs.length === 0) return () => false;
  const matchers = globs.map((pattern) => {
    const isMatch = picomatch(pattern, { dot: true }, true);
    return { isMatch, negated: isMatch.state.negated || isMatch.state.negatedExtglob === true };
  });
  return (path) => {
    let kept: boolean | undefined;
    let negatives = 0;
    for (const { isMatch, negated } of matchers) {
      if (negated) negatives++;
      const matched = isMatch(path);
      if (!matched && negated) kept = false;
      else if (matched && !negated) kept = true;
    }
    return negatives === matchers.length ? kept !== false : kept === true;
  };
}

async function jestSettings(root: string, manifest: PackageManifest, rules: JestRules): Promise<{ settings: Settings; source: string }> {
  const sources: string[] = [];
  for (const ext of rules.configExtensions) if (await exists(join(root, `jest.config${ext}`))) sources.push(`jest.config${ext}`);
  const fromManifest = 'jest' in manifest.value;
  if (fromManifest) sources.push('package.json#jest');
  if (sources.length > 1) {
    refuse('unsupported-feature', `jest finds more than one config (${sources.join(', ')}) and refuses to choose; so does this package`);
  }
  const [source] = sources;
  if (source === undefined) return { settings: new JsonSettings('defaults', {}), source: 'defaults' };
  if (fromManifest) {
    const value = manifest.value.jest;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      refuse('unresolvable-config', `package.json#jest is not an object`);
    }
    return { settings: new JsonSettings(source, value as Record<string, unknown>), source };
  }
  const path = join(root, source);
  if (source.endsWith('.json')) {
    let value: unknown;
    try {
      value = JSON.parse(await readRegularFile(path, SOURCE_FILE_CAP));
    } catch (error) {
      refuse('unparseable', `${source} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) refuse('unresolvable-config', `${source} is not an object`);
    return { settings: new JsonSettings(source, value as Record<string, unknown>), source };
  }
  const scope = await readConfigModule(path, jestKnown(rules));
  return { settings: resolved(StaticSettings.of(resolved(exportedConfig(scope, source)), scope, source)), source };
}

export interface JestDiscovery {
  readonly rules: JestRules;
  readonly roots: readonly string[];
  readonly accept: (absolutePosixPath: string) => boolean;
}

export async function jestDiscovery(root: string): Promise<JestDiscovery> {
  const manifest = await requireManifest(root);
  const range = declaredRange(manifest, 'jest');
  if (range === undefined) refuse('unsupported-version', `${manifest.path} does not declare jest`);
  const rules = jestRules(range);
  const { settings, source } = await jestSettings(root, manifest, rules);

  if (settings.keys().includes('projects')) {
    refuse('unsupported-feature', `${source} sets projects, which declares several jest projects, and this package enumerates one project only`);
  }
  const preset = resolved(settings.string('preset'));
  if (preset !== undefined && !DISCOVERY_NEUTRAL_PRESETS.has(preset)) {
    refuse('unsupported-feature', `${source} uses the preset "${preset}", which is a module that can change which files are tests`);
  }
  const haste = resolved(settings.object('haste'));
  for (const key of ['enableSymlinks', 'retainAllFiles']) {
    if (resolved(haste?.boolean(key)) === true) refuse('unsupported-feature', `${source} sets haste.${key}, which changes which files jest crawls`);
  }

  const rootDir = await insideDirectory(root, resolve(root, resolved(settings.string('rootDir')) ?? '.'), `${source} rootDir`);
  const rootDirPosix = toPosix(rootDir);
  const withRootDir = (value: string): string => value.replaceAll('<rootDir>', rootDirPosix);
  const withRootDirPattern = (value: string): string => value.replaceAll('<rootDir>', escapeRegex(rootDirPosix));

  const roots = await Promise.all(
    (resolved(settings.strings('roots')) ?? ['<rootDir>']).map(async (r) =>
      insideDirectory(root, resolve(rootDir, withRootDir(r)), `${source} roots`),
    ),
  );
  const testRegex = resolved(settings.strings('testRegex', true)) ?? [];
  const explicitMatch = resolved(settings.strings('testMatch', true));
  if (testRegex.length > 0 && explicitMatch !== undefined && explicitMatch.length > 0) {
    refuse('unresolvable-config', `${source} sets both testMatch and testRegex, which jest refuses`);
  }
  const testMatch = (explicitMatch ?? (testRegex.length > 0 ? [] : rules.testMatch)).map(withRootDir);
  const ignore = (resolved(settings.strings('testPathIgnorePatterns')) ?? JEST_DEFAULT_IGNORE).map(withRootDirPattern);
  const moduleIgnore = (resolved(settings.strings('modulePathIgnorePatterns')) ?? []).map(withRootDirPattern);
  const cacheDirectory = resolved(settings.string('cacheDirectory'));
  if (cacheDirectory !== undefined) {
    const cache = toPosix(resolve(rootDir, withRootDir(cacheDirectory)));
    if (cache.startsWith(`${rootDirPosix}/`)) moduleIgnore.push(escapeRegex(cache));
  }
  const extensions = new Set(['snap', ...(resolved(settings.strings('moduleFileExtensions')) ?? rules.moduleFileExtensions)]);

  const matchesGlob = globsToMatcher(testMatch);
  const regexes = testRegex.map((pattern) => assertLinearPattern(pattern, `${source} testRegex`));
  const ignored = ignore.length === 0 ? undefined : assertLinearPattern(ignore.join('|'), `${source} testPathIgnorePatterns`);
  const hidden = moduleIgnore.length === 0 ? undefined : assertLinearPattern(moduleIgnore.join('|'), `${source} modulePathIgnorePatterns`);

  const accept = (path: string): boolean => {
    if (!extensions.has(extname(path).slice(1))) return false;
    if (hidden?.test(path) === true) return false;
    if (testMatch.length > 0 && !matchesGlob(path)) return false;
    if (ignored?.test(path) === true) return false;
    if (regexes.length > 0 && !regexes.some((regex) => regex.test(path))) return false;
    return true;
  };
  return { rules, roots, accept };
}

export async function jestSuites(root: string): Promise<string[]> {
  const discovery = await jestDiscovery(root);
  const found = new Set<string>();
  for (const dir of discovery.roots) {
    if (!(await exists(dir))) continue;
    const entries = await walkTree(dir, { skipDirectory: (name) => name === 'node_modules' || VCS_DIRECTORIES.has(name) });
    for (const [relativePath, entry] of entries) {
      // jest's crawler ignores symbolic links unless haste.enableSymlinks is set, which is refused above.
      if (entry.kind !== 'file') continue;
      const absolute = resolve(dir, relativePath);
      if (discovery.accept(toPosix(absolute))) found.add(absolute);
    }
  }
  return [...found].sort();
}
