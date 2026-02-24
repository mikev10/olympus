/**
 * Workflow Engine Hooks
 *
 * Helper functions for generating workflow prompts that guide Claude through
 * multi-stage feature development workflows.
 */

import type { WorkflowCheckpoint, WorkflowStage } from './types.js';

/**
 * Map workflow stages to their corresponding agent types.
 */
const STAGE_AGENT_MAP: Record<WorkflowStage, string | null> = {
  intent: null,    // INTENT stage handled by /plan entry point
  unit: null,      // UNIT decomposition handled by ConstructionExecutor
  bolt: null,      // BOLT execution handled by ConstructionExecutor
  complete: null,  // No agent needed for complete stage
};

/**
 * Get human-readable task description for a workflow stage.
 */
function getStageTaskDescription(stage: WorkflowStage): string {
  switch (stage) {
    case 'intent':
      return 'capture the problem statement, personas, success metrics, constraints, and define business requirements, technical approach, and proposed UNITs';
    case 'unit':
      return 'decompose into module-scoped UNITs with interface contracts';
    case 'bolt':
      return 'execute the smallest implementation unit with domain and logical design';
    case 'complete':
      return 'finalize and validate all workflow artifacts';
    default:
      return 'proceed with the next stage';
  }
}

/**
 * Generate initial workflow instructions for Claude when starting structured workflow.
 *
 * Tells Claude which agent to invoke for the current stage and provides
 * feature context and stage information.
 *
 * @param featureName - Name of the feature being developed
 * @param checkpoint - Current workflow checkpoint state
 * @returns Formatted prompt string with clear instructions
 *
 * @example
 * const prompt = buildStructuredWorkflowPrompt('user-auth', checkpoint);
 * // Returns:
 * // You are beginning a structured workflow for feature: user-auth
 * //
 * // Current stage: idea
 * // Status: in_progress
 * //
 * // Next step: capture the problem statement, personas, success metrics, and constraints
 */
export function buildStructuredWorkflowPrompt(
  featureName: string,
  checkpoint: any
): string {
  const currentStage = checkpoint.current_stage as WorkflowStage;
  const agent = STAGE_AGENT_MAP[currentStage];
  const taskDescription = getStageTaskDescription(currentStage);

  let prompt = `You are beginning a structured workflow for feature: ${featureName}\n\n`;
  prompt += `Current stage: ${currentStage}\n`;
  prompt += `Status: ${checkpoint.status}\n\n`;

  if (agent) {
    prompt += `Next step: Invoke the ${agent} agent to ${taskDescription}\n\n`;
    prompt += `Use: Task(subagent_type="${agent}", prompt="...")\n`;
  } else {
    prompt += `Next step: ${taskDescription}\n`;
  }

  return prompt;
}

/**
 * Generate resume instructions for interrupted workflow.
 *
 * Indicates which stage was interrupted and what to do next.
 * Includes resume context if available from the checkpoint.
 *
 * @param featureName - Name of the feature being developed
 * @param checkpoint - Current workflow checkpoint state
 * @returns Formatted prompt string for resuming work
 *
 * @example
 * const prompt = buildWorkflowResumptionPrompt('user-auth', checkpoint);
 * // Returns:
 * // Resuming workflow for feature: user-auth
 * //
 * // You were interrupted during: intent
 * // Last update: 2024-01-15T12:00:00Z
 * //
 * // Resume context: [checkpoint data if available]
 * //
 * // Continue from where you left off: define business requirements, technical approach, and proposed UNITs
 */
export function buildWorkflowResumptionPrompt(
  featureName: string,
  checkpoint: any
): string {
  const currentStage = checkpoint.current_stage as WorkflowStage;
  const agent = STAGE_AGENT_MAP[currentStage];
  const taskDescription = getStageTaskDescription(currentStage);

  let prompt = `Resuming workflow for feature: ${featureName}\n\n`;
  prompt += `You were interrupted during: ${currentStage}\n`;
  prompt += `Last update: ${checkpoint.updated_at}\n\n`;

  if (checkpoint.resume_context) {
    prompt += `Resume context: ${JSON.stringify(checkpoint.resume_context, null, 2)}\n\n`;
  } else {
    prompt += `Resume context: No additional context available\n\n`;
  }

  if (agent) {
    prompt += `Continue from where you left off: Invoke the ${agent} agent to ${taskDescription}\n\n`;
    prompt += `Use: Task(subagent_type="${agent}", prompt="...")\n`;
  } else {
    prompt += `Continue from where you left off: ${taskDescription}\n`;
  }

  return prompt;
}

/**
 * Generate transition instructions between workflow stages.
 *
 * Tells Claude what was completed and what's next, providing context
 * for validation gates and artifact status.
 *
 * @param checkpoint - Current workflow checkpoint state
 * @param nextStage - The stage to transition to
 * @returns Formatted prompt string for stage transition
 *
 * @example
 * const prompt = buildWorkflowTransitionPrompt(checkpoint, 'unit');
 * // Returns:
 * // Stage intent complete! ✓
 * //
 * // Completed artifacts:
 * // - INTENT-001: .olympus/workflows/user-auth/intent.md (validated: true)
 * //
 * // Next stage: unit
 * // Validation required: UNIT decomposition coverage and interface contracts
 * //
 * // Proceed with: decompose into module-scoped UNITs with interface contracts
 */
export function buildWorkflowTransitionPrompt(
  checkpoint: WorkflowCheckpoint,
  nextStage: WorkflowStage
): string {
  const currentStage = checkpoint.current_stage;
  const nextAgent = STAGE_AGENT_MAP[nextStage];
  const nextTaskDescription = getStageTaskDescription(nextStage);

  let prompt = `Stage ${currentStage} complete! ✓\n\n`;
  prompt += `Completed artifacts:\n`;

  // List artifacts for the current stage
  const currentArtifact = checkpoint.artifacts[currentStage];
  if (currentArtifact) {
    const validationStatus = checkpoint.validation_results[currentStage]?.passed ?? false;
    prompt += `- ${currentArtifact.id}: ${currentArtifact.path} (validated: ${validationStatus})\n`;
  } else {
    prompt += `- No artifacts recorded for ${currentStage} stage\n`;
  }

  prompt += `\n`;
  prompt += `Next stage: ${nextStage}\n`;

  // Add validation context based on next stage
  const validationType = getValidationType(nextStage);
  if (validationType) {
    prompt += `Validation required: ${validationType}\n`;
  }

  prompt += `\n`;

  if (nextAgent) {
    prompt += `Proceed with: Invoke the ${nextAgent} agent to ${nextTaskDescription}\n\n`;
    prompt += `Use: Task(subagent_type="${nextAgent}", prompt="...")\n`;
  } else {
    prompt += `Proceed with: ${nextTaskDescription}\n`;
  }

  return prompt;
}

/**
 * Get the validation type description for a workflow stage.
 */
function getValidationType(stage: WorkflowStage): string | null {
  switch (stage) {
    case 'intent':
      return 'INTENT completeness and alignment with IDEA';
    case 'unit':
      return 'UNIT decomposition coverage and interface contracts';
    case 'bolt':
      return 'BOLT implementation alignment with parent UNIT';
    case 'complete':
      return 'Final workflow validation';
    default:
      return null;
  }
}
