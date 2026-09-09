import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  inlineConfigComments,
  inlineSuppressions,
  lintFile,
  parseLintExpectations,
  resolvedRuleSeverity,
  suppressesAny,
  unmetLintExpectations,
  workspaceEslint,
} from '../../src/kit/eslint.js';
import { conformanceRoot, workspacePackages, workspaceRoot } from '../../src/kit/workspace.js';

describe('parseLintExpectations', () => {
  test('reads one rule per annotated line', () => {
    const source = [
      `const a = 'x' + raw; // expect-lint @typescript-eslint/restrict-plus-operands`,
      `const b = 1;`,
      `const c = String(raw); // expect-lint @typescript-eslint/no-base-to-string`,
    ].join('\n');
    expect(parseLintExpectations(source)).toEqual([
      { line: 1, rule: '@typescript-eslint/restrict-plus-operands' },
      { line: 3, rule: '@typescript-eslint/no-base-to-string' },
    ]);
  });
});

describe('unmetLintExpectations', () => {
  test('an expectation is met only by the named rule on the same line', () => {
    const expectations = [
      { line: 1, rule: 'a' },
      { line: 2, rule: 'b' },
    ];
    const messages = [
      { line: 1, ruleId: 'a', message: '' },
      { line: 2, ruleId: 'c', message: '' },
      { line: 3, ruleId: 'b', message: '' },
    ];
    expect(unmetLintExpectations(expectations, messages)).toEqual([{ line: 2, rule: 'b' }]);
  });
});

describe('inlineConfigComments', () => {
  const comments = (lines: readonly string[]) => inlineConfigComments([...lines, ''].join('\n'));

  test('reads a disable-next-line directive with its rule list and drops the description', () => {
    expect(comments([`// eslint-disable-next-line rule-a, @scope/rule-b -- why`, `const x = 1;`])).toEqual([
      { line: 1, kind: 'disable-next-line', rules: ['rule-a', '@scope/rule-b'], text: 'eslint-disable-next-line rule-a, @scope/rule-b -- why' },
    ]);
  });

  test('reads a disable-line directive and a block disable with no rule list, which disables every rule', () => {
    expect(comments([`const x = 1; // eslint-disable-line rule-a`, `/* eslint-disable */`, `/* eslint-enable */`])).toEqual([
      { line: 1, kind: 'disable-line', rules: ['rule-a'], text: 'eslint-disable-line rule-a' },
      { line: 2, kind: 'disable', rules: [], text: 'eslint-disable' },
    ]);
  });

  test('reads an inline configuration comment and the rules it names', () => {
    expect(comments([`/* eslint rule-a: "off", @scope/rule-b: 0 */`])).toEqual([
      { line: 1, kind: 'config', rules: ['rule-a', '@scope/rule-b'], text: 'eslint rule-a: "off", @scope/rule-b: 0' },
    ]);
  });

  test('finds a block comment in a position no statement owns', () => {
    expect(comments([`f(/* eslint-disable */);`, `function f() {}`])).toEqual([
      { line: 1, kind: 'disable', rules: [], text: 'eslint-disable' },
    ]);
  });

  test('ignores prose that mentions a directive, a directive inside a string, and a regex that looks like a comment', () => {
    expect(
      comments([
        `// When false, eslint-disable comments are ignored.`,
        `/** Finds eslint-disable-next-line comments. */`,
        `const s = '// eslint-disable-next-line rule-a';`,
        'const t = `/* eslint-disable */`;',
        `const r = /\\/\\/ eslint-disable/;`,
        `export { s, t, r };`,
      ]),
    ).toEqual([]);
  });
});

describe('suppressesAny', () => {
  const RULES = ['@typescript-eslint/no-base-to-string'];
  test('a directive naming a guarded rule, a bare disable, and a config comment naming a guarded rule all suppress', () => {
    expect(suppressesAny(RULES, { line: 1, kind: 'disable-next-line', rules: ['@typescript-eslint/no-base-to-string'], text: '' })).toBe(true);
    expect(suppressesAny(RULES, { line: 1, kind: 'disable', rules: [], text: '' })).toBe(true);
    expect(suppressesAny(RULES, { line: 1, kind: 'config', rules: ['@typescript-eslint/no-base-to-string'], text: '' })).toBe(true);
  });
  test('a directive naming only other rules does not', () => {
    expect(suppressesAny(RULES, { line: 1, kind: 'disable-next-line', rules: ['no-console'], text: '' })).toBe(false);
    expect(suppressesAny(RULES, { line: 1, kind: 'config', rules: ['no-console'], text: '' })).toBe(false);
  });
});

describe('inlineSuppressions', () => {
  const RULES = ['@typescript-eslint/no-base-to-string', '@typescript-eslint/restrict-plus-operands'];
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'conformance-suppress-'));
    const pkg = join(root, 'packages', 'sample');
    mkdirSync(join(pkg, 'src'), { recursive: true });
    mkdirSync(join(pkg, 'fixtures', 'lint'), { recursive: true });
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@olympus-ai/sample', types: './src/index.ts' }));
    writeFileSync(
      join(pkg, 'src', 'index.ts'),
      [
        `// eslint-disable-next-line @typescript-eslint/no-base-to-string`,
        `export const a = String({});`,
        `// eslint-disable-next-line no-console`,
        `console.log(a);`,
        `/* eslint-disable */`,
        `/* eslint @typescript-eslint/restrict-plus-operands: "off" */`,
        '',
      ].join('\n'),
    );
    writeFileSync(join(pkg, 'src', 'plain.js'), `/* eslint-disable-line @typescript-eslint/no-base-to-string */\n`);
    writeFileSync(join(pkg, 'fixtures', 'lint', 'coercion.ts'), `// eslint-disable-next-line @typescript-eslint/no-base-to-string\n`);
  });
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test('reports every comment in package sources that suppresses or reconfigures a guarded rule, and nothing under fixtures/', () => {
    const hits = inlineSuppressions(RULES, workspacePackages(root), root);
    expect(hits.map((h) => `${h.file}:${String(h.line)}`)).toEqual([
      'packages/sample/src/index.ts:1',
      'packages/sample/src/index.ts:5',
      'packages/sample/src/index.ts:6',
      'packages/sample/src/plain.js:1',
    ]);
  });
});

describe('against the workspace configuration', () => {
  const eslint = workspaceEslint();

  test('a contract file resolves the I7 rules at error', async () => {
    const file = join(workspaceRoot(), 'packages', 'triggers', 'src', 'types.ts');
    expect(await resolvedRuleSeverity(eslint, file, '@typescript-eslint/restrict-plus-operands')).toBe('error');
    expect(await resolvedRuleSeverity(eslint, file, '@typescript-eslint/restrict-template-expressions')).toBe('error');
    expect(await resolvedRuleSeverity(eslint, file, '@typescript-eslint/no-base-to-string')).toBe('error');
  });

  test('a rule the configuration never mentions is absent', async () => {
    const file = join(workspaceRoot(), 'packages', 'triggers', 'src', 'types.ts');
    expect(await resolvedRuleSeverity(eslint, file, 'no-such-rule/anywhere')).toBe('absent');
  });

  test('compile-error fixtures are ignored by the ordinary lint run', async () => {
    const file = join(conformanceRoot(), 'fixtures', 'types', 'i1', 'write-boundary-vault-never.ts');
    expect(await resolvedRuleSeverity(eslint, file, '@typescript-eslint/restrict-plus-operands')).toBe('ignored');
  });

  test('inline disable comments are honoured by default and ignored on request', async () => {
    const fixture = join(conformanceRoot(), 'fixtures', 'lint', 'i7', 'untrusted-text-coercion.ts');
    const honoured = await lintFile(eslint, fixture);
    expect(honoured.filter((m) => m.ruleId !== null)).toEqual([]);
    const ignored = await lintFile(workspaceEslint({ allowInlineConfig: false }), fixture);
    expect(new Set(ignored.map((m) => m.ruleId))).toEqual(
      new Set([
        '@typescript-eslint/restrict-plus-operands',
        '@typescript-eslint/restrict-template-expressions',
        '@typescript-eslint/no-base-to-string',
      ]),
    );
  });
});
