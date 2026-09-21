import { describe, expect, test } from 'vitest';
import { changedLines } from '../src/index.js';

/** The length of a longest common subsequence, by dynamic programming: the oracle a shortest edit script must agree with. */
function lcs(a: readonly string[], b: readonly string[]): number {
  const row = new Array<number>(b.length + 1).fill(0);
  for (const x of a) {
    let diagonal = 0;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j] ?? 0;
      row[j] = x === b[j - 1] ? diagonal + 1 : Math.max(above, row[j - 1] ?? 0);
      diagonal = above;
    }
  }
  return row[b.length] ?? 0;
}

/** A small deterministic generator, so a failure names a seed that reproduces it. */
function lines(seed: number, length: number): string[] {
  let state = seed;
  return Array.from({ length }, () => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return String.fromCharCode(97 + (state % 4));
  });
}

describe('changedLines', () => {
  test('an unchanged file has no changed line', () => {
    expect([...changedLines(['a', 'b'], ['a', 'b'])]).toEqual([]);
  });

  test('an inserted line and a replaced line are reported, by their line in the new text', () => {
    expect([...changedLines(['a', 'b', 'c'], ['a', 'x', 'b', 'y'])].sort()).toEqual([2, 4]);
  });

  test('a deletion reports nothing in the new text', () => {
    expect([...changedLines(['a', 'b', 'c'], ['a', 'c'])]).toEqual([]);
  });

  test('a new file is every line', () => {
    expect([...changedLines([], ['a', 'b'])]).toEqual([1, 2]);
  });

  test.each(Array.from({ length: 200 }, (_, seed) => seed))('seed %i: exactly the lines outside a longest common subsequence', (seed) => {
    const before = lines(seed, seed % 17);
    const after = lines(seed * 7 + 3, (seed * 5) % 19);
    const changed = changedLines(before, after);
    expect(after.length - changed.size).toBe(lcs(before, after));
    const kept = after.filter((_, i) => !changed.has(i + 1));
    expect(lcs(before, kept)).toBe(kept.length);
  });

  test('a change larger than the edit bound reports the whole rewritten span, never less', () => {
    const before = lines(1, 400);
    const after = ['head', ...lines(2, 400), 'tail'];
    const bounded = changedLines(before, after, 10);
    expect(bounded.size).toBe(after.length);
  });
});
