import { join } from 'path';
import { SessionState, FeedbackCategory, TokenBudget } from './types.js';
import { readJsonFile, writeJsonFile } from './storage.js';
import { randomUUID } from 'crypto';
import { getSessionBaseline } from './baselines.js';

const MAX_RECENT_PROMPTS = 10;
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;  // 30 minutes

/** Get session state file path */
export function getSessionStatePath(directory: string): string {
  return join(directory, '.olympus', 'session-state.json');
}

/** Create fresh session state */
export function createSessionState(sessionId?: string, projectPath?: string): SessionState {
  const baseline = getSessionBaseline(projectPath);

  return {
    session_id: sessionId || randomUUID(),
    started_at: new Date().toISOString(),
    last_updated: new Date().toISOString(),
    recent_prompts: [],
    pending_completion: null,
    todo_snapshot: null,
    token_budget: {
      session_baseline: baseline,
      current_usage: 0,
      input_tokens: 0,
      output_tokens: 0,
      warning_threshold: 1.5,
      warning_issued: false,
      started_at: new Date().toISOString()
    },
    discovery_volume: {
      session_count: 0,
      daily_count: 0,
      daily_reset_at: new Date().toISOString(),
    },
  };
}

/** Load or create session state */
export function loadSessionState(directory: string, sessionId?: string): SessionState {
  const path = getSessionStatePath(directory);
  const state = readJsonFile<SessionState | null>(path, null);

  if (!state) {
    return createSessionState(sessionId, directory);
  }

  // Check for session timeout
  const lastUpdate = new Date(state.last_updated).getTime();
  const now = Date.now();
  if (now - lastUpdate > SESSION_TIMEOUT_MS) {
    return createSessionState(sessionId, directory);
  }

  // Update session ID if it changed (new Claude Code session)
  if (sessionId && state.session_id !== sessionId) {
    state.session_id = sessionId;
  }

  // Initialize token_budget if missing (backward compatibility)
  if (!state.token_budget) {
    const baseline = getSessionBaseline(directory);
    state.token_budget = {
      session_baseline: baseline,
      current_usage: 0,
      input_tokens: 0,
      output_tokens: 0,
      warning_threshold: 1.5,
      warning_issued: false,
      started_at: state.started_at
    };
  } else {
    // Ensure new fields exist (backward compatibility)
    if (state.token_budget.input_tokens === undefined) {
      state.token_budget.input_tokens = 0;
    }
    if (state.token_budget.output_tokens === undefined) {
      state.token_budget.output_tokens = 0;
    }
  }

  // Initialize discovery_volume if missing (backward compatibility)
  if (!state.discovery_volume) {
    state.discovery_volume = {
      session_count: 0,
      daily_count: 0,
      daily_reset_at: new Date().toISOString(),
    };
  }

  return state;
}

/** Save session state */
export function saveSessionState(directory: string, state: SessionState): void {
  const path = getSessionStatePath(directory);
  state.last_updated = new Date().toISOString();
  writeJsonFile(path, state);
}

/** Add prompt to session state */
export function addPromptToSession(
  state: SessionState,
  prompt: string,
  detectedFeedback?: FeedbackCategory
): SessionState {
  const entry = {
    prompt,
    timestamp: new Date().toISOString(),
    detected_feedback: detectedFeedback,
  };

  state.recent_prompts = [entry, ...state.recent_prompts].slice(0, MAX_RECENT_PROMPTS);
  state.last_updated = new Date().toISOString();

  return state;
}

/** Mark a completion claim */
export function markCompletionClaim(
  state: SessionState,
  taskDescription: string,
  agentUsed?: string
): SessionState {
  state.pending_completion = {
    claimed_at: new Date().toISOString(),
    task_description: taskDescription,
    agent_used: agentUsed,
  };
  state.last_updated = new Date().toISOString();
  return state;
}

/** Clear completion claim (on success or explicit reset) */
export function clearCompletionClaim(state: SessionState): SessionState {
  state.pending_completion = null;
  state.last_updated = new Date().toISOString();
  return state;
}

/** Check if there's a pending completion claim */
export function hasPendingCompletion(state: SessionState): boolean {
  if (!state.pending_completion?.claimed_at) return false;

  // Consider completion stale after 5 minutes
  const claimedAt = new Date(state.pending_completion.claimed_at).getTime();
  const now = Date.now();
  return now - claimedAt < 5 * 60 * 1000;
}

/** Initialize token budget for session */
export function initializeTokenBudget(
  state: SessionState,
  projectPath?: string
): SessionState {
  const baseline = getSessionBaseline(projectPath);

  state.token_budget = {
    session_baseline: baseline,
    current_usage: 0,
    input_tokens: 0,
    output_tokens: 0,
    warning_threshold: 1.5,
    warning_issued: false,
    started_at: new Date().toISOString()
  };

  state.last_updated = new Date().toISOString();
  return state;
}

/** Update token budget with new usage */
export function updateTokenBudget(
  state: SessionState,
  tokensUsed: number
): SessionState {
  if (!state.token_budget) {
    state.token_budget = {
      session_baseline: getSessionBaseline(),
      current_usage: 0,
      input_tokens: 0,
      output_tokens: 0,
      warning_threshold: 1.5,
      warning_issued: false,
      started_at: new Date().toISOString()
    };
  }

  state.token_budget.current_usage += tokensUsed;
  state.last_updated = new Date().toISOString();

  return state;
}

/** Mark that warning has been issued */
export function markWarningIssued(state: SessionState): SessionState {
  if (state.token_budget) {
    state.token_budget.warning_issued = true;
    state.last_updated = new Date().toISOString();
  }
  return state;
}

/** Check if budget warning should be issued */
export function shouldIssueWarning(state: SessionState): boolean {
  if (!state.token_budget) return false;
  if (state.token_budget.warning_issued) return false;

  const threshold = state.token_budget.session_baseline * state.token_budget.warning_threshold;
  return state.token_budget.current_usage >= threshold;
}

/** Get current token budget info */
export function getTokenBudgetInfo(state: SessionState): TokenBudget | null {
  return state.token_budget ?? null;
}

/** Increment discovery count for volume tracking */
export function incrementDiscoveryCount(state: SessionState): SessionState {
  if (!state.discovery_volume) {
    state.discovery_volume = {
      session_count: 0,
      daily_count: 0,
      daily_reset_at: new Date().toISOString(),
    };
  }

  // Reset daily count if past midnight
  const resetAt = new Date(state.discovery_volume.daily_reset_at);
  const now = new Date();
  if (now.toDateString() !== resetAt.toDateString()) {
    state.discovery_volume.daily_count = 0;
    state.discovery_volume.daily_reset_at = now.toISOString();
  }

  state.discovery_volume.session_count++;
  state.discovery_volume.daily_count++;
  state.last_updated = now.toISOString();

  return state;
}

/** Check if discovery volume limits are exceeded */
export function checkDiscoveryLimit(
  state: SessionState,
  config: { maxPerSession: number; maxPerDay: number }
): boolean {
  if (!state.discovery_volume) return false; // No tracking = not exceeded

  // Reset daily count if past midnight
  const resetAt = new Date(state.discovery_volume.daily_reset_at);
  const now = new Date();
  if (now.toDateString() !== resetAt.toDateString()) {
    return false; // New day, limits reset
  }

  return (
    state.discovery_volume.session_count >= config.maxPerSession ||
    state.discovery_volume.daily_count >= config.maxPerDay
  );
}
