/**
 * The CLI's version (R35, #54): the package keeps v1's npm name, so v2 must
 * not release under a 4.x number. While the manifest still says v1's 4.x, a
 * pending changeset must bump it major, which `changeset version` turns into
 * 5.0.0. Once the release has consumed it, the version itself is 5 or more.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('v2 cannot release as 4.x: a 4.x manifest has a pending major changeset', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'packages', 'cli', 'package.json'), 'utf8')) as { name: string; version: string };
  expect(pkg.name).toBe('olympus-ai');
  const major = Number(pkg.version.split('.')[0]);
  if (major >= 5) return;
  const dir = join(ROOT, '.changeset');
  const pending = readdirSync(dir)
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .filter((f) => /^---\r?\n[\s\S]*?["']olympus-ai["']\s*:\s*major\b[\s\S]*?\r?\n---/u.test(readFileSync(join(dir, f), 'utf8')));
  expect(pending, `${pkg.name} is ${pkg.version}, v1's number, and no pending changeset bumps it major`).not.toHaveLength(0);
});
