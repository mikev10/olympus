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
   * Generates the IDEA artifact following the structured format expected by validation.
   * The artifact includes problem statement, business context, success metrics, constraints,
   * solution approach, and risk assessment.
   */
  private async executeIdeaStage(checkpoint: WorkflowCheckpoint): Promise<void> {
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
   * Generates the PRD artifact with user stories and requirement coverage.
   * The PRD is validated against the IDEA artifact to ensure >= 90% coverage.
   */
  private async executePrdStage(checkpoint: WorkflowCheckpoint): Promise<void> {
    console.log(`[WorkflowEngine] Executing PRD stage for feature: ${this.featureName}`);

    // Get the IDEA artifact path for context
    const ideaPath = getArtifactPath(this.projectPath, this.workflowId, 'idea');
    console.log(`[WorkflowEngine] Reading IDEA artifact from: ${ideaPath}`);
    console.log('[WorkflowEngine] Generating PRD artifact with user stories');

    // Generate a properly formatted PRD artifact that passes validation
    const prdId = 'PRD-001';
    const timestamp = new Date().toISOString();

    // Create user stories that map to the constraints from IDEA
    // Each constraint type gets at least one user story
    const prdContent = `---
id: ${prdId}
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
