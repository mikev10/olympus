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

    // Create directory structure
    await ensureWorkflowDir(this.projectPath, this.workflowId);

    // Save initial checkpoint
    await saveCheckpoint(this.projectPath, checkpoint);

    // Execute the IDEA stage
    await this.executeStage('idea');
  }

  /**
   * Resume an existing workflow from its current stage
   *
   * @returns Status message indicating what happened
   */
  async resume(): Promise<string> {
    const checkpoint = await loadCheckpoint(this.projectPath, this.workflowId);

    if (!checkpoint) {
      throw new Error(`No checkpoint found for workflow: ${this.workflowId}`);
    }

    // Check if workflow is already complete
    if (checkpoint.status === 'complete') {
      return 'Workflow already complete';
    }

    // Update status to in_progress if it was paused
    if (checkpoint.status === 'paused') {
      checkpoint.status = 'in_progress';
      await saveCheckpoint(this.projectPath, checkpoint);
    }

    // Execute the current stage
    await this.executeStage(checkpoint.current_stage);

    return `Resumed workflow from stage: ${checkpoint.current_stage}`;
  }

  /**
   * Pause the workflow at its current state
   *
   * @returns Path to the checkpoint file
   */
  async pause(): Promise<string> {
    const checkpoint = await loadCheckpoint(this.projectPath, this.workflowId);

    if (!checkpoint) {
      throw new Error(`No checkpoint found for workflow: ${this.workflowId}`);
    }

    // Update status to paused
    checkpoint.status = 'paused';
    await saveCheckpoint(this.projectPath, checkpoint);

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
      validation_passed: true,
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
   */
  async getStatus(): Promise<WorkflowStatusResponse> {
    const checkpoint = await loadCheckpoint(this.projectPath, this.workflowId);

    if (!checkpoint) {
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
  // Stage Execution Methods (Stubs - to be replaced with real agent calls)
  // ============================================================================

  /**
   * Execute the IDEA stage
   * TODO: Replace with actual idea-intake agent call in Phase 2.2
   */
  private async executeIdeaStage(checkpoint: WorkflowCheckpoint): Promise<void> {
    console.log('Executing idea stage');

    // Create mock artifact
    const ideaContent = `# Feature Idea: ${this.featureName}

## Initial Prompt
${checkpoint.resume_context?.initial_prompt || 'No initial prompt provided'}

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
  }

  /**
   * Execute the PRD stage
   * TODO: Replace with actual prd-writer agent call in Phase 2.3
   */
  private async executePrdStage(checkpoint: WorkflowCheckpoint): Promise<void> {
    console.log('Executing prd stage');

    // Create mock artifact
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
  }

  /**
   * Execute the SPEC stage
   * TODO: Replace with actual spec-writer agent call in Phase 3.1
   */
  private async executeSpecStage(checkpoint: WorkflowCheckpoint): Promise<void> {
    console.log('Executing spec stage');

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
   * TODO: Replace with actual intent-generator agent call in Phase 3.2
   */
  private async executeIntentsStage(checkpoint: WorkflowCheckpoint): Promise<void> {
    console.log('Executing intents stage');

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
