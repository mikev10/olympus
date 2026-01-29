/**
 * Unified Hook Types for Olympus
 *
 * These types define the interface for the hook router system that
 * routes Claude Code events to registered hooks.
 */

/**
 * Hook events that can be registered for.
 * Maps to Claude Code's native hook system events.
 */
export type HookEvent =
  | 'UserPromptSubmit'
  | 'SessionStart'
  | 'Stop'
  | 'PreToolUse'
  | 'PostToolUse'
  | 'PostToolUseFailure'
  | 'Notification';

/**
 * Context passed to hook handlers.
 * Contains information about the current event being processed.
 */
export interface HookContext {
  /** Session identifier */
  sessionId?: string;
  /** Current working directory */
  directory?: string;
  /** Tool name (for PreToolUse/PostToolUse) */
  toolName?: string;
  /** Tool input parameters (for PreToolUse/PostToolUse) */
  toolInput?: unknown;
  /** Tool output result (for PostToolUse) */
  toolOutput?: unknown;
  /** User prompt text (for UserPromptSubmit) */
  prompt?: string;
  /** Message content with model info (for UserPromptSubmit) */
  message?: { content?: string; model?: { modelId?: string; providerId?: string } };
  /** Message parts array (for UserPromptSubmit) */
  parts?: Array<{ type: string; text?: string }>;
  /** Messages array (for future use) */
  messages?: Array<unknown>;
  /** Error information (for PostToolUseFailure) */
  error?: unknown;
  /** Notification event data (for Notification) */
  event?: { type: string; properties?: unknown };
}

/**
 * Result returned by hook handlers.
 */
export interface HookResult {
  /** Whether to continue processing (false blocks the action) */
  continue: boolean;
  /** Message to inject into the conversation (legacy format) */
  message?: string;
  /** Hook-specific output using new structured format */
  hookSpecificOutput?: {
    /** Event name for validation */
    hookEventName: HookEvent;
    /** Additional context to inject into conversation */
    additionalContext?: string;
  };
  /** Reason for blocking (when continue is false) */
  stopReason?: string;
  /** Modified tool input (for PreToolUse hooks that modify input) */
  modifiedInput?: unknown;
  /** Modified messages (for future use) */
  modifiedMessages?: Array<unknown>;
}

/**
 * Definition of a hook that can be registered with the router.
 */
export interface HookDefinition {
  /** Unique name for the hook (used for config enable/disable) */
  name: string;
  /** Event this hook responds to */
  event: HookEvent;
  /** Optional regex or string matcher for tool-specific hooks */
  matcher?: string | RegExp;
  /** Priority (lower runs first, default 100) */
  priority?: number;
  /** Whether the hook is enabled (defaults to true) */
  enabled?: boolean;
  /** The handler function */
  handler: (ctx: HookContext) => Promise<HookResult> | HookResult;
}

/**
 * Per-hook configuration options.
 */
export interface HookOptions {
  /** Whether the hook is enabled */
  enabled?: boolean;
  /** Hook-specific options */
  [key: string]: unknown;
}

/**
 * Global hook configuration.
 */
export interface HooksConfig {
  /** Global hook enable/disable */
  enabled?: boolean;
  /** Individual hook timeout in milliseconds (default: 100) */
  hookTimeoutMs?: number;
  /** Per-hook configuration keyed by hook name */
  [hookName: string]: HookOptions | boolean | number | undefined;
}
