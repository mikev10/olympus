import { describe, it, expect } from 'vitest';
import {
  updateAgentTokenEfficiency,
  extractTokens,
  wasSuccessful,
  hasMinimumSamples
} from '../../learning/aggregation.js';
import { AgentPerformance, FeedbackEntry } from '../../learning/types.js';

describe('updateAgentTokenEfficiency', () => {
  const basePerformance: AgentPerformance = {
    agent_name: 'oracle-low',
    total_invocations: 10,
    success_count: 8,
    revision_count: 1,
    cancellation_count: 1,
    success_rate: 0.8,
    failure_patterns: [],
    strong_areas: [],
    weak_areas: [],
    last_updated: new Date().toISOString()
  };

  it('should initialize token efficiency for new agent', () => {
    const result = updateAgentTokenEfficiency(basePerformance, 5000, true, 10000);

    expect(result.token_efficiency).toBeDefined();
    expect(result.token_efficiency?.avg_tokens_per_success).toBe(5000);
    expect(result.token_efficiency?.avg_tokens_per_failure).toBe(0);
    expect(result.token_efficiency?.total_tokens).toBe(5000);
    expect(result.token_efficiency?.invocation_count).toBe(1);
    expect(result.token_efficiency?.trend).toBe('insufficient_data');
  });

  it('should initialize with failure tokens', () => {
    const result = updateAgentTokenEfficiency(basePerformance, 8000, false, 10000);

    expect(result.token_efficiency?.avg_tokens_per_success).toBe(0);
    expect(result.token_efficiency?.avg_tokens_per_failure).toBe(8000);
    expect(result.token_efficiency?.total_tokens).toBe(8000);
  });

  it('should update existing efficiency with success', () => {
    const performanceWithEfficiency: AgentPerformance = {
      ...basePerformance,
      token_efficiency: {
        avg_tokens_per_success: 5000,
        avg_tokens_per_failure: 8000,
        total_tokens: 10000,
        invocation_count: 2,
        efficiency_score: 1.2,
        trend: 'insufficient_data'
      }
    };

    const result = updateAgentTokenEfficiency(performanceWithEfficiency, 4000, true, 10000);

    expect(result.token_efficiency?.invocation_count).toBe(3);
    expect(result.token_efficiency?.total_tokens).toBe(14000);
    // Avg should move toward 4000 using exponential moving average
    expect(result.token_efficiency?.avg_tokens_per_success).toBeLessThan(5000);
  });

  it('should update existing efficiency with failure', () => {
    const performanceWithEfficiency: AgentPerformance = {
      ...basePerformance,
      token_efficiency: {
        avg_tokens_per_success: 5000,
        avg_tokens_per_failure: 8000,
        total_tokens: 10000,
        invocation_count: 2,
        efficiency_score: 1.2,
        trend: 'insufficient_data'
      }
    };

    const result = updateAgentTokenEfficiency(performanceWithEfficiency, 10000, false, 10000);

    expect(result.token_efficiency?.avg_tokens_per_failure).toBeGreaterThan(8000);
  });

  it('should calculate trend when sufficient samples', () => {
    const performanceWithEfficiency: AgentPerformance = {
      ...basePerformance,
      token_efficiency: {
        avg_tokens_per_success: 5000,
        avg_tokens_per_failure: 8000,
        total_tokens: 24000,
        invocation_count: 5, // Now at 5, will be 6 after update
        efficiency_score: 1.2,
        trend: 'insufficient_data'
      }
    };

    const result = updateAgentTokenEfficiency(performanceWithEfficiency, 4000, true, 10000);

    // Should now have sufficient data for trend
    expect(result.token_efficiency?.trend).not.toBe('insufficient_data');
  });

  it('should recalculate efficiency score', () => {
    const performanceWithEfficiency: AgentPerformance = {
      ...basePerformance,
      token_efficiency: {
        avg_tokens_per_success: 10000,
        avg_tokens_per_failure: 15000,
        total_tokens: 50000,
        invocation_count: 5,
        efficiency_score: 0.8,
        trend: 'stable'
      }
    };

    const result = updateAgentTokenEfficiency(performanceWithEfficiency, 5000, true, 10000);

    // Efficiency should improve with lower tokens
    expect(result.token_efficiency?.efficiency_score).toBeGreaterThan(0.8);
  });

  it('should throw on negative token count', () => {
    expect(() => updateAgentTokenEfficiency(basePerformance, -5000, true, 10000))
      .toThrow('Token count cannot be negative');
  });

  it('should preserve other performance fields', () => {
    const result = updateAgentTokenEfficiency(basePerformance, 5000, true, 10000);

    expect(result.agent_name).toBe(basePerformance.agent_name);
    expect(result.success_rate).toBe(basePerformance.success_rate);
    expect(result.total_invocations).toBe(basePerformance.total_invocations);
  });
});

describe('extractTokens', () => {
  it('should extract tokens from entry with token_usage', () => {
    const entry: FeedbackEntry = {
      id: 'test-1',
      timestamp: new Date().toISOString(),
      session_id: 'session-1',
      project_path: '/test/project',
      event_type: 'success',
      user_message: 'Test',
      feedback_category: 'praise',
      confidence: 1.0,
      token_usage: {
        input_tokens: 3000,
        output_tokens: 2000,
        total_tokens: 5000,
        estimated: true
      }
    };

    expect(extractTokens(entry)).toBe(5000);
  });

  it('should return 0 for entry without token_usage', () => {
    const entry: FeedbackEntry = {
      id: 'test-1',
      timestamp: new Date().toISOString(),
      session_id: 'session-1',
      project_path: '/test/project',
      event_type: 'success',
      user_message: 'Test',
      feedback_category: 'praise',
      confidence: 1.0
    };

    expect(extractTokens(entry)).toBe(0);
  });
});

describe('wasSuccessful', () => {
  it('should return true for success event', () => {
    const entry: FeedbackEntry = {
      id: 'test-1',
      timestamp: new Date().toISOString(),
      session_id: 'session-1',
      project_path: '/test/project',
      event_type: 'success',
      user_message: 'Test',
      feedback_category: 'praise',
      confidence: 1.0
    };

    expect(wasSuccessful(entry)).toBe(true);
  });

  it('should return true for explicit_preference event', () => {
    const entry: FeedbackEntry = {
      id: 'test-1',
      timestamp: new Date().toISOString(),
      session_id: 'session-1',
      project_path: '/test/project',
      event_type: 'explicit_preference',
      user_message: 'Test',
      feedback_category: 'explicit_preference',
      confidence: 1.0
    };

    expect(wasSuccessful(entry)).toBe(true);
  });

  it('should return false for revision event', () => {
    const entry: FeedbackEntry = {
      id: 'test-1',
      timestamp: new Date().toISOString(),
      session_id: 'session-1',
      project_path: '/test/project',
      event_type: 'revision',
      user_message: 'Test',
      feedback_category: 'correction',
      confidence: 1.0
    };

    expect(wasSuccessful(entry)).toBe(false);
  });

  it('should return false for cancellation event', () => {
    const entry: FeedbackEntry = {
      id: 'test-1',
      timestamp: new Date().toISOString(),
      session_id: 'session-1',
      project_path: '/test/project',
      event_type: 'cancellation',
      user_message: 'Test',
      feedback_category: 'rejection',
      confidence: 1.0
    };

    expect(wasSuccessful(entry)).toBe(false);
  });
});

describe('hasMinimumSamples', () => {
  it('should return false when no token efficiency data', () => {
    const performance: AgentPerformance = {
      agent_name: 'oracle-low',
      total_invocations: 10,
      success_count: 8,
      revision_count: 1,
      cancellation_count: 1,
      success_rate: 0.8,
      failure_patterns: [],
      strong_areas: [],
      weak_areas: [],
      last_updated: new Date().toISOString()
    };

    expect(hasMinimumSamples(performance)).toBe(false);
  });

  it('should return false when invocation count < 5', () => {
    const performance: AgentPerformance = {
      agent_name: 'oracle-low',
      total_invocations: 10,
      success_count: 8,
      revision_count: 1,
      cancellation_count: 1,
      success_rate: 0.8,
      failure_patterns: [],
      strong_areas: [],
      weak_areas: [],
      last_updated: new Date().toISOString(),
      token_efficiency: {
        avg_tokens_per_success: 5000,
        avg_tokens_per_failure: 8000,
        total_tokens: 20000,
        invocation_count: 4,
        efficiency_score: 1.2,
        trend: 'insufficient_data'
      }
    };

    expect(hasMinimumSamples(performance)).toBe(false);
  });

  it('should return true when invocation count >= 5', () => {
    const performance: AgentPerformance = {
      agent_name: 'oracle-low',
      total_invocations: 10,
      success_count: 8,
      revision_count: 1,
      cancellation_count: 1,
      success_rate: 0.8,
      failure_patterns: [],
      strong_areas: [],
      weak_areas: [],
      last_updated: new Date().toISOString(),
      token_efficiency: {
        avg_tokens_per_success: 5000,
        avg_tokens_per_failure: 8000,
        total_tokens: 25000,
        invocation_count: 5,
        efficiency_score: 1.2,
        trend: 'stable'
      }
    };

    expect(hasMinimumSamples(performance)).toBe(true);
  });

  it('should use custom minimum samples', () => {
    const performance: AgentPerformance = {
      agent_name: 'oracle-low',
      total_invocations: 10,
      success_count: 8,
      revision_count: 1,
      cancellation_count: 1,
      success_rate: 0.8,
      failure_patterns: [],
      strong_areas: [],
      weak_areas: [],
      last_updated: new Date().toISOString(),
      token_efficiency: {
        avg_tokens_per_success: 5000,
        avg_tokens_per_failure: 8000,
        total_tokens: 30000,
        invocation_count: 7,
        efficiency_score: 1.2,
        trend: 'stable'
      }
    };

    expect(hasMinimumSamples(performance, 10)).toBe(false);
    expect(hasMinimumSamples(performance, 5)).toBe(true);
  });
});
