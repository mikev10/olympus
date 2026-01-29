import { join } from 'path';
import { existsSync } from 'fs';
import { SessionState, FeedbackCategory } from './types.js';
import { readJsonFile, writeJsonFile } from './storage.js';
import { randomUUID } from 'crypto';

const MAX_RECENT_PROMPTS = 10;
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;  // 30 minutes

/** Get session state file path */
export function getSessionStatePath(directory: string): string {
  return join(directory, '.olympus', 'session-state.json');
}

/** Create fresh session state */
export function createSessionState(sessionId?: string): SessionState {
  return {
    session_id: sessionId || randomUUID(),
    started_at: new Date().toISOString(),
    last_updated: new Date().toISOString(),
    recent_prompts: [],
    pending_completion: null,
    todo_snapshot: null,
  };
}

/** Load or create session state */
export function loadSessionState(directory: string, sessionId?: string): SessionState {
  const path = getSessionStatePath(directory);
  const state = readJsonFile<SessionState | null>(path, null);

  if (!state) {
    return createSessionState(sessionId);
  }

  // Check for session timeout
  const lastUpdate = new Date(state.last_updated).getTime();
  const now = Date.now();
  if (now - lastUpdate > SESSION_TIMEOUT_MS) {
    return createSessionState(sessionId);
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
