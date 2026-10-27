/**
 * The corpus is pinned file by file: the shipped corpus matches its manifest,
 * and a changed, added, or removed byte without a new version is refused
 * (D-R7-03).
 */
import { cp, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
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

/** Rewrites part of a copied corpus's manifest, leaving its file pins as they are. */
async function editManifest(version: string, edit: (m: Record<string, unknown>) => void): Promise<void> {
  const path = join(root, version, 'corpus.json');
  const manifest = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  edit(manifest);
  await writeFile(path, JSON.stringify(manifest, null, 2));
}

describe('pinning', () => {
  test('a released version repinned after a change is refused: a changed corpus is a new version', async () => {
    await writeFile(join(root, CURRENT_CORPUS, 'repos', 'calc', 'spec.md'), '# changed\n');
    await pinCorpus(join(root, CURRENT_CORPUS));
    await expect(loadCorpus(CURRENT_CORPUS, root)).rejects.toThrow(/released at sha256:/);
  });

  test("the manifest's detector groups are part of the digest", async () => {
    await editManifest(CURRENT_CORPUS, (m) => {
      m.groups = { ...(m.groups as Record<string, unknown>), 'skip-marker': ['gate-failed'] };
    });
    await expect(loadCorpus(CURRENT_CORPUS, root)).rejects.toThrow(/released at sha256:/);
  });

  test("the manifest's builder globs are part of the digest", async () => {
    await editManifest(CURRENT_CORPUS, (m) => {
      m.repos = { calc: { builderGlobs: ['src/**', 'test/**', 'docs/**'] } };
    });
    await expect(loadCorpus(CURRENT_CORPUS, root)).rejects.toThrow(/released at sha256:/);
  });

  test('a new version made from a released one loads once pinned, under a digest of its own', async () => {
    const released = await loadCorpus(CURRENT_CORPUS, root);
    await cp(join(root, CURRENT_CORPUS), join(root, 'v-next'), { recursive: true });
    await editManifest('v-next', (m) => {
      m.version = 'v-next';
    });
    await writeFile(join(root, 'v-next', 'repos', 'calc', 'spec.md'), '# changed\n');
    await pinCorpus(join(root, 'v-next'));
    const next = await loadCorpus('v-next', root);
    expect(next.digest).not.toBe(released.digest);
    expect(next.groups).toEqual(released.groups);
  });
});
