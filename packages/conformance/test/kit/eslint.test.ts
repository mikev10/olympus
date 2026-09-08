import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  lintFile,
  parseLintExpectations,
  resolvedRuleSeverity,
  unmetLintExpectations,
  workspaceEslint,
} from '../../src/kit/eslint.js';
import { conformanceRoot, workspaceRoot } from '../../src/kit/workspace.js';

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
