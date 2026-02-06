/**
 * Type definitions for the Olympus learning system
 * No external dependencies - using Node.js built-ins only
 */

/**
 * Input received by hooks via stdin
 * Based on actual Claude Code hook architecture
 */
export interface HookInput {
  prompt?: string;           // Current user prompt
  directory?: string;        // Working directory
  sessionId?: string;        // Session ID (may not always be present)
}

/**
 * Session state maintained across hook invocations
 * Stored in .olympus/session-state.json
 */
export interface TokenBudget {
  session_baseline: number;    // Expected baseline tokens per session (e.g., 10000)
  current_usage: number;        // Total tokens used so far (for backward compatibility)
  input_tokens: number;         // Input tokens used in session
  output_tokens: number;        // Output tokens used in session
  warning_threshold: number;    // Multiplier for baseline (e.g., 1.5 = 150%)
  warning_issued: boolean;      // Has warning been issued?
  started_at: string;           // When budget tracking started
  current_model?: string;       // Current model being used in session
  agents_used?: string[];       // All unique agents used during this session
}

export interface SessionState {
  session_id: string;
  started_at: string;
  last_updated: string;

  // Rolling window of recent interactions (max 10)
  recent_prompts: Array<{
    prompt: string;
    timestamp: string;
    detected_feedback?: FeedbackCategory;
  }>;

  // Track completion claims for revision detection
  pending_completion: {
    claimed_at?: string;
    task_description?: string;
    agent_used?: string;
  } | null;

  // Track todo state for cancellation detection
  todo_snapshot: {
    total: number;
    completed: number;
    pending: number;
  } | null;

  // Token budget tracking (optional for backward compatibility)
  token_budget?: TokenBudget;

  // Discovery volume tracking (optional for backward compatibility)
  discovery_volume?: {
    session_count: number;      // Discoveries this session (max 5)
    daily_count: number;        // Discoveries today (max 20)
    daily_reset_at: string;     // ISO timestamp for daily reset
  };
}

export type FeedbackCategory =
  | 'correction'      // "No, that's wrong"
  | 'rejection'       // "Stop", "Cancel"
  | 'clarification'   // "I meant X"
  | 'enhancement'     // "Also add X"
  | 'praise'          // "Perfect", "Thanks"
  | 'explicit_preference';  // "Always do X"

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  estimated: boolean;      // true if estimated from response, false if from API
  model?: string;          // Model used for this interaction
}

export interface CostEstimate {
  input_cost: number;      // Cost in USD for input tokens
  output_cost: number;     // Cost in USD for output tokens
  total_cost: number;      // Total cost in USD
  pricing_version: string; // Pricing version used (e.g., "2024-01-01")
}

export interface FeedbackEntry {
  id: string;                 // UUID
  timestamp: string;          // ISO 8601
  session_id: string;
  project_path: string;
  event_type: 'revision' | 'cancellation' | 'success' | 'explicit_preference';

  // Context (from session state)
  original_task?: string;
  agent_used?: string;
  completion_claim?: string;

  // Feedback
  user_message: string;
  feedback_category: FeedbackCategory;

  // Extracted learning (populated by analysis)
  extracted_lesson?: string;
  confidence: number;  // 0-1

  // Token metrics (optional for backward compatibility)
  token_usage?: TokenUsage;
  cost_estimate?: CostEstimate;
}

/**
 * Summary of a single session for observability
 * Written to session-summaries.jsonl at session end
 */
export interface SessionSummary {
  session_id: string;
  project_path: string;
  started_at: string;
  ended_at: string;
  duration_seconds: number;
  agents_used: string[];
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
  estimated_cost: number;
  model: string;
  outcome: 'success' | 'revision' | 'cancellation' | 'unknown';
}

export interface UserPreferences {
  verbosity: 'concise' | 'detailed' | 'unknown';
  autonomy: 'ask_first' | 'just_do_it' | 'balanced' | 'unknown';
  explanation_depth: 'minimal' | 'moderate' | 'thorough' | 'unknown';

  explicit_rules: string[];           // "always use TypeScript"
  inferred_preferences: string[];     // Learned from patterns
  recurring_corrections: Array<{
    pattern: string;
    count: number;
    last_seen: string;
    examples: string[];
  }>;

  last_updated: string;
}

export interface TokenEfficiency {
  avg_tokens_per_success: number;   // Average tokens for successful tasks
  avg_tokens_per_failure: number;   // Average tokens for failed tasks
  total_tokens: number;              // Total tokens across all invocations
  invocation_count: number;          // Total invocations tracked
  efficiency_score: number;          // Lower is better (tokens per success)
  trend: 'improving' | 'declining' | 'stable' | 'insufficient_data'; // Token efficiency trend
}

export interface AgentPerformance {
  agent_name: string;
  total_invocations: number;
  success_count: number;
  revision_count: number;
  cancellation_count: number;
  success_rate: number;  // Calculated: success_count / total_invocations

  failure_patterns: Array<{
    pattern: string;
    count: number;
    examples: string[];
  }>;

  strong_areas: string[];
  weak_areas: string[];

  last_updated: string;

  // Token efficiency metrics (optional for backward compatibility)
  token_efficiency?: TokenEfficiency;

  // Task patterns for routing recommendations
  task_patterns?: TaskPattern[];
}

/**
 * Configuration for smart agent routing recommendations
 */
export interface RoutingThresholds {
  /** Minimum data points before making recommendations. Default: 10 */
  minDataPoints: number;
  /** Minimum success rate to recommend a lower-tier agent. Default: 0.80 */
  minSuccessRate: number;
  /** Whether to prefer lower-tier agents when they meet thresholds. Default: true */
  preferLowerTier: boolean;
}

/**
 * Task pattern for agent performance correlation
 */
export interface TaskPattern {
  /** Pattern category (e.g., 'simple_search', 'debugging') */
  pattern: string;
  /** Agents that handle this pattern well */
  successfulAgents: string[];
  /** Agents that struggle with this pattern */
  unsuccessfulAgents: string[];
  /** Confidence score 0-1 based on sample size */
  confidence: number;
}

export interface ProjectPatterns {
  project_hash: string;       // SHA-256 of absolute project path
  project_path: string;

  conventions: string[];      // "uses kebab-case for files"
  tech_stack: string[];       // "React", "TypeScript", "Prisma"
  learned_rules: string[];    // "always run migrations after schema change"
  common_mistakes: string[];  // Things Claude got wrong on this project

  last_updated: string;
}

/**
 * Configuration for automatic archive pruning
 */
export interface ArchiveRetentionConfig {
  /** Maximum age in days before archives are pruned. Default: 30 */
  maxAgeInDays?: number;
  /** Maximum number of archives to keep per file type. Default: 5 */
  maxArchiveCount?: number;
}

/** Default archive retention settings */
export const DEFAULT_ARCHIVE_RETENTION: ArchiveRetentionConfig = {
  maxAgeInDays: 30,
  maxArchiveCount: 5,
};

// AGENT DISCOVERY TYPES (Phase 6)

/**
 * Category of agent-discovered learning
 */
export type DiscoveryCategory =
  | 'technical_insight'   // "This API requires X header format"
  | 'workaround'          // "Build fails silently, must check exit code"
  | 'pattern'             // "This codebase uses kebab-case for files"
  | 'gotcha'              // "Migration must run before seeding"
  | 'performance'         // "Query N+1 issue in X, use eager loading"
  | 'dependency'          // "Package X requires peer dependency Y"
  | 'configuration'       // "Environment variable X must be set"
  | 'planning_insight';   // "Plans need X consideration"

/**
 * An agent-discovered learning entry
 */
export interface AgentDiscovery {
  id: string;                 // UUID
  timestamp: string;          // ISO 8601
  session_id: string;
  project_path: string;

  // What was discovered
  category: DiscoveryCategory;
  summary: string;            // One-line summary (max 100 chars)
  details: string;            // Full explanation

  // Context
  agent_name: string;         // Which agent made the discovery
  task_context?: string;      // What task was being worked on
  files_involved?: string[];  // Related files

  // Validation
  confidence: number;         // 0-1, how confident the agent is
  verified: boolean;          // Has this been validated?
  verification_count: number; // How many times this has been useful

  // Lifecycle
  scope: 'global' | 'project'; // Where to store/apply
  expires_at?: string;        // Optional expiration for time-sensitive learnings
  last_useful: string;        // Last time this was injected
}

/**
 * Aggregated discoveries for context injection
 */
export interface DiscoverySummary {
  project_discoveries: AgentDiscovery[];  // Project-specific
  global_discoveries: AgentDiscovery[];   // Cross-project

  // Statistics
  total_discoveries: number;
  categories: Record<DiscoveryCategory, number>;
  most_useful: AgentDiscovery[];  // Top 5 by verification_count
}

/**
 * Pattern extracted from feedback analysis
 */
export interface ExtractedPattern {
  pattern: string;             // "User wants TypeScript strict mode"
  confidence: number;          // 0.85
  evidence_count: number;      // 4
  evidence_examples: string[]; // ["add types", "use strict", ...]
  scope: 'global' | 'project';
  category: 'style' | 'behavior' | 'tooling' | 'communication';
}

// PLAN LIFECYCLE TRACKING TYPES (Phase 6 Extension)

/**
 * Plan lifecycle event tracking
 */
export interface PlanLifecycleEvent {
  event_type: 'plan_created' | 'plan_revised' | 'plan_review_failed' |
              'plan_review_passed' | 'plan_completed' | 'plan_failed';
  plan_path: string;              // Relative path from project root
  plan_summary: string;           // First 200 chars of plan
  revision_count?: number;        // How many times revised
  failure_reasons?: string[];     // Why plan failed/was revised
  reviewer?: 'momus' | 'user';    // Who reviewed/rejected
  session_id: string;
  timestamp: string;
}
