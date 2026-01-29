/**
 * Quest State Storage
 *
 * Handles reading/writing quest.json for active plan tracking.
 *
 * Core Olympus feature for quest state management and plan tracking.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import { dirname, join, basename } from 'path';
import type { QuestState, PlanProgress, PlanSummary } from './types.js';
import { OLYMPUS_DIR, QUEST_FILE, PROMETHEUS_PLANS_DIR, PLAN_EXTENSION } from './constants.js';

/**
 * Get the full path to the quest state file
 */
export function getQuestFilePath(directory: string): string {
  return join(directory, OLYMPUS_DIR, QUEST_FILE);
}

/**
 * Read quest state from disk
 */
export function readQuestState(directory: string): QuestState | null {
  const filePath = getQuestFilePath(directory);

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as QuestState;
  } catch {
    return null;
  }
}

/**
 * Write quest state to disk
 */
export function writeQuestState(directory: string, state: QuestState): boolean {
  const filePath = getQuestFilePath(directory);

  try {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Append a session ID to the quest state
 */
export function appendSessionId(directory: string, sessionId: string): QuestState | null {
  const state = readQuestState(directory);
  if (!state) return null;

  if (!state.session_ids.includes(sessionId)) {
    state.session_ids.push(sessionId);
    if (writeQuestState(directory, state)) {
      return state;
    }
  }

  return state;
}

/**
 * Clear quest state (delete the file)
 */
export function clearQuestState(directory: string): boolean {
  const filePath = getQuestFilePath(directory);

  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Find Prometheus plan files for this project.
 * Prometheus stores plans at: {project}/.olympus/plans/{name}.md
 */
export function findPrometheusPlans(directory: string): string[] {
  const plansDir = join(directory, PROMETHEUS_PLANS_DIR);

  if (!existsSync(plansDir)) {
    return [];
  }

  try {
    const files = readdirSync(plansDir);
    return files
      .filter((f) => f.endsWith(PLAN_EXTENSION))
      .map((f) => join(plansDir, f))
      .sort((a, b) => {
        // Sort by modification time, newest first
        const aStat = statSync(a);
        const bStat = statSync(b);
        return bStat.mtimeMs - aStat.mtimeMs;
      });
  } catch {
    return [];
  }
}

/**
 * Parse a plan file and count checkbox progress.
 */
export function getPlanProgress(planPath: string): PlanProgress {
  if (!existsSync(planPath)) {
    return { total: 0, completed: 0, isComplete: true };
  }

  try {
    const content = readFileSync(planPath, 'utf-8');

    // Match markdown checkboxes: - [ ] or - [x] or - [X]
    const uncheckedMatches = content.match(/^[-*]\s*\[\s*\]/gm) || [];
    const checkedMatches = content.match(/^[-*]\s*\[[xX]\]/gm) || [];

    const total = uncheckedMatches.length + checkedMatches.length;
    const completed = checkedMatches.length;

    return {
      total,
      completed,
      isComplete: total === 0 || completed === total,
    };
  } catch {
    return { total: 0, completed: 0, isComplete: true };
  }
}

/**
 * Extract plan name from file path.
 */
export function getPlanName(planPath: string): string {
  return basename(planPath, PLAN_EXTENSION);
}

/**
 * Create a new quest state for a plan.
 */
export function createQuestState(
  planPath: string,
  sessionId: string
): QuestState {
  return {
    active_plan: planPath,
    started_at: new Date().toISOString(),
    session_ids: [sessionId],
    plan_name: getPlanName(planPath),
  };
}

/**
 * Get summaries of all available plans
 */
export function getPlanSummaries(directory: string): PlanSummary[] {
  const plans = findPrometheusPlans(directory);

  return plans.map((planPath) => {
    const stat = statSync(planPath);
    return {
      path: planPath,
      name: getPlanName(planPath),
      progress: getPlanProgress(planPath),
      lastModified: new Date(stat.mtimeMs),
    };
  });
}

/**
 * Check if a quest is currently active
 */
export function hasActiveQuest(directory: string): boolean {
  return readQuestState(directory) !== null;
}

/**
 * Get the active plan path from quest state
 */
export function getActivePlanPath(directory: string): string | null {
  const state = readQuestState(directory);
  return state?.active_plan ?? null;
}
