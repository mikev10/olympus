/**
 * The corpus is pinned file by file: the shipped corpus matches its manifest,
 * and a changed, added, or removed byte without a new version is refused
 * (D-R7-03).
 */
import { cp, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { CORPUS_ROOT, CURRENT_CORPUS, loadCorpus, pinCorpus, render } from '../src/corpus.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'corpus-'));
  await cp(join(CORPUS_ROOT, CURRENT_CORPUS), join(root, CURRENT_CORPUS), { recursive: true, filter: (src) => !src.includes('node_modules') });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('the shipped corpus', () => {
  test('matches its manifest, and every item names a repository, a group, and a change', async () => {
    const corpus = await loadCorpus();
    expect(corpus.version).toBe('v1');
    expect(corpus.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(corpus.items.length).toBeGreaterThan(0);
    for (const item of corpus.items) {
      expect(corpus.repos[item.repo]).toBeDefined();
      expect(item.kind === 'seeded' ? item.seeds : null).toBe(item.seeds);
    }
  });

  test('every item names a declared group', async () => {
    const corpus = await loadCorpus();
    for (const item of corpus.items) expect(corpus.groups[item.group], item.id).toBeDefined();
  });

  test('a credential is held in parts no one of which is the whole', async () => {
    const corpus = await loadCorpus();
    const parted = corpus.items.flatMap((i) => Object.values(i.change.write)).filter((c) => typeof c !== 'string');
    expect(parted.length).toBeGreaterThan(0);
    for (const content of parted) {
      for (const part of content.parts) expect(render(content)).not.toBe(part);
    }
  });
});

describe('a corpus that does not match its manifest is refused', () => {
  test('a changed byte', async () => {
    await writeFile(join(root, CURRENT_CORPUS, 'repos', 'calc', 'src', 'math.ts'), 'export {};\n');
    await expect(loadCorpus(CURRENT_CORPUS, root)).rejects.toThrow(/repos\/calc\/src\/math\.ts holds sha256:[0-9a-f]+, pinned at/);
  });

  test('an added file', async () => {
    await writeFile(join(root, CURRENT_CORPUS, 'items', 'extra.json'), '{}');
    await expect(loadCorpus(CURRENT_CORPUS, root)).rejects.toThrow(/items\/extra\.json is not pinned/);
  });

  test('a removed file', async () => {
    await unlink(join(root, CURRENT_CORPUS, 'items', 'clean.json'));
    await expect(loadCorpus(CURRENT_CORPUS, root)).rejects.toThrow(/items\/clean\.json is pinned and missing/);
  });

  test('a version the manifest does not name', async () => {
    await expect(loadCorpus('v0', root)).rejects.toThrow();
  });
});

describe('pinning', () => {
  test('pinCorpus makes a changed corpus load again, and the digest moves with the bytes', async () => {
    const before = await loadCorpus(CURRENT_CORPUS, root);
    await writeFile(join(root, CURRENT_CORPUS, 'repos', 'calc', 'spec.md'), '# changed\n');
    await pinCorpus(join(root, CURRENT_CORPUS));
    const after = await loadCorpus(CURRENT_CORPUS, root);
    expect(after.digest).not.toBe(before.digest);
    expect(after.groups).toEqual(before.groups);
  });
});
