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
  migrateCheckpointV1toV2,
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
  ensurePhaseWorkflowDir,
  isLegacyLayout,
  migrateLayout,
  getPhaseArtifactPath,
} from './artifacts.js';

// Manifest management
export {
  createManifest,
  loadManifest,
  saveManifest,
  registerArtifact,
  linkArtifacts,
  computeChecksum,
  detectStaleArtifacts,
  cascadeInvalidation,
  runAlignmentCheck,
  recoverManifest,
  normalizePath,
  updatePhaseStatus,
  addGateAuditEntry,
  getArtifactById,
  getArtifactsByPhase,
  updateContractStatus,
} from './manifest.js';

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

// Depth Assessment
export type { DepthFactors, RiskFactors } from './depth-assessment.js';
export {
  assessDepth,
  classifyRiskTier,
  assessDepthFromIdea,
  getDepthLabel,
  getRiskTierLabel,
} from './depth-assessment.js';

// Requirements
export type {
  Stakeholder,
  StakeholderMap,
  ConstraintCategory,
  ClassifiedConstraint,
  ConstraintClassification,
  TraceabilityLink,
  RequirementsTrace,
} from './requirements.js';
export {
  buildStakeholderMap,
  classifyConstraints,
  buildRequirementsTrace,
  getTraceabilitySummary,
} from './requirements.js';

// Risk Management
export type { RiskRegister, RiskSummary } from './risk-management.js';
export {
  extractRisks,
  createRiskRegister,
  loadRiskRegister,
  saveRiskRegister,
  addRisk,
  updateRisk,
  removeRisk,
  getRiskSummary,
  getRiskPriorityScore,
  getNextRiskId,
  formatRiskReport,
} from './risk-management.js';

// Trust
export {
  createDefaultTrustState,
  loadTrustState,
  saveTrustState,
  evaluateTrustLevel,
  recordTransition,
  resetTrust,
  shouldAutoAdvance,
  checkTrustReset,
} from './trust.js';

// Alignment
export type { TransitionType } from './alignment.js';
export {
  computeVerification,
  generateValidationQuestions,
  runAlignmentCheck as runFullAlignmentCheck,
  recordAlignmentResult,
  getConformanceThreshold,
} from './alignment.js';

// Forge Phase
export type {
  UnitSpec,
  BoltSpec,
  DecompositionTree,
} from './forge/decomposition.js';
export {
  parseIntentsFromDisk,
  decomposeIntentToUnits,
  decomposeUnitToBolts,
  buildDecompositionTree,
  getLeafBolts,
  getExecutableOrder,
} from './forge/decomposition.js';
export type {
  InterfaceContract,
  InterfaceField,
  DataFlowDiagram,
  DataFlowComponent,
  DataFlow,
  ComponentDesign,
  DesignArtifacts,
} from './forge/design.js';
export {
  generateInterfaceContracts,
  generateDataFlowDiagram,
  generateComponentDesign,
  validateDesign,
  writeDesignArtifacts,
  loadDesignArtifacts,
} from './forge/design.js';
export { ForgeExecutor, FORGE_STAGE_AGENT_MAP } from './forge/executor.js';
export type { ForgeProgress } from './forge/executor.js';
export {
  validateUnits,
  validateDesignArtifacts,
  validateBolt,
  validateForgePhase,
} from './forge/validation.js';

// Summit Phase
export type { SummitContext } from './summit/templates.js';
export {
  generateDeployGuide,
  generateRunbook,
  generateMonitoringConfig,
  generateReleaseNotes,
} from './summit/templates.js';

// Status Reporter
export type { WorkflowReport, PhaseProgressEntry } from './status-reporter.js';
export {
  generateWorkflowReport,
  computePhaseProgress,
  formatPhaseProgressBar,
  buildArtifactTree,
  buildRiskSummary,
  buildGateSummary,
  buildTrustDisplay,
  buildAlignmentSummary,
  buildDepthDisplay,
  buildRiskTierDisplay,
} from './status-reporter.js';

// Learning Bridge
export type {
  WorkflowEventType,
  WorkflowEvent,
  WorkflowContext,
  MethodologyPreference,
} from './learning-bridge.js';
export {
  captureWorkflowDiscovery,
  queryRelevantDiscoveries,
  reportAgentPerformance,
  trackMethodologyPreferences,
  recordTrustLevelChange,
} from './learning-bridge.js';

// Metrics
export {
  recordPhaseStart,
  recordPhaseComplete,
  computeMetrics,
  exportToLearningSystem,
  computePhaseDuration,
  formatDuration,
} from './metrics.js';

// Engine
export { WorkflowEngine, WorkflowStatusResponse } from './engine.js';
