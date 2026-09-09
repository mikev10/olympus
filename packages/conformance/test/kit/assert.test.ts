import { describe, expect, test } from 'vitest';
import { checkCastFixture, compileOkSource, keysEqual } from '../../src/kit/assert.js';
import { sharedFixtureCompiler } from '../../src/kit/fixtures.js';
import type { LocalAssertion } from '../../src/kit/types.js';

const NAMES: ReadonlySet<string> = new Set(['UntrustedText', 'UntrustedPayload']);

const HEADER = [
  `import type { UntrustedPayload } from '@olympus-ai/triggers';`,
  `declare const payload: UntrustedPayload;`,
];

function build(name: string, lines: readonly string[]) {
  return sharedFixtureCompiler().build({ path: `virtual/${name}.ts`, text: [...HEADER, ...lines, ''].join('\n') });
}

describe('checkCastFixture', () => {
  test('passes when every annotated line is reported with the named type and nothing else is', () => {
    const built = build('cast-ok', [
      `export const a = payload.raw as unknown as string; // expect-cast UntrustedText`,
      `export const b = payload.source as string;`,
    ]);
    expect(() => {
      checkCastFixture(built, NAMES);
    }).not.toThrow();
  });

  test('fails when an annotated line is not reported: the scan stopped seeing the form', () => {
    const built = build('cast-unmet', [`export const b = payload.source as string; // expect-cast UntrustedText`]);
    expect(() => {
      checkCastFixture(built, NAMES);
    }).toThrow('expected at line 3: a cast from UntrustedText');
  });

  test('fails when a cast is reported on a line with no annotation', () => {
    const built = build('cast-unexpected', [
      `export const a = payload.raw as unknown as string; // expect-cast UntrustedText`,
      `export const b = payload.raw as unknown;`,
    ]);
    expect(() => {
      checkCastFixture(built, NAMES);
    }).toThrow('unexpected at line 4: cast from UntrustedText');
  });

  test('fails when a cast fixture carries no annotations at all: a fixture that asserts nothing is not evidence', () => {
    const built = build('cast-empty', [`export const a = payload.raw as unknown;`]);
    expect(() => {
      checkCastFixture(built, NAMES);
    }).toThrow('carries no expect-cast annotations');
  });

  test('fails when the fixture does not compile: the forms under test are ones the type system allows', () => {
    const built = build('cast-broken', [`export const a: string = payload.raw; // expect-cast UntrustedText`]);
    expect(() => {
      checkCastFixture(built, NAMES);
    }).toThrow('did not compile as annotated');
  });
});

/** Runs an assertion, sync or async, as a promise so one matcher covers both. */
const attempt = (assertion: LocalAssertion): Promise<void> => Promise.resolve().then(() => assertion.run());

describe('compileOkSource', () => {
  const generated = (name: string, source: string) =>
    compileOkSource({ id: 'I8.generated', title: 'x', name: `virtual/${name}.ts`, source: () => source });

  test('passes on clean source', async () => {
    await expect(attempt(generated('ok', `export const n: number = 1;\n`))).resolves.toBeUndefined();
  });

  test('fails on a compiler error', async () => {
    await expect(attempt(generated('error', `export const n: number = 'text';\n`))).rejects.toThrow('did not compile as annotated');
  });

  test('fails when the source annotates an error instead of being free of them', async () => {
    // An annotated error matches its diagnostic, so a plain fixture check would
    // pass. A compile-ok assertion promises zero diagnostics, not matched ones.
    const source = `export const n: number = 'text'; // expect-error TS2322: Type 'string' is not assignable to type 'number'\n`;
    await expect(attempt(generated('annotated', source))).rejects.toThrow('carries expect-error annotations');
  });
});

describe('keysEqual', () => {
  const check = (name: string, declare: string, keys: readonly string[]) =>
    keysEqual({ id: 'I8.keys', title: 'x', name: `virtual/keys-${name}.ts`, typeName: 'Caps', declare, keys: () => keys });

  test('passes when the registered keys are exactly the keys of the type', async () => {
    await expect(attempt(check('exact', 'interface Caps { a: boolean; b: number }', ['a', 'b']))).resolves.toBeUndefined();
  });

  test('fails when the type has a key the registry does not list', async () => {
    await expect(attempt(check('missing', 'interface Caps { a: boolean; b: number; c: boolean }', ['a', 'b']))).rejects.toThrow(
      /Unregistered|"c"/,
    );
  });

  test('fails when the registry lists a key the type does not have', async () => {
    await expect(attempt(check('stale', 'interface Caps { a: boolean }', ['a', 'b']))).rejects.toThrow(/Stale|"b"/);
  });

  test('fails when the type has lost every key: an empty key set does not accept the registered ones', async () => {
    // Record<keyof Caps, 0> is Record<never, 0>, the empty object type, which
    // accepts any literal. The check must fail in this direction too.
    await expect(attempt(check('empty-type', 'interface Caps {}', ['a', 'b']))).rejects.toThrow(/Stale|"a"/);
  });

  test('fails when both sides are empty: a capability set with no members is not a finite set to assert', async () => {
    await expect(attempt(check('both-empty', 'interface Caps {}', []))).rejects.toThrow(/keysAreNonEmpty|no keys/);
  });

  test('fails when the type has a string index signature: its key set is not finite', async () => {
    await expect(attempt(check('string-index', 'interface Caps { [k: string]: boolean }', ['a']))).rejects.toThrow(
      /keysAreFinite|index signature/,
    );
  });

  test('fails when the type has a number index signature', async () => {
    await expect(attempt(check('number-index', 'interface Caps { [k: number]: boolean }', ['a']))).rejects.toThrow(
      /keysAreFinite|index signature/,
    );
  });
});
