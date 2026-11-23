import { describe, expect, it } from 'vitest';
import { multiply } from '../../src/math';

describe('multiply', () => {
  it('multiplies two positive numbers', () => {
    expect(multiply(3, 4)).toBe(12);
  });

  it('multiplies by zero', () => {
    expect(multiply(7, 0)).toBe(0);
  });

  it('multiplies two negative numbers', () => {
    expect(multiply(-2, -5)).toBe(10);
  });
});
