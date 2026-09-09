/**
 * Workspace discovery and the two inventory guards the S1 external review
 * asked for: a package whose tsconfig omits source files from its program,
 * and a package whose `main` and `types` name different files.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { sourceFilesOutsideProgram } from '../../src/kit/scan.js';
import { entryDivergence, workspacePackages, type WorkspacePackage } from '../../src/kit/workspace.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'conformance-workspace-'));
  mkdirSync(join(root, 'packages'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writePackage(dirName: string, manifest: Record<string, unknown>, files: Record<string, string> = {}): WorkspacePackage {
  const dir = join(root, 'packages', dirName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const [relative, text] of Object.entries(files)) {
    const file = join(dir, relative);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  const found = workspacePackages(root).find((p) => p.dir === dir);
  if (found === undefined) throw new Error(`test: ${dirName} was not discovered`);
  return found;
}

const TSCONFIG = (include: string[]): string =>
  JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: [] }, include }, null, 2);

describe('workspacePackages', () => {
  test('exposes main and types separately; entry prefers types and falls back to main', () => {
    const both = writePackage('both', { name: '@x/both', main: './dist/index.js', types: './src/index.ts' });
    expect(both).toMatchObject({ main: './dist/index.js', types: './src/index.ts', entry: './src/index.ts' });
    const mainOnly = writePackage('main-only', { name: '@x/main-only', main: './src/index.ts' });
    expect(mainOnly).toMatchObject({ main: './src/index.ts', types: undefined, entry: './src/index.ts' });
  });
});

describe('entryDivergence', () => {
  test('reports a package whose main and types resolve to different files, naming both', () => {
    const pkg = writePackage('diverges', { name: '@x/diverges', main: './dist/index.js', types: './src/index.ts' });
    const problem = entryDivergence(pkg);
    expect(problem).toContain('@x/diverges');
    expect(problem).toContain('./dist/index.js');
    expect(problem).toContain('./src/index.ts');
  });

  test('is silent when the two agree, or when only one is set', () => {
    expect(entryDivergence(writePackage('agrees', { name: '@x/agrees', main: './src/index.ts', types: 'src/index.ts' }))).toBeUndefined();
    expect(entryDivergence(writePackage('one', { name: '@x/one', types: './src/index.ts' }))).toBeUndefined();
  });
});

describe('sourceFilesOutsideProgram', () => {
  test('names every .ts under src that the tsconfig include leaves out of the program', () => {
    const pkg = writePackage(
      'shrunk',
      { name: '@x/shrunk', main: './src/index.ts', types: './src/index.ts' },
      {
        'tsconfig.json': TSCONFIG(['test']),
        'src/index.ts': 'export const a = 1;\n',
        'src/deep/hidden.ts': 'export const b = 2;\n',
        'test/t.ts': 'export const t = 3;\n',
      },
    );
    expect(sourceFilesOutsideProgram(pkg)).toEqual(['src/deep/hidden.ts', 'src/index.ts']);
  });

  test('is empty when the include covers src', () => {
    const pkg = writePackage(
      'covered',
      { name: '@x/covered', main: './src/index.ts', types: './src/index.ts' },
      { 'tsconfig.json': TSCONFIG(['src', 'test']), 'src/index.ts': 'export const a = 1;\n', 'test/t.ts': 'export const t = 3;\n' },
    );
    expect(sourceFilesOutsideProgram(pkg)).toEqual([]);
  });
});
