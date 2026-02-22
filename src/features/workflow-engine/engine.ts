/**
 * WorkflowEngine - Core orchestrator for the multi-stage workflow system
 *
 * Manages the progression of features through stages:
 * IDEA → INTENT → UNIT → BOLT → COMPLETE
 *
 * Features:
 * - Checkpoint-based persistence for resumable workflows
 * - Artifact generation and tracking
 * - Status management (in_progress, paused, complete)
 * - Dual validation (parent + root IDEA alignment) at stage transitions
 */

import * as fs from 'fs';
import {
  WorkflowCheckpoint,
  WorkflowStage,
  WorkflowStatus,
  ArtifactReference,
} from './types.js';
import { saveCheckpoint, loadCheckpoint } from './checkpoint.js';
import { ensureWorkflowDir, writeArtifact, getArtifactPath } from './artifacts.js';
import { validateIdea, validateIntent, clearFileCache } from './validation.js';
import { runDualValidation } from './alignment.js';
import { ConstructionExecutor } from './construction/executor.js';
import { executeDiscoveryPhase } from './discovery.js';
import { captureWorkflowDiscovery } from './learning-bridge.js';
import type { WorkflowEvent, WorkflowContext } from './learning-bridge.js';
import { recordDiscovery } from '../../learning/discovery.js';
import type { WorkflowPhase, WorkflowCheckpointV3 } from './phase-types.js';

/**
 * Ordered list of workflow stages for progression validation
 */
const STAGE_ORDER: WorkflowStage[] = ['idea', 'intent', 'unit', 'bolt', 'complete'];

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
    // Sanitize feature name to create workflow ID (slugify)
    let slug = featureName
      .toLowerCase()
      .replace(/\.[a-z]{1,4}$/, '')   // Strip file extensions (.md, .txt, .json, etc.)
      .replace(/[_\s]+/g, '-')         // Convert underscores and spaces to hyphens
      .replace(/[^a-z0-9-]/g, '')      // Remove remaining non-alphanumeric chars
      .replace(/-+/g, '-')             // Collapse multiple hyphens
      .replace(/^-|-$/g, '');           // Trim leading/trailing hyphens

    // Defense-in-depth: truncate overly long slugs
    if (slug.length > 80) {
      slug = slug.substring(0, 80).replace(/-$/, '');
    }

    // Reject empty slugs
    if (!slug) {
      throw new Error('Feature name produced an empty workflow ID after sanitization');
    }

    this.workflowId = slug;
  }

  /**
   * Start a new workflow from the IDEA stage
   *
   * @param initialPrompt - The user's initial description of the feature
   * @throws Error if disk is full, permissions are denied, or workflow initialization fails
   */
  async start(initialPrompt: string): Promise<void> {
    // Create initial checkpoint using V3 format
    const checkpoint: WorkflowCheckpointV3 = {
      schema_version: '3.0.0',
      workflow_id: this.workflowId,
      feature_name: this.featureName,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      current_phase: 'inception',
      current_stage: 'idea',
      status: 'in_progress',
      phases: {
        discovery: {
          status: 'not_started',
          started_at: null,
          completed_at: null,
          gate_result: null,
          gate_bypassed: false,
          bypass_reason: null,
        },
        inception: {
          status: 'in_progress',
          started_at: new Date().toISOString(),
          completed_at: null,
          gate_result: null,
          gate_bypassed: false,
          bypass_reason: null,
        },
        construction: {
          status: 'not_started',
          started_at: null,
          completed_at: null,
          gate_result: null,
          gate_bypassed: false,
          bypass_reason: null,
        },
        operations: {
          status: 'not_started',
          started_at: null,
          completed_at: null,
          gate_result: null,
          gate_bypassed: false,
          bypass_reason: null,
        },
      },
      manifest_path: `aidlc-docs/${this.workflowId}/manifest.json`,
      trust_state_path: `.olympus/trust-state.json`,
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

    // Note: start() only initializes checkpoint and directory structure.
    // Stage execution (IDEA interview, artifact generation) is driven by the
    // /plan skill template interactively, not by the engine programmatically.
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
    return `aidlc-docs/${this.workflowId}/checkpoint.json`;
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
      case 'intent':
        await this.executeIntentStage(checkpoint);
        break;
      case 'unit':
        await this.executeUnitStage(checkpoint);
        break;
      case 'bolt':
        await this.executeBoltStage(checkpoint);
        break;
    }

    // Note: V3 checkpoints don't track artifacts inline - they use manifest
    // Artifact tracking is handled by the manifest system

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

    // Note: V3 checkpoints don't have inline artifacts - they use manifest
    // For now, return empty artifacts array
    const artifacts: ArtifactReference[] = [];

    return {
      workflow_id: checkpoint.workflow_id,
      feature_name: checkpoint.feature_name,
      current_stage: checkpoint.current_stage,
      status: checkpoint.status,
      artifacts,
      updated_at: checkpoint.updated_at,
    };
  }

  /**
   * Execute a phase of the ODLC methodology.
   *
   * This is a NEW method that coexists with executeStage().
   * - executePhase('inception') delegates to existing executeStage() pipeline
   * - executePhase('construction') instantiates ConstructionExecutor
   * - executePhase('operations') generates template-based artifacts (v1 minimal)
   *
   * @param phase - The phase to execute ('discovery' | 'inception' | 'construction' | 'operations')
   */
  async executePhase(phase: WorkflowPhase): Promise<void> {
    switch (phase) {
      case 'discovery': {
        const manifestPath = `${this.projectPath}/aidlc-docs/${this.workflowId}/manifest.json`;
        const result = await executeDiscoveryPhase({
          projectPath: this.projectPath,
          workflowId: this.workflowId,
          featureName: this.featureName,
          manifestPath,
        });
        if (result.gateRequired) {
          console.log(`[WorkflowEngine] Discovery phase: ${result.artifactsGenerated.length} artifacts generated (${result.sourceFileCount} source files detected)`);
          console.log(`[WorkflowEngine] Discovery Gate: Review findings in aidlc-docs/${this.workflowId}/discovery/ before proceeding to Inception`);
        }

        // CCR-3: Capture discovery phase completion
        try {
          const phaseEvent: WorkflowEvent = {
            type: 'phase_complete',
            phase: 'discovery',
            details: `${result.artifactsGenerated.length} artifacts generated, ${result.sourceFileCount} source files`,
          };
          const wfContext: WorkflowContext = {
            workflowId: this.workflowId,
            featureName: this.featureName,
            projectPath: this.projectPath,
            sessionId: 'engine',
            phase: 'discovery',
          };
          const discovery = captureWorkflowDiscovery(phaseEvent, wfContext);
          recordDiscovery(discovery);
        } catch (error) {
          console.error('[WorkflowEngine] Failed to capture discovery phase discovery:', error);
        }

        break;
      }

      case 'inception': {
        // Delegate to existing stage-based pipeline
        const checkpoint = await loadCheckpoint(this.projectPath, this.workflowId);
        if (!checkpoint) {
          throw new Error(`No checkpoint found for workflow: ${this.workflowId}`);
        }

        const stageOrder: WorkflowStage[] = ['idea', 'intent'];
        for (const stage of stageOrder) {
          if (checkpoint.current_stage === stage || checkpoint.current_stage === 'idea') {
            await this.executeStage(stage);
            // Reload checkpoint after each stage
            const updated = await loadCheckpoint(this.projectPath, this.workflowId);
            if (updated && updated.current_stage === 'complete') {
              break;
            }
          }
        }
        console.log('[WorkflowEngine] Decomposition pending — will run when Construction pipeline is implemented in Phase 3');

        // CCR-3: Capture inception phase completion
        try {
          const phaseEvent: WorkflowEvent = {
            type: 'phase_complete',
            phase: 'inception',
            details: 'Inception stages completed',
          };
          const wfContext: WorkflowContext = {
            workflowId: this.workflowId,
            featureName: this.featureName,
            projectPath: this.projectPath,
            sessionId: 'engine',
            phase: 'inception',
          };
          const discovery = captureWorkflowDiscovery(phaseEvent, wfContext);
          recordDiscovery(discovery);
        } catch (error) {
          console.error('[WorkflowEngine] Failed to capture inception phase discovery:', error);
        }

        break;
      }

      case 'construction': {
        // Check if waiting for developer review before proceeding
        const constructionCheckpoint = await loadCheckpoint(this.projectPath, this.workflowId);
        if (constructionCheckpoint && constructionCheckpoint.status === 'awaiting_dev_review') {
          console.log('[WorkflowEngine] Waiting for developer review of technical specification (Risk Tier 3).');
          return;
        }

        // Read intent content for design validation
        const intentPath = getArtifactPath(this.projectPath, this.workflowId, 'intent');
        let intentContent: string | undefined;
        try {
          intentContent = fs.readFileSync(intentPath, 'utf-8');
        } catch {
          // Intent may not exist, continue without it
        }

        const executor = new ConstructionExecutor(this.projectPath, this.workflowId);
        const result = await executor.execute(intentContent);

        if (!result.passed) {
          console.error(`[WorkflowEngine] Construction phase validation failed:`, result.blocking_issues);
          throw new Error(`Construction phase validation failed: ${result.blocking_issues.join(', ')}`);
        }

        // CCR-3: Capture construction phase completion
        try {
          const phaseEvent: WorkflowEvent = {
            type: 'phase_complete',
            phase: 'construction',
            details: 'Construction phase completed',
          };
          const wfContext: WorkflowContext = {
            workflowId: this.workflowId,
            featureName: this.featureName,
            projectPath: this.projectPath,
            sessionId: 'engine',
            phase: 'construction',
          };
          const discovery = captureWorkflowDiscovery(phaseEvent, wfContext);
          recordDiscovery(discovery);
        } catch (error) {
          console.error('[WorkflowEngine] Failed to capture construction phase discovery:', error);
        }

        break;
      }

      case 'operations': {
        // Operations v2: depth-aware artifact generation with checkpoint persistence
        const { generateOperationsArtifacts } = await import('./operations/templates.js');
        const { loadManifest, registerArtifact, updatePhaseStatus } = await import('./manifest.js');

        const manifestPath = `${this.projectPath}/aidlc-docs/${this.workflowId}/manifest.json`;
        const manifest = loadManifest(manifestPath);

        // Read intent if available
        let intentContent: string | null = null;
        try {
          intentContent = fs.readFileSync(getArtifactPath(this.projectPath, this.workflowId, 'intent'), 'utf-8');
        } catch {
          // Intent may not exist
        }

        // Determine depth level from manifest or checkpoint
        const opsCheckpoint = await loadCheckpoint(this.projectPath, this.workflowId);
        let depthLevel: 'SHALLOW' | 'MEDIUM' | 'DEEP' = 'MEDIUM';
        if (manifest?.depth_assessment) {
          const score = manifest.depth_assessment.total_score;
          if (score <= 10) depthLevel = 'SHALLOW';
          else if (score >= 21) depthLevel = 'DEEP';
        }

        const opsContext = {
          workflowId: this.workflowId,
          featureName: this.featureName,
          manifest,
          specContent: intentContent,
          buildLogContent: null,
          depthLevel,
        };

        // Generate operations artifacts
        const result = await generateOperationsArtifacts(opsContext, this.projectPath);

        // Update phase status in manifest
        if (manifest) {
          updatePhaseStatus(manifestPath, 'operations', 'complete');

          // Register each generated artifact in manifest
          for (const artifactName of result.artifactsGenerated) {
            const artifactPath = `aidlc-docs/${this.workflowId}/operations/${artifactName}`;
            const artifactType = artifactName.replace(/\.(md|json)$/, '').toUpperCase().replace(/-/g, '_');
            registerArtifact(manifestPath, {
              id: `OPS-${artifactType}`,
              type: artifactType,
              phase: 'operations',
              stage: 'bolt',
              path: artifactPath,
              validation_passed: true,
              write_complete: true,
              checksum: null,
            });
          }
        }

        // CCR-1: Save checkpoint after Operations artifact generation
        if (opsCheckpoint) {
          opsCheckpoint.current_phase = 'operations' as WorkflowPhase;
          opsCheckpoint.updated_at = new Date().toISOString();
          await saveCheckpoint(this.projectPath, opsCheckpoint);
        }

        console.log(`[WorkflowEngine] Operations phase: Generated ${result.artifactsGenerated.length} artifacts (depth: ${depthLevel})`);
        console.log(`[WorkflowEngine] Operations artifacts: ${result.artifactsGenerated.join(', ')}`);

        // CCR-3: Capture operations phase completion
        try {
          const phaseEvent: WorkflowEvent = {
            type: 'phase_complete',
            phase: 'operations',
            details: `${result.artifactsGenerated.length} artifacts generated (depth: ${depthLevel})`,
          };
          const wfContext: WorkflowContext = {
            workflowId: this.workflowId,
            featureName: this.featureName,
            projectPath: this.projectPath,
            sessionId: 'engine',
            phase: 'operations',
          };
          const discovery = captureWorkflowDiscovery(phaseEvent, wfContext);
          recordDiscovery(discovery);
        } catch (error) {
          console.error('[WorkflowEngine] Failed to capture operations phase discovery:', error);
        }

        break;
      }
    }
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
   * Generates the IDEA artifact following the structured format expected by validation.
   * The artifact includes problem statement, user personas, success metrics,
   * business constraints, and out of scope sections.
   */
  private async executeIdeaStage(checkpoint: WorkflowCheckpoint | WorkflowCheckpointV3): Promise<void> {
    const initialPrompt = checkpoint.resume_context?.initial_prompt || 'No initial prompt provided';

    console.log(`[WorkflowEngine] Executing IDEA stage for feature: ${this.featureName}`);
    console.log(`[WorkflowEngine] Initial prompt: ${initialPrompt}`);
    console.log('[WorkflowEngine] Generating IDEA artifact with structured format');

    // Generate a properly formatted IDEA artifact that passes validation
    const ideaId = `idea-${this.workflowId}`;
    const timestamp = new Date().toISOString();

    const ideaContent = `---
id: ${ideaId}
title: ${this.featureName}
status: draft
created: ${timestamp}
author: "workflow-engine"
risk_tier: 2
---

## Problem Statement

**Feature**: ${this.featureName}

${initialPrompt}

This feature addresses a specific need identified by stakeholders. The goal is to implement a solution that meets user requirements while maintaining system quality and performance standards.

## User Personas

- **Primary User**: End users who will directly interact with this feature in their daily workflow
- **Developer**: Engineers who will integrate with, maintain, and extend this feature
- **Administrator**: System administrators who will configure, monitor, and manage this feature

## Success Metrics

- **Metric 1**: Successful implementation with all acceptance criteria met (target: 100% completion)
- **Metric 2**: Zero critical bugs in production within first 30 days (target: 0 P0/P1 issues)
- **Metric 3**: Positive user feedback and adoption rate (target: >80% user satisfaction)

## Business Constraints

- **Technical**: Must integrate with existing system architecture and maintain compatibility
- **Timeline**: Development should follow standard sprint cycles and delivery timelines
- **Budget**: Implementation within allocated development resources and infrastructure costs
- **Resources**: Available team capacity and technical expertise
- **Policy**: Compliance with security standards, data privacy regulations, and coding best practices

## Out of Scope

- Future enhancements not included in initial requirements
- Integration with systems outside the current scope
- Features that require additional budget allocation
- Changes to unrelated system components

---
*Generated by WorkflowEngine*
`;

    await writeArtifact(this.projectPath, this.workflowId, 'idea', ideaContent);

    // Validate the generated artifact
    const ideaPath = getArtifactPath(this.projectPath, this.workflowId, 'idea');
    console.log(`[WorkflowEngine] Validating IDEA artifact at: ${ideaPath}`);

    const validationResult = await validateIdea(ideaPath);

    // Note: V3 checkpoints don't store validation_results inline - they use manifest
    // For now, just log the validation result
    if (!validationResult.passed) {
      console.log('[WorkflowEngine] IDEA validation failed:', validationResult.blocking_issues);
      console.log(`[WorkflowEngine] Coverage: ${validationResult.coverage_percentage}%`);
    } else {
      console.log('[WorkflowEngine] IDEA validation passed');
    }

    // CCR-1: Save checkpoint after artifact generation
    const updatedCheckpoint = await loadCheckpoint(this.projectPath, this.workflowId);
    if (updatedCheckpoint) {
      const v3Checkpoint = updatedCheckpoint as WorkflowCheckpointV3;
      if (v3Checkpoint.interview_progress) {
        v3Checkpoint.interview_progress.stage = 'idea';
      }
      updatedCheckpoint.updated_at = new Date().toISOString();
      await saveCheckpoint(this.projectPath, updatedCheckpoint);
    }
  }

  /**
   * Execute the INTENT stage
   *
   * Reads the approved IDEA artifact and generates:
   * 1. inception/intent.md - Business requirements, technical specification, implementation plan
   * 2. inception/nfr.md - Non-functional requirements (security, performance, etc.)
   *
   * Runs dual validation (parent + root IDEA alignment) for the idea-to-intent transition.
   */
  private async executeIntentStage(checkpoint: WorkflowCheckpoint | WorkflowCheckpointV3): Promise<void> {
    console.log(`[WorkflowEngine] Executing INTENT stage for feature: ${this.featureName}`);

    // Read the approved IDEA artifact
    const ideaPath = getArtifactPath(this.projectPath, this.workflowId, 'idea');
    console.log(`[WorkflowEngine] Reading IDEA artifact from: ${ideaPath}`);

    let ideaContent: string;
    try {
      ideaContent = fs.readFileSync(ideaPath, 'utf-8');
    } catch {
      ideaContent = '';
      console.warn('[WorkflowEngine] Could not read IDEA artifact, proceeding with empty context');
    }

    console.log('[WorkflowEngine] Generating INTENT artifact with business requirements and technical specification');

    const ideaId = `idea-${this.workflowId}`;
    const intentId = `intent-${this.workflowId}`;
    const timestamp = new Date().toISOString();

    // Generate INTENT artifact with new template format
    const intentContent = `---
id: ${intentId}
title: ${this.featureName}
parent: "${ideaId}"
status: draft
created: ${timestamp}
depth_score: 3
risk_tier: 2
---

## Business Requirements

### User Stories

#### US-001: Core Feature Implementation
**As a** user
**I want** to use ${this.featureName}
**So that** I can benefit from the new functionality

**Acceptance Criteria:**
- [ ] Feature is accessible through the standard user interface
- [ ] Feature functions according to specification
- [ ] Feature integrates with existing system components
- [ ] Feature handles error cases gracefully

#### US-002: Technical Integration
**As a** developer
**I want** the feature to integrate seamlessly with existing systems
**So that** we maintain system stability and consistency

**Acceptance Criteria:**
- [ ] All API contracts are maintained
- [ ] Integration tests pass successfully
- [ ] No breaking changes to existing functionality
- [ ] Performance metrics remain within acceptable bounds

#### US-003: Operational Readiness
**As a** system administrator
**I want** the feature to be properly documented and monitored
**So that** I can maintain and troubleshoot it effectively

**Acceptance Criteria:**
- [ ] Monitoring and alerting are configured
- [ ] Runbook documentation is complete
- [ ] Resource usage stays within budget constraints
- [ ] Scaling strategy is defined

### Business Rules

- All user-facing changes must maintain backward compatibility
- Security review is required before deployment
- Performance must not degrade beyond established baselines
- All changes must comply with data privacy regulations

## Technical Specification

### Architecture Overview

The implementation follows the existing system architecture patterns. Core functionality will be implemented as modular components that integrate with the current service layer.

### API Design

- RESTful endpoints following existing API conventions
- Request/response validation using established middleware
- Proper error handling with standard error response format

### Data Model

- Data structures aligned with existing schema patterns
- Migration scripts for any database changes
- Backward-compatible schema modifications

### Integration Points

- Integration with existing authentication and authorization systems
- Event-driven communication where applicable
- API versioning to maintain backward compatibility

### Security Considerations

- Input validation on all user-facing endpoints
- Authentication required for all protected resources
- Authorization checks at the service layer
- Audit logging for sensitive operations

## Implementation Plan

### Proposed UNITs

- **UNIT-001**: Core feature implementation and business logic
- **UNIT-002**: Integration layer and API endpoints
- **UNIT-003**: Testing, documentation, and deployment configuration

### Cross-UNIT Dependencies

- UNIT-002 depends on UNIT-001 (core logic must exist before integration)
- UNIT-003 depends on UNIT-001 and UNIT-002 (testing requires both layers)

### Risk Assessment

**Technical Risks:**
- Integration complexity may require additional investigation
- Performance requirements may need optimization iterations

**Mitigation:**
- Early prototyping to validate integration approach
- Incremental delivery with continuous testing
- Regular technical reviews and architecture discussions

---
*Generated by WorkflowEngine based on ${ideaId}*
`;

    await writeArtifact(this.projectPath, this.workflowId, 'intent', intentContent);

    // Generate NFR artifact
    const nfrId = `nfr-${this.workflowId}`;
    const nfrContent = `---
id: ${nfrId}
parent: "${intentId}"
status: draft
created: ${timestamp}
---

## Security

| Requirement | Type | Gate-blocking |
|-------------|------|---------------|
| Input validation on all endpoints | design-time | yes |
| Authentication for protected resources | design-time | yes |
| Authorization checks at service layer | runtime | yes |
| Audit logging for sensitive operations | runtime | no |

## Performance

| Requirement | Type | Gate-blocking |
|-------------|------|---------------|
| API response time < 500ms (p95) | runtime | yes |
| No memory leaks under sustained load | runtime | yes |
| Database queries optimized with indexes | design-time | no |

## Availability

| Requirement | Type | Gate-blocking |
|-------------|------|---------------|
| Graceful degradation on dependency failure | runtime | yes |
| Health check endpoint available | design-time | no |
| Error recovery without data loss | runtime | yes |

## Compliance

| Requirement | Type | Gate-blocking |
|-------------|------|---------------|
| Data privacy regulations satisfied | design-time | yes |
| Coding standards and best practices followed | design-time | no |
| License compliance for dependencies | design-time | no |

## Accessibility

| Requirement | Type | Gate-blocking |
|-------------|------|---------------|
| WCAG 2.1 AA compliance for UI components | design-time | no |
| Keyboard navigation support | design-time | no |
| Screen reader compatible output | runtime | no |

---
*Generated by WorkflowEngine based on ${intentId}*
`;

    await writeArtifact(this.projectPath, this.workflowId, 'nfr', nfrContent);
    console.log('[WorkflowEngine] Generated NFR artifact at inception/nfr.md');

    // Run dual validation (parent + root IDEA alignment)
    try {
      const dualResult = runDualValidation(
        intentContent,
        ideaContent,
        ideaContent,
        'idea-to-intent',
        'unit-to-idea',
        ideaId,
        intentId,
        ideaId
      );
      console.log(`[WorkflowEngine] Dual validation: parent=${dualResult.parentCheck.alignment_passed}, root=${dualResult.rootCheck.alignment_passed}, overall=${dualResult.passed}`);
    } catch (error) {
      console.error('[WorkflowEngine] Dual validation error (non-blocking):', (error as Error).message);
    }

    // Validate the generated artifact
    const intentPath = getArtifactPath(this.projectPath, this.workflowId, 'intent');
    console.log(`[WorkflowEngine] Validating INTENT artifact at: ${intentPath}`);

    const validationResult = await validateIntent(intentPath);

    if (!validationResult.passed) {
      console.log('[WorkflowEngine] INTENT validation failed:', validationResult.blocking_issues);
      console.log(`[WorkflowEngine] Coverage: ${validationResult.coverage_percentage}%`);
    } else {
      console.log('[WorkflowEngine] INTENT validation passed');
      console.log(`[WorkflowEngine] Coverage: ${validationResult.coverage_percentage}%`);
    }

    // CCR-1: Save checkpoint after artifact generation
    const updatedCheckpoint = await loadCheckpoint(this.projectPath, this.workflowId);
    if (updatedCheckpoint) {
      const v3Checkpoint = updatedCheckpoint as WorkflowCheckpointV3;
      v3Checkpoint.interview_progress = {
        stage: 'intent',
        questions_asked: 0,
        draft_artifact_path: intentPath,
      };
      updatedCheckpoint.updated_at = new Date().toISOString();
      await saveCheckpoint(this.projectPath, updatedCheckpoint);
    }
  }

  /**
   * Execute the UNIT stage
   *
   * Generates the UNIT artifacts for the feature.
   */
  private async executeUnitStage(checkpoint: WorkflowCheckpoint | WorkflowCheckpointV3): Promise<void> {
    console.log(`[WorkflowEngine] Executing UNIT stage for feature: ${this.featureName}`);
    // TODO: Implement UNIT stage execution
    throw new Error('UNIT stage execution not yet implemented');
  }

  /**
   * Execute the BOLT stage
   *
   * Generates the BOLT artifacts for the feature.
   */
  private async executeBoltStage(checkpoint: WorkflowCheckpoint | WorkflowCheckpointV3): Promise<void> {
    console.log(`[WorkflowEngine] Executing BOLT stage for feature: ${this.featureName}`);
    // TODO: Implement BOLT stage execution
    throw new Error('BOLT stage execution not yet implemented');
  }

}
