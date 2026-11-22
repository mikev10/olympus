/**
 * Two registry helpers that used to pass on what they could not see (I5).
 * Each case here is one the old code passed: `allText` read an unreadable
 * file as empty (#93), and the I1 surface check read only the class
 * prototype's own string names (#65).
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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

  test('a named operation that is absent is refused', () => {
    class Missing {
      read(): void { return; }
    }
    expect(vaultSurfaceProblems(new Missing(), NAMED)).toStrictEqual(["no plain method for the named operation 'recordRun'"]);
  });
});
