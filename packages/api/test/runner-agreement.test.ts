/**
 * The selection rule admission relies on, held to the runner it models
 * (D-R15-04). Admission refuses an acceptance check whose named tests the
 * base's vitest would not run exactly, and it decides that from the
 * adapter's model of vitest's filter rule rather than by starting vitest. So
 * the model is checked here against vitest itself: the workspace's own
 * vitest lists the files each filter selects, and the model must name the
 * same ones. Here rather than in `@olympus-ai/adapters`, where nothing may
 * start a process (I1.adapters-execute-nothing-on-the-host).
 */
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { VitestAdapter } from '@olympus-ai/adapters';

const run = promisify(execFile);
/** The workspace's own vitest: the major the adapter below models. */
const WORKSPACE_VITEST = resolve(import.meta.dirname, '../../../node_modules/vitest/vitest.mjs');
const vitest = new VitestAdapter(4);

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'r15-selection-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function write(files: Readonly<Record<string, string>>): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
}

/** What vitest itself lists for the arguments the adapter would start it with. */
async function listed(named: readonly string[]): Promise<string[]> {
  const out = await run(process.execPath, [WORKSPACE_VITEST, 'list', '--filesOnly', ...vitest.invocation(named).slice(3)], { cwd: root });
  return out.stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '').sort();
}

test('the files vitest lists for each set of named tests are the ones the adapter says it selects', async () => {
  await write({
    'package.json': JSON.stringify({ name: 'fixture', devDependencies: { vitest: '^4.1.0' } }),
    'src/a.test.ts': '',
    'src/data.test.ts': '',
    'sub/src/a.test.ts': '',
    'test/a.test.ts': '',
    'test/b.spec.ts': '',
  });
  for (const named of [['src/a.test.ts'], ['test/a.test.ts'], ['src/data.test.ts', 'test/b.spec.ts'], ['sub/src/a.test.ts']]) {
    expect(await vitest.selectSuites(root, named)).toEqual(await listed(named));
  }
});

test('under test.dir, too', async () => {
  await write({
    'package.json': JSON.stringify({ name: 'fixture', devDependencies: { vitest: '^4.1.0' } }),
    'vitest.config.mjs': "export default { test: { dir: 'pkg' } };\n",
    'pkg/a.test.ts': '',
    'pkg/deep/a.test.ts': '',
    'other/a.test.ts': '',
  });
  for (const named of [['pkg/a.test.ts'], ['pkg/deep/a.test.ts']]) {
    expect(await vitest.selectSuites(root, named)).toEqual(await listed(named));
  }
});
