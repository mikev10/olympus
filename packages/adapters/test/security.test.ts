import { describe, expect, test } from 'vitest';
import { markersIn, newFindings, parseGitleaksReport, parseSemgrepReport, staticFingerprint, treeRelative } from '../src/index.js';

describe('security scanner reports (R17)', () => {
  test('a gitleaks report becomes findings with the runtime\'s fingerprint, and a redacted or malformed one is no report', () => {
    const report = JSON.stringify([{ RuleID: 'github-pat', File: '/workspace/src/a.ts', StartLine: 3, Secret: 'ghp_x' }]);
    const [finding] = parseGitleaksReport(report) ?? [];
    expect(finding).toMatchObject({ rule: 'github-pat', location: { path: 'src/a.ts', line: 3 } });
    expect(finding?.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(finding)).not.toContain('ghp_x');
    expect(parseGitleaksReport(JSON.stringify([{ RuleID: 'r', File: 'a', StartLine: 1, Secret: 'REDACTED' }]))).toBeUndefined();
    expect(parseGitleaksReport('not json')).toBeUndefined();
    expect(parseGitleaksReport('[]')).toEqual([]);
  });

  test('a semgrep report with an error, or with its matched code withheld, is no report', () => {
    const result = { check_id: 'rules.no-eval', path: './x.ts', start: { line: 2 }, extra: { lines: '  eval(x);' } };
    expect(parseSemgrepReport(JSON.stringify({ results: [result], errors: [] }))).toEqual([
      { rule: 'rules.no-eval', location: { path: 'x.ts', line: 2 }, fingerprint: staticFingerprint('rules.no-eval', 'x.ts', 'eval(x);') },
    ]);
    expect(parseSemgrepReport(JSON.stringify({ results: [result], errors: [{ message: 'parse error' }] }))).toBeUndefined();
    expect(parseSemgrepReport(JSON.stringify({ results: [{ ...result, extra: { lines: 'requires login' } }], errors: [] }))).toBeUndefined();
  });

  test('findings are compared by count, so a copy of a base finding is new and a move is not', () => {
    const f = (fingerprint: string, line: number) => ({ rule: 'r', location: { path: 'a', line }, fingerprint });
    expect(newFindings([f('x', 1)], [f('x', 9)])).toEqual([]);
    expect(newFindings([f('x', 1)], [f('x', 1), f('x', 2)])).toEqual([f('x', 2)]);
    expect(newFindings([], [f('y', 1)])).toEqual([f('y', 1)]);
  });

  test('markers match case-insensitively, and a report path is made tree-relative', () => {
    expect(markersIn('const a = 1; // NOSEMGREP', ['nosem'])).toEqual(['nosem']);
    expect(markersIn('const a = 1;', ['gitleaks:allow'])).toEqual([]);
    expect(treeRelative('.\\src\\a.ts')).toBe('src/a.ts');
    expect(treeRelative('/workspace/b.ts')).toBe('b.ts');
  });
});
