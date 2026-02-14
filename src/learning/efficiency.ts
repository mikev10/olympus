/**
 * Token efficiency calculation functions
 * Pure functions with no side effects for calculating agent efficiency scores
 */

import { randomUUID } from 'crypto';
import type { FeedbackEntry, AgentPerformance } from './types.js';
import { appendFeedback, readFeedbackLog, updateAgentPerformance } from './storage.js';

/**
 * Result of a BOLT execution (single workflow execution)
 */
export interface BoltExecutionResult {
  boltId: string;              // e.g., 'BOLT-001'
  agentName: string;           // e.g., 'olympian', 'frontend-engineer'
  success: boolean;            // Did the BOLT execution succeed?
  sessionId: string;           // Current session ID
  projectPath: string;         // Current project path
  taskDescription?: string;    // BOLT spec summary
  tokenUsage?: {               // If available from agent tracking
    input_tokens: number;
    output_tokens: number;
  };
  failureReason?: string;      // If success=false, why
}

/**
 * Calculate efficiency score for an agent
 *
 * @param successRate - Success rate between 0 and 1
 * @param avgTokens - Average tokens per invocation
 * @param baselineTokens - Global baseline for comparison
 * @returns Efficiency score (higher is better, capped at 2.0)
 */
export function calculateEfficiencyScore(
  successRate: number,
  avgTokens: number,
  baselineTokens: number
): number {
  // Handle edge cases
  if (successRate < 0 || successRate > 1) {
    throw new Error(`Invalid success rate: ${successRate}. Must be between 0 and 1.`);
  }

  if (avgTokens < 0 || baselineTokens < 0) {
    throw new Error('Token counts cannot be negative');
  }

  // If no tokens used, return 0 (can't calculate efficiency)
  if (avgTokens === 0) {
    return 0;
  }

  // Normalize tokens: baseline / actual (lower tokens = higher factor)
  const tokenFactor = baselineTokens / Math.max(avgTokens, 1);

  // Efficiency = success rate * token efficiency
  // Cap token factor at 2.0 to prevent unrealistic scores
  const efficiency = successRate * Math.min(tokenFactor, 2);

  return efficiency;
}

/**
 * Calculate trend based on recent vs historical averages
 *
 * @param recentAvg - Average tokens for recent sessions (last 10)
 * @param historicalAvg - Average tokens across all history
 * @param sampleCount - Total number of samples
 * @returns Trend indicator
 */
export function calculateTrend(
  recentAvg: number,
  historicalAvg: number,
  sampleCount: number
): 'improving' | 'stable' | 'declining' | 'insufficient_data' {
  // Need at least 5 samples for meaningful trend
  if (sampleCount < 5) {
    return 'insufficient_data';
  }

  // Handle edge cases
  if (recentAvg < 0 || historicalAvg < 0) {
    throw new Error('Average token counts cannot be negative');
  }

  if (historicalAvg === 0) {
    return 'insufficient_data';
  }

  // Calculate percentage difference
  const percentChange = (recentAvg - historicalAvg) / historicalAvg;

  // Thresholds for trend detection (±10%)
  const IMPROVEMENT_THRESHOLD = -0.10; // 10% reduction is improvement
  const DECLINE_THRESHOLD = 0.10;      // 10% increase is decline

  if (percentChange <= IMPROVEMENT_THRESHOLD) {
    return 'improving';
  } else if (percentChange >= DECLINE_THRESHOLD) {
    return 'declining';
  } else {
    return 'stable';
  }
}

/**
 * Record the result of a BOLT execution for agent performance tracking
 *
 * @param result - BOLT execution result with agent, success, and token data
 */
export function recordAgentExecution(result: BoltExecutionResult): void {
  const entry: FeedbackEntry = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    session_id: result.sessionId,
    project_path: result.projectPath,
    event_type: result.success ? 'success' : 'revision',
    agent_used: result.agentName,
    original_task: result.taskDescription,
    user_message: `BOLT ${result.boltId} execution ${result.success ? 'succeeded' : 'failed'}`,
    feedback_category: result.success ? 'praise' : 'correction',
    confidence: 1.0,
    token_usage: result.tokenUsage ? {
      input_tokens: result.tokenUsage.input_tokens,
      output_tokens: result.tokenUsage.output_tokens,
      total_tokens: result.tokenUsage.input_tokens + result.tokenUsage.output_tokens,
      estimated: true
    } : undefined
  };

  appendFeedback(entry);
}

/**
 * Get agent performance metrics for routing decisions
 *
 * @param agentName - Name of the agent to query
 * @returns AgentPerformance object or null if no data exists
 */
export function getAgentPerformanceForRouting(agentName: string): AgentPerformance | null {
  const entries = readFeedbackLog();
  return updateAgentPerformance(agentName, entries);
}
