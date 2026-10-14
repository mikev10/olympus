/**
 * The runner a suite check runs (D-R15-04): the argument vector each
 * framework is invoked with, and which suites that invocation selects, by
 * each runner's own rule. The vitest rule is also held to vitest itself, in
 * `@olympus-ai/api`'s tests, since nothing in this package may start a
 * process (I1.adapters-execute-nothing-on-the-host).
 */
import { afterEach, describe, expect, test } from 'vitest';
import { JestAdapter, VitestAdapter } from '../src/index.js';
import { cleanup, pkg, repo } from './repo.js';

afterEach(cleanup);

const vitest = new VitestAdapter(4);
const jest = new JestAdapter(30);

describe('vitest', () => {
  test('runs the installed launcher, never watch, each named file ./-led so none reads as an option', () => {
    expect(vitest.runner).toBe('node_modules/vitest/vitest.mjs');
    expect(vitest.invocation(null)).toEqual(['node', 'node_modules/vitest/vitest.mjs', 'run']);
    expect(vitest.invocation(['src/a.test.ts', '-b.test.ts'])).toEqual(['node', 'node_modules/vitest/vitest.mjs', 'run', './src/a.test.ts', './-b.test.ts']);
  });

  test('a file is a filter: it selects every suite whose path contains it, in any case', async () => {
    const root = await repo({
      'package.json': pkg({ vitest: '^4.1.0' }),
      'src/a.test.ts': '',
      'src/data.test.ts': '',
      'other/src/a.test.ts': '',
      'test/a.test.ts': '',
    });
    expect(await vitest.selectSuites(root, ['src/a.test.ts'])).toEqual(['other/src/a.test.ts', 'src/a.test.ts']);
    expect(await vitest.selectSuites(root, ['test/a.test.ts'])).toEqual(['test/a.test.ts']);
    expect(await vitest.selectSuites(root, ['SRC/DATA.test.ts'])).toEqual(['src/data.test.ts']);
  });

  test('matched relative to test.dir, as the runner matches it', async () => {
    const root = await repo({
      'package.json': pkg({ vitest: '^4.1.0' }),
      'vitest.config.ts': "export default { test: { dir: 'pkg' } };\n",
      'pkg/a.test.ts': '',
      'pkg/deep/a.test.ts': '',
    });
    expect(await vitest.selectSuites(root, ['pkg/a.test.ts'])).toEqual(['pkg/a.test.ts', 'pkg/deep/a.test.ts']);
    expect(await vitest.selectSuites(root, ['pkg/deep/a.test.ts'])).toEqual(['pkg/deep/a.test.ts']);
  });
});

describe('jest', () => {
  test('runs the package bin with --ci, and named files by path rather than as patterns', () => {
    expect(jest.runner).toBe('node_modules/jest/bin/jest.js');
    expect(jest.invocation(null)).toEqual(['node', 'node_modules/jest/bin/jest.js', '--ci']);
    expect(jest.invocation(['src/a.test.ts'])).toEqual(['node', 'node_modules/jest/bin/jest.js', '--ci', '--runTestsByPath', './src/a.test.ts']);
  });

  test('a path selects that file alone, and only if it is a suite', async () => {
    const root = await repo({
      'package.json': pkg({ jest: '^30.0.0' }),
      'src/a.test.ts': '',
      'src/data.test.ts': '',
      'other/src/a.test.ts': '',
      'src/notes.ts': '',
    });
    expect(await jest.selectSuites(root, ['src/a.test.ts'])).toEqual(['src/a.test.ts']);
    expect(await jest.selectSuites(root, ['src/notes.ts'])).toEqual([]);
  });
});
