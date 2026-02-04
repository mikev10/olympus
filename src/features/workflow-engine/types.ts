/**
 * Workflow Engine Type Definitions
 *
 * Comprehensive types for the multi-stage workflow system that guides features
 * through idea → PRD → spec → intents → implementation stages.
 */

/**
 * Workflow stages representing the progression of feature development.
 * Each stage produces artifacts that feed into the next stage.
 *
 * - idea: Initial feature concept and requirements
 * - prd: Product Requirements Document
 * - spec: Technical specification
 * - intents: Intent files for implementation
 * - complete: All stages finished and validated
 */
export type WorkflowStage = 'idea' | 'prd' | 'spec' | 'intents' | 'complete';

/**
 * Current status of a workflow or workflow stage.
 *
 * - not_started: Stage hasn't begun yet
 * - in_progress: Currently working on this stage
 * - paused: Temporarily halted, can resume
 * - blocked: Cannot proceed due to validation failures or dependencies
 * - complete: Stage is finished and validated
 */
export type WorkflowStatus = 'not_started' | 'in_progress' | 'paused' | 'blocked' | 'complete';

/**
 * Reference to a workflow artifact (file produced by a stage).
 * Each stage creates artifacts that are tracked and validated.
 *
 * @example
 * {
 *   id: "IDEA-001",
 *   path: ".olympus/workflows/user-auth/idea.md",
 *   created_at: "2024-01-15T10:30:00Z",
 *   validation_passed: true
 * }
 */
export interface ArtifactReference {
  /** Unique artifact identifier (e.g., "IDEA-001", "PRD-001") */
  id: string;

  /** Relative path to the artifact file from project root */
  path: string;

  /** ISO timestamp when artifact was created */
  created_at: string;

  /** Whether this artifact passed validation */
  validation_passed: boolean;
}

/**
 * Results from validating a workflow stage's artifacts.
 * Used by reviewers (Momus, Metis) to assess completeness and quality.
 *
 * @example
 * {
 *   passed: true,
 *   coverage_percentage: 95,
 *   blocking_issues: [],
 *   reviewer: 'momus',
 *   timestamp: "2024-01-15T11:00:00Z"
 * }
 */
export interface ValidationResult {
  /** Overall validation pass/fail */
  passed: boolean;

  /** Percentage of requirements covered (0-100) */
  coverage_percentage: number;

  /** Critical issues that must be resolved before proceeding */
  blocking_issues: string[];

  /** Name of the agent that performed validation (e.g., 'momus', 'metis') */
  reviewer?: string;

  /** ISO timestamp when validation was performed */
  timestamp: string;
}

/**
 * Mapping between requirements across workflow stages.
 * Ensures traceability from initial idea through to implementation.
 *
 * @example
 * {
 *   requirement_id: "REQ-001",
 *   source_artifact: "IDEA-001",
 *   target_artifact: "PRD-001",
 *   covered: true,
 *   notes: "Authentication requirement fully specified in PRD section 3.2"
 * }
 */
export interface RequirementMapping {
  /** Unique requirement identifier */
  requirement_id: string;

  /** Source artifact ID (e.g., "IDEA-001") */
  source_artifact: string;

  /** Target artifact ID that should cover this requirement (e.g., "PRD-001") */
  target_artifact: string;

  /** Whether the requirement is adequately covered in the target */
  covered: boolean;

  /** Additional notes about the mapping or coverage */
  notes?: string;
}

/**
 * Complete workflow checkpoint representing the state of a feature's development.
 * This checkpoint is persisted to disk and can be resumed at any time.
 *
 * The checkpoint tracks:
 * - Which stage the workflow is currently in
 * - All artifacts produced at each stage
 * - Validation results for each stage
 * - Context needed to resume interrupted workflows
 *
 * @example
 * {
 *   schema_version: "1.0.0",
 *   workflow_id: "wf-2024-01-15-user-auth",
 *   feature_name: "user-authentication",
 *   created_at: "2024-01-15T10:00:00Z",
 *   updated_at: "2024-01-15T12:00:00Z",
 *   current_stage: "prd",
 *   status: "in_progress",
 *   artifacts: {
 *     idea: { id: "IDEA-001", path: ".olympus/workflows/user-auth/idea.md", ... },
 *     prd: null,
 *     spec: null,
 *     intents: null,
 *     complete: null
 *   },
 *   validation_results: {
 *     idea: { passed: true, coverage_percentage: 100, ... },
 *     prd: null,
 *     spec: null,
 *     intents: null,
 *     complete: null
 *   }
 * }
 */
export interface WorkflowCheckpoint {
  /** Version of the checkpoint format for migration compatibility */
  schema_version: string;

  /** Unique identifier for this workflow instance */
  workflow_id: string;

  /** Name of the feature being developed */
  feature_name: string;

  /** ISO timestamp when workflow was created */
  created_at: string;

  /** ISO timestamp of last update to this checkpoint */
  updated_at: string;

  /** Current stage of the workflow */
  current_stage: WorkflowStage;

  /** Overall status of the workflow */
  status: WorkflowStatus;

  /** Artifacts produced at each stage (null if stage not yet complete) */
  artifacts: Record<WorkflowStage, ArtifactReference | null>;

  /** Validation results for each stage (null if not yet validated) */
  validation_results: Record<WorkflowStage, ValidationResult | null>;

  /** Context data needed to resume interrupted workflows */
  resume_context?: any;
}
