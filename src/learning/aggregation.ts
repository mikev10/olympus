/**
 * Token efficiency aggregation functions
 * Updates agent performance metrics with token usage data
 */

import { AgentPerformance, TokenEfficiency, FeedbackEntry } from './types.js';
import { calculateEfficiencyScore, calculateTrend } from './efficiency.js';
import { readAgentPerformance } from './storage.js';
import { getSessionBaseline } from './baselines.js';

/**
 * Update agent token efficiency with new session data
 * Uses incremental averaging to avoid full recalculation
 *
 * @param performance - Current agent performance data
 * @param newTokens - Tokens used in new invocation
 * @param success - Whether the invocation was successful
 * @param baselineTokens - Global baseline for efficiency calculation
 * @returns Updated performance with new token efficiency
 */
function resolveBaseline(
  performance: AgentPerformance,
  baselineTokens: number,
  projectPath?: string
): number {
  if (projectPath) {
    try {
      const projectPerf = readAgentPerformance(projectPath);
      const agentPerf = projectPerf[performance.agent_name];
      if (agentPerf?.token_efficiency && agentPerf.token_efficiency.invocation_count >= 5) {
        return agentPerf.token_efficiency.total_tokens / agentPerf.token_efficiency.invocation_count;
      }
    } catch { /* fall through */ }

    try {
      const globalPerf = readAgentPerformance();
      const agentPerf = globalPerf[performance.agent_name];
      if (agentPerf?.token_efficiency && agentPerf.token_efficiency.invocation_count >= 5) {
        return agentPerf.token_efficiency.total_tokens / agentPerf.token_efficiency.invocation_count;
      }
    } catch { /* fall through */ }
  }

  return baselineTokens;
}

export function updateAgentTokenEfficiency(
  performance: AgentPerformance,
  newTokens: number,
  success: boolean,
  baselineTokens: number,
  projectPath?: string
): AgentPerformance {
  if (newTokens < 0) {
    throw new Error('Token count cannot be negative');
  }

  const resolvedBaseline = resolveBaseline(performance, baselineTokens, projectPath);
  const currentEfficiency = performance.token_efficiency;

  if (!currentEfficiency) {
    return {
      ...performance,
      token_efficiency: {
        avg_tokens_per_success: success ? newTokens : 0,
        avg_tokens_per_failure: success ? 0 : newTokens,
        total_tokens: newTokens,
        invocation_count: 1,
        efficiency_score: calculateEfficiencyScore(
          success ? 1 : 0,
          newTokens,
          resolvedBaseline
        ),
        trend: 'insufficient_data'
      }
    };
  }

  const newInvocationCount = currentEfficiency.invocation_count + 1;
  const newTotalTokens = currentEfficiency.total_tokens + newTokens;

  const ALPHA = 0.2;

  let newAvgSuccess = currentEfficiency.avg_tokens_per_success;
  let newAvgFailure = currentEfficiency.avg_tokens_per_failure;

  if (success) {
    newAvgSuccess = currentEfficiency.avg_tokens_per_success === 0
      ? newTokens
      : currentEfficiency.avg_tokens_per_success * (1 - ALPHA) + newTokens * ALPHA;
  } else {
    newAvgFailure = currentEfficiency.avg_tokens_per_failure === 0
      ? newTokens
      : currentEfficiency.avg_tokens_per_failure * (1 - ALPHA) + newTokens * ALPHA;
  }

  const recentAvg = newTokens * ALPHA + (newTotalTokens / newInvocationCount) * (1 - ALPHA);
  const historicalAvg = newTotalTokens / newInvocationCount;

  const trend = calculateTrend(recentAvg, historicalAvg, newInvocationCount);

  const avgTokens = newTotalTokens / newInvocationCount;
  const successRate = performance.success_rate;
  const efficiencyScore = calculateEfficiencyScore(successRate, avgTokens, resolvedBaseline);

  return {
    ...performance,
    token_efficiency: {
      avg_tokens_per_success: newAvgSuccess,
      avg_tokens_per_failure: newAvgFailure,
      total_tokens: newTotalTokens,
      invocation_count: newInvocationCount,
      efficiency_score: efficiencyScore,
      trend
    }
  };
}

/**
 * Extract token usage from feedback entry
 *
 * @param entry - Feedback entry (may or may not have token data)
 * @returns Token count or 0 if not available
 */
export function extractTokens(entry: FeedbackEntry): number {
  return entry.token_usage?.total_tokens ?? 0;
}

/**
 * Determine if invocation was successful based on event type
 *
 * @param entry - Feedback entry
 * @returns True if successful, false otherwise
 */
export function wasSuccessful(entry: FeedbackEntry): boolean {
  return entry.event_type === 'success' || entry.event_type === 'explicit_preference';
}

/**
 * Check if agent has minimum samples for recommendations
 *
 * @param performance - Agent performance data
 * @param minimumSamples - Minimum required samples (default: 5)
 * @returns True if sufficient samples
 */
export function hasMinimumSamples(
  performance: AgentPerformance,
  minimumSamples: number = 5
): boolean {
  return (performance.token_efficiency?.invocation_count ?? 0) >= minimumSamples;
}
