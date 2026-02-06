import { join } from 'path';
import { getLearningDir, readJsonFile, writeJsonFile } from './storage.js';
import type { AgentPerformance, RoutingThresholds } from './types.js';
import { extractPatterns as extractTaskPatterns } from './pattern-matcher.js';

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
export function getRoutingRecommendation(
  agentName: string,
  taskDescription: string
): string | null {
  try {
    const config = loadRoutingConfig();

    if (!config.preferLowerTier) return null;

    const tierInfo = findAgentTier(agentName, config.agentTiers);
    if (!tierInfo) return null;

    // Only recommend if the requested agent is NOT already the lowest tier
    if (tierInfo.index === 0) return null;

    // Load agent performance data
    const perfPath = join(getLearningDir(), 'agent-performance.json');
    const allPerf = readJsonFile<Record<string, AgentPerformance>>(perfPath, {});

    // Check lower-tier agents for sufficient data and success rate
    // Start from the lowest tier (index 0) and work upward
    const lowerTierAgents = tierInfo.tierList.slice(0, tierInfo.index);

    for (const lowerAgent of lowerTierAgents) {
      const perf = allPerf[lowerAgent];
      if (!perf) continue;

      if (perf.total_invocations < config.minDataPoints) continue;
      if (perf.success_rate < config.minSuccessRate) continue;

      // Check task patterns for more specific recommendation
      let patternNote = '';
      if (perf.task_patterns && perf.task_patterns.length > 0) {
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

      const successPct = (perf.success_rate * 100).toFixed(0);
      return `Based on ${perf.total_invocations} data points, ${lowerAgent} handles this type of task with ${successPct}% success rate${patternNote}. Consider using ${lowerAgent} instead of ${agentName} to save tokens.`;
    }

    return null;
  } catch {
    // Any error → no recommendation (non-critical)
    return null;
  }
}
