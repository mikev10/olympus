/**
 * Learning Aggregation Hook
 *
 * Automatically aggregates feedback log data to produce:
 * - agent-performance.json (per-agent metrics)
 * - user-preferences.json (learned preferences)
 *
 * Runs on Stop event (priority 95) after learning-capture (90), before cancellation-detector (100).
 *
 * THROTTLING:
 * - Skips aggregation if feedback-log.jsonl is empty or has <3 entries
 * - Skips aggregation if agent-performance.json is newer than feedback-log.jsonl
 *   (avoids re-running expensive operations when nothing has changed)
 *
 * ARCHITECTURE:
 * - Silent error handling (catch + console.error, never throw)
 * - Reads feedback-log.jsonl via readFeedbackLog()
 * - Aggregates per-agent performance via updateAgentPerformance()
 * - Updates user preferences via updatePreferences()
 * - Optionally extracts patterns via extractPatterns() if enough data
 */

import { registerHook } from '../registry.js';
import {
  readFeedbackLog,
  updateAgentPerformance,
  writeJsonFile,
  getLearningDir,
  readJsonFile,
} from '../../learning/storage.js';
import { updatePreferences, createDefaultPreferences } from '../../learning/preference-learner.js';
import { extractPatterns } from '../../learning/pattern-extractor.js';
import type { HookContext, HookResult } from '../types.js';
import type { AgentPerformance, UserPreferences, ExtractedPattern } from '../../learning/types.js';
import { join } from 'path';
import { existsSync, statSync } from 'fs';

/** Minimum entries needed before aggregation */
const MIN_ENTRIES_FOR_AGGREGATION = 3;

/** Minimum entries for pattern extraction (expensive operation) */
const MIN_ENTRIES_FOR_PATTERNS = 10;

/**
 * Check if aggregation should run based on file modification times.
 * Returns true if feedback log has changed since last aggregation.
 */
function shouldRunAggregation(learningDir: string): boolean {
  const feedbackLogPath = join(learningDir, 'feedback-log.jsonl');
  const performancePath = join(learningDir, 'agent-performance.json');

  // If feedback log doesn't exist, skip
  if (!existsSync(feedbackLogPath)) {
    return false;
  }

  // If performance file doesn't exist, we should aggregate
  if (!existsSync(performancePath)) {
    return true;
  }

  try {
    const feedbackStat = statSync(feedbackLogPath);
    const performanceStat = statSync(performancePath);

    // If feedback log is newer, we need to re-aggregate
    return feedbackStat.mtime > performanceStat.mtime;
  } catch (error) {
    // If we can't stat files, err on the side of running aggregation
    console.error('[Olympus Learning Aggregation] Failed to check file times:', error);
    return true;
  }
}

/**
 * Register learning aggregation hook
 */
export function registerLearningAggregationHook(): void {
  registerHook({
    name: 'learningAggregation',
    event: 'Stop',
    priority: 95, // After learning-capture (90), before cancellation-detector (100)
    handler: async (ctx: HookContext): Promise<HookResult> => {
      try {
        if (!ctx.directory) {
          return { continue: true };
        }

        const learningDir = getLearningDir();

        // Throttle: Check if we need to run aggregation
        if (!shouldRunAggregation(learningDir)) {
          // Skip silently - performance file is newer than feedback log
          return { continue: true };
        }

        // Read feedback log
        const feedbackLog = readFeedbackLog();

        // Skip if empty or too few entries
        if (feedbackLog.length < MIN_ENTRIES_FOR_AGGREGATION) {
          return { continue: true };
        }

        // Extract unique agents from feedback log
        const agentsSet = new Set<string>();
        for (const entry of feedbackLog) {
          if (entry.agent_used) {
            agentsSet.add(entry.agent_used);
          }
        }

        const agents = Array.from(agentsSet);

        // Skip if no agents found
        if (agents.length === 0) {
          return { continue: true };
        }

        // Aggregate agent performance
        const performanceMap: Record<string, AgentPerformance> = {};

        for (const agent of agents) {
          const performance = updateAgentPerformance(agent, feedbackLog);
          if (performance) {
            performanceMap[agent] = performance;
          }
        }

        // Write agent performance to file
        const performancePath = join(learningDir, 'agent-performance.json');
        writeJsonFile(performancePath, performanceMap);

        // Update user preferences
        const preferencesPath = join(learningDir, 'user-preferences.json');
        const currentPrefs = readJsonFile<UserPreferences>(
          preferencesPath,
          createDefaultPreferences()
        );

        // Extract patterns if we have enough data
        let patterns: ExtractedPattern[] = [];
        if (feedbackLog.length >= MIN_ENTRIES_FOR_PATTERNS) {
          try {
            patterns = extractPatterns(feedbackLog);
          } catch (error) {
            // Pattern extraction is optional - don't block on failure
            console.error('[Olympus Learning Aggregation] Pattern extraction failed:', error);
          }
        }

        // Update preferences with new feedback and patterns
        const updatedPrefs = updatePreferences(currentPrefs, feedbackLog, patterns);

        // Write updated preferences
        writeJsonFile(preferencesPath, updatedPrefs);

      } catch (error) {
        // Silent failure - learning aggregation should never block
        console.error('[Olympus Learning Aggregation] Error in aggregation handler:', error);
      }

      return { continue: true };
    }
  });
}
