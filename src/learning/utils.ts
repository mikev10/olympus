/**
 * Type guards and safe accessor utilities for learning system
 * No external dependencies - using Node.js built-ins only
 */

import type { FeedbackEntry, AgentPerformance, TokenUsage } from './types.js';

/**
 * Safely extract token usage from feedback entry
 * Returns null if token_usage is undefined or invalid
 */
export function getTokenUsage(entry: FeedbackEntry): TokenUsage | null {
  if (!entry.token_usage) {
    return null;
  }

  const { token_usage } = entry;

  // Validate structure
  if (
    typeof token_usage.input_tokens !== 'number' ||
    typeof token_usage.output_tokens !== 'number' ||
    typeof token_usage.total_tokens !== 'number' ||
    typeof token_usage.estimated !== 'boolean'
  ) {
    return null;
  }

  return token_usage;
}

/**
 * Safely extract efficiency score from agent performance
 * Returns 0 if token_efficiency is undefined
 */
export function getEfficiencyScore(perf: AgentPerformance): number {
  if (!perf.token_efficiency) {
    return 0;
  }

  return perf.token_efficiency.efficiency_score || 0;
}

/**
 * Check if agent performance has minimum sample size for reliable metrics
 * Default minimum is 5 invocations
 */
export function hasMinimumSamples(perf: AgentPerformance, minimum: number = 5): boolean {
  if (!perf.token_efficiency) {
    return false;
  }

  return perf.token_efficiency.invocation_count >= minimum;
}

/**
 * Safely get total tokens from feedback entry
 * Returns 0 if token_usage is undefined or invalid
 */
export function safeTokenTotal(entry: FeedbackEntry): number {
  const tokenUsage = getTokenUsage(entry);
  return tokenUsage?.total_tokens || 0;
}

/**
 * Type guard: check if value is a valid TokenUsage object
 */
export function isTokenUsage(value: unknown): value is TokenUsage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;
  return (
    typeof obj.input_tokens === 'number' &&
    typeof obj.output_tokens === 'number' &&
    typeof obj.total_tokens === 'number' &&
    typeof obj.estimated === 'boolean'
  );
}

/**
 * Type guard: check if feedback entry has token metrics
 */
export function hasTokenMetrics(entry: FeedbackEntry): entry is FeedbackEntry & {
  token_usage: TokenUsage;
} {
  return entry.token_usage !== undefined && isTokenUsage(entry.token_usage);
}

/**
 * Type guard: check if agent performance has efficiency metrics
 */
export function hasEfficiencyMetrics(perf: AgentPerformance): perf is AgentPerformance & {
  token_efficiency: NonNullable<AgentPerformance['token_efficiency']>;
} {
  return perf.token_efficiency !== undefined;
}
