/**
 * Workflow Engine Type Definitions
 *
 * Comprehensive types for the ODLC 4-stage pipeline:
 * idea → intent → unit → bolt → complete
 */

/**
 * Workflow stages representing the 4-level ODLC pipeline.
 * Each stage produces artifacts that feed into the next stage.
 *
 * - idea: Problem statement, personas, success metrics, constraints
 * - intent: Business requirements, technical spec, proposed UNITs
 * - unit: Module scope, interface contracts, acceptance criteria
 * - bolt: Smallest execution unit — domain design, logical design, implementation steps
 * - complete: All stages finished and validated
 */
export type WorkflowStage = 'idea' | 'intent' | 'unit' | 'bolt' | 'complete';

/**
 * Current status of a workflow or workflow stage.
 *
 * - not_started: Stage hasn't begun yet
 * - in_progress: Currently working on this stage
 * - paused: Temporarily halted, can resume
 * - blocked: Cannot proceed due to validation failures or dependencies
 * - complete: Stage is finished and validated
 * - awaiting_mode_selection: INTENT approved, user must choose execution mode
 * - awaiting_dev_review: Waiting for developer review (Risk Tier 3)
 * - deferred: Workflow paused with intent to return
 * - archived: Workflow archived (legacy or completed)
 */
export type WorkflowStatus = 'not_started' | 'in_progress' | 'paused' | 'blocked' | 'complete' | 'awaiting_mode_selection' | 'awaiting_dev_review' | 'deferred' | 'archived';

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
 * @deprecated Use WorkflowCheckpointV3 from phase-types.ts instead.
 * This interface represents the legacy v1 checkpoint format.
 * Retained for backward compatibility during migration only.
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

/**
 * Task definition for intent files.
 * Represents a single task with dependencies and effort estimates.
 *
 * @example
 * {
 *   id: "TASK-001",
 *   title: "Implement user authentication",
 *   component: "AuthService",
 *   estimated_effort: 5,
 *   dependencies: ["TASK-002", "TASK-003"]
 * }
 */
export interface IntentTask {
  /** Unique task identifier */
  id: string;

  /** Human-readable task title */
  title: string;

  /** Component or module this task belongs to */
  component: string;

  /** Estimated effort in story points or hours */
  estimated_effort: number;

  /** Array of task IDs this task depends on */
  dependencies: string[];
}

/**
 * Node in a dependency graph.
 * Represents a task without its dependency relationships.
 */
export interface IntentNode {
  /** Unique task identifier */
  id: string;

  /** Human-readable task title */
  title: string;

  /** Component or module this task belongs to */
  component: string;

  /** Estimated effort in story points or hours */
  estimated_effort: number;
}

/**
 * Dependency graph representing task relationships.
 * Used for topological sorting and cycle detection.
 *
 * @example
 * {
 *   nodes: [
 *     { id: "TASK-001", title: "Setup database", component: "DB", estimated_effort: 3 },
 *     { id: "TASK-002", title: "Create schema", component: "DB", estimated_effort: 2 }
 *   ],
 *   edges: [
 *     { from: "TASK-001", to: "TASK-002" }  // TASK-002 depends on TASK-001
 *   ]
 * }
 */
export interface DependencyGraph {
  /** Array of task nodes */
  nodes: IntentNode[];

  /** Array of directed edges (from -> to means 'to' depends on 'from') */
  edges: { from: string; to: string }[];
}
