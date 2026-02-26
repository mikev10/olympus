/**
 * Workflow Artifact Gate Hook Registration
 *
 * Validates workflow artifacts after Inception stage agents complete their work.
 * Runs validation functions when prometheus agent finishes tasks, using the
 * checkpoint's current_stage to determine which artifact to validate.
 * Injects warnings for failed validations but always fails open (never blocks
 * workflow progression).
 *
 * Priority: 78 (runs after agent-tracking at 50, before quality-gate at 80)
 *
 * Key behaviors:
 * - Detects Task completions from Inception stage agents (prometheus)
 * - Loads active workflow checkpoint to determine artifact type
 * - Runs validateIntent validation function
 * - Looks in aidlc-docs/ directory structure for artifacts
 * - Injects success/warning context based on validation results
 * - Always returns continue: true (fail-open approach)
 */

import { registerHook } from '../registry.js';
import { loadSessionState } from '../../learning/session-state.js';
import { loadCheckpoint, listWorkflows, saveCheckpoint } from '../../features/workflow-engine/checkpoint.js';
import {
  validateIntent,
} from '../../features/workflow-engine/validation.js';
import { assessDepthFromIntent } from '../../features/workflow-engine/depth-assessment.js';
import { loadManifest, saveManifest } from '../../features/workflow-engine/manifest.js';
import type { HookContext, HookResult } from '../types.js';
import type { ValidationResult } from '../../features/workflow-engine/types.js';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';

/**
 * Maps Inception stage agent names to their phase.
 * Prometheus handles the intent stage; the actual artifact type
 * is determined by checkpoint.current_stage at runtime.
 */
const INCEPTION_STAGE_AGENT_MAP: Record<string, string> = {
  'prometheus': 'inception', // Prometheus handles intent stage
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
): Promise<{ workflowId: string; checkpoint: any } | null> {
  try {
    const workflows = await listWorkflows(projectPath);
    if (workflows.length === 0) return null;

    let bestMatch: {
      workflowId: string;
      checkpoint: any;
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
 * Supports nested layout (inception/ subdirectory) and legacy flat layout.
 * The workflowDir is already under aidlc-docs/<workflowId>/.
 *
 * @param workflowDir - Absolute path to workflow directory (e.g., <project>/aidlc-docs/<workflowId>)
 * @param artifactType - Type of artifact (intent)
 * @returns Object containing all necessary artifact paths for validation
 */
function getArtifactPaths(
  workflowDir: string,
  artifactType: string
): { artifactPath: string; referencePaths: string[] } | null {
  // Try nested layout first (inception/ subdirectory), then flat layout
  const nestedBasePath = join(workflowDir, 'inception');
  const flatBasePath = workflowDir;

  switch (artifactType) {
    case 'intent': {
      const nestedIntentPath = join(nestedBasePath, 'intent.md');
      const flatIntentPath = join(flatBasePath, 'intent.md');
      const intentPath = existsSync(nestedIntentPath) ? nestedIntentPath : flatIntentPath;

      return existsSync(intentPath)
        ? { artifactPath: intentPath, referencePaths: [] }
        : null;
    }

    default:
      return null;
  }
}

/**
 * Runs the appropriate validation function based on artifact type.
 *
 * @param artifactType - Type of artifact (intent)
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
      case 'intent':
        return await validateIntent(artifactPath);

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
 * Validates workflow artifacts when Inception stage agents complete their tasks.
 * Detects Task tool completions from prometheus agent and uses the checkpoint's
 * current_stage to determine which artifact to validate.
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

    // Check if this agent is an Inception stage agent
    const agentPhase = INCEPTION_STAGE_AGENT_MAP[agentUsed];
    if (!agentPhase) {
      // Not an Inception stage agent - pass through
      return { continue: true };
    }

    // Find active workflow
    const activeWorkflow = await findActiveWorkflow(ctx.directory);
    if (!activeWorkflow) {
      // No active workflow - pass through
      return { continue: true };
    }

    const { workflowId, checkpoint } = activeWorkflow;

    const artifactType = 'intent';

    // Determine workflow directory
    const workflowDir = join(ctx.directory, 'aidlc-docs', workflowId);
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
    let message = formatValidationMessage(artifactType, validationResult);

    if (artifactType === 'intent' && validationResult.passed) {
      try {
        const intentFileContent = readFileSync(paths.artifactPath, 'utf-8');
        const depthAssessment = assessDepthFromIntent(intentFileContent);

        // Store in manifest
        const manifestPath = checkpoint.manifest_path ||
          join(ctx.directory, 'aidlc-docs', workflowId, 'manifest.json');
        const manifest = loadManifest(manifestPath);
        if (manifest) {
          manifest.depth_assessment = depthAssessment;
          manifest.risk_tier = depthAssessment.risk_tier;
          saveManifest(manifestPath, manifest);
        }

        // Store in checkpoint (CCR-1)
        checkpoint.depth_score = depthAssessment.total_score;
        checkpoint.risk_tier = depthAssessment.risk_tier.tier;
        await saveCheckpoint(ctx.directory, checkpoint);

        // Append depth info to validation message
        const depthLabel = depthAssessment.recommended_depth === 'minimal' ? 'SHALLOW' :
                          depthAssessment.recommended_depth === 'standard' ? 'MEDIUM' : 'DEEP';
        message += `\n\n[Depth Assessment] Score: ${depthAssessment.total_score}/30 → ${depthLabel} | Risk Tier: ${depthAssessment.risk_tier.tier}`;
      } catch (error) {
        console.error('[Olympus Artifact Gate] Failed to assess depth after INTENT validation:', error);
      }
    }

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
