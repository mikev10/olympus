import { describe, it, expect } from 'vitest';
import { evaluateAgentPerformance } from '../../learning/agent-evaluator.js';
import { MOCK_FEEDBACK_AGENTS } from './fixtures/mock-feedback.js';

describe('AgentEvaluator', () => {
  it('calculates success rate per agent', () => {
    const performance = evaluateAgentPerformance(MOCK_FEEDBACK_AGENTS);

    const oracle = performance.get('oracle');
    expect(oracle).toBeDefined();
    expect(oracle?.total_invocations).toBe(2);
    expect(oracle?.success_count).toBe(1);
    expect(oracle?.revision_count).toBe(1);
    expect(oracle?.success_rate).toBe(0.5);
  });

  it('handles agents with no failures', () => {
    const performance = evaluateAgentPerformance(MOCK_FEEDBACK_AGENTS);

    const olympian = performance.get('olympian');
    expect(olympian).toBeDefined();
    expect(olympian?.success_rate).toBe(1);
    expect(olympian?.failure_patterns).toHaveLength(0);
  });

  it('ignores feedback without agent_used', () => {
    const feedbackWithoutAgent = [
      { id: '1', timestamp: '', session_id: '', project_path: '', event_type: 'success' as const, user_message: 'Thanks', feedback_category: 'praise' as const, confidence: 0.9 },
    ];

    const performance = evaluateAgentPerformance(feedbackWithoutAgent);
    expect(performance.size).toBe(0);
  });
});
