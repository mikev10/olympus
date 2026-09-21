/**
 * Assertions and skip markers, for vitest and jest alike: what is parsed,
 * and what a change between two versions of a file loses.
 */
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { AdapterRefusal, JestAdapter, VitestAdapter, type Assertion, type TestFrameworkAdapter } from '../src/index.js';
import { cleanup, linkDirectory, repo } from './repo.js';

afterEach(cleanup);

const adapters: Array<[string, TestFrameworkAdapter]> = [['vitest', new VitestAdapter(4)], ['jest', new JestAdapter(30)]];

async function parsed(adapter: TestFrameworkAdapter, body: string): Promise<Assertion[]> {
  const root = await repo({ 'a.test.ts': body });
  return adapter.parseAssertions(join(root, 'a.test.ts'));
}

async function compare(adapter: TestFrameworkAdapter, before: string, after: string): Promise<ReturnType<TestFrameworkAdapter['compareAssertions']>> {
  return adapter.compareAssertions(await parsed(adapter, before), await parsed(adapter, after));
}

describe.each(adapters)('%s', (_, adapter) => {
  test('parses a matcher with its subject, its arguments, and its line', async () => {
    const found = await parsed(adapter, "test('x', () => {\n  expect(add(2, 3)).toBe(5);\n  expect(xs).not.toContain( 'a' );\n});");
    expect(found).toEqual([
      { file: expect.stringMatching(/a\.test\.ts$/) as string, line: 2, operator: 'toBe()', args: ['add(2, 3)', '5'] },
      { file: expect.stringMatching(/a\.test\.ts$/) as string, line: 3, operator: 'not.toContain()', args: ['xs', "'a'"] },
    ]);
  });

  test('toBe(5) changed to toBeTruthy() is weakened', async () => {
    const delta = await compare(adapter, 'expect(x).toBe(5);', 'expect(x).toBeTruthy();');
    expect(delta.weakened.map((a) => a.operator)).toEqual(['toBeTruthy()']);
    expect(delta.removed).toEqual([]);
  });

  test('a deleted assertion is removed', async () => {
    const delta = await compare(adapter, 'expect(x).toBe(5);\nexpect(y).toEqual([1]);', 'expect(x).toBe(5);');
    expect(delta.removed.map((a) => a.args[0])).toEqual(['y']);
    expect(delta.weakened).toEqual([]);
  });

  test('toBeCloseTo(v, 5) changed to toBeCloseTo(v, 2) is toleranceWidened', async () => {
    const delta = await compare(adapter, 'expect(r).toBeCloseTo(0.3, 5);', 'expect(r).toBeCloseTo(0.3, 2);');
    expect(delta.toleranceWidened).toEqual([expect.objectContaining({ tolerance: 0.005 })]);
    expect(delta.weakened).toEqual([]);
  });

  test('an unchanged file compares empty, and so does one whose assertions only moved', async () => {
    const body = 'expect(x).toBe(5);\nexpect(y).toStrictEqual({ a: 1 });';
    expect(await compare(adapter, body, body)).toEqual({ weakened: [], removed: [], toleranceWidened: [] });
    const moved = '\n\n// reordered\nexpect(y).toStrictEqual({  a: 1 });\nexpect(x).toBe(5);';
    expect(await compare(adapter, body, moved)).toEqual({ weakened: [], removed: [], toleranceWidened: [] });
  });

  test.each([
    ['a new negation', 'expect(x).toBe(5);', 'expect(x).not.toBe(5);'],
    ['a changed expected value', 'expect(x).toBe(5);', 'expect(x).toBe(6);'],
    ['looser equality', 'expect(x).toStrictEqual(y);', 'expect(x).toEqual(y);'],
    ['a dropped message', "expect(f).toThrow('boom');", 'expect(f).toThrow();'],
    ['a strict assert loosened', 'assert.strictEqual(a, b);', 'assert.equal(a, b);'],
    ['a chai equality turned into existence', 'expect(x).to.equal(1);', 'expect(x).to.exist;'],
  ])('%s is weakened', async (_, before, after) => {
    const delta = await compare(adapter, before, after);
    expect(delta.weakened).toHaveLength(1);
  });

  test.each([
    ['existence turned into equality', 'expect(x).toBeDefined();', 'expect(x).toBe(5);'],
    ['a message added', 'expect(f).toThrow();', "expect(f).toThrow('boom');"],
    ['stricter equality', 'expect(x).toEqual(y);', 'expect(x).toStrictEqual(y);'],
    ['a negation removed', 'expect(x).not.toBe(5);', 'expect(x).toBe(5);'],
    ['a tolerance narrowed', 'expect(r).toBeCloseTo(0.3, 2);', 'expect(r).toBeCloseTo(0.3, 5);'],
  ])('%s is not reported', async (_, before, after) => {
    expect(await compare(adapter, before, after)).toEqual({ weakened: [], removed: [], toleranceWidened: [] });
  });

  test('expect.assertions and the chai property forms are assertions too', async () => {
    const found = await parsed(adapter, 'expect.assertions(2);\nexpect(ok).to.be.true;\nassert(flag);');
    expect(found.map((a) => a.operator)).toEqual(['expect.assertions', 'to.be.true', 'assert']);
  });

  test('a file that does not parse is refused, never read as having fewer assertions', async () => {
    await expect(parsed(adapter, 'expect(x).toBe(')).rejects.toThrow(AdapterRefusal);
  });

  test('a test file reached through a linked directory is refused, never followed', async () => {
    const outside = await repo({ 'secret.test.ts': 'expect(1).toBe(1);' });
    const root = await repo({});
    await linkDirectory(outside, join(root, 'linked'));
    await expect(adapter.parseAssertions(join(root, 'linked'))).rejects.toThrow(/symbolic link/);
  });

  test('detects every skip marker, by chain and test name, with no line number', async () => {
    const root = await repo({
      'a.test.ts': [
        "describe.only('suite', () => {",
        "  it.skip('skipped', () => {});",
        "  test.todo('later');",
        "  xit('prefixed', () => {});",
        "  fdescribe('focused', () => {});",
        "  test.skipIf(process.env.CI)('conditional', () => {});",
        "  test.runIf(isLinux)('only here', () => {});",
        "  test.fails('expected to fail', () => {});",
        "  test.failing('jest expected to fail', () => {});",
        "  test.skip.each([1, 2])('table %i', () => {});",
        "  test('context', (ctx) => { ctx.skip(); });",
        "  test('destructured', ({ skip }) => { skip(); });",
        "  test('runs', () => { expect(1).toBe(1); });",
        '});',
      ].join('\n'),
    });
    expect(await adapter.detectSkipMarkers(join(root, 'a.test.ts'))).toEqual([
      'describe.only: suite',
      'it.skip: skipped',
      'test.todo: later',
      'xit: prefixed',
      'fdescribe: focused',
      'test.skipIf(process.env.CI): conditional',
      'test.runIf(isLinux): only here',
      'test.fails: expected to fail',
      'test.failing: jest expected to fail',
      'test.skip.each([1, 2]): table %i',
      'ctx.skip: context',
      'skip: destructured',
    ]);
  });
});
