/**
 * Workflow Artifact Gate Hook Registration
 *
 * Validates workflow artifacts after Vision stage agents complete their work.
 * Runs validation functions when idea-intake, prd-writer, spec-writer, or
 * intent-generator agents finish tasks. Injects warnings for failed validations
 * but always fails open (never blocks workflow progression).
 *
 * Priority: 78 (runs after agent-tracking at 50, before quality-gate at 80)
 *
 * Key behaviors:
 * - Detects Task completions from Vision stage agents
 * - Loads active workflow checkpoint
 * - Runs appropriate validation function (validateIdea, validatePrd, etc.)
 * - Injects success/warning context based on validation results
 * - Always returns continue: true (fail-open approach)
 */

import { registerHook } from '../registry.js';
import { loadSessionState } from '../../learning/session-state.js';
import { loadCheckpoint, listWorkflows } from '../../features/workflow-engine/checkpoint.js';
import {
  validateIdea,
  validatePrd,
  validateSpec,
  validateTasks,
} from '../../features/workflow-engine/validation.js';
import type { HookContext, HookResult } from '../types.js';
import type { WorkflowCheckpoint, ValidationResult } from '../../features/workflow-engine/types.js';
import { join } from 'path';
import { existsSync } from 'fs';

/**
 * Maps Vision stage agent names to their artifact types.
 * This determines which validation function to run for each agent.
 */
const VISION_STAGE_AGENT_MAP: Record<string, string> = {
  'idea-intake': 'idea',
  'prd-writer': 'prd',
  'spec-writer': 'spec',
  'intent-generator': 'intents',
};

/**
 * Finds the active workflow with a running checkpoint.
 * Prefers the most recently updated non-complete workflow.
 *
 * @param projectPath - Absolute path to project root
 * @returns Workflow ID and checkpoint, or null if none found
 */
async function findActiveWorkflow(
  projectPath: string
): Promise<{ workflowId: string; checkpoint: WorkflowCheckpoint } | null> {
  try {
    const workflows = await listWorkflows(projectPath);
    if (workflows.length === 0) return null;

    let bestMatch: {
      workflowId: string;
      checkpoint: WorkflowCheckpoint;
      updatedAt: string;
    } | null = null;

    for (const workflowId of workflows) {
      const checkpoint = await loadCheckpoint(projectPath, workflowId);
      if (!checkpoint || checkpoint.status === 'complete') continue;

      if (!bestMatch || checkpoint.updated_at > bestMatch.updatedAt) {
        bestMatch = {
          workflowId,
          checkpoint,
          updatedAt: checkpoint.updated_at,
        };
      }
    }

    if (!bestMatch) return null;
    return {
      workflowId: bestMatch.workflowId,
      checkpoint: bestMatch.checkpoint,
    };
  } catch (error) {
    console.error('[Olympus Artifact Gate] Failed to find active workflow:', error);
    return null;
  }
}

/**
 * Determines artifact paths based on workflow directory structure.
 * Supports both new nested layout (vision/) and legacy flat layout.
 *
 * @param workflowDir - Absolute path to workflow directory
 * @param artifactType - Type of artifact (idea, prd, spec, intents)
 * @returns Object containing all necessary artifact paths for validation
 */
function getArtifactPaths(
  workflowDir: string,
  artifactType: string
): { artifactPath: string; referencePaths: string[] } | null {
  // Try nested layout first (vision/ subdirectory)
  const nestedBasePath = join(workflowDir, 'vision');
  const flatBasePath = workflowDir;

  switch (artifactType) {
    case 'idea': {
      const nestedPath = join(nestedBasePath, 'idea.md');
      const flatPath = join(flatBasePath, 'idea.md');
      const artifactPath = existsSync(nestedPath) ? nestedPath : flatPath;
      return existsSync(artifactPath) ? { artifactPath, referencePaths: [] } : null;
    }

    case 'prd': {
      const nestedPrdPath = join(nestedBasePath, 'prd.md');
      const flatPrdPath = join(flatBasePath, 'prd.md');
      const prdPath = existsSync(nestedPrdPath) ? nestedPrdPath : flatPrdPath;

      const nestedIdeaPath = join(nestedBasePath, 'idea.md');
      const flatIdeaPath = join(flatBasePath, 'idea.md');
      const ideaPath = existsSync(nestedIdeaPath) ? nestedIdeaPath : flatIdeaPath;

      return existsSync(prdPath) && existsSync(ideaPath)
        ? { artifactPath: prdPath, referencePaths: [ideaPath] }
        : null;
    }

    case 'spec': {
      const nestedSpecPath = join(nestedBasePath, 'spec.md');
      const flatSpecPath = join(flatBasePath, 'spec.md');
      const specPath = existsSync(nestedSpecPath) ? nestedSpecPath : flatSpecPath;

      const nestedPrdPath = join(nestedBasePath, 'prd.md');
      const flatPrdPath = join(flatBasePath, 'prd.md');
      const prdPath = existsSync(nestedPrdPath) ? nestedPrdPath : flatPrdPath;

      return existsSync(specPath) && existsSync(prdPath)
        ? { artifactPath: specPath, referencePaths: [prdPath] }
        : null;
    }

    case 'intents': {
      const nestedIntentsDir = join(nestedBasePath, 'intents');
      const flatIntentsDir = join(flatBasePath, 'intents');
      const intentsDir = existsSync(nestedIntentsDir) ? nestedIntentsDir : flatIntentsDir;

      const nestedSpecPath = join(nestedBasePath, 'spec.md');
      const flatSpecPath = join(flatBasePath, 'spec.md');
      const specPath = existsSync(nestedSpecPath) ? nestedSpecPath : flatSpecPath;

      return existsSync(intentsDir) && existsSync(specPath)
        ? { artifactPath: intentsDir, referencePaths: [specPath] }
        : null;
    }

    default:
      return null;
  }
}

/**
 * Runs the appropriate validation function based on artifact type.
 *
 * @param artifactType - Type of artifact (idea, prd, spec, intents)
 * @param artifactPath - Path to the artifact to validate
 * @param referencePaths - Paths to reference artifacts needed for validation
 * @returns Validation result or null if validation type not supported
 */
async function runValidation(
  artifactType: string,
  artifactPath: string,
  referencePaths: string[]
): Promise<ValidationResult | null> {
  try {
    switch (artifactType) {
      case 'idea':
        return await validateIdea(artifactPath);

      case 'prd':
        if (referencePaths.length === 0) return null;
        return await validatePrd(artifactPath, referencePaths[0]);

      case 'spec':
        if (referencePaths.length === 0) return null;
        return await validateSpec(artifactPath, referencePaths[0]);

      case 'intents':
        if (referencePaths.length === 0) return null;
        return await validateTasks(artifactPath, referencePaths[0]);

      default:
        return null;
    }
  } catch (error) {
    console.error(`[Olympus Artifact Gate] Validation error for ${artifactType}:`, error);
    return null;
  }
}

/**
 * Formats validation result into a context message for the agent.
 *
 * @param artifactType - Type of artifact validated
 * @param result - Validation result
 * @returns Formatted message for context injection
 */
function formatValidationMessage(artifactType: string, result: ValidationResult): string {
  const artifactName = artifactType.toUpperCase();

  if (result.passed) {
    return `[Artifact Validation] ${artifactName} validation PASSED (${result.coverage_percentage}% coverage). Good work!`;
  }

  const issuesList = result.blocking_issues.map((issue, i) => `  ${i + 1}. ${issue}`).join('\n');

  return `[Artifact Validation] WARNING: ${artifactName} validation FAILED (${result.coverage_percentage}% coverage)

Blocking issues:
${issuesList}

${result.reviewer ? `Reviewer: ${result.reviewer}\n` : ''}Please review and address these issues before proceeding to the next stage.`;
}

/**
 * Workflow Artifact Gate Hook (PostToolUse, priority 78)
 *
 * Validates workflow artifacts when Vision stage agents complete their tasks.
 * Detects Task tool completions from idea-intake, prd-writer, spec-writer, or
 * intent-generator agents and runs the appropriate validation function.
 *
 * Always fails open - returns continue: true even if validation fails.
 * Validation failures are injected as warnings via additionalContext.
 *
 * @param ctx - Hook context with tool execution result
 * @returns Hook result with validation message or pass-through
 */
async function workflowArtifactGateHandler(ctx: HookContext): Promise<HookResult> {
  try {
    // Only process Task tool completions
    if (ctx.toolName !== 'Task') {
      return { continue: true };
    }

    // Guard: require directory and session ID
    if (!ctx.directory || !ctx.sessionId) {
      return { continue: true };
    }

    // Load session state to get the agent that was used
    const state = loadSessionState(ctx.directory, ctx.sessionId);
    const agentUsed = state.pending_completion?.agent_used;

    if (!agentUsed) {
      return { continue: true };
    }

    // Check if this agent is a Vision stage agent
    const artifactType = VISION_STAGE_AGENT_MAP[agentUsed];
    if (!artifactType) {
      // Not a Vision stage agent - pass through
      return { continue: true };
    }

    // Find active workflow
    const activeWorkflow = await findActiveWorkflow(ctx.directory);
    if (!activeWorkflow) {
      // No active workflow - pass through
      return { continue: true };
    }

    const { workflowId, checkpoint } = activeWorkflow;

    // Determine workflow directory
    const workflowDir = join(ctx.directory, '.olympus', 'workflow', workflowId);
    if (!existsSync(workflowDir)) {
      console.error('[Olympus Artifact Gate] Workflow directory not found:', workflowDir);
      return { continue: true }; // Fail open
    }

    // Get artifact paths
    const paths = getArtifactPaths(workflowDir, artifactType);
    if (!paths) {
      console.error(
        `[Olympus Artifact Gate] Could not find artifact paths for ${artifactType} in ${workflowDir}`
      );
      return { continue: true }; // Fail open - artifacts may not exist yet
    }

    // Run validation
    const validationResult = await runValidation(
      artifactType,
      paths.artifactPath,
      paths.referencePaths
    );

    if (!validationResult) {
      // Validation function not available or failed to run
      console.error(`[Olympus Artifact Gate] Validation failed to run for ${artifactType}`);
      return { continue: true }; // Fail open
    }

    // Format and inject validation message
    const message = formatValidationMessage(artifactType, validationResult);

    return {
      continue: true, // Always fail open
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: message,
      },
    };
  } catch (error) {
    console.error('[Olympus Artifact Gate] Error in workflowArtifactGateHandler:', error);
    return { continue: true }; // Fail open on all errors
  }
}

/**
 * Registers the workflow artifact gate hook with the hook router.
 * Called from registerAllHooks() in index.ts.
 */
export function registerWorkflowArtifactGateHook(): void {
  registerHook({
    name: 'workflowArtifactGate',
    event: 'PostToolUse',
    priority: 78,
    matcher: 'task',
    handler: workflowArtifactGateHandler,
  });
}
