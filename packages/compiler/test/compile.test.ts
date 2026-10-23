import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { compileRoles, DEFAULT_ROLES_DIRECTORY, isRoleId, ROLE_FILE_MAX_BYTES, type RoleCompilation } from '../src/index.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'roles-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function refusedOnly(outcome: RoleCompilation): ReadonlyArray<{ entry: string; code: string }> {
  if (outcome.ok) throw new Error(`expected a refusal, compiled ${outcome.roles.map((r) => r.role).join(', ')}`);
  return outcome.refused.map(({ entry, code }) => ({ entry, code }));
}

describe('compileRoles', () => {
  test('compiles every role file, sorted by id, versioned by the SHA-256 of its bytes', async () => {
    await writeFile(join(dir, 'reviewer.md'), 'Review the change.\n');
    await writeFile(join(dir, 'builder.md'), 'Build the task.\n');
    const outcome = await compileRoles(dir);
    expect(outcome).toEqual({
      ok: true,
      roles: [
        { role: 'builder', instructions: 'Build the task.\n', sha256: sha256('Build the task.\n') },
        { role: 'reviewer', instructions: 'Review the change.\n', sha256: sha256('Review the change.\n') },
      ],
    });
  });

  test('a byte-order mark stays in the instructions, so they encode back to the bytes hashed', async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('Build.')]);
    await writeFile(join(dir, 'builder.md'), bytes);
    const outcome = await compileRoles(dir);
    if (!outcome.ok) throw new Error('refused');
    const [role] = outcome.roles;
    expect(role?.sha256).toBe(sha256(bytes));
    expect(sha256(new TextEncoder().encode(role?.instructions))).toBe(role?.sha256);
  });

  test('front matter is instructions like any other text, never a field', async () => {
    const text = '---\ntools: [Bash]\nmodel: deep\n---\nBuild.\n';
    await writeFile(join(dir, 'builder.md'), text);
    const outcome = await compileRoles(dir);
    if (!outcome.ok) throw new Error('refused');
    expect(Object.keys(outcome.roles[0] ?? {}).sort()).toEqual(['instructions', 'role', 'sha256']);
    expect(outcome.roles[0]?.instructions).toBe(text);
  });

  test('an empty directory compiles to no roles; whether that admits a run is admission\'s call', async () => {
    expect(await compileRoles(dir)).toEqual({ ok: true, roles: [] });
  });

  test('a file exactly at the byte cap compiles, and one byte past it is refused', async () => {
    await writeFile(join(dir, 'builder.md'), 'a'.repeat(ROLE_FILE_MAX_BYTES));
    expect((await compileRoles(dir)).ok).toBe(true);
    await writeFile(join(dir, 'builder.md'), 'a'.repeat(ROLE_FILE_MAX_BYTES + 1));
    expect(refusedOnly(await compileRoles(dir))).toEqual([{ entry: 'builder.md', code: 'too-large' }]);
  });

  test('the cap is checked before decoding: an oversized file that is not UTF-8 is refused as too large', async () => {
    await writeFile(join(dir, 'builder.md'), new Uint8Array(ROLE_FILE_MAX_BYTES + 1).fill(0xff));
    expect(refusedOnly(await compileRoles(dir))).toEqual([{ entry: 'builder.md', code: 'too-large' }]);
  });

  test('bytes that are not UTF-8 are refused, never replaced', async () => {
    await writeFile(join(dir, 'builder.md'), new Uint8Array([0x42, 0xc3, 0x28]));
    expect(refusedOnly(await compileRoles(dir))).toEqual([{ entry: 'builder.md', code: 'not-utf8' }]);
  });

  test('an empty file, and one holding only whitespace, are refused', async () => {
    await writeFile(join(dir, 'builder.md'), '');
    await writeFile(join(dir, 'reviewer.md'), '﻿ \n\t\n');
    expect(refusedOnly(await compileRoles(dir))).toEqual([
      { entry: 'builder.md', code: 'empty' },
      { entry: 'reviewer.md', code: 'empty' },
    ]);
  });

  test.each(['Builder.md', 'builder.txt', 'builder', 'build_er.md', '-builder.md', 'builder-.md', 'a--b.md', '.md', `${'a'.repeat(65)}.md`, '.hidden.md', 'builder.MD'])(
    'a file named %j is refused as misnamed',
    async (name) => {
      await writeFile(join(dir, name), 'Build.');
      expect(refusedOnly(await compileRoles(dir))).toEqual([{ entry: name, code: 'invalid-name' }]);
    },
  );

  test('a directory in the roles directory is refused, not descended into', async () => {
    await mkdir(join(dir, 'nested.md'));
    expect(refusedOnly(await compileRoles(dir))).toEqual([{ entry: 'nested.md', code: 'not-regular' }]);
  });

  test('a symbolic link is refused even when it points at a valid role file', async (context) => {
    const elsewhere = await mkdtemp(join(tmpdir(), 'roles-target-'));
    try {
      await writeFile(join(elsewhere, 'builder.md'), 'Build.');
      try {
        await symlink(join(elsewhere, 'builder.md'), join(dir, 'builder.md'), 'file');
      } catch (error) {
        // Only the one refusal a Windows host without privilege gives; any other failure is the test's own.
        if (process.platform !== 'win32' || (error as { code?: unknown }).code !== 'EPERM') throw error;
        context.skip('this host cannot create a symbolic link without privilege');
      }
      expect(refusedOnly(await compileRoles(dir))).toEqual([{ entry: 'builder.md', code: 'not-regular' }]);
    } finally {
      await rm(elsewhere, { recursive: true, force: true });
    }
  });

  test('every refused entry is named, and a refusal compiles no role at all', async () => {
    await writeFile(join(dir, 'builder.md'), 'Build.');
    await writeFile(join(dir, 'notes.txt'), 'x');
    await writeFile(join(dir, 'reviewer.md'), '');
    const outcome = await compileRoles(dir);
    expect(refusedOnly(outcome)).toEqual([
      { entry: 'notes.txt', code: 'invalid-name' },
      { entry: 'reviewer.md', code: 'empty' },
    ]);
    expect(outcome).not.toHaveProperty('roles');
  });

  test('a missing directory, and a file where the directory should be, are refused as unreadable', async () => {
    expect(refusedOnly(await compileRoles(join(dir, 'absent')))).toEqual([{ entry: '.', code: 'unreadable' }]);
    await writeFile(join(dir, 'file'), 'x');
    expect(refusedOnly(await compileRoles(join(dir, 'file')))).toEqual([{ entry: '.', code: 'unreadable' }]);
  });

  test('each refusal message names the entry', async () => {
    await writeFile(join(dir, 'Builder.md'), 'Build.');
    const outcome = await compileRoles(dir);
    if (outcome.ok) throw new Error('compiled');
    expect(outcome.refused[0].message).toContain('Builder.md');
  });
});

describe('isRoleId', () => {
  test.each(['builder', 'reviewer', 'spec-drafter', 'a1', 'a'.repeat(64)])('%j is a role id', (id) => {
    expect(isRoleId(id)).toBe(true);
  });
  test.each(['', 'Builder', '1builder', 'a_b', 'a--b', 'a-', '__proto__', 'a'.repeat(65)])('%j is not', (id) => {
    expect(isRoleId(id)).toBe(false);
  });
});

describe('the shipped roles', () => {
  test('are builder and reviewer, and compile', async () => {
    expect((await readdir(DEFAULT_ROLES_DIRECTORY)).sort()).toEqual(['builder.md', 'reviewer.md']);
    const outcome = await compileRoles(DEFAULT_ROLES_DIRECTORY);
    if (!outcome.ok) throw new Error(JSON.stringify(outcome.refused));
    expect(outcome.roles.map((r) => r.role)).toEqual(['builder', 'reviewer']);
    for (const role of outcome.roles) {
      expect(role.sha256).toBe(sha256(await readFile(join(DEFAULT_ROLES_DIRECTORY, `${role.role}.md`))));
    }
  });
});
