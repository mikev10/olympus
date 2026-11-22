/**
 * The tree snapshot the scan tests compare against (#117): a symlink is recorded by the target it names, so a
 * link replaced by a file holding its target's bytes is a change (gemini-5). Needs no Docker daemon.
 */
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { treeSnapshot } from './repo.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'readiness-snapshot-'));
  await writeFile(join(dir, 'target.txt'), 'the same bytes\n');
  await symlink('target.txt', join(dir, 'link.txt'), 'file');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test('a symlink is recorded by the target it names', async () => {
  expect((await treeSnapshot(dir))['link.txt']).toBe('symlink to target.txt');
});

test('a symlink replaced by a file holding its target bytes is a change', async () => {
  const before = await treeSnapshot(dir);
  const bytes = await readFile(join(dir, 'link.txt'));
  await rm(join(dir, 'link.txt'));
  await writeFile(join(dir, 'link.txt'), bytes);
  expect(await treeSnapshot(dir)).not.toStrictEqual(before);
});
