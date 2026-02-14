import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  calculateEfficiencyScore,
  calculateTrend,
  recordAgentExecution,
  getAgentPerformanceForRouting,
  type BoltExecutionResult
} from '../../learning/efficiency.js';
import type { FeedbackEntry, AgentPerformance } from '../../learning/types.js';

// Mock storage functions (partial mock to preserve other exports)
vi.mock('../../learning/storage.js', async () => {
  const actual = await vi.importActual('../../learning/storage.js');
  return {
    ...actual,
    appendFeedback: vi.fn(),
    readFeedbackLog: vi.fn(() => []),
    updateAgentPerformance: vi.fn(() => null)
  };
});

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

describe('recordAgentExecution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should construct correct FeedbackEntry for successful execution', async () => {
    const { appendFeedback } = await import('../../learning/storage.js');

    const result: BoltExecutionResult = {
      boltId: 'BOLT-001',
      agentName: 'olympian',
      success: true,
      sessionId: 'test-session-123',
      projectPath: '/test/project',
      taskDescription: 'Implement feature X'
    };

    recordAgentExecution(result);

    expect(appendFeedback).toHaveBeenCalledTimes(1);
    const call = vi.mocked(appendFeedback).mock.calls[0][0] as FeedbackEntry;

    expect(call.session_id).toBe('test-session-123');
    expect(call.project_path).toBe('/test/project');
    expect(call.event_type).toBe('success');
    expect(call.agent_used).toBe('olympian');
    expect(call.original_task).toBe('Implement feature X');
    expect(call.user_message).toBe('BOLT BOLT-001 execution succeeded');
    expect(call.feedback_category).toBe('praise');
    expect(call.confidence).toBe(1.0);
    expect(call.id).toMatch(/^[0-9a-f-]{36}$/); // UUID format
    expect(call.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO format
  });

  it('should set event_type to revision and category to correction for failed execution', async () => {
    const { appendFeedback } = await import('../../learning/storage.js');

    const result: BoltExecutionResult = {
      boltId: 'BOLT-002',
      agentName: 'frontend-engineer',
      success: false,
      sessionId: 'test-session-456',
      projectPath: '/test/project',
      taskDescription: 'Fix bug Y',
      failureReason: 'Test failed'
    };

    recordAgentExecution(result);

    expect(appendFeedback).toHaveBeenCalledTimes(1);
    const call = vi.mocked(appendFeedback).mock.calls[0][0] as FeedbackEntry;

    expect(call.event_type).toBe('revision');
    expect(call.feedback_category).toBe('correction');
    expect(call.user_message).toBe('BOLT BOLT-002 execution failed');
  });

  it('should include token usage when provided', async () => {
    const { appendFeedback } = await import('../../learning/storage.js');

    const result: BoltExecutionResult = {
      boltId: 'BOLT-003',
      agentName: 'oracle',
      success: true,
      sessionId: 'test-session-789',
      projectPath: '/test/project',
      tokenUsage: {
        input_tokens: 1000,
        output_tokens: 500
      }
    };

    recordAgentExecution(result);

    const call = vi.mocked(appendFeedback).mock.calls[0][0] as FeedbackEntry;

    expect(call.token_usage).toBeDefined();
    expect(call.token_usage?.input_tokens).toBe(1000);
    expect(call.token_usage?.output_tokens).toBe(500);
    expect(call.token_usage?.total_tokens).toBe(1500);
    expect(call.token_usage?.estimated).toBe(true);
  });

  it('should omit token_usage when not provided', async () => {
    const { appendFeedback } = await import('../../learning/storage.js');

    const result: BoltExecutionResult = {
      boltId: 'BOLT-004',
      agentName: 'olympian-low',
      success: true,
      sessionId: 'test-session-abc',
      projectPath: '/test/project'
    };

    recordAgentExecution(result);

    const call = vi.mocked(appendFeedback).mock.calls[0][0] as FeedbackEntry;

    expect(call.token_usage).toBeUndefined();
  });
});

describe('getAgentPerformanceForRouting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return AgentPerformance when data exists', async () => {
    const { readFeedbackLog, updateAgentPerformance } = await import('../../learning/storage.js');

    const mockEntries: FeedbackEntry[] = [
      {
        id: '1',
        timestamp: new Date().toISOString(),
        session_id: 'session-1',
        project_path: '/test',
        event_type: 'success',
        agent_used: 'olympian',
        user_message: 'Test',
        feedback_category: 'praise',
        confidence: 1.0
      }
    ];

    const mockPerformance: AgentPerformance = {
      agent_name: 'olympian',
      total_invocations: 10,
      success_count: 8,
      revision_count: 2,
      cancellation_count: 0,
      success_rate: 0.8,
      failure_patterns: [],
      strong_areas: [],
      weak_areas: [],
      last_updated: new Date().toISOString()
    };

    vi.mocked(readFeedbackLog).mockReturnValue(mockEntries);
    vi.mocked(updateAgentPerformance).mockReturnValue(mockPerformance);

    const result = getAgentPerformanceForRouting('olympian');

    expect(readFeedbackLog).toHaveBeenCalledTimes(1);
    expect(updateAgentPerformance).toHaveBeenCalledWith('olympian', mockEntries);
    expect(result).toEqual(mockPerformance);
  });

  it('should return null when no data exists', async () => {
    const { readFeedbackLog, updateAgentPerformance } = await import('../../learning/storage.js');

    vi.mocked(readFeedbackLog).mockReturnValue([]);
    vi.mocked(updateAgentPerformance).mockReturnValue(null);

    const result = getAgentPerformanceForRouting('unknown-agent');

    expect(result).toBeNull();
  });
});
