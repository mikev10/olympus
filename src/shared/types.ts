/**
 * Shared types for Olympus
 */

export type ModelType = 'sonnet' | 'opus' | 'haiku' | 'inherit';

export interface AgentConfig {
  name: string;
  description: string;
  prompt: string;
  tools: string[];
  model?: ModelType;
}

export interface PluginConfig {
  // Agent model overrides
  agents?: {
    olympus?: { model?: string };
    oracle?: { model?: string; enabled?: boolean };
    librarian?: { model?: string };
    explore?: { model?: string };
    frontendEngineer?: { model?: string; enabled?: boolean };
    documentWriter?: { model?: string; enabled?: boolean };
    multimodalLooker?: { model?: string; enabled?: boolean };
    // Olympus agent system
    momus?: { model?: string; enabled?: boolean };
    metis?: { model?: string; enabled?: boolean };
    orchestratorOlympus?: { model?: string; enabled?: boolean };
    olympusJunior?: { model?: string; enabled?: boolean };
    prometheus?: { model?: string; enabled?: boolean };
  };

  // Feature toggles
  features?: {
    parallelExecution?: boolean;
    lspTools?: boolean;
    astTools?: boolean;
    continuationEnforcement?: boolean;
    autoContextInjection?: boolean;
  };

  // MCP server configurations
  mcpServers?: {
    exa?: { enabled?: boolean; apiKey?: string };
    context7?: { enabled?: boolean };
    grepApp?: { enabled?: boolean };
  };

  // Permission settings
  permissions?: {
    allowBash?: boolean;
    allowEdit?: boolean;
    allowWrite?: boolean;
    maxBackgroundTasks?: number;
  };

  // Magic keyword customization
  magicKeywords?: {
    ultrawork?: string[];
    search?: string[];
    analyze?: string[];
    ultrathink?: string[];
  };

  // Intelligent model routing configuration
  routing?: {
    /** Enable intelligent model routing */
    enabled?: boolean;
    /** Default tier when no rules match */
    defaultTier?: 'LOW' | 'MEDIUM' | 'HIGH';
    /** Enable automatic escalation on failure */
    escalationEnabled?: boolean;
    /** Maximum escalation attempts */
    maxEscalations?: number;
    /** Model mapping per tier */
    tierModels?: {
      LOW?: string;
      MEDIUM?: string;
      HIGH?: string;
    };
    /** Agent-specific tier overrides */
    agentOverrides?: Record<string, {
      tier: 'LOW' | 'MEDIUM' | 'HIGH';
      reason: string;
    }>;
    /** Keywords that force escalation to higher tier */
    escalationKeywords?: string[];
    /** Keywords that suggest lower tier */
    simplificationKeywords?: string[];
  };

  // Hook configuration
  hooks?: {
    /** Global hook enable/disable */
    enabled?: boolean;

    /** Individual hook timeout in milliseconds (default: 100) */
    hookTimeoutMs?: number;

    // UserPromptSubmit hooks
    keywordDetector?: { enabled?: boolean };
    autoSlashCommand?: { enabled?: boolean };
    thinkMode?: { enabled?: boolean };

    // SessionStart hooks
    sessionStart?: { enabled?: boolean };

    // Stop hooks
    persistentMode?: { enabled?: boolean };

    // PreToolUse hooks
    rulesInjector?: { enabled?: boolean };
    directoryReadmeInjector?: { enabled?: boolean };
    nonInteractiveEnv?: { enabled?: boolean };
    olympusOrchestrator?: { enabled?: boolean };

    // PostToolUse hooks
    editErrorRecovery?: { enabled?: boolean };
    commentChecker?: { enabled?: boolean; customPrompt?: string };
    contextWindowLimitRecovery?: { enabled?: boolean; detailed?: boolean };
    preemptiveCompaction?: { enabled?: boolean; warningThreshold?: number };
    agentUsageReminder?: { enabled?: boolean };

    // Notification hooks
    backgroundNotification?: { enabled?: boolean };

    // PostToolUseFailure hooks (session recovery)
    sessionRecovery?: { enabled?: boolean };
    emptyMessageSanitizer?: { enabled?: boolean };
    thinkingBlockValidator?: { enabled?: boolean };
  };

  // Learning system configuration
  learning?: {
    /** Enable the learning system (default: true) */
    enabled?: boolean;
    /** Enable context injection at session start (default: true) */
    contextInjection?: boolean;
    /** Maximum tokens for injected context (default: 500) */
    maxContextTokens?: number;
    /** Minimum occurrences before learning a pattern (default: 3) */
    minPatternOccurrences?: number;
    /** Days before preferences decay (default: 30) */
    preferenceDecayDays?: number;
  };
}

export interface SessionState {
  sessionId?: string;
  activeAgents: Map<string, AgentState>;
  backgroundTasks: BackgroundTask[];
  contextFiles: string[];
}

export interface AgentState {
  name: string;
  status: 'idle' | 'running' | 'completed' | 'error';
  lastMessage?: string;
  startTime?: number;
}

export interface BackgroundTask {
  id: string;
  agentName: string;
  prompt: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  result?: string;
  error?: string;
}

export interface MagicKeyword {
  triggers: string[];
  action: (prompt: string) => string;
  description: string;
}

export interface HookDefinition {
  event: 'PreToolUse' | 'PostToolUse' | 'Stop' | 'SessionStart' | 'SessionEnd' | 'UserPromptSubmit';
  matcher?: string;
  command?: string;
  handler?: (context: HookContext) => Promise<HookResult>;
}

export interface HookContext {
  toolName?: string;
  toolInput?: unknown;
  toolOutput?: unknown;
  sessionId?: string;
}

export interface HookResult {
  continue: boolean;
  message?: string;
  modifiedInput?: unknown;
}
