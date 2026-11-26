/**
 * The local check's judgment (D-TOOLING-13): which failures of a conformance
 * run a checkout may report as "not run here", and that everything else,
 * including anything it cannot read, stays a failure.
 */
import { describe, expect, test } from 'vitest';
import { changedPackages, classify, idPattern, isPaid, isRegistryId, outcomesOf, problemLines, RECONCILIATION_ID, unproven, type TestOutcome } from '../local-check.ts';

const REGISTRY = 'test/registry.test.ts';
const AGGREGATE = 'no entry is missing, no record is malformed, and no pending count exceeds its baseline';
const COMPLETE = '[I8.registry-complete] every invariant and capability claim is asserted';

const external = (id: string, pkg: string, file: string, status = 'failed'): TestOutcome => ({ file: REGISTRY, title: `[${id}] a title (external: ${pkg} ${file})`, status });
const local = (id: string, status: string): TestOutcome => ({ file: REGISTRY, title: `[${id}] a title`, status });
const stale = (id: string, pkg: string): string => `${id}: ${pkg} has changed since its tests ran (${RECONCILIATION_ID}: stale)`;

const PAID = external('I1.driver-executes-inside-the-sandbox', '@olympus-ai/driver-claude-code', 'test/assertions.test.ts');
const PAID_LINE = external('I2.line-usage-is-metered', '@olympus-ai/api', 'test/paid/line.paid.test.ts');
const CLAIM = external('driver.hooks.codex', '@olympus-ai/driver-codex', 'test/claims.paid.test.ts');

describe('which reports only CI writes', () => {
  test('the two model drivers, and the api package under test/paid/ only', () => {
    expect(isPaid('@olympus-ai/driver-claude-code', 'test/x.test.ts')).toBe(true);
    expect(isPaid('@olympus-ai/driver-codex', 'test/x.test.ts')).toBe(true);
    expect(isPaid('@olympus-ai/api', 'test/paid/line.paid.test.ts')).toBe(true);
    expect(isPaid('@olympus-ai/api', 'test/line.test.ts')).toBe(false);
    expect(isPaid('@olympus-ai/driver-openai-compatible', 'test/driver.test.ts')).toBe(false);
    expect(isPaid('@olympus-ai/sandbox', 'test/paid/x.test.ts')).toBe(false);
  });
});

describe('classify', () => {
  test('a failed entry of a paid suite is not run here, and the aggregates fail for it alone', () => {
    const outcomes = [PAID, PAID_LINE, CLAIM, { file: REGISTRY, title: AGGREGATE, status: 'failed' }, { file: REGISTRY, title: COMPLETE, status: 'failed' }, local('I9.x', 'passed')];
    const problems = [
      stale('I1.driver-executes-inside-the-sandbox', '@olympus-ai/driver-claude-code'),
      stale('I2.line-usage-is-metered', '@olympus-ai/api'),
      stale('driver.hooks.codex', '@olympus-ai/driver-codex'),
      'driver.hooks: missing (no assertion and no pending owner)',
    ];
    const verdict = classify(outcomes, problems);
    expect(verdict.failed).toEqual([]);
    expect(verdict.notRunHere).toEqual(['I1.driver-executes-inside-the-sandbox', 'I2.line-usage-is-metered', 'driver.hooks.codex']);
    expect(verdict.aggregates).toEqual([AGGREGATE, COMPLETE]);
  });

  test('a failed local entry is a failure', () => {
    expect(classify([local('I9.draft-is-read-through-the-api', 'failed')], []).failed).toEqual([`${REGISTRY}: [I9.draft-is-read-through-the-api] a title`]);
  });

  test('a failed external entry of a suite that runs here is a failure', () => {
    const free = external('I1.openai-compatible-driver-executes-inside-the-sandbox', '@olympus-ai/driver-openai-compatible', 'test/driver.test.ts');
    const unpaidApi = external('I5.x', '@olympus-ai/api', 'test/line.test.ts');
    expect(classify([free, unpaidApi], []).failed).toHaveLength(2);
    expect(classify([free, unpaidApi], []).notRunHere).toEqual([]);
  });

  test('one problem line about anything else fails the aggregates and is named', () => {
    const outcomes = [PAID, { file: REGISTRY, title: AGGREGATE, status: 'failed' }];
    for (const other of [
      'I4.something: pending count 3 exceeds its baseline 2',
      'driver.steering: missing (no assertion and no pending owner)',
      stale('I1.openai-compatible-driver-executes-inside-the-sandbox', '@olympus-ai/driver-openai-compatible'),
      'I1.driver-executes-inside-the-sandbox: the record is malformed',
    ]) {
      const verdict = classify(outcomes, [stale('I1.driver-executes-inside-the-sandbox', '@olympus-ai/driver-claude-code'), other]);
      expect(verdict.aggregates, other).toEqual([]);
      expect(verdict.failed, other).toContain(`${REGISTRY}: ${AGGREGATE}`);
      expect(verdict.failed, other).toContain(`registry problem: ${other}`);
    }
  });

  test('an aggregate that failed with no problem list read, or with no entry not run, is a failure', () => {
    expect(classify([PAID, { file: REGISTRY, title: AGGREGATE, status: 'failed' }], []).failed).toEqual([`${REGISTRY}: ${AGGREGATE}`]);
    const passedPaid = { ...PAID, status: 'passed' };
    expect(classify([passedPaid, { file: REGISTRY, title: AGGREGATE, status: 'failed' }], [stale('I1.driver-executes-inside-the-sandbox', '@olympus-ai/driver-claude-code')]).failed).toEqual([`${REGISTRY}: ${AGGREGATE}`]);
  });

  test('a test in another file with an aggregate title, or a title that only quotes an external suffix, is a failure', () => {
    expect(classify([PAID, { file: 'test/other.test.ts', title: AGGREGATE, status: 'failed' }], [stale('I1.driver-executes-inside-the-sandbox', '@olympus-ai/driver-claude-code')]).failed).toEqual([`test/other.test.ts: ${AGGREGATE}`]);
    expect(classify([{ file: REGISTRY, title: 'no id (external: @olympus-ai/driver-codex test/x.test.ts)', status: 'failed' }], []).failed).toHaveLength(1);
  });

  test('nothing failed is nothing reported', () => {
    expect(classify([local('I9.x', 'passed'), { ...PAID, status: 'passed' }], [])).toEqual({ failed: [], notRunHere: [], aggregates: [] });
  });
});

describe('reading a run', () => {
  test('problem lines are the indented lines after the last Problems heading, colour removed', () => {
    const output = ['Problems', '  an earlier one', '', 'Conformance registry', 'Pending entries: 2', '', '\u001b[31mProblems\u001b[39m', '  first: a', '  second: b', '', '  not one'].join('\r\n');
    expect(problemLines(output)).toEqual(['first: a', 'second: b']);
    expect(problemLines('Conformance registry\n\nAssertions: 3\n')).toEqual([]);
  });

  test('a report gives each test, and a file that failed outside any test is a failure of its own', () => {
    const report = { testResults: [
      { name: 'a.test.ts', status: 'passed', assertionResults: [{ title: 'one', status: 'passed' }] },
      { name: 'b.test.ts', status: 'failed', assertionResults: [] },
      { name: 'c.test.ts', status: 'failed', assertionResults: [{ title: 'two', status: 'failed' }] },
    ] };
    expect(outcomesOf(report)).toEqual([
      { file: 'a.test.ts', title: 'one', status: 'passed' },
      { file: 'b.test.ts', title: '(the file failed outside any test)', status: 'failed' },
      { file: 'c.test.ts', title: 'two', status: 'failed' },
    ]);
    expect(classify(outcomesOf(report), []).failed).toHaveLength(2);
  });

  test('a report that is not one throws', () => {
    for (const bad of [null, {}, { testResults: 'x' }, { testResults: [{ name: 'a' }] }, { testResults: [{ name: 'a', assertionResults: [{ title: 1, status: 'passed' }] }] }]) {
      expect(() => outcomesOf(bad)).toThrow(/local-check/u);
    }
  });
});

describe('naming registry entries', () => {
  test('an id is accepted only in the registry form', () => {
    for (const id of ['I9.draft-is-read-through-the-api', 'driver.hooks.codex', 'I10.no-greek-names-in-code']) expect(isRegistryId(id), id).toBe(true);
    for (const id of ['', 'I9', '--flag', 'I9.a|b', 'I9.a b', 'I9.(x)', '.I9', 'I9..a', 'I9.a"']) expect(isRegistryId(id), id).toBe(false);
  });

  test('the pattern matches each named entry by its bracketed id and no longer one', () => {
    const pattern = new RegExp(idPattern(['I9.a-b', 'driver.hooks']), 'u');
    expect(pattern.test('[I9.a-b] title')).toBe(true);
    expect(pattern.test('[driver.hooks] title')).toBe(true);
    expect(pattern.test('[driver.hooks.codex] title')).toBe(false);
    expect(pattern.test('[I9xa-b] title')).toBe(false);
  });

  test('an id no passed test carried is unproven', () => {
    const outcomes = [local('I9.a', 'passed'), local('I9.b', 'skipped'), local('I9.c', 'failed'), local('I9.a.longer', 'passed')];
    expect(unproven(['I9.a', 'I9.b', 'I9.c', 'I9.d'], outcomes)).toEqual(['I9.b', 'I9.c', 'I9.d']);
  });
});

describe('which packages a change touches', () => {
  const packages = [{ name: 'api', dir: 'packages/api' }, { name: 'codex', dir: 'packages/drivers/codex' }, { name: 'cli', dir: 'packages/cli' }];
  test('a path belongs to the package whose directory holds it, and to none otherwise', () => {
    expect(changedPackages(['packages/api/src/x.ts', 'packages\\drivers\\codex\\test\\y.ts', 'docs/decisions.md', 'packages/apix/z.ts', 'scripts/a.ts'], packages).map((p) => p.name)).toEqual(['api', 'codex']);
    expect(changedPackages([], packages)).toEqual([]);
  });
});
