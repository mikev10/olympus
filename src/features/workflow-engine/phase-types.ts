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

export interface GateResult {
  passed: boolean;
  approved_by: 'human' | 'auto' | 'trust' | null;
  approved_at: string | null;
  feedback: string | null;
  verification: AlignmentVerificationResult;
  validation: AlignmentValidationResult;
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
  type: 'intent' | 'unit' | 'code-generation';
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
  code_plan_path?: string;
  plan_steps_total?: number;
  plan_steps_completed?: number;
  inception_stages?: Record<InceptionStage, InceptionStageState>;
  current_inception_stage?: InceptionStage;
  construction_units?: Record<string, ConstructionUnitProgress>;
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
  estimated_code_generations: number;
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

export type ConstructionDesignStage = 'functional-design' | 'nfr-requirements' | 'nfr-design' | 'infrastructure-design' | 'code-generation';

export interface ConstructionUnitProgress {
  unitId: string;
  stages: Record<ConstructionDesignStage, {
    status: 'not_started' | 'in_progress' | 'completed' | 'skipped';
    artifact_path: string | null;
    completed_at: string | null;
  }>;
  code_plan_path: string | null;
  code_generation_status: 'not_started' | 'planning' | 'awaiting_approval' | 'generating' | 'completed';
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
