import { describe, expect, it } from 'vitest';
import { add } from '../src/math';

describe('add', () => {
  it('adds two positive numbers', () => {
    expect(add(2, 3)).toBe(5);
  });

  it('adds a negative number', () => {
    expect(add(2, -3)).toBe(-1);
  });
});
