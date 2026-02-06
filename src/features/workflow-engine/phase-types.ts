/**
 * ODLC Phase Type System
 *
 * Type definitions for the Olympus Development Life Cycle (ODLC) phase-based workflow.
 * This system extends the existing stage-based workflow with three primary phases:
 * - Vision: Requirements gathering and depth assessment
 * - Forge: Hierarchical design and implementation planning
 * - Summit: Deployment and monitoring
 *
 * Includes trust state management, risk tier classification, alignment verification,
 * and comprehensive artifact tracking for the phase-based methodology.
 */

// Import what we need from existing types
import type { WorkflowStage, WorkflowStatus, ArtifactReference, ValidationResult } from './types.js';

export type WorkflowPhase = 'vision' | 'forge' | 'summit';
export type ForgeStage = 'units' | 'design' | 'build';
// Note: ForgeStage 'build' refers to the Forge construction stage, not npm build.
export type SummitStage = 'deploy' | 'monitor';
export type AnyStage = WorkflowStage | ForgeStage | SummitStage;

export type TrustLevel = 0 | 1 | 2 | 3;

export interface TrustState {
  current_level: TrustLevel;
  total_transitions: number;
  rejection_count: number;
  rejection_rate: number;
  incident_count: number;
  last_level_change: string | null;
  level_history: TrustLevelChange[];
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
  skip_forge: boolean;
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
  type: 'intent' | 'unit' | 'bolt';
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
  stage: AnyStage;
  path: string;
  created_at: string;
  updated_at: string;
  validation_passed: boolean | null;
  write_complete: boolean;
  checksum: string | null;
  contract_status: 'draft' | 'active' | 'fulfilled' | 'violated' | 'stale';
  contract_version: number;
  stale_reason: string | null;
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
  vision_duration_ms: number | null;
  forge_duration_ms: number | null;
  summit_duration_ms: number | null;
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

  // ODLC extensions
  manifest_path: string | null;
  trust_state_path: string | null;
  risk_tier: RiskTierClassification | null;
}
