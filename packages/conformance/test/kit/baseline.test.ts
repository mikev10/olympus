import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { PENDING_BASELINE_FILE, parsePendingBaseline, readPendingBaseline } from '../../src/kit/baseline.js';

describe('parsePendingBaseline', () => {
  test('accepts a table of non-negative integers under invariants and claims', () => {
    expect(parsePendingBaseline('{"invariants":{"I1":1,"I8":0},"claims":{"driver.mcp":1}}')).toEqual({
      invariants: { I1: 1, I8: 0 },
      claims: { 'driver.mcp': 1 },
    });
  });

  test('rejects a count that is not a non-negative integer', () => {
    expect(() => parsePendingBaseline('{"invariants":{"I1":-1},"claims":{}}')).toThrow('I1: -1 is not a non-negative integer');
    expect(() => parsePendingBaseline('{"invariants":{"I1":1.5},"claims":{}}')).toThrow('I1: 1.5 is not a non-negative integer');
    expect(() => parsePendingBaseline('{"invariants":{},"claims":{"driver.mcp":"1"}}')).toThrow(
      'driver.mcp: "1" is not a non-negative integer',
    );
  });

  test('rejects a document that is not an object with both sections', () => {
    expect(() => parsePendingBaseline('{"invariants":{}}')).toThrow('claims');
    expect(() => parsePendingBaseline('{"claims":{}}')).toThrow('invariants');
    expect(() => parsePendingBaseline('[]')).toThrow('not an object');
  });

  test('rejects an unknown top-level key, so a misspelled section cannot pass as absent, but allows a $comment', () => {
    expect(() => parsePendingBaseline('{"invariants":{},"claims":{},"claim":{}}')).toThrow("unknown key 'claim'");
    expect(parsePendingBaseline('{"$comment":"how to edit","invariants":{},"claims":{}}')).toEqual({ invariants: {}, claims: {} });
  });

  test('rejects a key that is not an invariant id or a claim id', () => {
    expect(() => parsePendingBaseline('{"invariants":{"I11":0},"claims":{}}')).toThrow("'I11' is not an invariant");
    expect(() => parsePendingBaseline('{"invariants":{},"claims":{"vault.write":0}}')).toThrow(
      "'vault.write' is not a capability claim",
    );
  });
});

describe('readPendingBaseline', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'conformance-baseline-'));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('reads and parses the file at the given path', () => {
    const file = join(dir, 'ok.json');
    writeFileSync(file, '{"invariants":{"I2":3},"claims":{}}\n');
    expect(readPendingBaseline(file)).toEqual({ invariants: { I2: 3 }, claims: {} });
  });

  test('a missing file is an error naming the committed location, never an empty baseline', () => {
    expect(() => readPendingBaseline(join(dir, 'absent.json'))).toThrow(PENDING_BASELINE_FILE);
  });

  test('the committed location is the conformance package root', () => {
    expect(PENDING_BASELINE_FILE).toBe('packages/conformance/pending-baseline.json');
  });
});
