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
  PathwayType,
  Level1PlanStage,
  Level1Plan,
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
  assessDepthFromIntent,
  getDepthLabel,
  getRiskTierLabel,
  adjustDepthForPathway,
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
  shouldAutoApproveBoltPlan,
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

export type { Level1PlanOptions } from './level1-plan.js';
export {
  detectPathway,
  generateLevel1Plan,
  writeLevel1PlanArtifact,
  loadLevel1Plan,
  isPhaseIncluded,
  isStageIncluded,
  LEVEL1_PLAN_FORMAT_INSTRUCTIONS,
} from './level1-plan.js';

// Brownfield Scanner
export type {
  DirectoryNode,
  ImportEdge,
  WorkspaceScanResult,
} from './brownfield-scanner.js';
export {
  scanWorkspace,
  selectKeyFiles,
  selectIntentRelevantFiles,
  WORKSPACE_SCAN_SCHEMA,
  SKIP_DIRS as SCANNER_SKIP_DIRS,
} from './brownfield-scanner.js';

// Brownfield Analysis
export type {
  BrownfieldAnalysisOptions,
  ModuleDescription,
  DependencyEdge,
  DataModelDescription,
  StaticModel,
  UseCaseFlow,
  EventPattern,
  DynamicModel,
} from './brownfield-analysis.js';
export {
  buildStaticModelPrompt,
  buildDynamicModelPrompt,
  parseStaticModelResponse,
  parseDynamicModelResponse,
  writeModelsToArtifacts,
  STATIC_MODEL_FORMAT_INSTRUCTIONS,
  DYNAMIC_MODEL_FORMAT_INSTRUCTIONS,
} from './brownfield-analysis.js';

// Bolt Dispatcher
export {
  buildBoltPlanPath,
  buildBoltPrompt,
  dispatchBolt,
  BOLT_PLAN_FORMAT_INSTRUCTIONS,
} from './bolt-dispatcher.js';

// Discovery (brownfield integration)
export { populateDiscoveryModels } from './discovery.js';

// Engine
export { WorkflowEngine, WorkflowStatusResponse } from './engine.js';

// Audit Generator
export type {
  AuditDocument,
  AuditTimelineEntry,
  TraceabilityEntry,
  TrustChange,
  CascadeEvent,
} from './audit-generator.js';
export {
  generateAuditDocument,
  renderAuditMarkdown,
  writeAuditArtifact,
  appendToAudit,
} from './audit-generator.js';

// PRFAQ Generator
export type { PRFAQResult, PRFAQOptions } from './prfaq-generator.js';
export {
  buildPRFAQPrompt,
  parsePRFAQResponse,
  writePRFAQArtifact,
  attemptPRFAQGeneration,
  PRFAQ_FORMAT_INSTRUCTIONS,
} from './prfaq-generator.js';

// Ceremony
export type { CeremonyConfig } from './phase-types.js';
export {
  getDefaultCeremonyConfig,
  loadCeremonyConfig,
  formatForCeremony,
  getCeremonyArtifactTemplates,
} from './ceremony.js';

// Phase 4: Question Manager
export type { Question, AnsweredQuestion, Contradiction, Ambiguity } from './question-manager.js';
export {
  generateQuestionFile,
  readAnsweredFile,
  detectContradictions,
  detectAmbiguities,
  generateClarificationFile,
  allQuestionsResolved,
  AMBIGUITY_TRIGGER_PHRASES as QA_AMBIGUITY_TRIGGER_PHRASES,
} from './question-manager.js';

// Phase 4: Audit Interaction Logging (extends audit-generator)
export type { AuditInteraction } from './audit-generator.js';
export {
  appendInteraction,
  logApprovalPrompt,
  logApprovalResponse,
} from './audit-generator.js';

// Phase 4: Construction Design Stages
export type { ConstructionDesignStage, UnitDesignState, UserStory, UnitDefinition } from './phase-types.js';
export type { DomainDesignArtifact } from './construction/domain-design.js';
export {
  buildDomainDesignPrompt,
  parseDomainDesignResponse,
  writeDomainDesignArtifact,
} from './construction/domain-design.js';
export type { FunctionalDesignArtifacts } from './construction/functional-design.js';
export {
  buildFunctionalDesignPrompt,
  parseFunctionalDesignResponse,
  writeFunctionalDesignArtifacts,
} from './construction/functional-design.js';
export type { LogicalDesignArtifact } from './construction/nfr-design.js';
export {
  buildNFRRequirementsPrompt,
  buildNFRDesignPrompt,
  buildLogicalDesignPrompt,
  writeNFRRequirements,
  writeNFRDesign,
  writeLogicalDesignArtifact,
} from './construction/nfr-design.js';
export {
  buildInfrastructureDesignPrompt,
  writeInfrastructureDesign,
} from './construction/infrastructure-design.js';

// Phase 4: Extended Brownfield Artifacts
export {
  generateComponentInventory,
  generateTechnologyStack,
  generateDependencies,
} from './brownfield-scanner.js';
export {
  buildBusinessOverviewPrompt,
  buildAPIDocumentationPrompt,
  buildCodeQualityPrompt,
} from './brownfield-analysis.js';
export { writeExtendedDiscoveryArtifacts } from './discovery.js';

// Phase 4: Overconfidence Guard
export type { OverconfidenceCheck } from './overconfidence-guard.js';
export {
  OVERCONFIDENCE_RULES,
  RED_FLAG_INDICATORS,
  AMBIGUITY_TRIGGER_PHRASES,
  checkForOverconfidence,
  getOverconfidenceRulesText,
} from './overconfidence-guard.js';

// Phase 4: Content Validation
export type { ValidationResult as ContentValidationResult } from './content-validation.js';
export {
  validateMermaidSyntax,
  validateAsciiDiagram,
  validateMarkdown,
  validateAndFallback,
  CONTENT_VALIDATION_RULES,
} from './content-validation.js';

// Phase 4: Application Design
export type {
  ComponentDefinition,
  ServiceDefinition,
  ComponentDependency,
  ApplicationDesignArtifacts,
} from './application-design.js';
export {
  buildApplicationDesignPrompt,
  parseApplicationDesignResponse,
  writeApplicationDesignArtifacts,
  APPLICATION_DESIGN_FORMAT_INSTRUCTIONS,
} from './application-design.js';

// Phase 4: Workflow Changes
export type { ChangeType, ChangeRequest, ChangeImpact, WorkflowState } from './workflow-changes.js';
export {
  assessChangeImpact,
  archiveArtifacts,
  resetStages,
  logChangeRequest,
} from './workflow-changes.js';

// Phase 4: Completion Messages
export {
  INCEPTION_COMPLETION_FORMAT,
  CONSTRUCTION_COMPLETION_FORMAT,
  buildCompletionMessage,
  formatSummaryBullets,
  COMPLETION_MESSAGE_RULES,
} from './completion-messages.js';

// Phase 4: State File
export {
  generateStateFile,
  updateStateFile,
  STATE_FILE_RULES,
} from './state-file.js';

// Phase 4: Execution Plan Visualization
export { generatePlanVisualization } from './level1-plan.js';

// Phase 4: Error Recovery
export type { ErrorSeverity, WorkflowError, RecoveryResult } from './error-recovery.js';
export {
  assessErrorSeverity,
  recoverPartialCompletion,
  recoverCorruptedState,
  recoverMissingArtifacts,
  handleUserRestart,
  handleUserSkip,
  ERROR_LOG_FORMAT,
  RECOVERY_LOG_FORMAT,
} from './error-recovery.js';

// Phase 4: Session Continuity
export {
  generateWelcomeMessage,
  generateWelcomeBackMessage,
  getContextLoadingRecommendation,
} from './status-reporter.js';
