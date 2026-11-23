import { describe, expect, test } from 'vitest';
import type { CheckResult, PropertyCheckSpec, PropertyEvidence, PropertyRun } from '@olympus-ai/integrity';
import { propertyBaseCause, propertyOutcome } from '../src/property.js';
import { parseManifest } from '../src/validate.js';

const pin = { seed: 42, numRuns: 25 };
const sites = [{ file: 'a.test.ts', line: 3 }, { file: 'a.test.ts', line: 9 }];
const run = (line: number, over: Partial<PropertyRun> = {}): PropertyRun => ({ file: 'a.test.ts', line, seed: 42, casesRun: 25, failed: false, counterexample: null, ...over });
const evidence = (runs: PropertyRun[]): PropertyEvidence => ({ ...pin, runs });
const fields = (outcome: ReturnType<typeof propertyOutcome>): string[] => (outcome.held ? [] : outcome.mismatches.map((m) => m.field));

describe('propertyOutcome', () => {
  test('holds only when every registration ran every pinned case on the pinned seed, and the process exited 0', () => {
    expect(propertyOutcome(pin, sites, 0, evidence([run(3), run(9), run(9)]))).toEqual({ held: true });
  });

  test('names each way it fails', () => {
    expect(fields(propertyOutcome(pin, sites, 1, evidence([run(3), run(9)])))).toEqual(['exitCode']);
    expect(fields(propertyOutcome(pin, sites, 0, null))).toEqual(['reports']);
    expect(fields(propertyOutcome(pin, sites, 0, evidence([run(3)])))).toEqual(['a.test.ts:9']);
    expect(fields(propertyOutcome(pin, sites, 0, evidence([run(3), run(9, { casesRun: 24 })])))).toEqual(['a.test.ts:9.casesRun']);
    expect(fields(propertyOutcome(pin, sites, 0, evidence([run(3), run(9, { seed: 7 })])))).toEqual(['a.test.ts:9.seed']);
    expect(fields(propertyOutcome(pin, sites, 1, evidence([run(3), run(9, { failed: true, casesRun: 2, counterexample: '[0]' })])))).toEqual(['exitCode', 'a.test.ts:9.failed']);
    expect(fields(propertyOutcome(pin, sites, 0, evidence([run(3), run(9), run(5)])))).toEqual(['reports']);
    expect(fields(propertyOutcome(pin, sites, 0, evidence([run(3), run(9), { ...run(0), file: '' }])))).toEqual(['reports']);
  });

  test('no registration at all never holds on an empty report', () => {
    expect(propertyOutcome(pin, [], 0, evidence([run(3)])).held).toBe(false);
  });
});

describe('propertyBaseCause', () => {
  const check = (onBase: 'fails' | 'passes'): PropertyCheckSpec => ({ id: 'p', kind: 'property', onBase, tests: ['a.test.ts'], ...pin, required: true, timeoutMs: 1000 });
  const result = (runs: PropertyRun[] | null, exitCode: number): CheckResult => {
    const property = runs === null ? null : evidence(runs);
    return { checkId: 'p', exitCode, stdout: '', stderr: '', suiteCount: 1, findings: null, property, expectation: propertyOutcome(pin, sites, exitCode, property), durationMs: 1, startedAt: '' };
  };

  test("'fails' is met only by a run that failed on the pinned seed", () => {
    expect(propertyBaseCause(check('fails'), result([run(3, { failed: true, casesRun: 1, counterexample: '[0]' }), run(9)], 1))).toBeUndefined();
    expect(propertyBaseCause(check('fails'), result([], 1))).toBe('no-result');
    expect(propertyBaseCause(check('fails'), result(null, 1))).toBe('no-result');
    expect(propertyBaseCause(check('fails'), result([run(3, { failed: true, seed: 1 })], 1))).toBe('no-result');
    expect(propertyBaseCause(check('fails'), result([run(3), run(9)], 0))).toBe('contrary');
  });

  test("'passes' is met only when the comparison held", () => {
    expect(propertyBaseCause(check('passes'), result([run(3), run(9)], 0))).toBeUndefined();
    expect(propertyBaseCause(check('passes'), result([run(3), run(9, { casesRun: 1 })], 0))).toBe('suite-count');
    expect(propertyBaseCause(check('passes'), result([run(3), run(9, { failed: true })], 1))).toBe('contrary');
  });
});

describe('a property check in a manifest', () => {
  const base = { id: 'p', kind: 'property', onBase: 'fails', tests: ['a.test.ts'], seed: 42, numRuns: 25, required: true, timeoutMs: 1000 };
  const codes = (check: Record<string, unknown>): string[] => {
    const parsed = parseManifest({ checks: [check] });
    return parsed.ok ? [] : parsed.problems.map((p) => `${p.path}:${p.code}`);
  };

  test('is admitted with its tests, its declaration, and its pin', () => {
    expect(codes(base)).toEqual([]);
  });

  test('pins a 32-bit seed and a positive case count, with no default', () => {
    expect(codes({ ...base, seed: undefined })).toContain('manifest.checks[0].seed:not-integer');
    expect(codes({ ...base, seed: 2 ** 31 })).toContain('manifest.checks[0].seed:not-integer');
    expect(codes({ ...base, numRuns: 0 })).toContain('manifest.checks[0].numRuns:not-integer');
    expect(codes({ ...base, numRuns: 1.5 })).toContain('manifest.checks[0].numRuns:not-integer');
  });

  test('declares what it does on the base, names its tests, and pins no command', () => {
    expect(codes({ ...base, onBase: undefined })).toContain('manifest.checks[0].onBase:undeclared');
    expect(codes({ ...base, tests: [] })).toContain('manifest.checks[0].tests:missing');
    expect(codes({ ...base, command: ['node'] })).toContain('manifest.checks[0].command:not-applicable');
    // A property check may name a rule it states (A-R25-01), and like every check that does, it is required.
    expect(codes({ ...base, deniesRule: 'r' })).toEqual([]);
    expect(codes({ ...base, deniesRule: 'r', required: false })).toContain('manifest.checks[0].required:not-required');
  });

  test('no other kind pins a seed or a case count', () => {
    expect(codes({ id: 'a', kind: 'acceptance', onBase: 'fails', tests: ['a.test.ts'], seed: 1, required: true, timeoutMs: 1000 })).toContain('manifest.checks[0].seed:not-applicable');
  });
});
