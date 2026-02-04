/**
 * Features Module Exports
 */

export {
  createMagicKeywordProcessor,
  detectMagicKeywords,
  builtInMagicKeywords
} from './magic-keywords.js';

export {
  createContinuationHook,
  continuationSystemPromptAddition,
  detectCompletionSignals,
  generateVerificationPrompt
} from './continuation-enforcement.js';

export {
  // Types
  type VersionMetadata,
  type ReleaseInfo,
  type UpdateCheckResult,
  type UpdateResult,
  type SilentUpdateConfig,
  // Constants
  REPO_OWNER,
  REPO_NAME,
  GITHUB_API_URL,
  GITHUB_RAW_URL,
  CLAUDE_CONFIG_DIR,
  VERSION_FILE,
  // Functions
  getInstalledVersion,
  saveVersionMetadata,
  updateLastCheckTime,
  fetchLatestRelease,
  compareVersions,
  checkForUpdates,
  performUpdate,
  formatUpdateNotification,
  shouldCheckForUpdates,
  backgroundUpdateCheck,
  interactiveUpdate,
  // Silent auto-update
  silentAutoUpdate,
  hasPendingUpdateRestart,
  clearPendingUpdateRestart,
  getPendingUpdateVersion,
  initSilentAutoUpdate
} from './auto-update.js';

// Quest State - session/plan tracking
export {
  // Types
  type QuestState,
  type PlanProgress,
  type PlanSummary,
  // Constants
  OLYMPUS_DIR,
  QUEST_FILE,
  QUEST_STATE_PATH,
  NOTEPAD_DIR,
  NOTEPAD_BASE_PATH,
  PROMETHEUS_PLANS_DIR,
  PLAN_EXTENSION,
  // Functions
  getQuestFilePath,
  readQuestState,
  writeQuestState,
  appendSessionId,
  clearQuestState,
  findPrometheusPlans,
  getPlanProgress,
  getPlanName,
  createQuestState,
  getPlanSummaries,
  hasActiveQuest,
  getActivePlanPath
} from './quest-state/index.js';

// Context Injector - multi-source context collection and injection
export {
  // Classes
  ContextCollector,
  contextCollector,
  // Functions
  injectPendingContext,
  injectContextIntoText,
  createContextInjectorHook,
  // Types
  type ContextSourceType,
  type ContextPriority,
  type ContextEntry,
  type RegisterContextOptions,
  type PendingContext,
  type MessageContext,
  type OutputPart,
  type InjectionStrategy,
  type InjectionResult
} from './context-injector/index.js';

// Background Agent - background task management
export {
  // Classes
  BackgroundManager,
  ConcurrencyManager,
  // Functions
  getBackgroundManager,
  resetBackgroundManager,
  // Types
  type BackgroundTask,
  type BackgroundTaskStatus,
  type BackgroundTaskConfig,
  type LaunchInput,
  type ResumeInput,
  type TaskProgress
} from './background-agent/index.js';

// Builtin Skills - bundled skill definitions
export {
  // Functions
  createBuiltinSkills,
  getBuiltinSkill,
  listBuiltinSkillNames,
  // Types
  type BuiltinSkill,
  type SkillMcpConfig,
  type SkillRegistry
} from './builtin-skills/index.js';

// Ascent Checkpoint - checkpoint system for ascent safety
export {
  // Functions
  saveCheckpoint,
  loadCheckpoint,
  listCheckpoints,
  validateCheckpoint,
  hashPlanContent,
  getGitSha,
  getCheckpointsDir,
  // Types
  type AscentCheckpoint
} from './ascent-checkpoint/index.js';

// Model Routing - intelligent model tier routing
export {
  // Main functions
  routeTask,
  routeWithEscalation,
  routeAndAdaptTask,
  escalateModel,
  canEscalate,
  explainRouting,
  quickTierForAgent,
  // Signal extraction
  extractLexicalSignals,
  extractStructuralSignals,
  extractContextSignals,
  extractAllSignals,
  // Scoring
  calculateComplexityScore,
  calculateComplexityTier,
  scoreToTier,
  getScoreBreakdown,
  calculateConfidence,
  // Rules
  evaluateRules,
  getMatchingRules,
  createRule,
  mergeRules,
  DEFAULT_ROUTING_RULES,
  // Prompt adaptation
  adaptPromptForTier,
  getPromptStrategy,
  getPromptPrefix,
  getPromptSuffix,
  createDelegationPrompt,
  getTaskInstructions,
  // Constants
  TIER_MODELS,
  TIER_TO_MODEL_TYPE,
  DEFAULT_ROUTING_CONFIG,
  AGENT_CATEGORY_TIERS,
  COMPLEXITY_KEYWORDS,
  TIER_PROMPT_STRATEGIES,
  TIER_TASK_INSTRUCTIONS,
  // Types
  type ComplexityTier,
  type ComplexitySignals,
  type LexicalSignals,
  type StructuralSignals,
  type ContextSignals,
  type RoutingDecision,
  type RoutingContext,
  type RoutingConfig,
  type RoutingRule,
  type PromptAdaptationStrategy,
} from './model-routing/index.js';

// Session State - task completion tracking
export {
  SessionState,
  sessionState,
  type TaskCompletion
} from './session-state/index.js';

// Hook Logging - violation logging
export {
  logViolation,
  getViolationStats,
  readViolations,
  clearViolations,
  type HookViolation
} from './hook-logging/index.js';

// Workflow Engine - structured workflow system
export {
  // Types
  type WorkflowStage,
  type WorkflowStatus,
  type ArtifactReference,
  type ValidationResult,
  type RequirementMapping,
  type WorkflowCheckpoint,
  // Checkpoint persistence
  saveCheckpoint as saveWorkflowCheckpoint,
  loadCheckpoint as loadWorkflowCheckpoint,
  listWorkflows,
  deleteWorkflow,
  // Artifact management
  ensureWorkflowDir,
  getArtifactPath,
  writeArtifact,
  readArtifact,
} from './workflow-engine/index.js';
