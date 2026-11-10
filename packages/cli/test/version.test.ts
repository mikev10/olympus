/**
 * The CLI's version (R35, #54): the package keeps v1's npm name, so v2 must
 * not release under a 4.x number. While the manifest still says v1's 4.x, a
 * pending changeset must bump it major, which `changeset version` turns into
 * 5.0.0. Once the release has consumed it, the version itself is 5 or more.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * Whether a changeset's front matter bumps `name` major: only the lines
 * between the opening `---` and the next `---`, each one `"<name>": <bump>`,
 * comments and blank lines skipped. The body is never read (review: codex-4,
 * gemini-1), and a line that is neither is refused rather than ignored.
 */
export function bumpsMajor(text: string, name: string): boolean {
  const lines = text.split(/\r?\n/u);
  if (lines[0] !== '---') return false;
  const end = lines.indexOf('---', 1);
  if (end === -1) throw new Error('a changeset with no closing front-matter line');
  for (const line of lines.slice(1, end)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const entry = /^(["'])([^"']+)\1\s*:\s*(major|minor|patch)$/u.exec(trimmed);
    if (entry === null) throw new Error(`a changeset front-matter line that is not "<package>": <bump>: ${trimmed}`);
    if (entry[2] === name && entry[3] === 'major') return true;
  }
  return false;
}

describe('the CLI release version', () => {
  test('reads the front matter, never the body or a comment', () => {
    const name = 'olympus-ai';
    const quoted = JSON.stringify(name);
    expect(bumpsMajor(`---\n${quoted}: major\n---\n\nwhy\n`, name)).toBe(true);
    expect(bumpsMajor(`---\n'${name}': major\n---\n`, name)).toBe(true);
    expect(bumpsMajor(`---\n"@olympus-ai/core": patch\n---\nExample only: ${quoted}: major\n---\n`, name)).toBe(false);
    expect(bumpsMajor(`---\n# ${quoted}: major\n"@olympus-ai/core": patch\n---\n`, name)).toBe(false);
    expect(bumpsMajor(`---\n${quoted}: minor\n---\n`, name)).toBe(false);
  });

  test('v2 cannot release as 4.x: a 4.x manifest has a pending major changeset', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'packages', 'cli', 'package.json'), 'utf8')) as { name: string; version: string };
    expect(pkg.name).toBe('olympus-ai');
    const major = Number(pkg.version.split('.')[0]);
    if (major >= 5) return;
    const dir = join(ROOT, '.changeset');
    const pending = readdirSync(dir)
      .filter((f) => f.endsWith('.md') && f !== 'README.md')
      .filter((f) => bumpsMajor(readFileSync(join(dir, f), 'utf8'), pkg.name));
    expect(pending, `${pkg.name} is ${pkg.version}, v1's number, and no pending changeset bumps it major`).not.toHaveLength(0);
  });
});
