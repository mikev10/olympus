/**
 * Quest State Module
 *
 * Manages the active work plan state for Olympus orchestrator.
 * Part of the Olympus quest system for tracking active work plans.
 *
 * Core Olympus feature for quest state management and plan tracking.
 */

// Types
export type {
  QuestState,
  PlanProgress,
  PlanSummary
} from './types.js';

// Constants
export {
  OLYMPUS_DIR,
  QUEST_FILE,
  QUEST_STATE_PATH,
  NOTEPAD_DIR,
  NOTEPAD_BASE_PATH,
  PROMETHEUS_PLANS_DIR,
  PLAN_EXTENSION
} from './constants.js';

// Storage operations
export {
  getQuestFilePath,
  readQuestState,
  writeQuestState,
  appendSessionId,
  clearQuestState,
  findPrometheusPlans,
  getPlanProgress,
  getPlanName,
  createQuestState,
  getPlanSummaries,
  hasActiveQuest,
  getActivePlanPath
} from './storage.js';
