import { describe, expect, test } from 'vitest';
import { checkCastFixture } from '../../src/kit/assert.js';
import { sharedFixtureCompiler } from '../../src/kit/fixtures.js';

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
