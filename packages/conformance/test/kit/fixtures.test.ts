import { describe, expect, test } from 'vitest';
import ts from 'typescript';
import {
  FixtureCompiler,
  describeFailure,
  matchExpectations,
  parseExpectations,
  sharedFixtureCompiler,
} from '../../src/kit/fixtures.js';

describe('parseExpectations', () => {
  test('reads a same-line annotation with code and message', () => {
    expect(parseExpectations(`const x: number = 'a'; // expect-error TS2322: not assignable`)).toEqual([
      { line: 1, code: 2322, message: 'not assignable' },
    ]);
  });

  test('reads a code-only annotation', () => {
    expect(parseExpectations(`const x: number = 'a'; // expect-error TS2322`)).toEqual([
      { line: 1, code: 2322, message: undefined },
    ]);
  });

  test('an annotation on its own line applies to the next line of code', () => {
    const source = [
      '// expect-error TS2322: not assignable',
      '',
      '// another comment',
      `const x: number = 'a';`,
    ].join('\n');
    expect(parseExpectations(source)).toEqual([{ line: 4, code: 2322, message: 'not assignable' }]);
  });

  test('ignores ordinary comments', () => {
    expect(parseExpectations('// expect nothing\nconst x = 1; // fine')).toEqual([]);
  });
});

describe('matchExpectations', () => {
  const file = 'packages/conformance/fixtures/types/x.ts';

  test('pairs by line, code, and message fragment, ignoring whitespace differences', () => {
    const result = matchExpectations(
      [{ line: 3, code: 2322, message: `not assignable to type '"never"'` }],
      [{ file, line: 3, code: 2322, message: `Type '"append"' is not assignable   to type '"never"'.` }],
      file,
    );
    expect(result).toEqual({ unmet: [], unexpected: [] });
  });

  test('a diagnostic with the wrong code is unexpected and the annotation stays unmet', () => {
    const result = matchExpectations(
      [{ line: 3, code: 2322, message: undefined }],
      [{ file, line: 3, code: 2339, message: 'Property does not exist' }],
      file,
    );
    expect(result.unmet).toHaveLength(1);
    expect(result.unexpected).toHaveLength(1);
  });

  test('a diagnostic in another file never satisfies an annotation', () => {
    const result = matchExpectations(
      [{ line: 3, code: 2322, message: undefined }],
      [{ file: 'packages/core/src/index.ts', line: 3, code: 2322, message: 'x' }],
      file,
    );
    expect(result.unmet).toHaveLength(1);
    expect(result.unexpected).toHaveLength(1);
  });
});

describe('FixtureCompiler', () => {
  const compiler = sharedFixtureCompiler();

  test('a fixture whose annotations match its diagnostics passes', () => {
    const outcome = compiler.compile({
      path: 'virtual/passes.ts',
      text: `export const n: number = 'text'; // expect-error TS2322: Type 'string' is not assignable to type 'number'\n`,
    });
    expect(describeFailure(outcome)).toBeUndefined();
  });

  test('a fixture that compiles cleanly against an annotation fails with an unmet expectation', () => {
    const outcome = compiler.compile({
      path: 'virtual/unmet.ts',
      text: `export const n: number = 1; // expect-error TS2322\n`,
    });
    expect(outcome.unmet).toHaveLength(1);
    expect(describeFailure(outcome)).toContain('expected at line 1: TS2322');
  });

  test('an unannotated diagnostic fails', () => {
    const outcome = compiler.compile({
      path: 'virtual/unexpected.ts',
      text: `export const n: number = 'text';\n`,
    });
    expect(outcome.unexpected).toHaveLength(1);
    expect(describeFailure(outcome)).toContain('must compile cleanly');
  });

  test('an annotation with the right code but the wrong message is unmet', () => {
    const outcome = compiler.compile({
      path: 'virtual/wrong-message.ts',
      text: `export const n: number = 'text'; // expect-error TS2322: boolean\n`,
    });
    expect(outcome.unmet).toHaveLength(1);
    expect(outcome.unexpected).toHaveLength(1);
  });

  test('fixtures resolve sibling contracts through their published entry', () => {
    const outcome = compiler.compile({
      path: 'virtual/imports.ts',
      text: [
        `import type { RunId } from '@olympus-ai/core';`,
        `import type { SandboxHandle } from '@olympus-ai/sandbox';`,
        `export const run: RunId = 'plain'; // expect-error TS2322: not assignable to type 'RunId'`,
        `export const handle: SandboxHandle = 'plain'; // expect-error TS2322: not assignable to type 'SandboxHandle'`,
        '',
      ].join('\n'),
    });
    expect(describeFailure(outcome)).toBeUndefined();
  });

  test('the compiler applies the conformance tsconfig strictness', () => {
    const outcome = compiler.compile({
      path: 'virtual/strict.ts',
      text:
        `export function f(list: string[]): string { return list[0]; }` +
        ` // expect-error TS2322: 'string | undefined' is not assignable to type 'string'\n`,
    });
    expect(describeFailure(outcome)).toBeUndefined();
  });

  test('build exposes the program, source file, and text so a scan can run over the fixture', () => {
    const built = compiler.build({ path: 'virtual/built.ts', text: `export const n = 1;\n` });
    expect(built.outcome.diagnostics).toEqual([]);
    expect(built.text).toBe(`export const n = 1;\n`);
    const declaration = built.sourceFile.statements.find(ts.isVariableStatement)?.declarationList.declarations[0];
    if (declaration === undefined) throw new Error('declaration not found');
    const checker = built.program.getTypeChecker();
    expect(checker.typeToString(checker.getTypeAtLocation(declaration.name))).toBe('1');
  });

  test('a second compiler instance is independent', () => {
    const other = new FixtureCompiler();
    const outcome = other.compile({ path: 'virtual/independent.ts', text: 'export const ok = 1;\n' });
    expect(outcome.diagnostics).toEqual([]);
  });
});
