import { describe, expect, test } from 'vitest';
import ts from 'typescript';
import { GREEK_NAMES, castsFrom, moduleSpecifiers, propertyChains, splitWords, words } from '../../src/kit/scan.js';

function parse(text: string): ts.SourceFile {
  return ts.createSourceFile('sample.ts', text, ts.ScriptTarget.ES2022, true);
}

describe('splitWords', () => {
  test('splits camelCase, kebab-case, snake_case, and paths into lowercase words', () => {
    expect(splitWords('olympusRunState')).toEqual(['olympus', 'run', 'state']);
    expect(splitWords('olympus-run_state')).toEqual(['olympus', 'run', 'state']);
    expect(splitWords('packages/core/src/HTTPServer.ts')).toEqual(['packages', 'core', 'src', 'http', 'server', 'ts']);
  });
  test('never splits inside a word, so "shares" is not "ares"', () => {
    expect(splitWords('shares')).toEqual(['shares']);
    expect(splitWords('videos')).toEqual(['videos']);
  });
});

describe('words', () => {
  test('reports identifiers, property names, and string literals with their source', () => {
    const sf = parse(`const zeusRunner = { apolloKey: 'hermes-channel' }; export const t = \`athena-\${zeusRunner.apolloKey}-ares\`;`);
    const found = words(sf).filter((w) => GREEK_NAMES.includes(w.word));
    expect(found.map((w) => [w.source, w.word]).sort()).toEqual(
      [
        ['identifier', 'zeus'],
        ['identifier', 'apollo'],
        ['string', 'hermes'],
        ['string', 'athena'],
        ['identifier', 'zeus'],
        ['identifier', 'apollo'],
        ['string', 'ares'],
      ].sort(),
    );
  });
  test('applies the string transform before splitting', () => {
    const sf = parse(`import type { X } from '@olympus-ai/core';`);
    const strip = (t: string): string => t.replace('@olympus-ai/', '');
    expect(words(sf).some((w) => w.word === 'olympus')).toBe(true);
    expect(words(sf, strip).some((w) => w.word === 'olympus')).toBe(false);
  });
});

describe('moduleSpecifiers', () => {
  test('finds static imports, re-exports, dynamic imports, and require', () => {
    const sf = parse([
      `import { a } from 'node:tty';`,
      `export * from './x.js';`,
      `const b = await import('readline');`,
      `const c = require('chalk');`,
    ].join('\n'));
    expect(moduleSpecifiers(sf).map((m) => [m.line, m.text])).toEqual([
      [1, 'node:tty'],
      [2, './x.js'],
      [3, 'readline'],
      [4, 'chalk'],
    ]);
  });
});

describe('propertyChains', () => {
  test('reports the longest chain rooted at an identifier', () => {
    const sf = parse(`if (process.stdout.isTTY) { console.log(process.env.HOME); }`);
    expect(propertyChains(sf).map((c) => c.text)).toEqual(['process.stdout.isTTY', 'console.log', 'process.env.HOME']);
  });
});

describe('castsFrom', () => {
  test('finds as, angle-bracket, and satisfies casts whose expression has a named type', () => {
    const text = [
      `type UntrustedText = { readonly __brand: 'UntrustedText' };`,
      `interface UntrustedPayload { raw: UntrustedText; source: string }`,
      `declare const payload: UntrustedPayload;`,
      `const a = payload.raw as unknown as string;`,
      `const b = <unknown>payload.raw;`,
      `const c = payload satisfies UntrustedPayload;`,
      `const d = payload.source as string;`,
      `const e = { raw: payload.raw } as { raw: unknown };`,
    ].join('\n');
    const program = ts.createProgram({
      rootNames: ['sample.ts'],
      options: { strict: true, noEmit: true, lib: ['lib.es2022.d.ts'] },
      host: {
        ...ts.createCompilerHost({}),
        getSourceFile: (name, version) => (name === 'sample.ts' ? ts.createSourceFile(name, text, version, true) : ts.createCompilerHost({}).getSourceFile(name, version)),
        fileExists: (name) => name === 'sample.ts' || ts.sys.fileExists(name),
        readFile: (name) => (name === 'sample.ts' ? text : ts.sys.readFile(name)),
      },
    });
    const sf = program.getSourceFile('sample.ts');
    if (sf === undefined) throw new Error('sample not loaded');
    const casts = castsFrom(sf, program.getTypeChecker(), new Set(['UntrustedText', 'UntrustedPayload']));
    expect(casts.map((c) => [c.line, c.from])).toEqual([
      [4, 'UntrustedText'],
      [5, 'UntrustedText'],
      [6, 'UntrustedPayload'],
    ]);
  });
});
