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
  idea: 'idea-intake',
  prd: 'prd-writer',
  spec: 'spec-writer',
  intents: 'intent-generator',
  complete: null, // No agent needed for complete stage
};

/**
 * Get human-readable task description for a workflow stage.
 */
function getStageTaskDescription(stage: WorkflowStage): string {
  switch (stage) {
    case 'idea':
      return 'capture and validate the initial feature concept';
    case 'prd':
      return 'create a comprehensive Product Requirements Document';
    case 'spec':
      return 'write a detailed technical specification';
    case 'intents':
      return 'generate implementation intent files';
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
 * // Next step: Invoke the idea-intake agent to capture and validate the initial feature concept
 * //
 * // Use: Task(subagent_type="idea-intake", prompt="...")
 */
export function buildStructuredWorkflowPrompt(
  featureName: string,
  checkpoint: WorkflowCheckpoint
): string {
  const agent = STAGE_AGENT_MAP[checkpoint.current_stage];
  const taskDescription = getStageTaskDescription(checkpoint.current_stage);

  let prompt = `You are beginning a structured workflow for feature: ${featureName}\n\n`;
  prompt += `Current stage: ${checkpoint.current_stage}\n`;
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
 * // You were interrupted during: prd
 * // Last update: 2024-01-15T12:00:00Z
 * //
 * // Resume context: [checkpoint data if available]
 * //
 * // Continue from where you left off: create a comprehensive Product Requirements Document
 */
export function buildWorkflowResumptionPrompt(
  featureName: string,
  checkpoint: WorkflowCheckpoint
): string {
  const agent = STAGE_AGENT_MAP[checkpoint.current_stage];
  const taskDescription = getStageTaskDescription(checkpoint.current_stage);

  let prompt = `Resuming workflow for feature: ${featureName}\n\n`;
  prompt += `You were interrupted during: ${checkpoint.current_stage}\n`;
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
 * const prompt = buildWorkflowTransitionPrompt(checkpoint, 'spec');
 * // Returns:
 * // Stage prd complete! ✓
 * //
 * // Completed artifacts:
 * // - PRD-001: .olympus/workflows/user-auth/prd.md (validated: true)
 * //
 * // Next stage: spec
 * // Validation required: Technical specification review
 * //
 * // Proceed with: Invoke the spec-writer agent to write a detailed technical specification
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
    case 'prd':
      return 'Product requirements completeness review';
    case 'spec':
      return 'Technical specification review';
    case 'intents':
      return 'Intent file validation';
    case 'complete':
      return 'Final workflow validation';
    default:
      return null;
  }
}
