/**
 * Token efficiency calculation functions
 * Pure functions with no side effects for calculating agent efficiency scores
 */

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
