import fc from 'fast-check';
import { describe, it } from 'vitest';
import { multiply } from '../../src/math';

describe('multiply, for every pair of integers', () => {
  it('returns their product', () => {
    fc.assert(fc.property(fc.integer({ min: -1000, max: 1000 }), fc.integer({ min: -1000, max: 1000 }), (a, b) => multiply(a, b) === a * b));
  });

  it('leaves a number unchanged when the other side is 1', () => {
    fc.assert(fc.property(fc.integer({ min: -1000, max: 1000 }), (a) => multiply(a, 1) === a && multiply(1, a) === a));
  });
});
