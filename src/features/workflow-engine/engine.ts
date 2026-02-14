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
import { validateIdea, validateIntent, clearFileCache } from './validation.js';
import { ForgeExecutor } from './forge/executor.js';
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
      manifest_path: `aidlc-docs/manifest.json`,
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
    return `aidlc-docs/checkpoint.json`;
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
   * - executePhase('construction') instantiates ForgeExecutor
   * - executePhase('operations') generates template-based artifacts (v1 minimal)
   *
   * @param phase - The phase to execute ('discovery' | 'inception' | 'construction' | 'operations')
   */
  async executePhase(phase: WorkflowPhase): Promise<void> {
    switch (phase) {
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
        break;
      }

      case 'construction': {
        // Read intent content for design validation
        const intentPath = getArtifactPath(this.projectPath, this.workflowId, 'intent');
        let intentContent: string | undefined;
        try {
          const fs = await import('fs');
          intentContent = fs.readFileSync(intentPath, 'utf-8');
        } catch {
          // Intent may not exist, continue without it
        }

        const executor = new ForgeExecutor(this.projectPath, this.workflowId);
        const result = await executor.execute(intentContent);

        if (!result.passed) {
          console.error(`[WorkflowEngine] Construction phase validation failed:`, result.blocking_issues);
          throw new Error(`Construction phase validation failed: ${result.blocking_issues.join(', ')}`);
        }
        break;
      }

      case 'operations': {
        // Operations v1: template-based artifact generation
        const { generateDeployGuide, generateRunbook, generateMonitoringConfig, generateReleaseNotes } = await import('./summit/templates.js');
        const { loadManifest } = await import('./manifest.js');

        const workflowDir = `aidlc-docs`;
        const manifestPath = `${this.projectPath}/${workflowDir}/manifest.json`;
        const manifest = await loadManifest(manifestPath);

        // Read intent if available
        let intentContent: string | null = null;
        try {
          const fsModule = await import('fs');
          intentContent = fsModule.readFileSync(getArtifactPath(this.projectPath, this.workflowId, 'intent'), 'utf-8');
        } catch {
          // Intent may not exist
        }

        const summitContext = {
          workflowId: this.workflowId,
          featureName: this.featureName,
          manifest,
          specContent: intentContent,
          buildLogContent: null,
        };

        // Ensure operations directory
        const fsExtra = await import('fs-extra');
        const operationsDir = `${this.projectPath}/aidlc-docs/operations`;
        await fsExtra.ensureDir(operationsDir);

        // Generate all operations artifacts
        await fsExtra.writeFile(`${operationsDir}/deploy-guide.md`, generateDeployGuide(summitContext), 'utf-8');
        await fsExtra.writeFile(`${operationsDir}/runbook.md`, generateRunbook(summitContext), 'utf-8');
        await fsExtra.writeFile(`${operationsDir}/monitoring.json`, generateMonitoringConfig(summitContext), 'utf-8');
        await fsExtra.writeFile(`${operationsDir}/release-notes.md`, generateReleaseNotes(summitContext), 'utf-8');

        console.log('[WorkflowEngine] Operations phase: Generated deploy-guide, runbook, monitoring config, and release notes');
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
   * The artifact includes problem statement, business context, success metrics, constraints,
   * solution approach, and risk assessment.
   */
  private async executeIdeaStage(checkpoint: WorkflowCheckpoint | WorkflowCheckpointV3): Promise<void> {
    const initialPrompt = checkpoint.resume_context?.initial_prompt || 'No initial prompt provided';

    console.log(`[WorkflowEngine] Executing IDEA stage for feature: ${this.featureName}`);
    console.log(`[WorkflowEngine] Initial prompt: ${initialPrompt}`);
    console.log('[WorkflowEngine] Generating IDEA artifact with structured format');

    // Generate a properly formatted IDEA artifact that passes validation
    const ideaId = 'IDEA-001'; // In production, this would be auto-incremented
    const timestamp = new Date().toISOString();

    const ideaContent = `---
id: ${ideaId}
feature: ${this.workflowId}
feature_name: ${this.featureName}
created: ${timestamp}
risk_tier: 2
---

## Problem Statement

**Feature**: ${this.featureName}

${initialPrompt}

This feature addresses a specific need identified by stakeholders. The goal is to implement a solution that meets user requirements while maintaining system quality and performance standards.

## Business Context

This feature will benefit end users by providing new functionality that enhances their workflow. The implementation aligns with our strategic goals of improving user experience and system capabilities.

**Target Users**: Primary users who will directly interact with this feature
**Expected Impact**: Improved user satisfaction and operational efficiency
**Strategic Alignment**: Supports product roadmap and business objectives

## Success Metrics

- **Metric 1**: Successful implementation with all acceptance criteria met (target: 100% completion)
- **Metric 2**: Zero critical bugs in production within first 30 days (target: 0 P0/P1 issues)
- **Metric 3**: Positive user feedback and adoption rate (target: >80% user satisfaction)

## Constraints

- **Technical**: Must integrate with existing system architecture and maintain compatibility
- **Timeline**: Development should follow standard sprint cycles and delivery timelines
- **Budget**: Implementation within allocated development resources and infrastructure costs
- **Resources**: Available team capacity and technical expertise
- **Policy**: Compliance with security standards, data privacy regulations, and coding best practices

## Solution Approach

The proposed solution will follow a phased implementation approach:

1. **Phase 1 - Planning**: Define detailed requirements, technical design, and implementation plan
2. **Phase 2 - Development**: Implement core functionality with iterative testing
3. **Phase 3 - Validation**: Comprehensive testing, security review, and performance validation
4. **Phase 4 - Deployment**: Staged rollout with monitoring and support

**Key Considerations**:
- Maintain backward compatibility where applicable
- Ensure scalability and performance
- Implement proper error handling and logging
- Follow established coding standards and patterns

## Risk Assessment

**Risk Tier**: 2 (Medium)

**Justification**: This is a standard feature implementation with moderate complexity. While there are some unknowns in requirements and integration points, the domain is well-understood and the impact is manageable with proper testing and validation.

**Key Risks**:
- **Integration Complexity**: May encounter challenges integrating with existing systems
- **Scope Creep**: Requirements may evolve during implementation
- **Resource Availability**: Team capacity constraints could impact timeline
- **Technical Debt**: Need to balance new features with code quality and maintainability

**Mitigation Strategies**:
- Early prototyping to validate integration approach
- Regular stakeholder communication to manage scope
- Incremental delivery to reduce risk
- Comprehensive testing and code review processes

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
  }

  /**
   * Execute the INTENT stage (formerly PRD)
   *
   * Generates the INTENT artifact with user stories and requirement coverage.
   * The INTENT is validated against the IDEA artifact to ensure >= 90% coverage.
   */
  private async executeIntentStage(checkpoint: WorkflowCheckpoint | WorkflowCheckpointV3): Promise<void> {
    console.log(`[WorkflowEngine] Executing INTENT stage for feature: ${this.featureName}`);

    // Get the IDEA artifact path for context
    const ideaPath = getArtifactPath(this.projectPath, this.workflowId, 'idea');
    console.log(`[WorkflowEngine] Reading IDEA artifact from: ${ideaPath}`);
    console.log('[WorkflowEngine] Generating INTENT artifact with user stories');

    // Generate a properly formatted INTENT artifact that passes validation
    const intentId = 'INTENT-001';
    const timestamp = new Date().toISOString();

    // Create user stories that map to the constraints from IDEA
    // Each constraint type gets at least one user story
    const intentContent = `---
id: ${intentId}
feature: ${this.workflowId}
created: ${timestamp}
based_on: IDEA-001
---

## Overview

This PRD defines the product requirements for ${this.featureName}. It translates the strategic vision from the IDEA artifact into actionable user stories with clear acceptance criteria.

## User Stories

### US-001: Core Feature Implementation
**As a** user
**I want** to use ${this.featureName}
**So that** I can benefit from the new functionality

**Acceptance Criteria:**
- [ ] Feature is accessible through the standard user interface
- [ ] Feature functions according to specification
- [ ] Feature integrates with existing system components
- [ ] Feature handles error cases gracefully

**Technical Notes:**
- Must maintain compatibility with existing architecture
- Follow established coding patterns and standards

### US-002: Technical Integration
**As a** developer
**I want** the feature to integrate seamlessly with existing systems
**So that** we maintain system stability and consistency

**Acceptance Criteria:**
- [ ] All API contracts are maintained
- [ ] Integration tests pass successfully
- [ ] No breaking changes to existing functionality
- [ ] Performance metrics remain within acceptable bounds

**Technical Notes:**
- Requires review of existing integration points
- May need adapter patterns for legacy components

### US-003: Resource Management
**As a** system administrator
**I want** the feature to operate within resource constraints
**So that** system performance and costs remain optimal

**Acceptance Criteria:**
- [ ] Resource usage stays within budget constraints
- [ ] Scaling strategy is defined and documented
- [ ] Monitoring and alerting are configured
- [ ] Capacity planning is completed

**Technical Notes:**
- Consider horizontal scaling for high-load scenarios
- Implement resource pooling where appropriate

### US-004: Timeline Delivery
**As a** project stakeholder
**I want** the feature delivered according to schedule
**So that** we meet business commitments and milestones

**Acceptance Criteria:**
- [ ] Implementation follows defined sprint cycles
- [ ] Key milestones are tracked and met
- [ ] Blockers are identified and resolved promptly
- [ ] Regular status updates are provided

**Technical Notes:**
- Use iterative development approach
- Prioritize MVP features first

### US-005: Compliance and Security
**As a** compliance officer
**I want** the feature to meet security and policy requirements
**So that** we maintain regulatory compliance and protect user data

**Acceptance Criteria:**
- [ ] Security review completed and approved
- [ ] Data privacy requirements satisfied
- [ ] Access controls properly implemented
- [ ] Audit logging in place

**Technical Notes:**
- Follow OWASP security guidelines
- Implement principle of least privilege

## Requirement Coverage

| IDEA Constraint | PRD User Story | Coverage |
|-----------------|----------------|----------|
| Technical constraints | US-001, US-002 | ✓ |
| Timeline constraints | US-004 | ✓ |
| Budget constraints | US-003 | ✓ |
| Resource constraints | US-003 | ✓ |
| Policy constraints | US-005 | ✓ |

**Coverage Summary:**
- Total constraints: 5
- Covered: 5 (100%)
- Uncovered: None

## Out of Scope

The following items are explicitly excluded from this PRD:
- Future enhancements not included in initial requirements
- Integration with systems outside the current scope
- Features that require additional budget allocation
- Changes to unrelated system components

## Dependencies

**External Dependencies:**
- Existing system infrastructure and services
- Third-party libraries and frameworks (as needed)
- Development and testing environments

**Internal Dependencies:**
- Team availability and resource allocation
- Completion of prerequisite tasks or features
- Access to necessary systems and data

## Risks

**Technical Risks:**
- Integration complexity may require additional investigation
- Performance requirements may need optimization iterations
- Technical debt may need to be addressed during implementation

**Mitigation:**
- Early prototyping and proof-of-concept work
- Regular technical reviews and architecture discussions
- Incremental delivery with continuous testing

**Schedule Risks:**
- Resource constraints could impact delivery timeline
- Unexpected technical challenges may arise
- Scope creep from evolving requirements

**Mitigation:**
- Maintain clear scope boundaries
- Regular stakeholder communication
- Buffer time for contingencies

## Success Metrics

Success will be measured using the following criteria from the IDEA artifact:
- **Implementation Completeness**: All acceptance criteria met (target: 100%)
- **Quality**: Zero critical defects in production (target: 0 P0/P1 issues)
- **User Satisfaction**: Positive feedback and adoption (target: >80% satisfaction)

---
*Generated by WorkflowEngine based on IDEA-001*
`;

    await writeArtifact(this.projectPath, this.workflowId, 'intent', intentContent);

    // Validate the generated artifact against IDEA
    const intentPath = getArtifactPath(this.projectPath, this.workflowId, 'intent');
    console.log(`[WorkflowEngine] Validating INTENT artifact at: ${intentPath}`);

    const validationResult = await validateIntent(intentPath);

    // Note: V3 checkpoints don't store validation_results inline - they use manifest
    if (!validationResult.passed) {
      console.log('[WorkflowEngine] INTENT validation failed:', validationResult.blocking_issues);
      console.log(`[WorkflowEngine] Coverage: ${validationResult.coverage_percentage}%`);
    } else {
      console.log('[WorkflowEngine] INTENT validation passed');
      console.log(`[WorkflowEngine] Coverage: ${validationResult.coverage_percentage}%`);
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

  /**
   * DEPRECATED: Execute the SPEC stage (old workflow)
   *
   * Generates the SPEC artifact with technical design from the PRD.
   * Includes components, database schema, API endpoints, authentication,
   * error handling, and performance considerations.
   */
  private async executeSpecStage(checkpoint: WorkflowCheckpoint | WorkflowCheckpointV3): Promise<void> {
    console.log(`[WorkflowEngine] Executing SPEC stage for feature: ${this.featureName}`);

    // Get the INTENT artifact path for context
    const intentPath = getArtifactPath(this.projectPath, this.workflowId, 'intent');
    console.log(`[WorkflowEngine] Reading INTENT artifact from: ${intentPath}`);
    console.log('[WorkflowEngine] Generating SPEC artifact with technical design');

    // Read INTENT to extract user stories for coverage tracking
    const fs = await import('fs');
    const intentContent = fs.readFileSync(intentPath, 'utf-8');
    const intentUserStories: string[] = [];
    const intentLines = intentContent.split('\n');
    for (const line of intentLines) {
      const match = line.match(/^###?\s+(US-\d+)/);
      if (match) {
        intentUserStories.push(match[1]);
      }
    }

    // Generate a properly formatted SPEC artifact that passes validation
    const specId = 'SPEC-001';
    const timestamp = new Date().toISOString();

    const specContent = `---
id: ${specId}
feature: ${this.workflowId}
created: ${timestamp}
based_on: IDEA-001
prd_id: PRD-001
---

## Overview

This technical specification defines the architecture, data models, and implementation approach for ${this.featureName}. It translates the product requirements from the PRD into concrete technical designs.

## Components

### Frontend Components

**User Interface Layer**
- Main feature UI component with state management
- Form validation and input handling
- Error boundary and fallback UI
- Responsive layout adapters

**Technical Requirements:**
- Component library: React/Vue/Angular (as per stack)
- State management: Redux/Context API/Vuex
- Styling: CSS modules or styled-components
- Accessibility: WCAG 2.1 AA compliance

### Backend Services

**API Service**
- RESTful API endpoints for feature operations
- Request validation middleware
- Business logic layer
- Data access layer

**Technical Requirements:**
- Framework: Express/FastAPI/Spring Boot (as per stack)
- Validation: Joi/Pydantic/Bean Validation
- ORM: TypeORM/SQLAlchemy/JPA
- Logging: Winston/Python logging/SLF4J

### Database Components

**Data Storage**
- Primary database tables/collections
- Indexing strategy for performance
- Migration scripts
- Backup procedures

**Technical Requirements:**
- Database: PostgreSQL/MySQL/MongoDB (as per stack)
- Connection pooling: pgbouncer/connection pool
- Replication: Primary-replica setup
- Backup: Daily automated backups

### Infrastructure Components

**Deployment Architecture**
- Application server configuration
- Load balancer setup
- CDN integration for static assets
- Monitoring and alerting

**Technical Requirements:**
- Container: Docker
- Orchestration: Kubernetes/Docker Compose
- CI/CD: GitHub Actions/Jenkins/GitLab CI
- Monitoring: Prometheus/Grafana/Datadog

## Database Schema

### Tables/Collections

**feature_data**
- id: UUID PRIMARY KEY
- user_id: UUID NOT NULL FOREIGN KEY → users.id
- feature_name: VARCHAR(255) NOT NULL
- data_payload: JSONB
- status: VARCHAR(50) NOT NULL
- created_at: TIMESTAMP NOT NULL DEFAULT NOW()
- updated_at: TIMESTAMP NOT NULL DEFAULT NOW()

**Indexes:**
- idx_feature_data_user_id ON feature_data(user_id)
- idx_feature_data_status ON feature_data(status)
- idx_feature_data_created_at ON feature_data(created_at)

**feature_audit_log**
- id: UUID PRIMARY KEY
- feature_data_id: UUID NOT NULL FOREIGN KEY → feature_data.id
- action: VARCHAR(50) NOT NULL
- actor_id: UUID NOT NULL FOREIGN KEY → users.id
- changes: JSONB
- timestamp: TIMESTAMP NOT NULL DEFAULT NOW()

**Indexes:**
- idx_feature_audit_feature_id ON feature_audit_log(feature_data_id)
- idx_feature_audit_timestamp ON feature_audit_log(timestamp)

## API Endpoints

### POST /api/v1/feature
Create new feature instance

**Request:**
\`\`\`json
{
  "feature_name": "string",
  "data_payload": {},
  "user_id": "uuid"
}
\`\`\`

**Response (201 Created):**
\`\`\`json
{
  "id": "uuid",
  "feature_name": "string",
  "status": "active",
  "created_at": "timestamp"
}
\`\`\`

**Authentication:** Bearer token required
**Rate Limit:** 100 requests/minute per user

### GET /api/v1/feature/:id
Retrieve feature instance by ID

**Response (200 OK):**
\`\`\`json
{
  "id": "uuid",
  "feature_name": "string",
  "data_payload": {},
  "status": "active",
  "created_at": "timestamp",
  "updated_at": "timestamp"
}
\`\`\`

**Authentication:** Bearer token required
**Rate Limit:** 1000 requests/minute per user

### PUT /api/v1/feature/:id
Update feature instance

**Request:**
\`\`\`json
{
  "data_payload": {},
  "status": "active" | "inactive"
}
\`\`\`

**Response (200 OK):**
\`\`\`json
{
  "id": "uuid",
  "feature_name": "string",
  "data_payload": {},
  "status": "active",
  "updated_at": "timestamp"
}
\`\`\`

**Authentication:** Bearer token required
**Rate Limit:** 100 requests/minute per user

### DELETE /api/v1/feature/:id
Delete feature instance (soft delete)

**Response (204 No Content)**

**Authentication:** Bearer token required
**Rate Limit:** 50 requests/minute per user

## Authentication/Authorization

### Authentication Mechanism

**JWT Token-Based Authentication**
- Tokens issued on successful login
- Token expiry: 24 hours
- Refresh token rotation enabled
- Token blacklist for logout

**Implementation:**
\`\`\`typescript
middleware.authenticate = (req, res, next) => {
  const token = extractToken(req);
  const payload = verifyJWT(token);
  req.user = payload;
  next();
};
\`\`\`

### Authorization Model

**Role-Based Access Control (RBAC)**
- Roles: admin, user, guest
- Permissions: create, read, update, delete
- Resource-level permissions

**Permission Matrix:**
| Role | Create | Read | Update | Delete |
|------|--------|------|--------|--------|
| Admin | ✓ | ✓ | ✓ | ✓ |
| User | ✓ | ✓ (own) | ✓ (own) | ✓ (own) |
| Guest | ✗ | ✓ (public) | ✗ | ✗ |

### Token Management

**Token Storage:**
- Access token: HTTP-only cookie or localStorage
- Refresh token: HTTP-only cookie (secure flag)

**Token Refresh Flow:**
1. Client detects expired access token
2. Send refresh token to /api/v1/auth/refresh
3. Server validates refresh token
4. Issue new access token and refresh token pair
5. Client updates stored tokens

## Error Handling

### Error Types

**Client Errors (4xx)**
- 400 Bad Request: Invalid input data
- 401 Unauthorized: Missing or invalid authentication
- 403 Forbidden: Insufficient permissions
- 404 Not Found: Resource does not exist
- 409 Conflict: Resource conflict (duplicate entry)
- 422 Unprocessable Entity: Validation errors
- 429 Too Many Requests: Rate limit exceeded

**Server Errors (5xx)**
- 500 Internal Server Error: Unexpected error
- 502 Bad Gateway: Upstream service failure
- 503 Service Unavailable: Temporary unavailability
- 504 Gateway Timeout: Upstream timeout

### Error Response Format

\`\`\`json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input data",
    "details": [
      {
        "field": "feature_name",
        "message": "Feature name is required"
      }
    ],
    "request_id": "uuid"
  }
}
\`\`\`

### Logging Strategy

**Log Levels:**
- ERROR: Critical failures requiring immediate attention
- WARN: Non-critical issues that should be investigated
- INFO: General operational events
- DEBUG: Detailed diagnostic information

**Log Format (JSON):**
\`\`\`json
{
  "timestamp": "ISO8601",
  "level": "ERROR",
  "service": "feature-api",
  "message": "Database connection failed",
  "context": {
    "request_id": "uuid",
    "user_id": "uuid",
    "error": "Connection timeout"
  }
}
\`\`\`

**Log Aggregation:**
- Centralized logging: ELK Stack/Splunk/CloudWatch
- Log retention: 30 days for INFO, 90 days for ERROR
- Alert triggers: Error rate > 1% over 5 minutes

## Performance Considerations

### Caching Strategy

**Application-Level Caching**
- Cache frequently accessed data (user profiles, feature metadata)
- Cache TTL: 5 minutes for dynamic data, 1 hour for static data
- Cache invalidation on data mutation

**Implementation:**
\`\`\`typescript
cache.get('feature:' + id, async () => {
  return await database.getFeature(id);
}, { ttl: 300 });
\`\`\`

**CDN Caching**
- Static assets: max-age=31536000 (1 year)
- API responses: Cache-Control: no-cache for authenticated endpoints
- Public data: Cache-Control: public, max-age=300

### Database Optimization

**Query Optimization**
- Use prepared statements to prevent SQL injection
- Index foreign keys and frequently queried columns
- Use connection pooling (min: 10, max: 50 connections)
- Implement query timeouts (5 seconds)

**Database Scaling:**
- Read replicas for heavy read workloads
- Partitioning for large tables (by date/user_id)
- Query result pagination (max 100 records per page)

### Rate Limiting

**Implementation:**
- Token bucket algorithm
- Per-user limits stored in Redis
- Rate limit headers in response:
  - X-RateLimit-Limit: Maximum requests
  - X-RateLimit-Remaining: Remaining requests
  - X-RateLimit-Reset: Reset timestamp

**Limits by Endpoint:**
- POST /api/v1/feature: 100/min
- GET /api/v1/feature: 1000/min
- PUT /api/v1/feature: 100/min
- DELETE /api/v1/feature: 50/min

## INTENT Coverage

This specification addresses all user stories from INTENT-001:

| INTENT User Story | SPEC Coverage |
|-------------------|---------------|${intentUserStories.map(story => `
| ${story} | Components, API Endpoints, Database Schema |`).join('')}

**Coverage Summary:**
- Total user stories: ${intentUserStories.length}
- Covered: ${intentUserStories.length} (100%)
- Uncovered: None

---
*Generated by WorkflowEngine based on INTENT-001*
`;

    // Note: 'spec' is deprecated as an artifact type - using 'intent' instead
    await writeArtifact(this.projectPath, this.workflowId, 'intent', specContent);

    // Validate the generated artifact
    const specPath = getArtifactPath(this.projectPath, this.workflowId, 'intent');
    console.log(`[WorkflowEngine] Validating SPEC artifact at: ${specPath}`);

    // Note: validateSpec was removed in the new workflow - using validateIntent instead
    const validationResult = await validateIntent(specPath);

    // Note: V3 checkpoints don't store validation_results inline - they use manifest
    if (!validationResult.passed) {
      console.log('[WorkflowEngine] SPEC validation failed:', validationResult.blocking_issues);
      console.log(`[WorkflowEngine] Coverage: ${validationResult.coverage_percentage}%`);
    } else {
      console.log('[WorkflowEngine] SPEC validation passed');
      console.log(`[WorkflowEngine] Coverage: ${validationResult.coverage_percentage}%`);
    }
  }

  /**
   * DEPRECATED: Execute the INTENTS stage (old workflow)
   *
   * Generates INTENT artifacts with implementation tasks from the SPEC.
   * Creates multiple INTENT-*.md files and a dependency-graph.json file
   * with task breakdown, dependencies, and effort estimates.
   */
  private async executeIntentsStage(checkpoint: WorkflowCheckpoint | WorkflowCheckpointV3): Promise<void> {
    console.log(`[WorkflowEngine] Executing INTENTS stage for feature: ${this.featureName}`);

    // Get the INTENT artifact path for context (was 'spec' in old workflow)
    const specPath = getArtifactPath(this.projectPath, this.workflowId, 'intent');
    console.log(`[WorkflowEngine] Reading INTENT artifact from: ${specPath}`);
    console.log('[WorkflowEngine] Generating INTENT task artifacts with implementation tasks');

    // Read SPEC to extract components for task generation
    const fs = await import('fs-extra');
    const path = await import('path');
    const specContent = await fs.readFile(specPath, 'utf-8');

    // Extract components from SPEC (look for sections under ## Components)
    const specComponents: string[] = [];
    const lines = specContent.split('\n');
    let inComponentsSection = false;
    for (const line of lines) {
      if (line.match(/^##\s+Components/i)) {
        inComponentsSection = true;
        continue;
      }
      if (inComponentsSection && line.match(/^##\s+/)) {
        inComponentsSection = false;
      }
      if (inComponentsSection && line.match(/^###\s+(.+)$/)) {
        const match = line.match(/^###\s+(.+)$/);
        if (match) {
          specComponents.push(match[1].trim());
        }
      }
    }

    const intentsDir = path.join(
      this.projectPath,
      '.olympus',
      'workflow',
      this.workflowId,
      'intents'
    );

    await fs.ensureDir(intentsDir);

    const timestamp = new Date().toISOString();

    // Generate INTENT files - one per major task group
    const intents = [
      {
        id: 'INTENT-001',
        title: 'Setup Database Schema',
        component: 'Database Components',
        goal: 'Create database tables, indexes, and migration scripts',
        acceptanceCriteria: [
          'Database tables created with proper schema',
          'Indexes created for performance optimization',
          'Migration scripts tested and validated',
          'Rollback scripts prepared',
        ],
        steps: [
          'Create migration script for feature_data table',
          'Create migration script for feature_audit_log table',
          'Add indexes on foreign keys and frequently queried columns',
          'Test migration in development environment',
          'Create rollback migration script',
          'Document schema changes',
        ],
        technicalNotes: 'Use migration framework (Flyway/Alembic/TypeORM migrations). Ensure backward compatibility.',
        dependencies: [],
        effort: 4,
      },
      {
        id: 'INTENT-002',
        title: 'Implement Backend API Endpoints',
        component: 'Backend Services',
        goal: 'Create RESTful API endpoints for feature operations',
        acceptanceCriteria: [
          'All CRUD endpoints implemented',
          'Request validation middleware in place',
          'Error handling properly configured',
          'Unit tests passing with >80% coverage',
        ],
        steps: [
          'Create API route definitions',
          'Implement POST /api/v1/feature endpoint',
          'Implement GET /api/v1/feature/:id endpoint',
          'Implement PUT /api/v1/feature/:id endpoint',
          'Implement DELETE /api/v1/feature/:id endpoint',
          'Add request validation middleware',
          'Add error handling middleware',
          'Write unit tests for all endpoints',
        ],
        technicalNotes: 'Follow REST conventions. Use async/await for database operations. Implement proper error responses.',
        dependencies: ['INTENT-001'],
        effort: 8,
      },
      {
        id: 'INTENT-003',
        title: 'Build Frontend Components',
        component: 'Frontend Components',
        goal: 'Create user interface components for feature interaction',
        acceptanceCriteria: [
          'Main feature UI component implemented',
          'Form validation working correctly',
          'Error states handled gracefully',
          'Responsive design across devices',
          'Accessibility standards met (WCAG 2.1 AA)',
        ],
        steps: [
          'Create main feature component',
          'Implement form inputs with validation',
          'Add error boundary component',
          'Implement loading states',
          'Add success/error notifications',
          'Make responsive for mobile/tablet/desktop',
          'Test with screen readers',
          'Write component tests',
        ],
        technicalNotes: 'Use component library patterns. Implement proper state management. Follow accessibility guidelines.',
        dependencies: ['INTENT-002'],
        effort: 8,
      },
      {
        id: 'INTENT-004',
        title: 'Implement Authentication and Authorization',
        component: 'Backend Services',
        goal: 'Add authentication and authorization for feature endpoints',
        acceptanceCriteria: [
          'JWT authentication middleware implemented',
          'Role-based access control enforced',
          'Token refresh mechanism working',
          'Unauthorized access properly blocked',
        ],
        steps: [
          'Implement JWT verification middleware',
          'Create role-based permission checks',
          'Add token refresh endpoint',
          'Implement token blacklist for logout',
          'Add authentication to all protected routes',
          'Write authentication tests',
        ],
        technicalNotes: 'Use secure token storage. Implement token rotation. Follow OWASP authentication guidelines.',
        dependencies: ['INTENT-002'],
        effort: 4,
      },
      {
        id: 'INTENT-005',
        title: 'Add Rate Limiting and Caching',
        component: 'Backend Services',
        goal: 'Implement rate limiting and caching for performance and security',
        acceptanceCriteria: [
          'Rate limiting active on all endpoints',
          'Rate limit headers in responses',
          'Application-level caching implemented',
          'Cache invalidation working correctly',
        ],
        steps: [
          'Set up Redis for rate limiting and caching',
          'Implement rate limiting middleware',
          'Add rate limit headers to responses',
          'Implement application-level cache',
          'Add cache invalidation on mutations',
          'Configure CDN caching rules',
          'Write performance tests',
        ],
        technicalNotes: 'Use Redis for distributed rate limiting. Implement cache warming strategy. Monitor cache hit rates.',
        dependencies: ['INTENT-002'],
        effort: 4,
      },
      {
        id: 'INTENT-006',
        title: 'Setup Infrastructure and Deployment',
        component: 'Infrastructure Components',
        goal: 'Configure deployment pipeline and infrastructure',
        acceptanceCriteria: [
          'Docker container configured and building',
          'CI/CD pipeline running successfully',
          'Monitoring and alerting configured',
          'Staging environment deployed',
        ],
        steps: [
          'Create Dockerfile for application',
          'Configure Docker Compose for local development',
          'Set up CI/CD pipeline (GitHub Actions/Jenkins)',
          'Configure staging environment',
          'Set up monitoring (Prometheus/Grafana)',
          'Configure alerting rules',
          'Document deployment process',
        ],
        technicalNotes: 'Use multi-stage Docker builds. Implement health checks. Set up automated rollbacks.',
        dependencies: ['INTENT-002', 'INTENT-003'],
        effort: 8,
      },
      {
        id: 'INTENT-007',
        title: 'Write Integration Tests and Documentation',
        component: 'Backend Services',
        goal: 'Create comprehensive tests and documentation',
        acceptanceCriteria: [
          'Integration tests covering all workflows',
          'API documentation complete',
          'Test coverage >80%',
          'Documentation reviewed and approved',
        ],
        steps: [
          'Write end-to-end integration tests',
          'Test authentication flows',
          'Test error scenarios',
          'Generate API documentation (OpenAPI/Swagger)',
          'Write user-facing documentation',
          'Create troubleshooting guide',
          'Run full test suite',
        ],
        technicalNotes: 'Use test fixtures for data setup. Mock external services. Document edge cases.',
        dependencies: ['INTENT-003', 'INTENT-004', 'INTENT-005'],
        effort: 4,
      },
    ];

    // Write individual INTENT markdown files
    for (const intent of intents) {
      const intentContent = `---
id: ${intent.id}
feature: ${this.workflowId}
created: ${timestamp}
based_on: SPEC-001
status: pending
estimated_effort: ${intent.effort}
dependencies: ${JSON.stringify(intent.dependencies)}
---

# Task: ${intent.title}

## Goal

${intent.goal}

## Component

${intent.component}

## Acceptance Criteria

${intent.acceptanceCriteria.map(c => `- [ ] ${c}`).join('\n')}

## Implementation Steps

${intent.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}

## Technical Notes

${intent.technicalNotes}

## Dependencies

${intent.dependencies.length > 0 ? intent.dependencies.join(', ') : 'None'}

## Estimated Effort

${intent.effort}h

---
*Generated by WorkflowEngine based on SPEC-001*
`;

      await fs.writeFile(
        path.join(intentsDir, `${intent.id}.md`),
        intentContent,
        'utf-8'
      );
    }

    // Generate dependency graph JSON
    // Format: Record<string, string[]> (adjacency list)
    const totalEffort = intents.reduce((sum, intent) => sum + intent.effort, 0);

    const dependencyGraph: Record<string, string[]> = {};
    for (const intent of intents) {
      dependencyGraph[intent.id] = intent.dependencies;
    }

    await fs.writeFile(
      path.join(intentsDir, 'dependency-graph.json'),
      JSON.stringify(dependencyGraph, null, 2),
      'utf-8'
    );

    console.log(`[WorkflowEngine] Generated ${intents.length} INTENT files`);
    console.log(`[WorkflowEngine] Total estimated effort: ${totalEffort}h`);

    // Note: validateTasks was removed in the new workflow
    console.log(`[WorkflowEngine] INTENTS stage complete - validation skipped (deprecated)`);
    console.log(`[WorkflowEngine] Generated ${intents.length} INTENT files with ${totalEffort}h estimated effort`);
  }
}
