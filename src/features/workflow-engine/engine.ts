/**
 * WorkflowEngine - Core orchestrator for the multi-stage workflow system
 *
 * Manages the progression of features through stages:
 * IDEA → PRD → SPEC → INTENTS → COMPLETE
 *
 * Features:
 * - Checkpoint-based persistence for resumable workflows
 * - Artifact generation and tracking
 * - Status management (in_progress, paused, complete)
 */

import {
  WorkflowCheckpoint,
  WorkflowStage,
  WorkflowStatus,
  ArtifactReference,
} from './types.js';
import { saveCheckpoint, loadCheckpoint } from './checkpoint.js';
import { ensureWorkflowDir, writeArtifact, getArtifactPath } from './artifacts.js';
import { validateIdea, validatePrd } from './validation.js';

/**
 * Ordered list of workflow stages for progression validation
 */
const STAGE_ORDER: WorkflowStage[] = ['idea', 'prd', 'spec', 'intents', 'complete'];

/**
 * Get the next stage in the workflow progression
 */
function getNextStage(currentStage: WorkflowStage): WorkflowStage {
  const currentIndex = STAGE_ORDER.indexOf(currentStage);
  if (currentIndex === -1 || currentIndex >= STAGE_ORDER.length - 1) {
    return 'complete';
  }
  return STAGE_ORDER[currentIndex + 1];
}

/**
 * Status response returned by getStatus()
 */
export interface WorkflowStatusResponse {
  workflow_id: string;
  feature_name: string;
  current_stage: WorkflowStage;
  status: WorkflowStatus;
  artifacts: ArtifactReference[];
  updated_at: string;
}

/**
 * WorkflowEngine orchestrates the multi-stage workflow system.
 *
 * @example
 * ```typescript
 * const engine = new WorkflowEngine('/path/to/project', 'User Authentication');
 * await engine.start('I want to build a user login system with OAuth');
 * // Later...
 * await engine.resume();
 * ```
 */
export class WorkflowEngine {
  private projectPath: string;
  private featureName: string;
  private workflowId: string;
  private interruptHandler: (() => void) | null = null;

  /**
   * Create a new WorkflowEngine instance
   *
   * @param projectPath - Absolute path to the project root
   * @param featureName - Human-readable name for the feature
   */
  constructor(projectPath: string, featureName: string) {
    this.projectPath = projectPath;
    this.featureName = featureName;
    // Sanitize feature name to create workflow ID
    this.workflowId = featureName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  }

  /**
   * Start a new workflow from the IDEA stage
   *
   * @param initialPrompt - The user's initial description of the feature
   * @throws Error if disk is full, permissions are denied, or workflow initialization fails
   */
  async start(initialPrompt: string): Promise<void> {
    // Create initial checkpoint
    const checkpoint: WorkflowCheckpoint = {
      schema_version: '1.0.0',
      workflow_id: this.workflowId,
      feature_name: this.featureName,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      current_stage: 'idea',
      status: 'in_progress',
      artifacts: {
        idea: null,
        prd: null,
        spec: null,
        intents: null,
        complete: null,
      },
      validation_results: {
        idea: null,
        prd: null,
        spec: null,
        intents: null,
        complete: null,
      },
      resume_context: {
        initial_prompt: initialPrompt,
      },
    };

    try {
      // Create directory structure
      await ensureWorkflowDir(this.projectPath, this.workflowId);
    } catch (error) {
      const err = error as Error;
      console.error(`[WorkflowEngine] Failed to initialize workflow directory: ${err.message}`);
      throw new Error(
        `Failed to start workflow: Could not create directory structure - ${err.message}`
      );
    }

    try {
      // Save initial checkpoint
      await saveCheckpoint(this.projectPath, checkpoint);
    } catch (error) {
      const err = error as Error;
      console.error(`[WorkflowEngine] Failed to save initial checkpoint: ${err.message}`);
      throw new Error(
        `Failed to start workflow: Could not save checkpoint - ${err.message}`
      );
    }

    // Setup interrupt handler before executing stages
    this.setupInterruptHandler();

    try {
      // Execute the IDEA stage
      await this.executeStage('idea');
    } catch (error) {
      const err = error as Error;
      console.error(`[WorkflowEngine] Failed to execute IDEA stage: ${err.message}`);

      // Try to save checkpoint as paused so workflow can be resumed
      try {
        const updatedCheckpoint = await loadCheckpoint(this.projectPath, this.workflowId);
        if (updatedCheckpoint) {
          updatedCheckpoint.status = 'paused';
          updatedCheckpoint.resume_context = {
            ...updatedCheckpoint.resume_context,
            error_message: err.message,
            failed_stage: 'idea',
          };
          await saveCheckpoint(this.projectPath, updatedCheckpoint);
          console.log('[WorkflowEngine] Workflow saved as paused. Resume with `/plan continue`');
        }
      } catch (saveError) {
        console.warn('[WorkflowEngine] Failed to save error checkpoint:', (saveError as Error).message);
      }

      throw new Error(
        `Failed to execute IDEA stage: ${err.message}`
      );
    } finally {
      // Clean up interrupt handler after workflow completes or errors
      this.cleanupInterruptHandler();
    }
  }

  /**
   * Resume an existing workflow from its current stage
   *
   * @returns Status message indicating what happened
   * @throws Error if checkpoint doesn't exist or workflow execution fails
   */
  async resume(): Promise<string> {
    let checkpoint;

    try {
      checkpoint = await loadCheckpoint(this.projectPath, this.workflowId);
    } catch (error) {
      const err = error as Error;
      console.error(`[WorkflowEngine] Failed to load checkpoint for resume: ${err.message}`);
      throw new Error(
        `Failed to resume workflow: Could not load checkpoint - ${err.message}`
      );
    }

    if (!checkpoint) {
      console.error(`[WorkflowEngine] No checkpoint found for workflow: ${this.workflowId}`);
      console.error(`[WorkflowEngine] Available workflows: Run 'olympus workflow list' to see workflows`);
      throw new Error(`No checkpoint found for workflow: ${this.workflowId}`);
    }

    // Check if workflow is already complete
    if (checkpoint.status === 'complete') {
      return 'Workflow already complete';
    }

    // Update status to in_progress if it was paused
    if (checkpoint.status === 'paused') {
      checkpoint.status = 'in_progress';

      try {
        await saveCheckpoint(this.projectPath, checkpoint);
      } catch (error) {
        const err = error as Error;
        console.error(`[WorkflowEngine] Failed to update checkpoint status: ${err.message}`);
        throw new Error(
          `Failed to resume workflow: Could not save checkpoint - ${err.message}`
        );
      }
    }

    // Setup interrupt handler before executing stages
    this.setupInterruptHandler();

    const currentStage = checkpoint.current_stage;

    try {
      // Execute the current stage
      await this.executeStage(currentStage);
    } catch (error) {
      const err = error as Error;
      console.error(`[WorkflowEngine] Failed to execute ${currentStage} stage: ${err.message}`);

      // Try to save checkpoint as paused so workflow can be resumed again
      try {
        const updatedCheckpoint = await loadCheckpoint(this.projectPath, this.workflowId);
        if (updatedCheckpoint) {
          updatedCheckpoint.status = 'paused';
          updatedCheckpoint.resume_context = {
            ...updatedCheckpoint.resume_context,
            error_message: err.message,
            failed_stage: currentStage,
          };
          await saveCheckpoint(this.projectPath, updatedCheckpoint);
          console.log('[WorkflowEngine] Workflow saved as paused. Fix the issue and resume with `/plan continue`');
        }
      } catch (saveError) {
        console.warn('[WorkflowEngine] Failed to save error checkpoint:', (saveError as Error).message);
      }

      throw new Error(
        `Failed to execute ${currentStage} stage: ${err.message}`
      );
    } finally {
      // Clean up interrupt handler after workflow completes or errors
      this.cleanupInterruptHandler();
    }

    return `Resumed workflow from stage: ${currentStage}`;
  }

  /**
   * Pause the workflow at its current state
   *
   * @returns Path to the checkpoint file
   * @throws Error if checkpoint doesn't exist or save fails
   */
  async pause(): Promise<string> {
    let checkpoint;

    try {
      checkpoint = await loadCheckpoint(this.projectPath, this.workflowId);
    } catch (error) {
      const err = error as Error;
      console.error(`[WorkflowEngine] Failed to load checkpoint for pause: ${err.message}`);
      throw new Error(
        `Failed to pause workflow: Could not load checkpoint - ${err.message}`
      );
    }

    if (!checkpoint) {
      console.error(`[WorkflowEngine] No checkpoint found for workflow: ${this.workflowId}`);
      throw new Error(`No checkpoint found for workflow: ${this.workflowId}`);
    }

    // Update status to paused
    checkpoint.status = 'paused';

    try {
      await saveCheckpoint(this.projectPath, checkpoint);
    } catch (error) {
      const err = error as Error;
      console.error(`[WorkflowEngine] Failed to save paused checkpoint: ${err.message}`);
      throw new Error(
        `Failed to pause workflow: Could not save checkpoint - ${err.message}`
      );
    }

    // Return the checkpoint file path
    return `.olympus/workflow/${this.workflowId}/checkpoint.json`;
  }

  /**
   * Execute a specific workflow stage
   *
   * @param stage - The stage to execute
   */
  async executeStage(stage: WorkflowStage): Promise<void> {
    if (stage === 'complete') {
      throw new Error('No execution for complete stage');
    }

    // Load current checkpoint
    const checkpoint = await loadCheckpoint(this.projectPath, this.workflowId);
    if (!checkpoint) {
      throw new Error(`No checkpoint found for workflow: ${this.workflowId}`);
    }

    // Dispatch to stage handler
    switch (stage) {
      case 'idea':
        await this.executeIdeaStage(checkpoint);
        break;
      case 'prd':
        await this.executePrdStage(checkpoint);
        break;
      case 'spec':
        await this.executeSpecStage(checkpoint);
        break;
      case 'intents':
        await this.executeIntentsStage(checkpoint);
        break;
    }

    // Update checkpoint with completion of this stage
    const artifactId = `${stage.toUpperCase()}-001`;
    const artifactPath = stage === 'intents'
      ? `.olympus/workflow/${this.workflowId}/intents/`
      : `.olympus/workflow/${this.workflowId}/${stage}.md`;

    checkpoint.artifacts[stage] = {
      id: artifactId,
      path: artifactPath,
      created_at: new Date().toISOString(),
      validation_passed: checkpoint.validation_results[stage]?.passed ?? false,
    };

    // Move to next stage
    const nextStage = getNextStage(stage);
    checkpoint.current_stage = nextStage;

    if (nextStage === 'complete') {
      checkpoint.status = 'complete';
    }

    // Save updated checkpoint
    await saveCheckpoint(this.projectPath, checkpoint);
  }

  /**
   * Get the current status of the workflow
   *
   * @throws Error if checkpoint doesn't exist or load fails
   */
  async getStatus(): Promise<WorkflowStatusResponse> {
    let checkpoint;

    try {
      checkpoint = await loadCheckpoint(this.projectPath, this.workflowId);
    } catch (error) {
      const err = error as Error;
      console.error(`[WorkflowEngine] Failed to load checkpoint for status: ${err.message}`);
      throw new Error(
        `Failed to get workflow status: Could not load checkpoint - ${err.message}`
      );
    }

    if (!checkpoint) {
      console.error(`[WorkflowEngine] No checkpoint found for workflow: ${this.workflowId}`);
      throw new Error(`No checkpoint found for workflow: ${this.workflowId}`);
    }

    // Collect non-null artifacts into array
    const artifacts: ArtifactReference[] = [];
    for (const stage of STAGE_ORDER) {
      const artifact = checkpoint.artifacts[stage];
      if (artifact) {
        artifacts.push(artifact);
      }
    }

    return {
      workflow_id: checkpoint.workflow_id,
      feature_name: checkpoint.feature_name,
      current_stage: checkpoint.current_stage,
      status: checkpoint.status,
      artifacts,
      updated_at: checkpoint.updated_at,
    };
  }

  // ============================================================================
  // Interrupt Handling
  // ============================================================================

  /**
   * Setup SIGINT handler to save checkpoint when workflow is interrupted.
   * This allows users to resume their workflow later with `/plan continue`.
   *
   * @private
   */
  private setupInterruptHandler(): void {
    this.interruptHandler = async () => {
      console.log('\n[WorkflowEngine] Workflow interrupted - saving checkpoint...');

      try {
        const checkpoint = await loadCheckpoint(this.projectPath, this.workflowId);
        if (checkpoint) {
          checkpoint.status = 'paused';
          checkpoint.updated_at = new Date().toISOString();
          checkpoint.resume_context = {
            ...checkpoint.resume_context,
            interrupted_at: new Date().toISOString(),
            current_stage: checkpoint.current_stage,
            message: `Workflow interrupted during ${checkpoint.current_stage} stage`,
          };

          await saveCheckpoint(this.projectPath, checkpoint);
          console.log('[WorkflowEngine] Checkpoint saved. Resume with `/plan continue`');
        }
      } catch (error) {
        console.error('[WorkflowEngine] Failed to save checkpoint on interrupt:', error);
      }

      process.exit(0);
    };

    process.on('SIGINT', this.interruptHandler);
  }

  /**
   * Clean up the interrupt handler when workflow completes or errors.
   *
   * @private
   */
  private cleanupInterruptHandler(): void {
    if (this.interruptHandler) {
      process.off('SIGINT', this.interruptHandler);
      this.interruptHandler = null;
    }
  }

  // ============================================================================
  // Stage Execution Methods (Stubs - to be replaced with real agent calls)
  // ============================================================================

  /**
   * Execute the IDEA stage
   *
   * Invokes the idea-intake agent to generate the IDEA artifact.
   * The artifact is validated before the stage is considered complete.
   *
   * TODO: Replace with actual Task tool invocation when integration is complete.
   * Current implementation creates mock artifacts with validation.
   */
  private async executeIdeaStage(checkpoint: WorkflowCheckpoint): Promise<void> {
    const initialPrompt = checkpoint.resume_context?.initial_prompt || 'No initial prompt provided';

    console.log(`[WorkflowEngine] Executing IDEA stage for feature: ${this.featureName}`);
    console.log(`[WorkflowEngine] Initial prompt: ${initialPrompt}`);

    // TODO: Implement actual agent invocation when Task tool integration is available
    // This would invoke the idea-intake agent with the feature request:
    //
    // const agentPrompt = `Generate IDEA artifact for: ${this.featureName}\n\nInitial request: ${initialPrompt}`;
    // await invokeAgent('idea-intake', agentPrompt, {
    //   workflowId: this.workflowId,
    //   outputPath: `.olympus/workflow/${this.workflowId}/idea.md`
    // });
    //
    // The idea-intake agent would:
    // 1. Interview the user about the feature
    // 2. Analyze requirements and constraints
    // 3. Generate a complete IDEA artifact with all required sections
    // 4. Save to the designated path

    console.log('[WorkflowEngine] Agent invocation: idea-intake (stub - would be invoked here)');

    // For now, create mock artifact (will be replaced when agent integration is complete)
    const ideaContent = `# Feature Idea: ${this.featureName}

## Initial Prompt
${initialPrompt}

## Summary
This is a placeholder idea document. The real idea-intake agent will generate
a proper analysis of the feature requirements.

## Key Requirements
- [To be filled by idea-intake agent]

## User Stories
- [To be filled by idea-intake agent]

## Acceptance Criteria
- [To be filled by idea-intake agent]

---
*Generated by WorkflowEngine (stub implementation)*
`;

    await writeArtifact(this.projectPath, this.workflowId, 'idea', ideaContent);

    // Validate the generated artifact
    const ideaPath = getArtifactPath(this.projectPath, this.workflowId, 'idea');
    console.log(`[WorkflowEngine] Validating IDEA artifact at: ${ideaPath}`);

    const validationResult = await validateIdea(ideaPath);

    // Store validation result in checkpoint
    checkpoint.validation_results.idea = validationResult;

    if (!validationResult.passed) {
      console.log('[WorkflowEngine] IDEA validation failed:', validationResult.blocking_issues);
      console.log(`[WorkflowEngine] Coverage: ${validationResult.coverage_percentage}%`);
    } else {
      console.log('[WorkflowEngine] IDEA validation passed');
    }
  }

  /**
   * Execute the PRD stage
   *
   * Invokes the prd-writer agent to generate the PRD artifact.
   * The PRD is validated against the IDEA artifact to ensure coverage.
   *
   * TODO: Replace with actual Task tool invocation when integration is complete.
   * Current implementation creates mock artifacts with validation.
   */
  private async executePrdStage(checkpoint: WorkflowCheckpoint): Promise<void> {
    console.log(`[WorkflowEngine] Executing PRD stage for feature: ${this.featureName}`);

    // Get the IDEA artifact path for context
    const ideaPath = getArtifactPath(this.projectPath, this.workflowId, 'idea');

    // TODO: Implement actual agent invocation when Task tool integration is available
    // This would invoke the prd-writer agent with the IDEA artifact:
    //
    // const agentPrompt = `Generate PRD artifact for: ${this.featureName}\n\nIDEA artifact: ${ideaPath}`;
    // await invokeAgent('prd-writer', agentPrompt, {
    //   workflowId: this.workflowId,
    //   inputArtifacts: { idea: ideaPath },
    //   outputPath: `.olympus/workflow/${this.workflowId}/prd.md`
    // });
    //
    // The prd-writer agent would:
    // 1. Read and analyze the IDEA artifact
    // 2. Generate user stories covering all constraints
    // 3. Create a comprehensive PRD with requirement coverage
    // 4. Save to the designated path

    console.log('[WorkflowEngine] Agent invocation: prd-writer (stub - would be invoked here)');
    console.log(`[WorkflowEngine] Input IDEA artifact: ${ideaPath}`);

    // For now, create mock artifact (will be replaced when agent integration is complete)
    const prdContent = `# Product Requirements Document: ${this.featureName}

## Overview
This is a placeholder PRD document. The real prd-writer agent will generate
a comprehensive product requirements document.

## Business Requirements
- [To be filled by prd-writer agent]

## Functional Requirements
- [To be filled by prd-writer agent]

## Non-Functional Requirements
- [To be filled by prd-writer agent]

## Success Metrics
- [To be filled by prd-writer agent]

---
*Generated by WorkflowEngine (stub implementation)*
`;

    await writeArtifact(this.projectPath, this.workflowId, 'prd', prdContent);

    // Validate the generated artifact against IDEA
    const prdPath = getArtifactPath(this.projectPath, this.workflowId, 'prd');
    console.log(`[WorkflowEngine] Validating PRD artifact at: ${prdPath}`);

    const validationResult = await validatePrd(prdPath, ideaPath);

    // Store validation result in checkpoint
    checkpoint.validation_results.prd = validationResult;

    if (!validationResult.passed) {
      console.log('[WorkflowEngine] PRD validation failed:', validationResult.blocking_issues);
      console.log(`[WorkflowEngine] Coverage: ${validationResult.coverage_percentage}%`);
    } else {
      console.log('[WorkflowEngine] PRD validation passed');
      console.log(`[WorkflowEngine] Coverage: ${validationResult.coverage_percentage}%`);
    }
  }

  /**
   * Execute the SPEC stage
   *
   * TODO (Phase 3): Implement spec-writer agent invocation.
   * The spec-writer agent would generate a technical specification from the PRD.
   */
  private async executeSpecStage(checkpoint: WorkflowCheckpoint): Promise<void> {
    console.log('[WorkflowEngine] Executing SPEC stage (stub implementation)');

    // TODO (Phase 3): Implement spec-writer agent invocation
    // This would invoke the spec-writer agent with the PRD artifact:
    //
    // const prdPath = getArtifactPath(this.projectPath, this.workflowId, 'prd');
    // const agentPrompt = `Generate technical specification for: ${this.featureName}\n\nPRD artifact: ${prdPath}`;
    // await invokeAgent('spec-writer', agentPrompt, {
    //   workflowId: this.workflowId,
    //   inputArtifacts: { prd: prdPath },
    //   outputPath: `.olympus/workflow/${this.workflowId}/spec.md`
    // });

    // Create mock artifact
    const specContent = `# Technical Specification: ${this.featureName}

## Overview
This is a placeholder technical specification. The real spec-writer agent will
generate a detailed technical specification.

## Architecture
- [To be filled by spec-writer agent]

## Data Models
- [To be filled by spec-writer agent]

## API Design
- [To be filled by spec-writer agent]

## Implementation Notes
- [To be filled by spec-writer agent]

---
*Generated by WorkflowEngine (stub implementation)*
`;

    await writeArtifact(this.projectPath, this.workflowId, 'spec', specContent);
  }

  /**
   * Execute the INTENTS stage
   *
   * TODO (Phase 3): Implement intent-generator agent invocation.
   * The intent-generator agent would create implementation intent files from the SPEC.
   */
  private async executeIntentsStage(checkpoint: WorkflowCheckpoint): Promise<void> {
    console.log('[WorkflowEngine] Executing INTENTS stage (stub implementation)');

    // TODO (Phase 3): Implement intent-generator agent invocation
    // This would invoke the intent-generator agent with the SPEC artifact:
    //
    // const specPath = getArtifactPath(this.projectPath, this.workflowId, 'spec');
    // const agentPrompt = `Generate implementation intents for: ${this.featureName}\n\nSPEC artifact: ${specPath}`;
    // await invokeAgent('intent-generator', agentPrompt, {
    //   workflowId: this.workflowId,
    //   inputArtifacts: { spec: specPath },
    //   outputPath: `.olympus/workflow/${this.workflowId}/intents/`
    // });

    // For intents stage, we create files in the intents directory
    // Since writeArtifact doesn't support intents, we'll write directly
    const fs = await import('fs-extra');
    const path = await import('path');

    const intentsDir = path.join(
      this.projectPath,
      '.olympus',
      'workflow',
      this.workflowId,
      'intents'
    );

    await fs.ensureDir(intentsDir);

    // Create a sample intent file
    const intentContent = `# Intent: Implement ${this.featureName}

## Description
This is a placeholder intent file. The real intent-generator agent will
create detailed implementation intents.

## Tasks
- [ ] Task 1: [To be filled by intent-generator agent]
- [ ] Task 2: [To be filled by intent-generator agent]
- [ ] Task 3: [To be filled by intent-generator agent]

## Dependencies
- [To be filled by intent-generator agent]

---
*Generated by WorkflowEngine (stub implementation)*
`;

    await fs.writeFile(
      path.join(intentsDir, 'intent-001.md'),
      intentContent,
      'utf-8'
    );
  }
}
