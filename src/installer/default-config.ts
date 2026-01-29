/**
 * Default Configuration for Olympus Hooks
 *
 * Provides default settings for all hooks.
 * These are merged with user configuration.
 */

import type { PluginConfig } from '../shared/types.js';

/**
 * Default configuration for hooks
 * All hooks are enabled by default
 */
export const DEFAULT_HOOKS_CONFIG: NonNullable<PluginConfig['hooks']> = {
  // Global settings
  enabled: true,
  hookTimeoutMs: 100,

  // UserPromptSubmit hooks
  keywordDetector: { enabled: true },
  autoSlashCommand: { enabled: true },
  thinkMode: { enabled: true },

  // SessionStart hooks
  sessionStart: { enabled: true },

  // Stop hooks
  persistentMode: { enabled: true },

  // PreToolUse hooks
  rulesInjector: { enabled: true },
  directoryReadmeInjector: { enabled: true },
  nonInteractiveEnv: { enabled: true },
  olympusOrchestrator: { enabled: true },

  // PostToolUse hooks
  editErrorRecovery: { enabled: true },
  commentChecker: { enabled: true },
  contextWindowLimitRecovery: { enabled: true },
  preemptiveCompaction: { enabled: true },
  agentUsageReminder: { enabled: true },

  // Notification hooks
  backgroundNotification: { enabled: true },

  // PostToolUseFailure hooks (session recovery)
  sessionRecovery: { enabled: true }
};

/**
 * Get the default hooks configuration
 */
export function getDefaultHooksConfig(): NonNullable<PluginConfig['hooks']> {
  return { ...DEFAULT_HOOKS_CONFIG };
}

/**
 * Merge user config with defaults
 * User settings override defaults
 */
export function mergeHooksConfig(
  userConfig?: PluginConfig['hooks']
): NonNullable<PluginConfig['hooks']> {
  if (!userConfig) {
    return getDefaultHooksConfig();
  }

  // Deep merge user config over defaults
  const merged = { ...DEFAULT_HOOKS_CONFIG };

  for (const [key, value] of Object.entries(userConfig)) {
    if (value !== undefined) {
      (merged as Record<string, unknown>)[key] = value;
    }
  }

  return merged;
}

/**
 * Hook metadata for documentation and UI
 */
export const HOOK_METADATA = {
  keywordDetector: {
    name: 'Keyword Detector',
    description: 'Detects magic keywords (ultrawork, ultrathink, search, analyze) and activates modes',
    event: 'UserPromptSubmit'
  },
  autoSlashCommand: {
    name: 'Auto Slash Command',
    description: 'Expands custom slash commands from .claude/commands/',
    event: 'UserPromptSubmit'
  },
  thinkMode: {
    name: 'Think Mode',
    description: 'Activates extended thinking when think/ultrathink keywords detected',
    event: 'UserPromptSubmit'
  },
  sessionStart: {
    name: 'Session Start',
    description: 'Restores persistent mode states and pending tasks on session start',
    event: 'SessionStart'
  },
  persistentMode: {
    name: 'Persistent Mode',
    description: 'Prevents stopping when tasks remain (ascent, ultrawork, todos)',
    event: 'Stop'
  },
  rulesInjector: {
    name: 'Rules Injector',
    description: 'Injects project and user rules when accessing files',
    event: 'PreToolUse'
  },
  directoryReadmeInjector: {
    name: 'Directory README Injector',
    description: 'Injects README context when working in directories',
    event: 'PreToolUse'
  },
  nonInteractiveEnv: {
    name: 'Non-Interactive Environment',
    description: 'Adds -y flags and environment variables for non-interactive execution',
    event: 'PreToolUse'
  },
  olympusOrchestrator: {
    name: 'Olympus Orchestrator',
    description: 'Reminds about delegation and tracks file changes',
    event: 'PreToolUse/PostToolUse'
  },
  editErrorRecovery: {
    name: 'Edit Error Recovery',
    description: 'Provides recovery guidance when Edit tool fails',
    event: 'PostToolUse'
  },
  commentChecker: {
    name: 'Comment Checker',
    description: 'Detects unnecessary comments in code changes',
    event: 'PostToolUse'
  },
  contextWindowLimitRecovery: {
    name: 'Context Window Limit Recovery',
    description: 'Detects and recovers from context window limit errors',
    event: 'PostToolUse'
  },
  preemptiveCompaction: {
    name: 'Preemptive Compaction',
    description: 'Warns before hitting context window limit',
    event: 'PostToolUse'
  },
  agentUsageReminder: {
    name: 'Agent Usage Reminder',
    description: 'Reminds to use specialized agents for appropriate tasks',
    event: 'PostToolUse'
  },
  backgroundNotification: {
    name: 'Background Notification',
    description: 'Surfaces background task completion notifications',
    event: 'Notification'
  },
  sessionRecovery: {
    name: 'Session Recovery',
    description: 'Recovers from API errors like thinking block order and empty message errors',
    event: 'PostToolUseFailure'
  }
};
