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

const EMPTY: TamperReport = { assertionsWeakened: [], skipMarkersAdded: [], testsDeleted: [], snapshotsRegenerated: [], coverageDelta: null, protectedPathsTouched: [] };

const frameworks = [
  ['vitest', JSON.stringify({ name: 'f', version: '0.0.0', devDependencies: { vitest: '4.1.11' } })],
  ['jest', JSON.stringify({ name: 'f', version: '0.0.0', devDependencies: { jest: '30.0.0' } })],
] as const;

const SUM = "test('adds', () => {\n  expect(add(1, 4)).toBe(5);\n});\ntest('subtracts', () => {\n  expect(sub(5, 4)).toBe(1);\n});\n";

describe.each(frameworks)('%s', (_, pkg) => {
  async function analyze(base: Record<string, string>, head: Record<string, string>, protectedPaths: readonly string[] = []): Promise<TamperReport> {
    return analyzeTamper(await tree({ 'package.json': pkg, ...base }), await tree({ 'package.json': pkg, ...head }), { protectedPaths, coverage: null });
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
});

test('a stack with no test adapter reports no test findings, and still reads paths', async () => {
  const report = await analyzeTamper(await tree({ 'a.test.ts': SUM }), await tree({ 'b.snap': 'x' }), { protectedPaths: [], coverage: null });
  expect(report).toEqual({ ...EMPTY, snapshotsRegenerated: ['b.snap'] });
});

test('a pinned coverage check whose report is missing refuses; none pinned is null', async () => {
  const pkg = frameworks[0][1];
  const base = await tree({ 'package.json': pkg, 'src/x.ts': 'export const x = 1;\n' });
  const head = await tree({ 'package.json': pkg, 'src/x.ts': 'export const x = 2;\n' });
  await expect(analyzeTamper(base, head, { protectedPaths: [], coverage: { report: join(head, 'coverage.json'), sourceRoot: '/workspace' } })).rejects.toThrow(AdapterRefusal);
  expect((await analyzeTamper(base, head, { protectedPaths: [], coverage: null })).coverageDelta).toBeNull();
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
