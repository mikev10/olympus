/**
 * Suite enumeration: what each framework would run, read without running
 * anything the repository holds, and refused wherever the config cannot be
 * read that way.
 */
import { rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { AdapterRefusal, JestAdapter, VitestAdapter } from '../src/index.js';
import { assertLinearPattern, globsToMatcher } from '../src/discovery.js';
import { cleanup, linkDirectory, pkg, repo } from './repo.js';

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
    ['a spread of an unknown object', 'import base from "./base"; export default { ...base };', 'unresolvable-config'],
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
    ['a pattern that can take exponential time', { 'jest.config.json': '{"testRegex": "(a+)+$"}' }, 'unsupported-feature'],
    ['roots outside the repository', { 'jest.config.json': '{"roots": ["<rootDir>/.."]}' }, 'unresolvable-config'],
  ])('%s is refused', async (_, files, reason) => {
    const root = await repo({ 'package.json': pkg({ jest: '30' }), 'a.test.ts': '', ...files });
    expect((await refusal(jest.enumerateSuites(root))).reason).toBe(reason);
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
    'a(?=b)',
  ])('%s is accepted', (pattern) => {
    expect(assertLinearPattern(pattern, 'test')).toBeInstanceOf(RegExp);
  });

  test.each(['(a+)+', '(a|aa)*', '(x*)*y', '(a)\\1', '(?:a+)+', '(?:a|b)*', '(?<n>a)\\k<n>'])('%s is refused', (pattern) => {
    expect(() => assertLinearPattern(pattern, 'test')).toThrow(AdapterRefusal);
  });
});
