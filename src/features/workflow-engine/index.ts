/**
 * Workflow Engine Module
 *
 * Provides structured workflow system for plan execution with:
 * - IDEA → PRD → SPEC → INTENTS stage progression
 * - Checkpoint persistence and resume capability
 * - Validation gates (Momus, Metis reviews)
 * - Artifact generation and management
 */

// Types
export type {
  WorkflowStage,
  WorkflowStatus,
  ArtifactReference,
  ValidationResult,
  RequirementMapping,
  WorkflowCheckpoint,
  IntentTask,
  IntentNode,
  DependencyGraph,
} from './types.js';

// ODLC Phase Types
export type {
  WorkflowPhase,
  ForgeStage,
  SummitStage,
  AnyStage,
  TrustLevel,
  TrustState,
  TrustLevelChange,
  RiskTier,
  RiskTierClassification,
  PhaseState,
  AlignmentVerificationResult,
  AlignmentValidationResult,
  AlignmentQuestion,
  AlignmentCheck,
  GateResult,
  DepthAssessment,
  RiskEntry,
  HierarchicalNode,
  ManifestSchema,
  ManifestArtifact,
  ArtifactLink,
  GateAuditEntry,
  MethodologyMetrics,
  WorkflowCheckpointV2,
} from './phase-types.js';

// Checkpoint persistence
export {
  saveCheckpoint,
  loadCheckpoint,
  listWorkflows,
  deleteWorkflow,
} from './checkpoint.js';

// Artifact management
export {
  ensureWorkflowDir,
  getArtifactPath,
  writeArtifact,
  readArtifact,
  generateDependencyGraph,
  validateDependencyGraph,
  getExecutionOrder,
  linkMasterPlan,
} from './artifacts.js';

// Execution and task tracking
export type { TaskStatus, TaskStatusRecord } from './execution.js';
export {
  updateTaskStatus,
  getTaskStatus,
  getBlockedTasks,
  getNextReadyTask,
  updateMasterPlanProgress,
} from './execution.js';

// Validation
export { validateIdea, validatePrd, validateSpec, validateTasks } from './validation.js';

// Engine
export { WorkflowEngine, WorkflowStatusResponse } from './engine.js';
