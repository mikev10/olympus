/**
 * Tests for summary formatter utilities
 */

import { describe, it, expect } from 'vitest';
import { formatSessionSummaryLine } from '../../learning/summary-formatter.js';
import type { SessionSummary } from '../../learning/types.js';

/**
 * Helper function to create sample SessionSummary objects
 */
function makeSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    session_id: 'test-123',
    project_path: '/test',
    started_at: '2026-02-05T10:00:00.000Z',
    ended_at: '2026-02-05T10:05:00.000Z',
    duration_seconds: 300,
    agents_used: ['oracle', 'explore', 'olympian'],
    total_input_tokens: 5000,
    total_output_tokens: 8000,
    total_tokens: 13000,
    estimated_cost: 0.04,
    model: 'claude-sonnet-4-5',
    outcome: 'success',
    ...overrides,
  };
}

describe('formatSessionSummaryLine', () => {
  it('should format a standard session summary', () => {
    const summary = makeSummary();
    const result = formatSessionSummaryLine(summary);

    expect(result).toContain('[Olympus] Session:');
    expect(result).toContain('3 agents');
    expect(result).toContain('oracle, explore, olympian');
    expect(result).toContain('13,000 tokens');
    expect(result).toContain('$0.04');
    expect(result).toContain('5m 0s');
  });

  it('should handle zero agents', () => {
    const summary = makeSummary({
      agents_used: [],
    });
    const result = formatSessionSummaryLine(summary);

    expect(result).toContain('0 agents');
    expect(result).toContain('(none)');
  });

  it('should handle single agent', () => {
    const summary = makeSummary({
      agents_used: ['oracle'],
    });
    const result = formatSessionSummaryLine(summary);

    expect(result).toContain('1 agent');
    expect(result).not.toContain('agents');
    expect(result).toContain('oracle');
  });

  it('should truncate agents when more than 4', () => {
    const summary = makeSummary({
      agents_used: ['oracle', 'explore', 'olympian', 'librarian', 'frontend-engineer', 'momus'],
    });
    const result = formatSessionSummaryLine(summary);

    expect(result).toContain('6 agents');
    expect(result).toContain('oracle, explore, olympian, ...');
    expect(result).not.toContain('librarian');
    expect(result).not.toContain('frontend-engineer');
    expect(result).not.toContain('momus');
  });

  it('should handle exactly 4 agents (no truncation)', () => {
    const summary = makeSummary({
      agents_used: ['oracle', 'explore', 'olympian', 'librarian'],
    });
    const result = formatSessionSummaryLine(summary);

    expect(result).toContain('4 agents');
    expect(result).toContain('oracle, explore, olympian, librarian');
    expect(result).not.toContain('...');
  });

  it('should handle zero tokens', () => {
    const summary = makeSummary({
      total_input_tokens: 0,
      total_output_tokens: 0,
      total_tokens: 0,
    });
    const result = formatSessionSummaryLine(summary);

    expect(result).toContain('0 tokens');
  });

  it('should handle very small cost', () => {
    const summary = makeSummary({
      estimated_cost: 0.003,
    });
    const result = formatSessionSummaryLine(summary);

    expect(result).toContain('$0.003');
  });

  it('should handle larger cost with 2 decimals', () => {
    const summary = makeSummary({
      estimated_cost: 1.50,
    });
    const result = formatSessionSummaryLine(summary);

    expect(result).toContain('$1.50');
  });

  it('should handle zero cost', () => {
    const summary = makeSummary({
      estimated_cost: 0,
    });
    const result = formatSessionSummaryLine(summary);

    expect(result).toContain('$0.00');
  });

  it('should handle short duration (seconds only)', () => {
    const summary = makeSummary({
      duration_seconds: 45,
    });
    const result = formatSessionSummaryLine(summary);

    expect(result).toContain('45s');
    // Should not contain "Xm Ys" pattern for duration (but may contain 'm' in "Olympus")
    expect(result).not.toMatch(/\d+m \d+s/);
  });

  it('should handle long duration', () => {
    const summary = makeSummary({
      duration_seconds: 3600,
    });
    const result = formatSessionSummaryLine(summary);

    expect(result).toContain('60m 0s');
  });

  it('should handle duration with minutes and seconds', () => {
    const summary = makeSummary({
      duration_seconds: 125, // 2m 5s
    });
    const result = formatSessionSummaryLine(summary);

    expect(result).toContain('2m 5s');
  });

  it('should not exceed 200 characters', () => {
    // Create a summary with many agents with VERY long names to exceed 200 chars
    const longAgentNames = [
      'extremely-long-agent-name-one-with-many-characters',
      'extremely-long-agent-name-two-with-many-characters',
      'extremely-long-agent-name-three-with-many-characters',
      'extremely-long-agent-name-four-with-many-characters',
      'extremely-long-agent-name-five-with-many-characters',
      'extremely-long-agent-name-six-with-many-characters',
      'extremely-long-agent-name-seven-with-many-characters',
    ];

    const summary = makeSummary({
      agents_used: longAgentNames,
      total_tokens: 999999999999, // Very large number
      estimated_cost: 99999.99,
      duration_seconds: 999999,
    });

    const result = formatSessionSummaryLine(summary);
    expect(result.length).toBeLessThanOrEqual(200);

    // If the line is exactly 200 chars or gets truncated, it should end with ...
    if (result.length === 200) {
      expect(result).toMatch(/\.\.\.$/);
    }
  });

  it('should handle very large token counts with commas', () => {
    const summary = makeSummary({
      total_tokens: 1234567,
    });
    const result = formatSessionSummaryLine(summary);

    expect(result).toContain('1,234,567 tokens');
  });

  it('should handle multiple agents without exceeding length', () => {
    const summary = makeSummary({
      agents_used: ['oracle', 'explore'],
      duration_seconds: 30,
    });
    const result = formatSessionSummaryLine(summary);

    expect(result).toContain('2 agents');
    expect(result).toContain('oracle, explore');
    expect(result.length).toBeLessThanOrEqual(200);
  });

  it('should format all components in correct order', () => {
    const summary = makeSummary({
      agents_used: ['oracle'],
      total_tokens: 1000,
      estimated_cost: 0.01,
      duration_seconds: 60,
    });
    const result = formatSessionSummaryLine(summary);

    // Verify order: [Olympus] Session: X agents (names) | Y tokens | $Z | Xm Ys
    const pattern = /\[Olympus\] Session: \d+ agent.*\| [\d,]+ tokens \| \$[\d.]+ \| \d+[ms]/;
    expect(result).toMatch(pattern);
  });

  it('should handle edge case with 0 duration', () => {
    const summary = makeSummary({
      duration_seconds: 0,
    });
    const result = formatSessionSummaryLine(summary);

    expect(result).toContain('0s');
  });

  it('should handle fractional costs correctly', () => {
    const summary1 = makeSummary({
      estimated_cost: 0.0099, // Should show 3 decimals
    });
    expect(formatSessionSummaryLine(summary1)).toContain('$0.010');

    const summary2 = makeSummary({
      estimated_cost: 0.01, // Should show 2 decimals
    });
    expect(formatSessionSummaryLine(summary2)).toContain('$0.01');
  });
});
