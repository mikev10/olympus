import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertCleanRoom } from '../cleanroom.ts';
import { buildCodexScratch, listRecursive, removeScratch } from '../scratch.ts';

// Fixture auth.json that buildCodexScratch copies into the scratch config home.
// Cleaned up in afterEach alongside every scratch this file creates.
const cleanupRoots: string[] = [];

function fixtureAuthJson(): string {
  const dir = mkdtempSync(join(tmpdir(), 'olympus-scratch-fixture-'));
  cleanupRoots.push(dir);
  const path = join(dir, 'auth.json');
  writeFileSync(path, '{"tokens":{}}');
  return path;
}

afterEach(() => {
  while (cleanupRoots.length > 0) {
    const root = cleanupRoots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

describe('buildCodexScratch', () => {
  it('produces a config home holding exactly auth.json and a work dir holding nothing', () => {
    const authJson = fixtureAuthJson();
    const scratch = buildCodexScratch(authJson);
    cleanupRoots.push(scratch.root);

    expect(listRecursive(scratch.configHome)).toEqual(['auth.json']);
    expect(listRecursive(scratch.workDir)).toEqual([]);
  });

  it('copies the given auth.json content into the scratch config home, not a placeholder', () => {
    const authJson = fixtureAuthJson();
    const scratch = buildCodexScratch(authJson);
    cleanupRoots.push(scratch.root);

    expect(existsSync(join(scratch.configHome, 'auth.json'))).toBe(true);
  });

  it('removes the directory it created when a step after mkdtemp fails, then rethrows', () => {
    // A private temp dir, so "nothing left behind" is checked in a directory
    // no other test writes to. os.tmpdir() reads these at call time.
    const privateTmp = mkdtempSync(join(tmpdir(), 'olympus-scratch-private-tmp-'));
    cleanupRoots.push(privateTmp);
    vi.stubEnv('TMPDIR', privateTmp);
    vi.stubEnv('TEMP', privateTmp);
    vi.stubEnv('TMP', privateTmp);
    try {
      expect(() => buildCodexScratch(join(privateTmp, 'no-such-auth.json'))).toThrow(/ENOENT/);
      expect(readdirSync(privateTmp)).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('listRecursive', () => {
  it('returns forward-slash relative paths, including nested ones', () => {
    const root = mkdtempSync(join(tmpdir(), 'olympus-listrecursive-'));
    cleanupRoots.push(root);
    mkdirSync(join(root, 'nested', 'deeper'), { recursive: true });
    writeFileSync(join(root, 'top.txt'), 'x');
    writeFileSync(join(root, 'nested', 'mid.txt'), 'x');
    writeFileSync(join(root, 'nested', 'deeper', 'bottom.txt'), 'x');

    const listed = listRecursive(root);

    expect(listed).toContain('top.txt');
    expect(listed).toContain('nested/mid.txt');
    expect(listed).toContain('nested/deeper/bottom.txt');
    // No backslashes anywhere, on any platform.
    expect(listed.some((p) => p.includes('\\'))).toBe(false);
  });

  it('returns an empty array for an empty directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'olympus-listrecursive-empty-'));
    cleanupRoots.push(root);

    expect(listRecursive(root)).toEqual([]);
  });
});

describe('assertCleanRoom with an empty work-dir allowlist', () => {
  it('passes on a fresh scratch, where the bundle travels on stdin and the work dir holds nothing', () => {
    const authJson = fixtureAuthJson();
    const scratch = buildCodexScratch(authJson);
    cleanupRoots.push(scratch.root);

    const proof = { configHome: listRecursive(scratch.configHome), workDir: listRecursive(scratch.workDir) };

    expect(() => {
      assertCleanRoom(proof, { configFiles: ['auth.json'], workFiles: [] });
    }).not.toThrow();
  });

  it('throws once any file is added to the work dir', () => {
    const authJson = fixtureAuthJson();
    const scratch = buildCodexScratch(authJson);
    cleanupRoots.push(scratch.root);
    writeFileSync(join(scratch.workDir, 'stray.txt'), 'should not be here');

    const proof = { configHome: listRecursive(scratch.configHome), workDir: listRecursive(scratch.workDir) };

    expect(() => {
      assertCleanRoom(proof, { configFiles: ['auth.json'], workFiles: [] });
    }).toThrow(/stray\.txt/);
  });
});

describe('removeScratch', () => {
  it('deletes what it is given', () => {
    const authJson = fixtureAuthJson();
    const scratch = buildCodexScratch(authJson);
    // Registered like every other scratch here: if removeScratch regressed, the
    // credential copy would otherwise outlive the test.
    cleanupRoots.push(scratch.root);

    expect(existsSync(scratch.root)).toBe(true);

    removeScratch(scratch);

    expect(existsSync(scratch.root)).toBe(false);
  });
});
