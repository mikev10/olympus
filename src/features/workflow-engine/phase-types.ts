/**
 * AIDLC Phase Type System
 *
 * Type definitions for the AI-Driven Development Life Cycle (AIDLC) phase-based workflow.
 * This system extends the existing stage-based workflow with four primary phases:
 * - Discovery: Initial exploration and scoping
 * - Inception: Requirements gathering and depth assessment
 * - Construction: Hierarchical design and implementation planning
 * - Operations: Deployment and monitoring
 *
 * Includes trust state management, risk tier classification, alignment verification,
 * and comprehensive artifact tracking for the phase-based methodology.
 */

// Import what we need from existing types
import type { WorkflowStage, WorkflowStatus, ArtifactReference, ValidationResult } from './types.js';

export type WorkflowPhase = 'discovery' | 'inception' | 'construction' | 'operations';

export type InceptionStage =
  | 'workspace-detection'      // greenfield/brownfield auto-detect
  | 'reverse-engineering'      // brownfield only — 6 artifacts
  | 'requirements-analysis'    // structured Q&A -> requirements.md
  | 'user-stories'             // conditional — personas.md + stories.md
  | 'workflow-planning'        // execution plan with Mermaid diagram
  | 'application-design'       // conditional — 4 design artifacts
  | 'units-generation';        // conditional — unit-of-work artifacts

export interface InceptionStageState {
  stage: InceptionStage;
  status: 'not_started' | 'in_progress' | 'completed' | 'skipped';
  started_at: string | null;
  completed_at: string | null;
  skip_reason: string | null;
  artifacts_generated: string[];
  questions_file: string | null;
  answers_received: boolean;
}

/**
 * Maps each workflow stage to its parent phase.
 * Used for phase progression tracking and gate routing.
 */
export const STAGE_PHASE_MAP: Record<WorkflowStage, WorkflowPhase | 'complete'> = {
  intent: 'inception',
  unit: 'construction',
  'code-generation': 'construction',
  complete: 'complete',
};

export type TrustLevel = 0 | 1 | 2 | 3;

export interface TransitionMetadata {
  gateNumber: number;
  artifactId: string;
  artifactType: string;
}

export interface TrustState {
  current_level: TrustLevel;
  total_transitions: number;
  rejection_count: number;
  rejection_rate: number;
  incident_count: number;
  last_level_change: string | null;
  level_history: TrustLevelChange[];
  // Per-code-generation tracking fields
  consecutive_rejections: number;
  transition_history: Array<{
    success: boolean;
    rejected: boolean;
    metadata?: TransitionMetadata;
    timestamp: string;
  }>;
}

export interface TrustLevelChange {
  from: TrustLevel;
  to: TrustLevel;
  reason: string;
  timestamp: string;
}

export type RiskTier = 1 | 2 | 3;

export interface RiskTierClassification {
  tier: RiskTier;
  rationale: string;
  factors: {
    reversibility: 'easy' | 'moderate' | 'difficult';
    blast_radius: 'isolated' | 'cross-cutting' | 'system-wide';
    data_sensitivity: 'none' | 'internal' | 'user-facing';
    compliance_impact: 'none' | 'minor' | 'major';
  };
  override_reason: string | null;
}

export interface PhaseState {
  status: WorkflowStatus;
  started_at: string | null;
  completed_at: string | null;
  gate_result: GateResult | null;
  gate_bypassed: boolean;
  bypass_reason: string | null;
}

export interface AlignmentVerificationResult {
  conformance_score: number;
  coverage_percentage: number;
  missing_items: string[];
  passed: boolean;
}

export interface AlignmentValidationResult {
  alignment_score: number;
  alignment_questions: AlignmentQuestion[];
  passed: boolean;
}

export interface AlignmentQuestion {
  question: string;
  answer: string | null;
  answered_by: 'human' | 'ai' | null;
  passed: boolean | null;
}

export interface AlignmentCheck {
  source_artifact_id: string;
  target_artifact_id: string;
  verification: AlignmentVerificationResult;
  validation: AlignmentValidationResult;
  alignment_passed: boolean;
  checked_at: string;
}

export interface ContentCheck {
  name: string;
  passed: boolean;
  severity: 'error' | 'warning' | 'info';
  remediation?: string;
}

export interface SecurityFinding {
  id: string;
  category: 'hardcoded-secret' | 'sql-injection' | 'xss' | 'dependency-cve' | 'risky-pattern';
  severity: 'critical' | 'warning' | 'info';
  message: string;
  file?: string;
  line?: number;
  pattern?: string;
  suppressed?: boolean;
  suppress_reason?: string;
}

export interface SecurityScanResult {
  status: 'completed' | 'failed' | 'skipped';
  findings: SecurityFinding[];
  scanned_files: number;
  scan_duration_ms: number;
  report_path: string;
}

export interface RecreationReadinessResult {
  overall_score: number;
  passed: boolean;
  mode: 'advisory' | 'blocking';
  dimensions: {
    requirements_coverage: number;
    data_model_completeness: number;
    implementation_guidance: number;
    test_coverage_documentation: number;
    bootstrap_capability: number;
  };
  remediation?: string[];
}

export interface QualityScorecardData {
  tests_total: number;
  tests_passed: number;
  tests_failed: number;
  coverage_percentage: number | null;
  security_findings: { critical: number; warning: number; info: number };
  units_completed: number;
  units_total: number;
  regressions_count: number;
  gate_bypass_count: number;
  data_sources: Record<string, 'connected' | 'pending'>;
  phases_completed?: number;
  time_per_phase?: { inception_ms: number; construction_ms: number; operations_ms: number };
  validation_pass_rate?: number;
  rework_count?: number;
  regressions_fixed?: number;
  average_recreation_readiness_score?: number | null;
}

export interface GateResult {
  passed: boolean;
  approved_by: 'human' | 'auto' | 'trust' | null;
  approved_at: string | null;
  feedback: string | null;
  verification: AlignmentVerificationResult;
  validation: AlignmentValidationResult;
  content_checks?: ContentCheck[];
}

export interface DepthAssessment {
  clarity: number;
  complexity: number;
  scope: number;
  risk: number;
  context: number;
  preferences: number;
  total_score: number;
  recommended_depth: 'minimal' | 'standard' | 'comprehensive';
  skip_units: boolean;
  risk_tier: RiskTierClassification;
}

export interface RiskEntry {
  id: string;
  description: string;
  likelihood: 'low' | 'medium' | 'high';
  impact: 'low' | 'medium' | 'high';
  mitigation: string;
  status: 'open' | 'mitigated' | 'accepted' | 'closed';
  owner: string;
}

export interface HierarchicalNode {
  id: string;
  type: 'intent' | 'unit' | 'code-generation' | 'bolt';
  title: string;
  parent_id: string | null;
  children_ids: string[];
  status: 'pending' | 'in_progress' | 'complete' | 'blocked';
  assigned_agent: string | null;
  estimated_effort: number;
}

// Manifest types
export interface ManifestSchema {
  schema_version: '2.0.0';
  workflow_id: string;
  feature_name: string;
  created_at: string;
  updated_at: string;
  phases: Record<WorkflowPhase, PhaseState>;
  depth_assessment: DepthAssessment | null;
  artifacts: ManifestArtifact[];
  links: ArtifactLink[];
  risks: RiskEntry[];
  gate_audit: GateAuditEntry[];
  metrics: MethodologyMetrics | null;
  alignment_checks: AlignmentCheck[];
  risk_tier: RiskTierClassification | null;
}

export interface ManifestArtifact {
  id: string;
  type: string;
  phase: WorkflowPhase;
  stage: WorkflowStage;
  path: string;
  created_at: string;
  updated_at: string;
  validation_passed: boolean | null;
  write_complete: boolean;
  checksum: string | null;
  contract_status: 'draft' | 'active' | 'fulfilled' | 'violated' | 'stale';
  contract_version: number;
  stale_reason: string | null;
  // Code generation audit trail fields
  executedBy?: string | null;
  reviewedBy?: string | null;
  statusHistory?: Array<{ status: string; timestamp: string }>;
  review_status?: 'pending_review' | 'reviewed' | 'approved' | 'revision_requested';
}

export interface ArtifactLink {
  source_id: string;
  target_id: string;
  link_type: 'derives' | 'implements' | 'validates' | 'traces';
}

export interface GateAuditEntry {
  phase: WorkflowPhase;
  timestamp: string;
  action: 'approved' | 'rejected' | 'bypassed';
  actor: 'human' | 'config' | 'flag' | 'trust';
  reason: string | null;
  content_checks?: ContentCheck[];
}

export interface MethodologyMetrics {
  inception_duration_ms: number | null;
  construction_duration_ms: number | null;
  operations_duration_ms: number | null;
  total_artifacts: number;
  validation_pass_rate: number;
  gate_bypass_count: number;
  rework_count: number;
  depth_assessment_accuracy: number | null;
}

// Checkpoint v2 type
export interface WorkflowCheckpointV2 {
  schema_version: '2.0.0';
  workflow_id: string;
  feature_name: string;
  created_at: string;
  updated_at: string;

  // Phase-based tracking (coexists with stage-based)
  current_phase: WorkflowPhase;
  phases: Record<WorkflowPhase, PhaseState>;

  // Stage-based tracking (unchanged from v1)
  current_stage: WorkflowStage;
  status: WorkflowStatus;
  artifacts: Record<WorkflowStage, ArtifactReference | null>;
  validation_results: Record<WorkflowStage, ValidationResult | null>;

  // Preserved from v1
  resume_context?: any;

  // AIDLC extensions
  manifest_path: string | null;
  trust_state_path: string | null;
  risk_tier: RiskTierClassification | null;
}

// Checkpoint v3 type
export interface WorkflowCheckpointV3 {
  schema_version: '3.0.0';
  workflow_id: string;
  feature_name: string;
  current_phase: WorkflowPhase;
  current_stage: WorkflowStage;
  status: WorkflowStatus;
  phases: Record<WorkflowPhase, PhaseState>;
  manifest_path: string;
  trust_state_path: string;
  depth_score?: number;
  risk_tier?: number;
  active_unit_id?: string;
  active_code_plan_path?: string;
  execution_mode?: 'ascent' | 'olympus' | 'ultrawork' | 'manual';
  interview_progress?: {
    stage: 'intent';
    questions_asked: number;
    draft_artifact_path?: string;
  };
  resume_context?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  workflow_routing_path?: string;
  pathway_type?: PathwayType;
  skipped_phases?: WorkflowPhase[];
  origin?: 'hook-init' | 'ai-initialized' | 'manual';
  // Physical archival fields — distinct from status:'archived' which means aborted-in-place (BR-004)
  archived_at?: string;
  archived_path?: string;
  bug_description?: string;
  code_plan_path?: string;
  plan_steps_total?: number;
  plan_steps_completed?: number;
  inception_stages?: Record<InceptionStage, InceptionStageState>;
  current_inception_stage?: InceptionStage;
  construction_units?: Record<string, ConstructionUnitProgress>;
  /** All bolt progress records, keyed by bolt ID (e.g. 'BOLT-001'). */
  construction_bolts?: Record<string, ConstructionBoltProgress>;
  /** ID of the bolt currently executing. Null when no bolt is active. */
  active_bolt_id?: string | null;
  /** Stage within the active bolt currently executing. Null when no bolt is active. */
  active_bolt_stage?: BoltExecutionStage | null;
  deepinit_status?: 'skipped' | 'completed' | 'pre-existing' | 'suggested' | 'not_applicable' | 'not_detected' | 'detected';
  original_pathway_type?: PathwayType;
  original_depth_score?: number;
  pathway_override?: PathwayType;
  depth_override?: number;
  smoke_test?: SmokeTestResult;
}

export type PathwayType = 'greenfield' | 'brownfield-enhancement' | 'brownfield-refactor' | 'bugfix' | 'optimization';

export interface WorkflowRoutingStage {
  phase: WorkflowPhase;
  stage: string;
  included: boolean;
  rationale: string;
}

export interface WorkflowRoutingPlan {
  pathway: PathwayType;
  risk_assessment: 'LOW' | 'MEDIUM' | 'HIGH';
  risk_tier: RiskTier;
  phases: Record<WorkflowPhase, { included: boolean; rationale: string }>;
  stages: WorkflowRoutingStage[];
  estimated_bolts: number;
  estimated_depth: 'minimal' | 'standard' | 'comprehensive';
  generated_at: string;
  approved_at: string | null;
  approved_by: 'human' | null;
}

export interface CeremonyConfig {
  ceremony_mode: boolean;
  pause_between_steps: boolean;
  output_format: 'standard' | 'presentation';
  review_prompt_style: 'inline' | 'explicit';
}

export type ConstructionDesignStage =
  | 'functional-design'
  | 'nfr-requirements'
  | 'nfr-design'
  | 'infrastructure-design'
  | 'code-generation'
  | 'test-generation';

/** Lifecycle state machine for a bolt (BR-003). */
export type BoltStatus =
  | 'planned'
  | 'in_progress'
  | 'built'
  | 'in_review'
  | 'done'
  | 'failed';

/** The four sequential stages within a bolt's execution lifecycle. */
export type BoltExecutionStage =
  | 'elaboration'
  | 'code_generation'
  | 'build_and_test'
  | 'review';

/** Per-stage tracking within a bolt. Adds started_at for duration tracking. */
export interface BoltStageProgress {
  /** Execution state of this stage. */
  status: 'not_started' | 'in_progress' | 'completed' | 'skipped' | 'failed';

  /** ISO 8601 timestamp when the stage began. Null if not yet started. */
  started_at: string | null;

  /** ISO 8601 timestamp when the stage finished. Null if not yet completed. */
  completed_at: string | null;

  /** Number of times this stage has failed and been retried. */
  failure_count: number;

  /** Last error message if status is 'failed'. Null otherwise. */
  last_error: string | null;

  /** Relative path to the stage's primary artifact (e.g. spec.md). Null if not produced. */
  artifact_path: string | null;
}

/** Union of all error codes thrown by BoltSpecValidator. */
export type BoltValidationErrorCode =
  | 'MAX_PER_UNIT_EXCEEDED'
  | 'MAX_TOTAL_EXCEEDED'
  | 'MISSING_REQUIRED_FIELD'
  | 'INVALID_ID_FORMAT'
  | 'INVALID_SEQUENCE';

/**
 * The primary bolt definition. Extends HierarchicalNode using the 'bolt'
 * discriminant, adding bolt-specific fields (FR-016).
 */
export interface BoltSpec extends HierarchicalNode {
  /** Discriminant — always 'bolt'. Narrows HierarchicalNode.type. */
  type: 'bolt';

  /** ID of the parent unit (e.g. 'UNIT-001'). Links bolt to its unit. */
  parent_unit_id: string;

  /** Execution order within the parent unit. Must be a positive integer. */
  sequence: number;

  /** Human-readable description of what this bolt accomplishes. Required. */
  scope: string;

  /**
   * Verifiable outcomes that define bolt completion. Minimum 1 required.
   * Each entry is a complete, testable statement.
   */
  acceptance_criteria: string[];

  /**
   * Relative project paths this bolt is expected to modify or create.
   * Used for impact analysis and reviewer guidance.
   */
  target_files: string[];

  /**
   * IDs of bolts that must complete before this bolt begins.
   * Defined here but not enforced for parallel execution — informational only
   * in the current implementation.
   */
  dependencies: string[];

  /**
   * Elaboration depth target on the 1-11 scale, inherited from the parent unit.
   * Determines how many elaboration stages are executed:
   * SHALLOW (0 stages) = depth_target 1-4,
   * MEDIUM (2 stages) = depth_target 5-7,
   * DEEP (4 stages) = depth_target 8-11.
   */
  depth_target: number;

  /**
   * When true, the elaboration stage is skipped for this bolt.
   * Eligible when depth_target <= 4 or pathway is 'bugfix'.
   */
  express_mode: boolean;

  /** Estimated duration in hours. Sourced from bolt spec frontmatter. */
  estimated_effort_hours: number;

  /** Requirement IDs this bolt satisfies (e.g. ['FR-1', 'FR-3']). */
  requirements?: string[];

  /** Story IDs this bolt satisfies (e.g. ['S-001', 'S-004']). */
  stories?: string[];
}

/**
 * Runtime tracking record for a bolt's execution. Stored in
 * WorkflowCheckpointV3.construction_bolts keyed by bolt ID (FR-022).
 */
export interface ConstructionBoltProgress {
  /** Global bolt identifier (e.g. 'BOLT-001'). */
  bolt_id: string;

  /** ID of the parent unit this bolt belongs to. */
  parent_unit_id: string;

  /** Fine-grained lifecycle status (BR-003). */
  status: BoltStatus;

  /** Per-stage execution state. All four stages are always present. */
  stages: Record<BoltExecutionStage, BoltStageProgress>;

  /** Total number of times this bolt has failed across all attempts. */
  failure_count: number;

  /** Most recent error message. Null if no failure has occurred. */
  last_error: string | null;

  /**
   * Quality score from the review stage (0-100). Null until review completes.
   * Populated by the review agent after the 'review' stage finishes.
   */
  review_score: number | null;

  /**
   * Agent or user identifier who acknowledged a failed bolt (FR-020).
   * Null until acknowledgment occurs.
   */
  acknowledged_by: string | null;

  /**
   * ISO 8601 timestamp of failure acknowledgment (FR-020).
   * Null until acknowledgment occurs.
   */
  acknowledged_at: string | null;
}

/**
 * Typed error thrown by BoltSpecValidator.validate(). Extends the built-in
 * Error class so it is caught by generic catch (e: Error) handlers while
 * still carrying a machine-readable code.
 */
export class BoltValidationError extends Error {
  readonly code: BoltValidationErrorCode;

  constructor(code: BoltValidationErrorCode, message: string) {
    super(message);
    this.name = 'BoltValidationError';
    this.code = code;
  }
}

export type ValidatorStatus = 'not_started' | 'in_progress' | 'completed' | 'skipped';

export type ValidatorFindingSeverity = 'error' | 'warning' | 'info';

export type ValidatorResultStatus = 'passed' | 'warned' | 'failed' | 'skipped' | 'timeout';

export interface Finding {
  id: string;
  severity: ValidatorFindingSeverity;
  category: string;
  message: string;
  location?: {
    file: string;
    line?: number;
    testName?: string;
  };
}

export interface ValidatorResult {
  status: ValidatorResultStatus;
  findings: Finding[];
  artifactPath: string;
}

export interface ConstructionUnitProgress {
  unitId: string;
  stages: Record<ConstructionDesignStage, {
    status: 'not_started' | 'in_progress' | 'completed' | 'skipped' | 'failed';
    artifact_path: string | null;
    completed_at: string | null;
    failure_count: number;
    last_error: string | null;
  }>;
  code_plan_path: string | null;
  code_generation_status: 'not_started' | 'planning' | 'awaiting_approval' | 'generating' | 'completed';
  tests_total?: number;
  tests_passed?: number;
  tests_failed?: number;
  test_framework?: string;
  regressions_count?: number;
  flaky_count?: number;
  test_generation_status?: 'not_started' | 'in_progress' | 'completed' | 'skipped';
  quality_validation_status?: ValidatorStatus;
  mutation_validation_status?: ValidatorStatus;
  traceability_status?: ValidatorStatus;
  contract_validation_status?: ValidatorStatus;
  coverage_status?: ValidatorStatus;
  coverage_percentage?: number | null;
  critical_gap_count?: number;
  security_scan_status?: ValidatorStatus;
  security_findings_critical?: number;
  security_findings_warning?: number;
  security_findings_info?: number;
  feature_doc_status?: 'not_started' | 'in_progress' | 'completed' | 'skipped';
  feature_doc_path?: string | null;
  doc_generation_agent?: string;
  doc_generation_prompt?: string;
  recreation_readiness_score?: number | null;
  recreation_readiness_dimensions?: Record<string, number> | null;
  adr_count?: number;
  adr_entries?: Array<{ path: string; title: string; number: number }>;
  impact_scan_status?: 'not_started' | 'completed' | 'skipped';
  impact_scan_report_path?: string | null;
  architecture_model_status?: string;
  recreation_readiness_override?: boolean;
  recreation_readiness_override_rationale?: string | null;
}

export interface UserStory {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
}

export interface UnitDefinition {
  id: string;
  name: string;
  description: string;
  scope: string;
}

/**
 * Baseline snapshot of all test results captured before a code-generation unit runs.
 * This is a frozen Group 1B contract surface — do NOT modify field names or types.
 */
export interface RegressionBaseline {
  tests: Array<{
    name: string;
    filePath: string;
    status: 'passed' | 'failed' | 'skipped';
    duration_ms: number;
  }>;
  captured_at: string;
  test_command: string;
  framework: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
}

export type RegressionCategory =
  | 'legitimate_regression'
  | 'intentional_change'
  | 'flaky'
  | 'pre_existing_failure';

export interface RegressionReport {
  workflow_id: string;
  unit_id: string;
  baseline_captured_at: string;
  compared_at: string;
  failures: Array<{
    test_name: string;
    file_path: string;
    category: RegressionCategory;
    rationale: string;
  }>;
  total_regressions: number;
  legitimate_regressions: number;
}

export interface TestFrameworkInfo {
  name: string;
  testCommand: string;
  configPath?: string;
}

/**
 * Build-level smoke test result aggregating all per-unit test results.
 * Written to checkpoint at the end of the Construction phase.
 */
export interface SmokeTestResult {
  status: 'passed' | 'failed' | 'not_run';
  tests_total: number;
  tests_passed: number;
  tests_failed: number;
  tests_skipped: number;
  regressions_total: number;
  flaky_total: number;
  units_tested: number;
  units_passed: number;
  report_path: string | null;
  completed_at: string | null;
}
