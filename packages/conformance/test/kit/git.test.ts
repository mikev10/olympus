import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { commitFixture, committedFiles } from '../../src/kit/git.js';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

test('a commit of named paths holds those paths alone, whatever an earlier commit of the same directory added (codex-4)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kit-git-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'extra.txt'), 'extra\n');
  writeFileSync(join(dir, 'wanted.txt'), 'wanted\n');
  commitFixture(dir);
  const narrowed = commitFixture(dir, { paths: ['wanted.txt'] });
  expect(committedFiles(dir, narrowed).map((f) => f.path)).toEqual(['wanted.txt']);
});
