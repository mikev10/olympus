import { describe, it, expect } from 'vitest';
import { calculateEfficiencyScore, calculateTrend } from '../../learning/efficiency.js';

describe('calculateEfficiencyScore', () => {
  it('should calculate efficiency score correctly', () => {
    const score = calculateEfficiencyScore(0.9, 5000, 10000);
    // successRate * (baseline / avgTokens)
    // 0.9 * (10000 / 5000) = 0.9 * 2 = 1.8
    expect(score).toBe(1.8);
  });

  it('should cap token factor at 2x', () => {
    // Very low tokens should cap at 2x
    const score = calculateEfficiencyScore(0.9, 1000, 10000);
    // 0.9 * min(10, 2) = 0.9 * 2 = 1.8
    expect(score).toBe(1.8);
  });

  it('should handle zero success rate', () => {
    const score = calculateEfficiencyScore(0, 5000, 10000);
    expect(score).toBe(0);
  });

  it('should handle zero tokens (return 0)', () => {
    const score = calculateEfficiencyScore(0.9, 0, 10000);
    expect(score).toBe(0);
  });

  it('should handle high token usage (low efficiency)', () => {
    const score = calculateEfficiencyScore(0.9, 20000, 10000);
    // 0.9 * (10000 / 20000) = 0.9 * 0.5 = 0.45
    expect(score).toBe(0.45);
  });

  it('should throw on invalid success rate (negative)', () => {
    expect(() => calculateEfficiencyScore(-0.1, 5000, 10000)).toThrow('Invalid success rate');
  });

  it('should throw on invalid success rate (> 1)', () => {
    expect(() => calculateEfficiencyScore(1.5, 5000, 10000)).toThrow('Invalid success rate');
  });

  it('should throw on negative token counts', () => {
    expect(() => calculateEfficiencyScore(0.9, -5000, 10000)).toThrow('Token counts cannot be negative');
    expect(() => calculateEfficiencyScore(0.9, 5000, -10000)).toThrow('Token counts cannot be negative');
  });

  it('should handle perfect efficiency (100% success, half the tokens)', () => {
    const score = calculateEfficiencyScore(1.0, 5000, 10000);
    // 1.0 * (10000 / 5000) = 1.0 * 2 = 2.0
    expect(score).toBe(2.0);
  });

  it('should handle baseline equal to average', () => {
    const score = calculateEfficiencyScore(0.8, 10000, 10000);
    // 0.8 * (10000 / 10000) = 0.8 * 1 = 0.8
    expect(score).toBe(0.8);
  });
});

describe('calculateTrend', () => {
  it('should return insufficient_data when samples < 5', () => {
    expect(calculateTrend(5000, 6000, 4)).toBe('insufficient_data');
    expect(calculateTrend(5000, 6000, 0)).toBe('insufficient_data');
  });

  it('should detect improving trend (tokens decreasing)', () => {
    // recentAvg is 10% lower than historical
    const trend = calculateTrend(9000, 10000, 10);
    expect(trend).toBe('improving');
  });

  it('should detect declining trend (tokens increasing)', () => {
    // recentAvg is 10% higher than historical
    const trend = calculateTrend(11000, 10000, 10);
    expect(trend).toBe('declining');
  });

  it('should detect stable trend (within 10% threshold)', () => {
    const trend = calculateTrend(10050, 10000, 10);
    expect(trend).toBe('stable');
  });

  it('should handle edge case: historical avg is zero', () => {
    const trend = calculateTrend(5000, 0, 10);
    expect(trend).toBe('insufficient_data');
  });

  it('should throw on negative averages', () => {
    expect(() => calculateTrend(-5000, 10000, 10)).toThrow('Average token counts cannot be negative');
    expect(() => calculateTrend(5000, -10000, 10)).toThrow('Average token counts cannot be negative');
  });

  it('should detect improving trend at exactly -10%', () => {
    const trend = calculateTrend(9000, 10000, 10);
    expect(trend).toBe('improving');
  });

  it('should detect declining trend at exactly +10%', () => {
    const trend = calculateTrend(11000, 10000, 10);
    expect(trend).toBe('declining');
  });

  it('should detect stable at -9% (just under threshold)', () => {
    const trend = calculateTrend(9100, 10000, 10);
    expect(trend).toBe('stable');
  });

  it('should detect stable at +9% (just under threshold)', () => {
    const trend = calculateTrend(10900, 10000, 10);
    expect(trend).toBe('stable');
  });
});
