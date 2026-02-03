import { describe, it, expect } from 'vitest';
import { detectAnomaly, AnomalyThresholds } from '../../learning/anomaly.js';

describe('detectAnomaly', () => {
  const defaultThresholds: AnomalyThresholds = {
    warning: 1.5,
    critical: 2.5
  };

  it('should detect no anomaly for normal usage', () => {
    const result = detectAnomaly(10000, 10000, defaultThresholds);

    expect(result.is_anomaly).toBe(false);
    expect(result.severity).toBe('info');
    expect(result.ratio).toBe(1.0);
    expect(result.message).toContain('10.0k');
    expect(result.message).toContain('100%');
  });

  it('should detect warning anomaly at 1.5x threshold', () => {
    const result = detectAnomaly(15000, 10000, defaultThresholds);

    expect(result.is_anomaly).toBe(true);
    expect(result.severity).toBe('warning');
    expect(result.ratio).toBe(1.5);
    expect(result.message).toContain('15.0k');
    expect(result.message).toContain('150%');
    expect(result.message).toContain('above typical usage');
  });

  it('should detect critical anomaly at 2.5x threshold', () => {
    const result = detectAnomaly(25000, 10000, defaultThresholds);

    expect(result.is_anomaly).toBe(true);
    expect(result.severity).toBe('critical');
    expect(result.ratio).toBe(2.5);
    expect(result.message).toContain('25.0k');
    expect(result.message).toContain('250%');
    expect(result.message).toContain('unusually high');
  });

  it('should handle first session (baseline = 0)', () => {
    const result = detectAnomaly(10000, 0, defaultThresholds);

    expect(result.is_anomaly).toBe(false);
    expect(result.severity).toBe('info');
    expect(result.ratio).toBe(0);
    expect(result.message).toContain('No baseline data');
  });

  it('should use custom thresholds', () => {
    const customThresholds: AnomalyThresholds = {
      warning: 2.0,
      critical: 3.0
    };

    const result = detectAnomaly(18000, 10000, customThresholds);

    // 1.8x is below 2.0 warning threshold
    expect(result.is_anomaly).toBe(false);
    expect(result.severity).toBe('info');
  });

  it('should detect warning with custom thresholds', () => {
    const customThresholds: AnomalyThresholds = {
      warning: 2.0,
      critical: 3.0
    };

    const result = detectAnomaly(20000, 10000, customThresholds);

    expect(result.is_anomaly).toBe(true);
    expect(result.severity).toBe('warning');
  });

  it('should format small token counts without k suffix', () => {
    const result = detectAnomaly(500, 500, defaultThresholds);

    expect(result.message).toContain('500');
    expect(result.message).not.toContain('k');
  });

  it('should format large token counts with k suffix', () => {
    const result = detectAnomaly(15000, 10000, defaultThresholds);

    expect(result.message).toContain('15.0k');
    expect(result.message).toContain('10.0k');
  });

  it('should throw on negative current tokens', () => {
    expect(() => detectAnomaly(-5000, 10000, defaultThresholds)).toThrow('Token counts cannot be negative');
  });

  it('should throw on negative baseline', () => {
    expect(() => detectAnomaly(10000, -5000, defaultThresholds)).toThrow('Token counts cannot be negative');
  });

  it('should throw on negative threshold values', () => {
    expect(() => detectAnomaly(10000, 10000, { warning: -1.5, critical: 2.5 }))
      .toThrow('Thresholds cannot be negative');
  });

  it('should throw when critical <= warning', () => {
    expect(() => detectAnomaly(10000, 10000, { warning: 2.5, critical: 2.5 }))
      .toThrow('Critical threshold must be greater than warning threshold');

    expect(() => detectAnomaly(10000, 10000, { warning: 3.0, critical: 2.5 }))
      .toThrow('Critical threshold must be greater than warning threshold');
  });

  it('should detect anomaly just below critical threshold', () => {
    const result = detectAnomaly(24999, 10000, defaultThresholds);

    expect(result.is_anomaly).toBe(true);
    expect(result.severity).toBe('warning');
  });

  it('should detect critical at exact threshold', () => {
    const result = detectAnomaly(25000, 10000, defaultThresholds);

    expect(result.is_anomaly).toBe(true);
    expect(result.severity).toBe('critical');
  });

  it('should include actionable recommendations in critical message', () => {
    const result = detectAnomaly(25000, 10000, defaultThresholds);

    expect(result.message).toContain('delegate');
    expect(result.message).toContain('smaller tasks');
  });

  it('should include actionable recommendations in warning message', () => {
    const result = detectAnomaly(15000, 10000, defaultThresholds);

    expect(result.message).toContain('delegating');
    expect(result.message).toContain('completion');
  });
});
