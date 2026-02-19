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
  WorkflowCheckpointV3,
} from './phase-types.js';

export { STAGE_PHASE_MAP } from './phase-types.js';

// Checkpoint persistence
export {
  saveCheckpoint,
  loadCheckpoint,
  listWorkflows,
  deleteWorkflow,
  isLegacyCheckpoint,
  archiveLegacyWorkflow,
} from './checkpoint.js';

// Artifact management
export type { ArtifactType } from './artifacts.js';
export {
  ensureWorkflowDir,
  getArtifactPath,
  writeArtifact,
  readArtifact,
  linkMasterPlan,
  ensurePhaseWorkflowDir,
  isLegacyLayout,
  migrateLayout,
  getPhaseArtifactPath,
} from './artifacts.js';

// Manifest management
export type { RevalidationResult } from './manifest.js';
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
  getUnitArtifacts,
  getBoltArtifacts,
  getBoltsByStatus,
  isWorkflowComplete,
  transitionToDraft,
  transitionToActive,
  transitionToFulfilled,
  transitionToViolated,
  transitionToStale,
  revalidateStaleArtifacts,
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
export { validateIdea, validateIntent, clearFileCache } from './validation.js';

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
export type { TransitionType, RootValidationType } from './alignment.js';
export {
  computeVerification,
  generateValidationQuestions,
  runAlignmentCheck as runFullAlignmentCheck,
  runDualValidation,
  recordAlignmentResult,
  getConformanceThreshold,
  getAdaptiveThreshold,
} from './alignment.js';

// Construction Phase
export type {
  UnitSpec,
  BoltSpec,
  DecompositionTree,
} from './construction/decomposition.js';
export {
  parseIntentsFromDisk,
  parseIntentFromFile,
  decomposeIntentToUnits,
  decomposeUnitToBolts,
  enforceGlobalBoltLimit,
  buildDecompositionTree,
  getLeafBolts,
  getExecutableOrder,
} from './construction/decomposition.js';
export type {
  InterfaceContract,
  InterfaceField,
  DataFlowDiagram,
  DataFlowComponent,
  DataFlow,
  ComponentDesign,
  DesignArtifacts,
} from './construction/design.js';
export {
  generateInterfaceContracts,
  generateDataFlowDiagram,
  generateComponentDesign,
  validateDesign,
  writeDesignArtifacts,
  loadDesignArtifacts,
} from './construction/design.js';
export {
  ConstructionExecutor,
  CONSTRUCTION_STAGE_AGENT_MAP,
} from './construction/executor.js';
export type { ConstructionProgress, ConstructionOptions } from './construction/executor.js';
export {
  validateUnits,
  validateDesignArtifacts,
  validateBolt,
  validateConstructionPhase,
} from './construction/validation.js';

// Operations Phase
export type { OperationsContext, OperationsResult } from './operations/templates.js';
export {
  generateDeployGuide,
  generateRunbook,
  generateMonitoringConfig,
  generateReleaseNotes,
  generateCostAnalysis,
  generateOperationsArtifacts,
} from './operations/templates.js';

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

// Validation Report
export type { BoltValidationData } from './validation-report.js';
export {
  generateValidationReport,
  readValidationReport,
  getValidationReportPath,
} from './validation-report.js';

// CI Checks
export type { CICheckConfig, CICheckResult, CICheckSummary } from './ci-checks.js';
export {
  loadCICheckConfig,
  getDefaultConfig as getDefaultCIConfig,
  detectProjectCommands,
  runCICheck,
  runAllCIChecks,
  formatCIResults,
  scanForSecrets,
  scanForRiskyPatterns,
} from './ci-checks.js';

// Manifest Updater (atomic writes)
export {
  atomicManifestUpdate,
  batchManifestUpdate,
} from './manifest-updater.js';

// Workflow Bridge
export type { WorkflowBridgeContext } from './workflow-bridge.js';
export {
  detectActiveWorkflow,
  getPendingBolts,
  getExecutionOrder,
  markBoltComplete,
  markUnitComplete,
  getWorkflowProgress,
  generateWorkflowSummary,
  generateBoltExecutionPlan,
} from './workflow-bridge.js';

// Retro
export {
  gatherRetroData,
  analyzeRetroPatterns,
  generateRetroSuggestions,
  persistRetroDiscoveries,
  runRetro,
} from './retro.js';

export type {
  RetroData,
  RetroPattern,
  RetroResult,
} from './retro.js';

// Engine
export { WorkflowEngine, WorkflowStatusResponse } from './engine.js';
