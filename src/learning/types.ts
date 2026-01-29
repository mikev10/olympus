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
}

export type FeedbackCategory =
  | 'correction'      // "No, that's wrong"
  | 'rejection'       // "Stop", "Cancel"
  | 'clarification'   // "I meant X"
  | 'enhancement'     // "Also add X"
  | 'praise'          // "Perfect", "Thanks"
  | 'explicit_preference';  // "Always do X"

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
  | 'configuration';      // "Environment variable X must be set"

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
