import { join } from 'path';
import { getLearningDir, readJsonFile, writeJsonFile, readAgentPerformance } from './storage.js';
import type { AgentPerformance, RoutingThresholds } from './types.js';
import { extractPatterns as extractTaskPatterns } from './pattern-matcher.js';

export const COLD_START_FALLBACK_RATE = 0.5;

/** Default routing configuration */
const DEFAULT_ROUTING_CONFIG = {
  minDataPoints: 10,
  minSuccessRate: 0.80,
  preferLowerTier: true,
  agentTiers: {
    oracle: ['oracle-low', 'oracle-medium', 'oracle'],
    olympian: ['olympian-low', 'olympian', 'olympian-high'],
    explore: ['explore', 'explore-medium'],
    librarian: ['librarian-low', 'librarian'],
    'frontend-engineer': ['frontend-engineer-low', 'frontend-engineer', 'frontend-engineer-high'],
  } as Record<string, string[]>,
};

interface RoutingConfig extends RoutingThresholds {
  agentTiers: Record<string, string[]>;
}

/**
 * Load routing config, creating defaults if missing.
 */
function loadRoutingConfig(): RoutingConfig {
  const configPath = join(getLearningDir(), 'routing-config.json');
  const config = readJsonFile<RoutingConfig | null>(configPath, null);
  if (config) return config;

  // Lazily create default config on first invocation
  try {
    writeJsonFile(configPath, DEFAULT_ROUTING_CONFIG);
  } catch {
    // Non-critical — use defaults in memory
  }
  return DEFAULT_ROUTING_CONFIG;
}

/**
 * Find which tier family an agent belongs to and its position.
 * Returns [familyKey, tierList, agentIndex] or null.
 */
function findAgentTier(
  agentName: string,
  tiers: Record<string, string[]>
): { family: string; tierList: string[]; index: number } | null {
  for (const [family, tierList] of Object.entries(tiers)) {
    const index = tierList.indexOf(agentName);
    if (index >= 0) {
      return { family, tierList, index };
    }
  }
  return null;
}

/**
 * Get a routing recommendation for the given agent and task.
 * Returns a recommendation string or null if no recommendation.
 *
 * This function must be fast (<50ms) to fit within the 100ms hook timeout.
 */
function resolveBlendedSuccessRate(
  perf: AgentPerformance | undefined,
  weight: number
): number {
  if (!perf || weight === 0) return COLD_START_FALLBACK_RATE;
  return weight * perf.success_rate + (1 - weight) * COLD_START_FALLBACK_RATE;
}

export function getRoutingRecommendation(
  agentName: string,
  taskDescription: string,
  projectPath?: string
): string | null {
  try {
    const config = loadRoutingConfig();

    if (!config.preferLowerTier) return null;

    const tierInfo = findAgentTier(agentName, config.agentTiers);
    if (!tierInfo) return null;

    if (tierInfo.index === 0) return null;

    const allPerf = readAgentPerformance(projectPath);

    const lowerTierAgents = tierInfo.tierList.slice(0, tierInfo.index);

    for (const lowerAgent of lowerTierAgents) {
      const perf = allPerf[lowerAgent];

      const invocations = perf?.total_invocations ?? 0;
      const weight = Math.min(1.0, invocations / 5);
      const blendedRate = resolveBlendedSuccessRate(perf, weight);

      if (blendedRate < config.minSuccessRate) continue;

      if (weight >= 1.0 && invocations < config.minDataPoints) continue;

      let patternNote = '';
      if (perf?.task_patterns && perf.task_patterns.length > 0) {
        const matchedPatterns = extractTaskPatterns(taskDescription);
        for (const tp of perf.task_patterns) {
          if (matchedPatterns.includes(tp.pattern) &&
              tp.successfulAgents.includes(lowerAgent) &&
              tp.confidence >= 0.7) {
            patternNote = ` (especially for ${tp.pattern.replace(/_/g, ' ')} tasks)`;
            break;
          }
        }
      }

      const successPct = (blendedRate * 100).toFixed(0);
      const dataPoints = invocations;
      return `Based on ${dataPoints} data points, ${lowerAgent} handles this type of task with ${successPct}% success rate${patternNote}. Consider using ${lowerAgent} instead of ${agentName} to save tokens.`;
    }

    return null;
  } catch {
    return null;
  }
}
