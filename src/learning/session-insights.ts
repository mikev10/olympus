import { join } from 'path';
import type { SessionSummary, SessionInsights } from './types.js';
import { loadSessionSummaries, writeJsonFile } from './storage.js';
import { getProjectScopedDir, deriveProjectSlug } from './project-resolver.js';
import { getSessionBaseline } from './baselines.js';

const ROLLING_WINDOW = 20;
const HIGH_TOKEN_RATIO = 2.0;

function computeHighTokenSessions(
  summaries: SessionSummary[],
  baselineTokens: number
): SessionInsights['high_token_sessions'] {
  const results: SessionInsights['high_token_sessions'] = [];
  for (const s of summaries) {
    const ratio = baselineTokens > 0 ? s.total_tokens / baselineTokens : 0;
    if (ratio >= HIGH_TOKEN_RATIO) {
      results.push({
        session_id: s.session_id,
        total_tokens: s.total_tokens,
        baseline_tokens: baselineTokens,
        ratio,
      });
    }
  }
  return results;
}

function computeAgentUsage(summaries: SessionSummary[]): Record<string, number> {
  const usage: Record<string, number> = {};
  for (const s of summaries) {
    for (const agent of s.agents_used) {
      usage[agent] = (usage[agent] || 0) + 1;
    }
  }
  return usage;
}

function computeDurationTrend(summaries: SessionSummary[]): SessionInsights['duration_trend'] {
  if (summaries.length === 0) {
    return { rolling_avg_seconds: 0, sample_count: 0 };
  }
  const total = summaries.reduce((sum, s) => sum + s.duration_seconds, 0);
  return {
    rolling_avg_seconds: total / summaries.length,
    sample_count: summaries.length,
  };
}

function computeOutcomeDistribution(summaries: SessionSummary[]): SessionInsights['outcome_distribution'] {
  const dist: SessionInsights['outcome_distribution'] = {
    success: 0,
    revision: 0,
    cancellation: 0,
    unknown: 0,
    total: summaries.length,
  };
  for (const s of summaries) {
    if (s.outcome === 'success') dist.success++;
    else if (s.outcome === 'revision') dist.revision++;
    else if (s.outcome === 'cancellation') dist.cancellation++;
    else dist.unknown++;
  }
  return dist;
}

function computeCostTrend(summaries: SessionSummary[]): SessionInsights['cost_trend'] {
  if (summaries.length === 0) {
    return { rolling_avg_cost: 0, total_cost: 0, sample_count: 0 };
  }
  const totalCost = summaries.reduce((sum, s) => sum + s.estimated_cost, 0);
  return {
    rolling_avg_cost: totalCost / summaries.length,
    total_cost: totalCost,
    sample_count: summaries.length,
  };
}

export function computeSessionInsights(projectPath: string): SessionInsights | null {
  try {
    const allSummaries = loadSessionSummaries(projectPath);
    if (allSummaries.length === 0) {
      return null;
    }

    const summaries = allSummaries.slice(-ROLLING_WINDOW);
    const baselineTokens = getSessionBaseline();

    const insights: SessionInsights = {
      project_slug: deriveProjectSlug(projectPath),
      computed_at: new Date().toISOString(),
      high_token_sessions: computeHighTokenSessions(summaries, baselineTokens),
      agent_usage: computeAgentUsage(summaries),
      duration_trend: computeDurationTrend(summaries),
      outcome_distribution: computeOutcomeDistribution(summaries),
      cost_trend: computeCostTrend(summaries),
    };

    const outPath = join(getProjectScopedDir(projectPath), 'session-insights.json');
    writeJsonFile(outPath, insights);

    return insights;
  } catch (error) {
    console.error('[Olympus Learning] Failed to compute session insights:', error);
    return null;
  }
}
