/**
 * Suite enumeration: what each framework would run, read without running
 * anything the repository holds, and refused wherever the config cannot be
 * read that way.
 */
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { AdapterRefusal, JestAdapter, VitestAdapter } from '../src/index.js';
import { assertLinearPattern, globsToMatcher } from '../src/discovery.js';
import { cleanup, linkDirectory, pkg, repo, write } from './repo.js';

afterEach(cleanup);

const vitest = new VitestAdapter(4);
const jest = new JestAdapter(30);

function names(root: string, files: readonly string[]): string[] {
  return files.map((f) => f.slice(resolve(root).length + 1).replaceAll('\\', '/'));
}

async function refusal(promise: Promise<unknown>): Promise<AdapterRefusal> {
  const error = await promise.then(() => undefined, (e: unknown) => e);
  if (!(error instanceof AdapterRefusal)) throw new Error(`expected an AdapterRefusal, got ${String(error)}`);
  return error;
}

describe('vitest', () => {
  test('with no config, the defaults of the declared major: test and spec files, node_modules excluded', async () => {
    const root = await repo({
      'package.json': pkg({ vitest: '^4.1.0' }),
      'src/a.test.ts': '',
      'src/b.spec.mts': '',
      'src/c.ts': '',
      'src/.hidden/d.test.js': '',
      'node_modules/dep/e.test.ts': '',
      'dist/f.test.js': '',
    });
    expect(names(root, await vitest.enumerateSuites(root))).toEqual(['dist/f.test.js', 'src/.hidden/d.test.js', 'src/a.test.ts', 'src/b.spec.mts']);
  });

  test('vitest 3 excludes what its own defaults exclude, dist and config files among them', async () => {
    const root = await repo({ 'package.json': pkg({ vitest: '~3.2.4' }), 'src/a.test.ts': '', 'dist/f.test.js': '' });
    expect(names(root, await vitest.enumerateSuites(root))).toEqual(['src/a.test.ts']);
  });

  test('deleting a test file shrinks the list', async () => {
    const root = await repo({ 'package.json': pkg({ vitest: '4' }), 'a.test.ts': '', 'b.test.ts': '' });
    expect(await vitest.enumerateSuites(root)).toHaveLength(2);
    await rm(join(root, 'b.test.ts'));
    expect(names(root, await vitest.enumerateSuites(root))).toEqual(['a.test.ts']);
  });

  test('literal include and exclude are honoured, and configDefaults resolves to the declared major', async () => {
    const root = await repo({
      'package.json': pkg({ vitest: '^4.0.0' }),
      'vitest.config.ts': [
        "import { configDefaults, defineConfig } from 'vitest/config';",
        'export default defineConfig({',
        "  plugins: [someVitePlugin()],",
        "  test: { include: ['test/**/*.check.ts'], exclude: [...configDefaults.exclude, 'test/slow/**'] },",
        '});',
      ].join('\n'),
      'test/a.check.ts': '',
      'test/slow/b.check.ts': '',
      'test/c.test.ts': '',
    });
    expect(names(root, await vitest.enumerateSuites(root))).toEqual(['test/a.check.ts']);
  });

  test('test.dir and a const bound config, read through `satisfies`, are followed', async () => {
    const root = await repo({
      'package.json': pkg({ vitest: '4.1.11' }),
      'vite.config.mts': [
        "import type { UserConfig } from 'vite';",
        "const config = { test: { dir: 'packages' } } satisfies UserConfig;",
        'export default config;',
      ].join('\n'),
      'packages/x/a.test.ts': '',
      'other/b.test.ts': '',
    });
    expect(names(root, await vitest.enumerateSuites(root))).toEqual(['packages/x/a.test.ts']);
  });

  test('vitest.config wins over vite.config, as vitest reads them', async () => {
    const root = await repo({
      'package.json': pkg({ vitest: '4' }),
      'vitest.config.ts': "export default { test: { include: ['**/*.a.ts'] } };",
      'vite.config.ts': "export default { test: { include: ['**/*.b.ts'] } };",
      'x.a.ts': '',
      'x.b.ts': '',
    });
    expect(names(root, await vitest.enumerateSuites(root))).toEqual(['x.a.ts']);
  });

  test.each([
    ['a computed include', "export default { test: { include: process.env.CI ? ['a'] : ['b'] } };", 'unresolvable-config'],
    // A package import, so what is refused is the spread and not the import.
    ['a spread of an unknown object', 'import base from "some-preset"; export default { ...base };', 'unresolvable-config'],
    ['mergeConfig', "import { mergeConfig } from 'vitest/config'; export default mergeConfig({}, {});", 'unresolvable-config'],
    ['a block-bodied factory', "import { defineConfig } from 'vitest/config'; export default defineConfig(() => { return {}; });", 'unresolvable-config'],
    ['a binding changed after it is declared', "const c = { test: { include: ['a'] } }; c.test.include.push('b'); export default c;", 'unresolvable-config'],
    ['configDefaults changed in place', "import { configDefaults } from 'vitest/config'; configDefaults.exclude.push('x'); export default { test: { exclude: [...configDefaults.exclude] } };", 'unresolvable-config'],
    ['in-source tests', "export default { test: { includeSource: ['src/**/*.ts'] } };", 'unsupported-feature'],
    ['several projects', "export default { test: { projects: ['a', 'b'] } };", 'unsupported-feature'],
    ['type-level tests', 'export default { test: { typecheck: { enabled: true } } };', 'unsupported-feature'],
    ['a test.dir outside the repository', "export default { test: { dir: '../..' } };", 'unresolvable-config'],
    ['a config that does not parse', 'export default { test: { include: [ } };', 'unparseable'],
  ])('%s is refused, naming why, rather than enumerated with the defaults', async (_, config, reason) => {
    const root = await repo({ 'package.json': pkg({ vitest: '4' }), 'vitest.config.ts': config, 'a.test.ts': '' });
    expect((await refusal(vitest.enumerateSuites(root))).reason).toBe(reason);
  });

  test.each(['*', '>=3', '^3 || ^4', 'latest', 'workspace:*', '^2.0.0', '5.0.0'])(
    'a declared range of "%s" selects no single supported major and is refused',
    async (range) => {
      const root = await repo({ 'package.json': pkg({ vitest: range }), 'a.test.ts': '' });
      expect((await refusal(vitest.enumerateSuites(root))).reason).toBe('unsupported-version');
    },
  );

  test('a vitest.workspace file is refused: several projects are not enumerated', async () => {
    const root = await repo({ 'package.json': pkg({ vitest: '3.2.4' }), 'vitest.workspace.ts': 'export default []', 'a.test.ts': '' });
    expect((await refusal(vitest.enumerateSuites(root))).reason).toBe('unsupported-feature');
  });

  test('a linked directory is never traversed, so a link to a tree outside the repository adds no suite', async () => {
    const outside = await repo({ 'escape.test.ts': '' });
    const root = await repo({ 'package.json': pkg({ vitest: '4' }), 'a.test.ts': '' });
    await linkDirectory(outside, join(root, 'linked'));
    expect(names(root, await vitest.enumerateSuites(root))).toEqual(['a.test.ts']);
  });

  test('test.dir is refused when it reaches its directory through a link, which lexical containment accepts', async () => {
    const outside = await repo({ 'tests/escape.test.ts': '' });
    const root = await repo({ 'package.json': pkg({ vitest: '4' }), 'vitest.config.ts': "export default { test: { dir: 'linked/tests' } };\n" });
    await linkDirectory(outside, join(root, 'linked'));
    expect((await refusal(vitest.enumerateSuites(root))).reason).toBe('unsafe-path');
  });

  test('a config that mutates its own export after setting it is refused, not read as the first value', async () => {
    const root = await repo({
      'package.json': pkg({ jest: '30' }),
      'jest.config.js': "module.exports = { testMatch: ['**/*.test.ts'] };\nmodule.exports.testMatch = ['**/*.check.ts'];\n",
      'a.test.ts': '',
      'a.check.ts': '',
    });
    expect((await refusal(jest.enumerateSuites(root))).reason).toBe('unresolvable-config');
  });

  test('a known default read twice without copying is refused: one reference can change what the other reads', async () => {
    const root = await repo({
      'package.json': pkg({ vitest: '4' }),
      'vitest.config.ts': [
        "import { configDefaults } from 'vitest/config';",
        'const holder = { list: configDefaults.exclude };',
        "holder.list.push('**/*');",
        'export default { test: { exclude: [...configDefaults.exclude] } };',
      ].join('\n'),
      'a.test.ts': '',
    });
    expect((await refusal(vitest.enumerateSuites(root))).reason).toBe('unresolvable-config');
  });

  test.each([
    ['a side-effect import of repository code', "import './mutator.js';\nexport default {};"],
    ['a named import of repository code', "import { x } from './helpers.js';\nexport default { test: {} };"],
    ['a require of repository code', "const x = require('./helpers.js');\nmodule.exports = {};"],
  ])('%s in a config is refused: it runs when the framework loads the config', async (_, config) => {
    const root = await repo({ 'package.json': pkg({ vitest: '4' }), 'vitest.config.ts': config, 'a.test.ts': '' });
    expect((await refusal(vitest.enumerateSuites(root))).reason).toBe('unsupported-feature');
  });

  test('a type-only import, and a package import, are left alone', async () => {
    const root = await repo({
      'package.json': pkg({ vitest: '4' }),
      'vitest.config.ts': [
        "import type { UserConfig } from 'vitest/config';",
        "import { configDefaults } from 'vitest/config';",
        "export default { test: { exclude: [...configDefaults.exclude], include: ['**/*.spec.ts'] } } satisfies UserConfig;",
      ].join('\n'),
      'a.spec.ts': '',
      'a.test.ts': '',
    });
    expect(names(root, await vitest.enumerateSuites(root))).toEqual(['a.spec.ts']);
  });

  test.each([
    ['a pattern that climbs out of the repository', "['../secret/**/*.test.ts']"],
    ['an absolute pattern', "['/etc/**/*.test.ts']"],
  ])('%s is refused rather than globbed', async (_, include) => {
    const root = await repo({
      'package.json': pkg({ vitest: '4' }),
      'vitest.config.ts': `export default { test: { include: ${include} } };\n`,
      'a.test.ts': '',
    });
    expect((await refusal(vitest.enumerateSuites(root))).reason).toBe('unresolvable-config');
  });
});

describe('jest', () => {
  test('with no config, the testMatch of the declared major: __tests__ and .test/.spec files', async () => {
    const root = await repo({
      'package.json': pkg({ jest: '^30.0.0' }),
      '__tests__/a.ts': '',
      'src/b.test.mts': '',
      'src/c.spec.js': '',
      'src/d.ts': '',
      'node_modules/x/e.test.js': '',
    });
    expect(names(root, await jest.enumerateSuites(root))).toEqual(['__tests__/a.ts', 'src/b.test.mts', 'src/c.spec.js']);
  });

  test('jest 29 does not treat .mts as a test file; jest 30 does', async () => {
    const files = { '__tests__/a.mts': '', 'b.test.ts': '' };
    const on29 = await repo({ 'package.json': pkg({ jest: '^29.7.0' }), ...files });
    const on30 = await repo({ 'package.json': pkg({ jest: '^30.2.0' }), ...files });
    expect(names(on29, await jest.enumerateSuites(on29))).toEqual(['b.test.ts']);
    expect(names(on30, await jest.enumerateSuites(on30))).toEqual(['__tests__/a.mts', 'b.test.ts']);
  });

  test('roots, testPathIgnorePatterns, and <rootDir> are honoured from package.json#jest', async () => {
    const root = await repo({
      'package.json': pkg({ jest: '30' }, { jest: { roots: ['<rootDir>/src'], testPathIgnorePatterns: ['/node_modules/', '<rootDir>/src/legacy/'] } }),
      'src/a.test.ts': '',
      'src/legacy/b.test.ts': '',
      'test/c.test.ts': '',
    });
    expect(names(root, await jest.enumerateSuites(root))).toEqual(['src/a.test.ts']);
  });

  test('testRegex replaces testMatch, and a const bound config in jest.config.ts is read through its type annotation', async () => {
    const root = await repo({
      'package.json': pkg({ jest: '30.2.0' }),
      'jest.config.ts': [
        "import type { Config } from 'jest';",
        "const config: Config = { preset: 'ts-jest', testRegex: '/checks/.*\\\\.ts$' };",
        'export default config;',
      ].join('\n'),
      'checks/a.ts': '',
      'b.test.ts': '',
    });
    expect(names(root, await jest.enumerateSuites(root))).toEqual(['checks/a.ts']);
  });

  test('a negated testMatch pattern only removes when a positive pattern precedes it, as jest-util orders them', () => {
    const match = globsToMatcher(['**/*.test.ts', '!**/fixtures/**']);
    expect(match('/r/a.test.ts')).toBe(true);
    expect(match('/r/fixtures/a.test.ts')).toBe(false);
    const onlyNegated = globsToMatcher(['!**/fixtures/**']);
    expect(onlyNegated('/r/a.ts')).toBe(true);
  });

  test.each([
    ['two config sources', { 'jest.config.js': 'module.exports = {};', 'package.json': pkg({ jest: '30' }, { jest: {} }) }, 'unsupported-feature'],
    ['a preset that is a module', { 'jest.config.json': '{"preset": "my-preset"}' }, 'unsupported-feature'],
    ['several projects', { 'jest.config.json': '{"projects": ["a"]}' }, 'unsupported-feature'],
    ['both testMatch and testRegex', { 'jest.config.json': '{"testMatch": ["**/*.t.ts"], "testRegex": "x"}' }, 'unresolvable-config'],
    ['an async config factory', { 'jest.config.js': 'module.exports = async () => ({});' }, 'unresolvable-config'],
    ['symlinks enabled', { 'jest.config.json': '{"haste": {"enableSymlinks": true}}' }, 'unsupported-feature'],
    ['a pattern that cannot be matched in one pass', { 'jest.config.json': '{"testRegex": "(a)\\\\1$"}' }, 'unsupported-feature'],
    ['roots outside the repository', { 'jest.config.json': '{"roots": ["<rootDir>/.."]}' }, 'unresolvable-config'],
  ])('%s is refused', async (_, files, reason) => {
    const root = await repo({ 'package.json': pkg({ jest: '30' }), 'a.test.ts': '', ...files });
    expect((await refusal(jest.enumerateSuites(root))).reason).toBe(reason);
  });

  test('a testRegex that would backtrack for minutes enumerates at once, against a path chosen to provoke it', async () => {
    const root = await repo({
      'package.json': pkg({ jest: '30' }, { jest: { testRegex: 'a*a*a*a*a*a*a*a*b\\.ts$' } }),
      [`${'a'.repeat(200)}b.ts`]: '',
      [`${'a'.repeat(200)}.ts`]: '',
    });
    const started = performance.now();
    expect(names(root, await jest.enumerateSuites(root))).toEqual([`${'a'.repeat(200)}b.ts`]);
    expect(performance.now() - started).toBeLessThan(5000);
  });

  test('a root that reaches its directory through a link is refused, and nothing outside is enumerated', async () => {
    const outside = await repo({ 'tests/escape.test.ts': '' });
    const root = await repo({ 'package.json': pkg({ jest: '30' }, { jest: { roots: ['<rootDir>/linked/tests'] } }) });
    await linkDirectory(outside, join(root, 'linked'));
    expect((await refusal(jest.enumerateSuites(root))).reason).toBe('unsafe-path');
  });
});

describe('a config is read, never run', () => {
  /*
   * The scan in packages/conformance proves no adapter source names a way to run code. This
   * proves the property the scan exists to protect, from the outside: a config that writes a file
   * the moment it is evaluated leaves no such file behind. It fails whenever parsing is replaced
   * by loading, however that loading is spelled, and it would fail against a `jiti`, a dynamic
   * `import`, or a `require` the scan had not been taught to recognise.
   */
  test.each([
    ['vitest', 'vitest.config.ts', pkg({ vitest: '4' }), (marker: string) => `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran');\nmodule.exports = { test: { include: ['**/*.test.ts'] } };\n`],
    ['jest', 'jest.config.js', pkg({ jest: '30' }), (marker: string) => `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran');\nmodule.exports = { testMatch: ['**/*.test.ts'] };\n`],
  ])('%s: a config that would write a file when it is evaluated writes nothing', async (name, configFile, manifest, body) => {
    const root = await repo({ 'package.json': manifest, 'a.test.ts': '' });
    const marker = join(root, 'evaluated.txt');
    await write(root, { [configFile]: body(marker.replaceAll('\\', '/')) });
    const adapter = name === 'vitest' ? vitest : jest;
    // Whether it enumerates or refuses is the config's business; that nothing ran is not.
    await adapter.enumerateSuites(root).catch(() => undefined);
    expect(existsSync(marker)).toBe(false);
  });
});

describe('pattern safety', () => {
  test.each([
    '/node_modules/',
    '(/__tests__/.*|(\\.|/)(test|spec))\\.[mc]?[jt]sx?$',
    '\\.check\\.ts$',
    'a{2,3}b',
    '(?:spec|test)\\.ts$',
    '(?:x)+',
    '(?<name>a)b',
    // Shapes a backtracking engine takes exponential time over. They are matched here in one
    // pass, so there is nothing to refuse: the cost no longer depends on the shape.
    '(a+)+',
    '(a|aa)*',
    '(x*)*y',
    '(?:a+)+',
    '(?:a|b)*',
  ])('%s is accepted', (pattern) => {
    expect(assertLinearPattern(pattern, 'test').source).toBe(pattern);
  });

  test.each([
    ['a backreference', '(a)\\1'],
    ['a named backreference', '(?<n>a)\\k<n>'],
    ['a lookahead', 'a(?=b)'],
    ['a negative lookahead', 'a(?!b)'],
    ['a lookbehind', '(?<=a)b'],
    ['a unicode property escape', '\\p{L}+'],
    ['an unclosed group', '(a'],
  ])('%s is refused: it cannot be matched in one pass', (_, pattern) => {
    expect(() => assertLinearPattern(pattern, 'test')).toThrow(AdapterRefusal);
  });

  test('a pattern that a backtracking engine takes a high power of the path to match is matched at once', () => {
    const pattern = assertLinearPattern('a*a*a*a*a*a*a*a*b$', 'test');
    const path = `/repo/${'a'.repeat(4000)}.ts`;
    const started = performance.now();
    expect(pattern.test(path)).toBe(false);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  /** A grammar of what the matcher accepts, so the cases are patterns it must agree with RegExp on. */
  function pattern(next: () => number): string {
    const atom = (): string => {
      const pick = next() % 8;
      if (pick === 0) return 'a';
      if (pick === 1) return 'b';
      if (pick === 2) return '/';
      if (pick === 3) return '.';
      if (pick === 4) return '\\.';
      if (pick === 5) return '[ab]';
      if (pick === 6) return '[^a/]';
      return '\\d';
    };
    const piece = (depth: number): string => {
      const body = depth > 0 && next() % 4 === 0 ? `(${expression(depth - 1)})` : atom();
      const quantifier = next() % 5;
      if (quantifier === 0) return `${body}*`;
      if (quantifier === 1) return `${body}+`;
      if (quantifier === 2) return `${body}?`;
      if (quantifier === 3) return `${body}{1,2}`;
      return body;
    };
    const sequence = (depth: number): string => Array.from({ length: 1 + (next() % 3) }, () => piece(depth)).join('');
    const expression = (depth: number): string =>
      Array.from({ length: 1 + (next() % 2) }, () => sequence(depth)).join('|');
    const anchors = next() % 4;
    const body = expression(2);
    return `${anchors === 1 ? '^' : ''}${body}${anchors === 2 ? '$' : ''}`;
  }

  test.each(Array.from({ length: 300 }, (_, seed) => seed))('seed %i: the same answer as the engine it replaces', (seed) => {
    let state = seed + 1;
    const next = (): number => {
      state = (state * 1103515245 + 12345) % 2 ** 31;
      return state >>> 8;
    };
    const source = pattern(next);
    const compiled = assertLinearPattern(source, 'oracle');
    const engine = new RegExp(source);
    for (let i = 0; i < 12; i++) {
      const input = Array.from({ length: next() % 9 }, () => 'ab/.9x'[next() % 6] ?? 'a').join('');
      expect([source, input, compiled.test(input)]).toEqual([source, input, engine.test(input)]);
    }
  });
});
