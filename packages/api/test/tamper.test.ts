/**
 * Tamper analysis over two trees, for vitest and jest alike: each kind of
 * finding, the controls beside them, and the refusals that keep an unreadable
 * input from reading as clean.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { AdapterRefusal } from '@olympus-ai/adapters';
import type { TamperReport } from '@olympus-ai/integrity';
import { analyzeTamper, tamperFindings } from '../src/index.js';

const made: string[] = [];
afterEach(async () => {
  while (made.length > 0) await rm(made.pop() ?? '', { recursive: true, force: true });
});

async function tree(files: Readonly<Record<string, string>>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'tamper-'));
  made.push(root);
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

const EMPTY: TamperReport = { assertionsWeakened: [], skipMarkersAdded: [], testsDeleted: [], snapshotsRegenerated: [], coverageDelta: null, changedLines: null, protectedPathsTouched: [], suppressionMarkersAdded: [] };

const frameworks = [
  ['vitest', JSON.stringify({ name: 'f', version: '0.0.0', devDependencies: { vitest: '4.1.11' } })],
  ['jest', JSON.stringify({ name: 'f', version: '0.0.0', devDependencies: { jest: '30.0.0' } })],
] as const;

const SUM = "test('adds', () => {\n  expect(add(1, 4)).toBe(5);\n});\ntest('subtracts', () => {\n  expect(sub(5, 4)).toBe(1);\n});\n";

describe('pytest', () => {
  const PYPROJECT = '[project]\nname = "hello"\nversion = "0.1.0"\n\n[dependency-groups]\ndev = ["pytest>=8"]\n';
  const LOCK = [
    'version = 1', 'revision = 3', '', '[[package]]', 'name = "hello"', 'version = "0.1.0"', 'source = { virtual = "." }', '',
    '[[package]]', 'name = "pytest"', 'version = "8.4.2"', 'source = { registry = "https://pypi.org/simple" }',
    'wheels = [', `    { url = "https://files.pythonhosted.org/p/pytest-8.4.2-py3-none-any.whl", hash = "sha256:${'a'.repeat(64)}" },`, ']', '',
  ].join('\n');
  const BASE = { 'pyproject.toml': PYPROJECT, 'uv.lock': LOCK, 'hello/__init__.py': 'def greet(n):\n    return "hi " + n\n', 'tests/test_h.py': 'from hello import greet\n\ndef test_h():\n    assert greet("a") == "hi a"\n' };
  const analyze = async (head: Record<string, string>): Promise<TamperReport> =>
    analyzeTamper(await tree(BASE), await tree({ ...BASE, ...head }), { protectedPaths: [], coverage: null, commands: [], markers: [] });

  // pytest's skip is a function any imported module can call, so a module the tests import is read for one too (gemini-1).
  test('a skip added to a module the tests import is reported', async () => {
    const report = await analyze({ 'hello/__init__.py': 'import pytest\npytest.skip("x", allow_module_level=True)\n\ndef greet(n):\n    return "hi " + n\n' });
    expect(report.skipMarkersAdded).toEqual([{ file: 'hello/__init__.py', marker: 'pytest.skip: (module)' }]);
  });

  test('an exit that ends the run, added to a module, is reported; a CLI exit is not', async () => {
    const report = await analyze({
      'hello/__init__.py': 'import os\nos._exit(0)\n\ndef greet(n):\n    return "hi " + n\n',
      'hello/cli.py': 'import sys\nfrom hello import greet\n\nif __name__ == "__main__":\n    sys.exit(greet("x"))\n',
    });
    expect(report.skipMarkersAdded).toEqual([{ file: 'hello/__init__.py', marker: 'os._exit: (module)' }]);
  });

  test('an ordinary change to a module reports nothing', async () => {
    expect(await analyze({ 'hello/__init__.py': 'def greet(n):\n    return "hello " + n\n' })).toEqual(EMPTY);
  });
});

describe.each(frameworks)('%s', (_, pkg) => {
  async function analyze(base: Record<string, string>, head: Record<string, string>, protectedPaths: readonly string[] = []): Promise<TamperReport> {
    return analyzeTamper(await tree({ 'package.json': pkg, ...base }), await tree({ 'package.json': pkg, ...head }), { protectedPaths, coverage: null, commands: [], markers: [] });
  }

  test('an unchanged tree reports empty', async () => {
    expect(await analyze({ 'src/sum.test.ts': SUM }, { 'src/sum.test.ts': SUM })).toEqual(EMPTY);
  });

  test('a weakened assertion is named with its before and after', async () => {
    const report = await analyze({ 'src/sum.test.ts': SUM }, { 'src/sum.test.ts': SUM.replace('toBe(5)', 'toBeTruthy()') });
    expect(report.assertionsWeakened).toEqual([{ file: 'src/sum.test.ts', before: 'line 2: expect(add(1, 4)).toBe(5)', after: 'line 2: expect(add(1, 4)).toBeTruthy()' }]);
  });

  test('a removed assertion and a widened tolerance are both named', async () => {
    const base = "test('r', () => {\n  expect(r).toBeCloseTo(0.3, 5);\n  expect(y).toBe(2);\n});\n";
    const report = await analyze({ 'a.test.ts': base }, { 'a.test.ts': "test('r', () => {\n  expect(r).toBeCloseTo(0.3, 2);\n});\n" });
    expect(report.assertionsWeakened.map((w) => w.after)).toEqual([expect.stringContaining('toBeCloseTo(0.3, 2)'), '(removed)']);
  });

  test.each([
    ['.skip', "test.skip('adds'"], ['.only', "test.only('adds'"], ['.todo', "test.todo('adds'"], ['xit', "xit('adds'"],
  ])('an added %s is a finding, naming the file', async (_, replaced) => {
    const report = await analyze({ 'src/sum.test.ts': SUM }, { 'src/sum.test.ts': SUM.replace("test('adds'", replaced) });
    expect(report.skipMarkersAdded).toEqual([{ file: 'src/sum.test.ts', marker: expect.stringContaining('adds') as string }]);
  });

  test('a marker that was already there is not added', async () => {
    const skipped = SUM.replace("test('adds'", "test.skip('adds'");
    expect((await analyze({ 'src/sum.test.ts': skipped }, { 'src/moved.test.ts': skipped })).skipMarkersAdded).toEqual([]);
  });

  test('a deleted test file names every case it held; a surviving file that lost a case names that one', async () => {
    expect((await analyze({ 'a.test.ts': SUM }, {})).testsDeleted).toEqual(['a.test.ts: adds', 'a.test.ts: subtracts']);
    const shrunk = await analyze({ 'a.test.ts': SUM }, { 'a.test.ts': SUM.split('test(\'subtracts\'')[0] ?? '' });
    expect(shrunk.testsDeleted).toEqual(['a.test.ts: subtracts']);
  });

  test('a case moved to another file is not deleted', async () => {
    const [adds = '', rest = ''] = SUM.split("test('subtracts'");
    const report = await analyze({ 'a.test.ts': SUM }, { 'a.test.ts': adds, 'b.test.ts': `test('subtracts'${rest}` });
    expect(report.testsDeleted).toEqual([]);
  });

  test('an added, modified, or deleted snapshot is named', async () => {
    const report = await analyze(
      { '__snapshots__/a.test.ts.snap': 'old', 'b.snap': 'b' },
      { '__snapshots__/a.test.ts.snap': 'new', 'c/__snapshots__/c.test.ts.snap': 'c' },
    );
    expect(report.snapshotsRegenerated).toEqual(['__snapshots__/a.test.ts.snap', 'b.snap', 'c/__snapshots__/c.test.ts.snap']);
  });

  test('a protected path and a config change are touches; an ordinary file is not', async () => {
    const report = await analyze(
      { '.github/ci.yml': 'a', 'tsconfig.json': '{}', 'src/x.ts': '1' },
      { '.github/ci.yml': 'b', 'tsconfig.json': '{"strict":true}', 'src/x.ts': '2' },
      ['.github/**'],
    );
    expect(report.protectedPathsTouched).toEqual(['.github/ci.yml', 'tsconfig.json']);
  });

  test('a test file that does not parse refuses rather than reporting nothing', async () => {
    await expect(analyze({ 'a.test.ts': SUM }, { 'a.test.ts': "test('adds', () => {" })).rejects.toThrow(AdapterRefusal);
  });

  test('a case title that is not a literal refuses, naming the file', async () => {
    await expect(analyze({ 'a.test.ts': SUM }, { 'a.test.ts': `${SUM}const n = 'x';\ntest(n, () => {});\n` })).rejects.toThrow(/a\.test\.ts:\d+/);
  });

  test('a row dropped from a table is a deleted case, naming the row', async () => {
    const table = (rows: string): string => `test.each([${rows}])('handles %i', (n) => {\n  expect(validate(n)).toBe(true);\n});\n`;
    expect((await analyze({ 'a.test.ts': table('1, 2, 3') }, { 'a.test.ts': table('1') })).testsDeleted)
      .toEqual(['a.test.ts: handles %i [2]', 'a.test.ts: handles %i [3]']);
    expect((await analyze({ 'a.test.ts': table('1, 2') }, { 'a.test.ts': table('1, 2, 3') })).testsDeleted).toEqual([]);
  });

  test('a marker moved between two files that both survive is added; one carried by a rename is not', async () => {
    const suite = (only: boolean): string => `describe${only ? '.only' : ''}('selected', () => {\n  test('x', () => {});\n});\n`;
    const judge = "test('judge', () => {});\n";
    const moved = await analyze(
      { 'a.test.ts': suite(true), 'b.test.ts': suite(false) + judge },
      { 'a.test.ts': suite(false), 'b.test.ts': suite(true) + judge },
    );
    expect(moved.skipMarkersAdded).toEqual([{ file: 'b.test.ts', marker: 'describe.only: selected' }]);
    expect((await analyze({ 'a.test.ts': suite(true) }, { 'renamed.test.ts': suite(true) })).skipMarkersAdded).toEqual([]);
  });

  test('a file the pinned command names is a touch; the same change with no command naming it is not', async () => {
    const trees = [await tree({ 'package.json': pkg, 'scripts/check.mjs': 'run()' }), await tree({ 'package.json': pkg, 'scripts/check.mjs': 'process.exit(0)' })] as const;
    const touched = async (commands: ReadonlyArray<readonly string[]>): Promise<readonly string[]> =>
      (await analyzeTamper(...trees, { protectedPaths: [], coverage: null, commands, markers: [] })).protectedPathsTouched;
    expect(await touched([['node', './scripts/check.mjs']])).toEqual(['scripts/check.mjs']);
    expect(await touched([['sh', '-c', 'node scripts/check.mjs --ci']])).toEqual(['scripts/check.mjs']);
    expect(await touched([['node', 'scripts/other.mjs']])).toEqual([]);
  });
});

test('a stack with no test adapter reports no test findings, and still reads paths', async () => {
  const report = await analyzeTamper(await tree({ 'a.test.ts': SUM }), await tree({ 'b.snap': 'x' }), { protectedPaths: [], coverage: null, commands: [], markers: [] });
  expect(report).toEqual({ ...EMPTY, snapshotsRegenerated: ['b.snap'] });
});

test('a pinned coverage check whose report is missing refuses; none pinned is null', async () => {
  const pkg = frameworks[0][1];
  const base = await tree({ 'package.json': pkg, 'src/x.ts': 'export const x = 1;\n' });
  const head = await tree({ 'package.json': pkg, 'src/x.ts': 'export const x = 2;\n' });
  await expect(analyzeTamper(base, head, { protectedPaths: [], coverage: { report: join(head, 'coverage.json'), sourceRoot: '/workspace' }, commands: [], markers: [] })).rejects.toThrow(AdapterRefusal);
  expect((await analyzeTamper(base, head, { protectedPaths: [], coverage: null, commands: [], markers: [] })).coverageDelta).toBeNull();
});

test('tamperFindings spells every finding but the protected paths, one line each', () => {
  const lines = tamperFindings({
    ...EMPTY,
    assertionsWeakened: [{ file: 'a', before: 'x', after: 'y' }],
    skipMarkersAdded: [{ file: 'a', marker: 'it.skip: t' }],
    testsDeleted: ['a: t'],
    snapshotsRegenerated: ['s.snap'],
    protectedPathsTouched: ['package.json'],
  });
  expect(lines).toHaveLength(4);
  expect(lines.join('\n')).not.toMatch(/package\.json/);
});
