/**
 * Hook Registrations - Master Index
 *
 * Imports all hook registration modules and provides a single
 * function to register all hooks with the router.
 */

import { registerUserPromptSubmitHooks } from './user-prompt-submit.js';
import { registerSessionStartHooks } from './session-start.js';
import { registerStopHooks } from './stop.js';
import { registerPreToolUseHooks } from './pre-tool-use.js';
import { registerPostToolUseHooks } from './post-tool-use.js';
import { registerPostToolUseFailureHooks } from './post-tool-use-failure.js';
import { registerNotificationHooks } from './notification.js';
import { registerLearningCaptureHooks } from './learning-capture.js';
import { registerBudgetWarningHook } from './budget-warning.js';
import { registerAgentTrackingHook } from './agent-tracking.js';
import { registerDiscoveryCaptureHooks } from './discovery-capture.js';
import { registerPlanLifecycleHooks } from './plan-lifecycle.js';
import { registerQualityGateHooks } from './quality-gate.js';

/** Flag to prevent double registration */
let registered = false;

/**
 * Register all hooks with the router.
 * Safe to call multiple times (idempotent).
 */
export function registerAllHooks(): void {
  if (registered) {
    return;
  }

  // Register hooks by event type
  registerUserPromptSubmitHooks();
  registerSessionStartHooks();
  registerStopHooks();
  registerPreToolUseHooks();
  registerPostToolUseHooks();
  registerPostToolUseFailureHooks();
  registerNotificationHooks();
  registerLearningCaptureHooks();
  registerBudgetWarningHook(); // Token budget warning (informational)
  registerAgentTrackingHook(); // Agent usage tracking for learning system
  registerDiscoveryCaptureHooks(); // Auto-discovery capture for learning system
  registerPlanLifecycleHooks(); // Plan lifecycle tracking for learning system
  registerQualityGateHooks(); // Quality gate hooks for phase transitions

  registered = true;
}

/**
 * Reset registration flag.
 * Primarily used for testing.
 */
export function resetRegistration(): void {
  registered = false;
}

// Re-export individual registration functions for selective use
export {
  registerUserPromptSubmitHooks,
  registerSessionStartHooks,
  registerStopHooks,
  registerPreToolUseHooks,
  registerPostToolUseHooks,
  registerPostToolUseFailureHooks,
  registerNotificationHooks,
  registerLearningCaptureHooks,
  registerBudgetWarningHook,
  registerAgentTrackingHook,
  registerDiscoveryCaptureHooks,
  registerPlanLifecycleHooks,
  registerQualityGateHooks,
};
