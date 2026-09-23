/**
 * The pure parts of verification and the tree operations it rests on, each
 * over a real directory. The line's own behaviour is `line.test.ts`'s; the
 * registry assertions are in `packages/conformance`.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { RunId } from '@olympus-ai/core';
import type { CheckSpec } from '@olympus-ai/integrity';
import {
  claimEvidenceDiff,
  composeDiff,
  countSuites,
  diffDigest,
  ownDiff,
  suiteCountFor,
  taskResultProblems,
  treeDigest,
  writesOutsideGrant,
} from '../src/index.js';
import { basePath, localWorkspaceStore, materialize, snapshotBase, treePath } from '../src/workspace.js';

let base: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), 'p6-verification-'));
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

async function tree(name: string, files: Record<string, string>): Promise<string> {
  const root = join(base, name);
  await mkdir(root, { recursive: true });
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(root, ...path.split('/').slice(0, -1)), { recursive: true });
    await writeFile(join(root, ...path.split('/')), text);
  }
  return root;
}

describe('the diff is collected from the trees, never from a claim', () => {
  test('a task diff names each added, modified, and removed path, and nothing under .git', async () => {
    const start = await tree('start', { 'a.ts': 'a', 'b.ts': 'b', '.git/HEAD': 'ref' });
    const work = await tree('work', { 'a.ts': 'a2', 'c.ts': 'c', '.git/HEAD': 'changed', '.git/notes': 'n' });
    const diff = await ownDiff(start, work);
    expect(diff.map(({ path, change }) => [path, change])).toEqual([
      ['a.ts', 'modified'],
      ['b.ts', 'removed'],
      ['c.ts', 'added'],
    ]);
    expect(diff.find((e) => e.path === 'b.ts')?.sha256).toBeNull();
  });

  test('a path returned to its base content leaves the cumulative diff', async () => {
    const root = await tree('base', { 'a.ts': 'a' });
    const first = await tree('first', { 'a.ts': 'changed' });
    const [changed] = await ownDiff(root, first);
    if (changed === undefined) throw new Error('no change collected');
    const cumulative = await composeDiff(root, [], [changed]);
    expect(cumulative).toHaveLength(1);
    const back = await ownDiff(first, root);
    expect(await composeDiff(root, cumulative, back)).toEqual([]);
  });

  test('a diff digest depends on the entries, not their order', () => {
    const a = { path: 'a', change: 'added' as const, sha256: '1' };
    const b = { path: 'b', change: 'removed' as const, sha256: null };
    expect(diffDigest([a, b])).toBe(diffDigest([b, a]));
    expect(diffDigest([a])).not.toBe(diffDigest([a, b]));
  });

  test('a tree digest changes with any file', async () => {
    const one = await tree('one', { 'a.ts': 'a' });
    const before = await treeDigest(one);
    await writeFile(join(one, 'a.ts'), 'b');
    expect(await treeDigest(one)).not.toBe(before);
  });
});

describe('a tree is built from base and a diff', () => {
  test('a tree rebuilt from itself, as a task that changed nothing rebuilds its predecessor, keeps its contents', async () => {
    const source = await tree('source', { 'a.ts': 'a' });
    const store = localWorkspaceStore(process.getuid === undefined ? { root: join(base, 'store'), user: { uid: 0, gid: 0 } } : { root: join(base, 'store') });
    const runId = 'rebuild' as RunId;
    await snapshotBase(store, runId, source);
    const changed = await tree('changed', { 'a.ts': 'a', 'b.ts': 'b' });
    const diff = await ownDiff(basePath(store, runId), changed);
    const target = treePath(store, runId, diffDigest(diff));
    await materialize(store, runId, target, diff, () => changed);
    await materialize(store, runId, target, diff, () => target);
    expect(await readFile(join(target, 'b.ts'), 'utf8')).toBe('b');
  });

  test('a source whose bytes changed after the diff was taken is refused', async () => {
    const source = await tree('source2', { 'a.ts': 'a' });
    const store = localWorkspaceStore(process.getuid === undefined ? { root: join(base, 'store2'), user: { uid: 0, gid: 0 } } : { root: join(base, 'store2') });
    const runId = 'moved' as RunId;
    await snapshotBase(store, runId, source);
    const changed = await tree('changed2', { 'a.ts': 'new' });
    const diff = await ownDiff(basePath(store, runId), changed);
    await writeFile(join(changed, 'a.ts'), 'newer');
    await expect(materialize(store, runId, treePath(store, runId, diffDigest(diff)), diff, () => changed)).rejects.toThrow(/after the diff was taken/);
  });
});

describe('the claim is compared with the diff, and only its file list', () => {
  const diff = [{ path: 'src/a.ts', change: 'modified' as const, sha256: '1' }];

  test('a claim that lists what the diff holds differs in nothing', () => {
    expect(claimEvidenceDiff({ narrative: 'anything at all', filesChanged: ['./src/a.ts'] }, diff)).toEqual([]);
    expect(claimEvidenceDiff({ narrative: '', filesChanged: ['/workspace/src/a.ts'] }, diff)).toEqual([]);
  });

  test('a claimed file the diff lacks, and a changed file the claim omits, are each named', () => {
    const differences = claimEvidenceDiff({ narrative: 'I changed b', filesChanged: ['src/b.ts'] }, diff);
    expect(differences).toEqual(['claimed but not in the diff: src/b.ts', 'in the diff but not claimed: src/a.ts']);
  });
});

describe('a write is inside the grant only when both the role and the station grant it', () => {
  const diff = [
    { path: 'src/a.ts', change: 'modified' as const, sha256: '1' },
    { path: 'notes.md', change: 'added' as const, sha256: '2' },
    { path: '.github/workflows/ci.yml', change: 'added' as const, sha256: '3' },
  ];

  test('the role glob narrows the station glob', () => {
    expect(writesOutsideGrant(diff, ['src/**'], ['**'])).toEqual(['notes.md', '.github/workflows/ci.yml']);
  });

  test('dot paths are matched, not skipped', () => {
    expect(writesOutsideGrant(diff, ['**'], ['**'])).toEqual([]);
  });

  test('an empty list grants nothing', () => {
    expect(writesOutsideGrant(diff, [], ['**'])).toHaveLength(3);
    expect(writesOutsideGrant(diff, ['**'], [])).toHaveLength(3);
  });
});

describe('suites are counted on the host, from files', () => {
  test('a vitest tree counts its test files, and one fewer when one is deleted', async () => {
    const root = await tree('suites', {
      'package.json': JSON.stringify({ name: 'x', devDependencies: { vitest: '4.1.11' } }),
      'src/a.test.ts': "test('a', () => {})",
      'src/b.test.ts': "test('b', () => {})",
    });
    expect(await countSuites(root)).toBe(2);
    await rm(join(root, 'src', 'b.test.ts'));
    expect(await countSuites(root)).toBe(1);
  });

  test('a tree with no test framework has no count, never zero', async () => {
    expect(await countSuites(await tree('none', { 'readme.md': 'x' }))).toBeNull();
  });

  test('the count is recorded for a suite check, and for any check that pins one', () => {
    const check: CheckSpec = { id: 'c', kind: 'lint', command: ['x'], required: true, timeoutMs: 1 };
    expect(suiteCountFor(check, 3)).toBeNull();
    expect(suiteCountFor({ ...check, kind: 'unit' }, 3)).toBe(3);
    expect(suiteCountFor({ ...check, expectedSuiteCount: 3 }, null)).toBeNull();
  });
});

describe("a driver's result is held to the contract's exact keys", () => {
  const result = {
    taskId: 't',
    claim: { narrative: 'n', filesChanged: [] },
    events: [],
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, wallClockMs: 0 },
    model: { provider: 'p', family: 'f', model: 'm', version: 'v' },
    contractVersion: '1',
  };

  test('a result with exactly the contract keys has no problem', () => {
    expect(taskResultProblems(result)).toEqual([]);
  });

  test.each([
    ['result.status', { ...result, status: 'passed' }],
    ['result.claim.passed', { ...result, claim: { ...result.claim, passed: true } }],
    ['result.model.inferred', { ...result, model: { ...result.model, inferred: true } }],
    ['result.usage.verdict', { ...result, usage: { ...result.usage, verdict: 'ok' } }],
  ])('%s is refused', (field, value) => {
    expect(taskResultProblems(value).join('\n')).toContain(field);
  });

  test('a missing field is named too', () => {
    const { usage: _usage, ...partial } = result;
    expect(taskResultProblems(partial)).toContain('result.usage is missing');
  });
});
