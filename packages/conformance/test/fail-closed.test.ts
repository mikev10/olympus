/**
 * Two registry helpers that used to pass on what they could not see (I5).
 * Each case here is one the old code passed: `allText` read an unreadable
 * file as empty (#93), and the I1 surface check read only the class
 * prototype's own string names (#65).
 */
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { allText } from '../src/registry/all-text.js';
import { vaultSurfaceProblems } from '../src/registry/vault-surface.js';

describe('allText refuses a file it cannot read (#93)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'all-text-'));
    await writeFile(join(dir, 'readable.txt'), 'a token');
    await writeFile(join(dir, 'unreadable.txt'), '');
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('reads every file', async () => {
    await expect(allText(dir)).resolves.toContain('a token');
  });

  test('rejects with the read error rather than counting the file as empty', async () => {
    const failing = (path: string): Promise<string> =>
      path.endsWith('unreadable.txt') ? Promise.reject(new Error(`EACCES: ${path}`)) : Promise.resolve('a token');
    await expect(allText(dir, failing)).rejects.toThrow(/EACCES/u);
  });

  // codex-6, gemini-4: a symlink is not a file, and the old walk skipped it, so the text behind it went unread.
  test('refuses a symlink, to a file outside the directory or to nothing', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'all-text-outside-'));
    try {
      await writeFile(join(outside, 'secret'), 'the merge token');
      await mkdir(join(dir, 'nested'));
      await symlink(join(outside, 'secret'), join(dir, 'nested', 'link'), 'file');
      await expect(allText(dir)).rejects.toThrow(/neither a file nor a directory/u);
      await rm(join(dir, 'nested', 'link'));
      await symlink(join(outside, 'gone'), join(dir, 'nested', 'dangling'), 'file');
      await expect(allText(dir)).rejects.toThrow(/neither a file nor a directory/u);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

describe('the Vault surface check sees the whole instance (#65)', () => {
  const NAMED = ['read', 'recordRun'];

  class Clean {
    read(): void { return; }
    recordRun(): void { return; }
  }

  test('a class with exactly the named operations as plain methods passes', () => {
    expect(vaultSurfaceProblems(new Clean(), NAMED)).toStrictEqual([]);
  });

  test('a class whose private state is #private passes', () => {
    class WithPrivate {
      readonly #store = 'store';
      read(): string { return this.#store; }
      recordRun(): void { return; }
    }
    expect(vaultSurfaceProblems(new WithPrivate(), NAMED)).toStrictEqual([]);
  });

  /** What the old check read: the class prototype's own string names. */
  const oldRead = (cls: abstract new () => object): string[] =>
    Object.getOwnPropertyNames(cls.prototype as object).filter((name) => name !== 'constructor').sort();

  // Each of these has only `read` and `recordRun` among the prototype's own string names, which the old check read.
  test('an instance field is refused', () => {
    class Field {
      put = (): void => undefined;
      read(): void { return; }
      recordRun(): void { return; }
    }
    expect(oldRead(Field)).toStrictEqual(NAMED);
    expect(vaultSurfaceProblems(new Field(), NAMED).join('\n')).toMatch(/instance property 'put'/u);
  });

  test('a symbol-keyed method is refused', () => {
    const write = Symbol('write');
    class Keyed {
      read(): void { return; }
      recordRun(): void { return; }
      [write](): void { return; }
    }
    expect(oldRead(Keyed)).toStrictEqual(NAMED);
    expect(vaultSurfaceProblems(new Keyed(), NAMED).join('\n')).toMatch(/symbol-keyed Symbol\(write\)/u);
  });

  test('an inherited helper is refused', () => {
    class Base {
      held(): void { return; }
      remove(): void { return; }
    }
    class Inherits extends Base {
      read(): void { return; }
      recordRun(): void { return; }
    }
    expect(oldRead(Inherits)).toStrictEqual(NAMED);
    expect(vaultSurfaceProblems(new Inherits(), NAMED).join('\n')).toMatch(/'remove', which is not a named operation/u);
  });

  test('an accessor under an allowed name is refused', () => {
    class Getter {
      get read(): () => void { return () => undefined; }
      recordRun(): void { return; }
    }
    expect(oldRead(Getter)).toStrictEqual(NAMED);
    expect(vaultSurfaceProblems(new Getter(), NAMED).join('\n')).toMatch(/'read', which is not a plain method/u);
  });

  // codex-2, gemini-2: `vault.constructor` reaches a static member, which the prototype walk skipped.
  test('a static member, own or inherited, is refused', () => {
    class Own {
      static put(): void { return; }
      read(): void { return; }
      recordRun(): void { return; }
    }
    expect(oldRead(Own)).toStrictEqual(NAMED);
    expect(vaultSurfaceProblems(new Own(), NAMED).join('\n')).toMatch(/a static 'put'/u);
    class Base {
      held(): void { return; }
      static wipe(): void { return; }
    }
    class Heir extends Base {
      read(): void { return; }
      recordRun(): void { return; }
    }
    expect(oldRead(Heir)).toStrictEqual(NAMED);
    expect(vaultSurfaceProblems(new Heir(), NAMED).join('\n')).toMatch(/a static 'wipe'/u);
  });

  // gemini-3: a Proxy's traps decide what reflection reports, so a clean read of one is no evidence.
  test('a Proxy is refused, whatever its traps report', () => {
    const hidden = new Proxy(new Clean(), {
      ownKeys: () => [],
      get: (target, key) => (key === 'wipe' ? () => 'wiped' : Reflect.get(target, key) as unknown),
    });
    expect((hidden as unknown as { wipe: () => string }).wipe()).toBe('wiped');
    expect(vaultSurfaceProblems(hidden, NAMED).join('\n')).toMatch(/is a Proxy/u);
    class Behind {
      read(): void { return; }
    }
    Object.setPrototypeOf(Behind.prototype, new Proxy(Clean.prototype, {}));
    expect(vaultSurfaceProblems(new Behind(), NAMED).join('\n')).toMatch(/prototype on the chain is a Proxy/u);
  });

  test('a named operation that is absent is refused', () => {
    class Missing {
      read(): void { return; }
    }
    expect(vaultSurfaceProblems(new Missing(), NAMED)).toStrictEqual(["no plain method for the named operation 'recordRun'"]);
  });
});
