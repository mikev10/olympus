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
import { registerAgentRoleGuardHook } from './agent-role-guard.js';
import { registerBuildCheckHooks } from './build-check.js';
import { registerWorkflowArtifactGateHook } from './workflow-artifact-gate.js';
import { registerCIReviewPipelineHook } from './ci-review-pipeline.js';
import { registerLearningAggregationHook } from './learning-aggregation.js';
import { registerWorkflowStatusHook } from './workflow-status.js';
import { registerWorkflowTransitionHooks } from './workflow-transition.js';

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
  registerAgentRoleGuardHook(); // Agent role enforcement (priority 5) - BEFORE pre-tool-use
  registerWorkflowStatusHook(); // Workflow status reporter (priority 6) - BEFORE other UserPromptSubmit hooks
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
  registerBuildCheckHooks(); // Async build check (priorities 65/66) - AFTER post-tool-use
  registerWorkflowArtifactGateHook(); // Workflow artifact validation (priority 78) - AFTER build-check
  registerCIReviewPipelineHook(); // CI review pipeline (priority 79) - AFTER artifact-gate, BEFORE quality-gate
  registerQualityGateHooks(); // Quality gate hooks for phase transitions
  registerWorkflowTransitionHooks(); // Workflow transition messages (priority 82) - AFTER quality-gate
  registerLearningAggregationHook(); // Learning aggregation (priority 95) - AFTER learning-capture

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
  registerAgentRoleGuardHook,
  registerBuildCheckHooks,
  registerWorkflowArtifactGateHook,
  registerCIReviewPipelineHook,
  registerLearningAggregationHook,
  registerWorkflowStatusHook,
  registerWorkflowTransitionHooks,
};
