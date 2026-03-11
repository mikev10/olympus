import { describe, it, expect } from 'vitest';
import {
  getSessionBaseline,
  updateSessionBaseline,
  getWarningThreshold,
  SessionBaseline
} from '../../learning/baselines.js';

describe('getSessionBaseline', () => {
  it('should return default 10k when no baseline data', () => {
    expect(getSessionBaseline()).toBe(10000);
  });

  it('should return default 10k when sample count < 5', () => {
    const baseline: SessionBaseline = {
      overall_avg: 8000,
      by_task_type: {},
      sample_count: 4,
      last_updated: new Date().toISOString()
    };
    expect(getSessionBaseline(undefined, baseline)).toBe(10000);
  });

  it('should return task-type baseline when available', () => {
    const baseline: SessionBaseline = {
      overall_avg: 10000,
      by_task_type: { debugging: 6000 },
      sample_count: 10,
      last_updated: new Date().toISOString()
    };
    expect(getSessionBaseline('debugging', baseline)).toBe(6000);
  });

  it('should fall back to overall average when no specific baseline', () => {
    const baseline: SessionBaseline = {
      overall_avg: 9200,
      by_task_type: {},
      sample_count: 10,
      last_updated: new Date().toISOString()
    };
    expect(getSessionBaseline('unknown-task', baseline)).toBe(9200);
  });
});

describe('updateSessionBaseline', () => {
  it('should initialize baseline for first session', () => {
    const result = updateSessionBaseline(8000, 'debugging', undefined);

    expect(result.overall_avg).toBe(8000);
    expect(result.by_task_type['debugging']).toBe(8000);
    expect(result.sample_count).toBe(1);
  });

  it('should initialize baseline without task type', () => {
    const result = updateSessionBaseline(8000, undefined, undefined);

    expect(result.overall_avg).toBe(8000);
    expect(result.by_task_type).toEqual({});
    expect(result.sample_count).toBe(1);
  });

  it('should update overall average correctly', () => {
    const baseline: SessionBaseline = {
      overall_avg: 10000,
      by_task_type: {},
      sample_count: 1,
      last_updated: new Date().toISOString()
    };

    const result = updateSessionBaseline(8000, undefined, baseline);

    // (10000 * 1 + 8000) / 2 = 9000
    expect(result.overall_avg).toBe(9000);
    expect(result.sample_count).toBe(2);
  });

  it('should update task-type average when provided', () => {
    const baseline: SessionBaseline = {
      overall_avg: 10000,
      by_task_type: { debugging: 8000 },
      sample_count: 5,
      last_updated: new Date().toISOString()
    };

    const result = updateSessionBaseline(6000, 'debugging', baseline);

    expect(result.by_task_type['debugging']).toBeLessThan(8000);
  });

  it('should throw on negative token counts', () => {
    expect(() => updateSessionBaseline(-1000)).toThrow('Session tokens cannot be negative');
  });

  it('should update last_updated timestamp', () => {
    const oldTimestamp = new Date('2024-01-01').toISOString();
    const baseline: SessionBaseline = {
      overall_avg: 10000,
      by_task_type: {},
      sample_count: 1,
      last_updated: oldTimestamp
    };

    const result = updateSessionBaseline(8000, undefined, baseline);

    expect(result.last_updated).not.toBe(oldTimestamp);
    expect(new Date(result.last_updated).getTime()).toBeGreaterThan(new Date(oldTimestamp).getTime());
  });

  it('should not have by_project field', () => {
    const result = updateSessionBaseline(8000, 'debugging', undefined);
    expect((result as unknown as Record<string, unknown>)['by_project']).toBeUndefined();
  });
});

describe('getWarningThreshold', () => {
  it('should calculate warning threshold with default multiplier', () => {
    expect(getWarningThreshold(10000)).toBe(15000);
  });

  it('should calculate warning threshold with custom multiplier', () => {
    expect(getWarningThreshold(10000, 2.0)).toBe(20000);
  });

  it('should handle zero baseline', () => {
    expect(getWarningThreshold(0, 1.5)).toBe(0);
  });

  it('should throw on negative baseline', () => {
    expect(() => getWarningThreshold(-10000, 1.5)).toThrow('Baseline and multiplier must be non-negative');
  });

  it('should throw on negative multiplier', () => {
    expect(() => getWarningThreshold(10000, -1.5)).toThrow('Baseline and multiplier must be non-negative');
  });
});
