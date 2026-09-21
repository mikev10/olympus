/**
 * Changed-line coverage over an istanbul JSON report, and config-file
 * change detection: both compare two trees an agent could have written.
 */
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { AdapterRefusal, ConfigManifestAdapter, IstanbulCoverageAdapter, VitestAdapter } from '../src/index.js';
import { cleanup, linkDirectory, pkg, repo, write } from './repo.js';

afterEach(cleanup);

const SOURCE_ROOT = '/workspace';

/** An istanbul entry with one statement per listed line, hit or not. */
function entry(file: string, lines: Readonly<Record<number, number>>): Record<string, unknown> {
  const statementMap: Record<string, unknown> = {};
  const s: Record<string, number> = {};
  Object.entries(lines).forEach(([line, hits], i) => {
    statementMap[String(i)] = { start: { line: Number(line), column: 0 }, end: { line: Number(line), column: 10 } };
    s[String(i)] = hits;
  });
  return { path: file, statementMap, s, fnMap: {}, f: {}, branchMap: {}, b: {} };
}

async function trees(before: Record<string, string>, after: Record<string, string>): Promise<{ base: string; head: string }> {
  const manifest = { 'package.json': pkg({ vitest: '4' }) };
  return { base: await repo({ ...manifest, ...before }), head: await repo({ ...manifest, ...after }) };
}

async function adapterFor(report: unknown): Promise<IstanbulCoverageAdapter> {
  const dir = await repo({ 'coverage-final.json': typeof report === 'string' ? report : JSON.stringify(report) });
  return new IstanbulCoverageAdapter({ report: join(dir, 'coverage-final.json'), sourceRoot: SOURCE_ROOT, tests: new VitestAdapter(4) });
}

describe('changedLineCoverage', () => {
  test('counts changed executable lines and how many of them ran', async () => {
    const { base, head } = await trees(
      { 'src/a.ts': 'const a = 1;\nconst b = 2;\n' },
      { 'src/a.ts': 'const a = 1;\nconst b = 3;\nconst c = 4;\n// a comment\n' },
    );
    const adapter = await adapterFor({ '/workspace/src/a.ts': entry('/workspace/src/a.ts', { 1: 1, 2: 5, 3: 0 }) });
    // Lines 2 and 3 changed and are executable; line 2 ran and line 3 did not. The comment is not executable.
    expect(await adapter.changedLineCoverage(base, head)).toBe(0.5);
  });

  test('a changed source file the report does not mention counts every executable changed line as uncovered', async () => {
    const { base, head } = await trees(
      { 'src/a.ts': 'export const a = 1;\n' },
      { 'src/a.ts': 'export const a = 1;\n', 'src/new.ts': "import x from './x';\ninterface T { a: 1 }\nexport const n = x + 1;\nif (n) { console.log(n); }\n" },
    );
    const adapter = await adapterFor({ '/workspace/src/a.ts': entry('/workspace/src/a.ts', { 1: 1 }) });
    expect(await adapter.changedLineCoverage(base, head)).toBe(0);
  });

  test('test files, config files, and declaration files are not lines the suite must cover', async () => {
    const { base, head } = await trees({}, { 'src/a.test.ts': 'expect(1).toBe(1);\n', 'vite.config.ts': 'export default {};\n', 'src/t.d.ts': 'declare const x: 1;\n' });
    const adapter = await adapterFor({});
    expect(await adapter.changedLineCoverage(base, head)).toBe(1);
  });

  test('a report keyed by Windows paths is read the same way', async () => {
    const { base, head } = await trees({}, { 'src/a.ts': 'const a = 1;\n' });
    const dir = await repo({ 'r.json': JSON.stringify({ 'C:\\w\\src\\a.ts': entry('C:\\w\\src\\a.ts', { 1: 2 }) }) });
    const adapter = new IstanbulCoverageAdapter({ report: join(dir, 'r.json'), sourceRoot: 'C:\\w', tests: new VitestAdapter(4) });
    expect(await adapter.changedLineCoverage(base, head)).toBe(1);
  });

  test.each([
    ['not JSON', '{', 'malformed-report'],
    ['an array', '[]', 'malformed-report'],
    ['an entry with no statement map', JSON.stringify({ '/workspace/a.ts': { s: {} } }), 'malformed-report'],
    ['a statement with no hit count', JSON.stringify({ '/workspace/a.ts': { statementMap: { 0: { start: { line: 1, column: 0 }, end: { line: 1, column: 1 } } }, s: {} } }), 'malformed-report'],
    ['a report on another tree', JSON.stringify({ '/elsewhere/a.ts': entry('/elsewhere/a.ts', { 1: 1 }) }), 'malformed-report'],
  ])('a report that is %s is refused, never read as a number', async (_, report, reason) => {
    const { base, head } = await trees({}, { 'src/a.ts': 'const a = 1;\n' });
    const adapter = await adapterFor(report);
    const error = await adapter.changedLineCoverage(base, head).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AdapterRefusal);
    expect((error as AdapterRefusal).reason).toBe(reason);
  });

  test('a missing report is refused as missing', async () => {
    const { base, head } = await trees({}, {});
    const dir = await repo({});
    const adapter = new IstanbulCoverageAdapter({ report: join(dir, 'absent.json'), sourceRoot: SOURCE_ROOT, tests: new VitestAdapter(4) });
    await expect(adapter.changedLineCoverage(base, head)).rejects.toMatchObject({ reason: 'missing-report' });
  });
});

describe('detectConfigChanges', () => {
  test('names every config file added, removed, or modified, at any depth, and nothing else', async () => {
    const base = await repo({
      'package.json': '{"a":1}',
      'tsconfig.json': '{}',
      'packages/x/vitest.config.ts': 'export default {};',
      '.npmrc': 'x',
      'src/a.ts': 'const a = 1;',
    });
    const head = await repo({
      'package.json': '{"a":2}',
      'packages/x/vitest.config.ts': 'export default {};',
      '.npmrc': 'x',
      'jest.config.js': 'module.exports = {};',
      'src/a.ts': 'const a = 2;',
    });
    expect(await new ConfigManifestAdapter().detectConfigChanges(base, head)).toEqual(['jest.config.js', 'package.json', 'tsconfig.json']);
  });

  test('a config file rewritten to the same bytes is unchanged', async () => {
    const base = await repo({ 'package.json': '{}' });
    const head = await repo({ 'package.json': '{}' });
    expect(await new ConfigManifestAdapter().detectConfigChanges(base, head)).toEqual([]);
  });

  test('a config directory replaced by a link is a change, and the link is never followed', async () => {
    const outside = await repo({ 'package.json': '{}' });
    const base = await repo({ 'nested/package.json': '{}' });
    const head = await repo({});
    await linkDirectory(outside, join(head, 'nested'));
    expect(await new ConfigManifestAdapter().detectConfigChanges(base, head)).toEqual(['nested/package.json']);
  });

  test('node_modules is not walked', async () => {
    const base = await repo({ 'package.json': '{}' });
    const head = await repo({ 'package.json': '{}' });
    await write(head, { 'node_modules/dep/package.json': '{}' });
    expect(await new ConfigManifestAdapter().detectConfigChanges(base, head)).toEqual([]);
    await rm(join(head, 'node_modules'), { recursive: true });
  });
});
