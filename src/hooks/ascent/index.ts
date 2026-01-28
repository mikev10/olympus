/**
 * The Ascent Hook
 *
 * Self-referential work loop that continues until a completion promise is detected.
 * Named after the character who keeps working until the job is done.
 *
 * Olympus ascent hook for extending Claude Code behavior.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface AscentLoopState {
  /** Whether the loop is currently active */
  active: boolean;
  /** Current iteration number */
  iteration: number;
  /** Maximum iterations before stopping */
  max_iterations: number;
  /** The promise phrase to detect for completion */
  completion_promise: string;
  /** When the loop started */
  started_at: string;
  /** The original prompt/task */
  prompt: string;
  /** Session ID the loop is bound to */
  session_id?: string;
}

export interface AscentLoopOptions {
  /** Maximum iterations (default: 10) */
  maxIterations?: number;
  /** Custom completion promise (default: "TASK_COMPLETE") */
  completionPromise?: string;
}

export interface AscentLoopHook {
  startLoop: (sessionId: string, prompt: string, options?: AscentLoopOptions) => boolean;
  cancelLoop: (sessionId: string) => boolean;
  getState: () => AscentLoopState | null;
}

const DEFAULT_MAX_ITERATIONS = 10;
const DEFAULT_COMPLETION_PROMISE = 'TASK_COMPLETE';

/**
 * Get the state file path for The Ascent
 */
function getStateFilePath(directory: string): string {
  const olympusDir = join(directory, '.olympus');
  return join(olympusDir, 'ascent-state.json');
}

/**
 * Ensure the .olympus directory exists
 */
function ensureStateDir(directory: string): void {
  const olympusDir = join(directory, '.olympus');
  if (!existsSync(olympusDir)) {
    mkdirSync(olympusDir, { recursive: true });
  }
}

/**
 * Read The Ascent state from disk
 */
export function readAscentState(directory: string): AscentLoopState | null {
  const stateFile = getStateFilePath(directory);

  if (!existsSync(stateFile)) {
    return null;
  }

  try {
    const content = readFileSync(stateFile, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Write The Ascent state to disk
 */
export function writeAscentState(directory: string, state: AscentLoopState): boolean {
  try {
    ensureStateDir(directory);
    const stateFile = getStateFilePath(directory);
    writeFileSync(stateFile, JSON.stringify(state, null, 2));
    return true;
  } catch {
    return false;
  }
}

/**
 * Clear The Ascent state
 */
export function clearAscentState(directory: string): boolean {
  const stateFile = getStateFilePath(directory);

  if (!existsSync(stateFile)) {
    return true;
  }

  try {
    unlinkSync(stateFile);
    return true;
  } catch {
    return false;
  }
}

/**
 * Increment The Ascent iteration
 */
export function incrementAscentIteration(directory: string): AscentLoopState | null {
  const state = readAscentState(directory);

  if (!state || !state.active) {
    return null;
  }

  state.iteration += 1;

  if (writeAscentState(directory, state)) {
    return state;
  }

  return null;
}

/**
 * Detect completion promise in session transcript
 */
export function detectCompletionPromise(
  sessionId: string,
  promise: string
): boolean {
  // Try to find transcript in Claude's session directory
  const claudeDir = join(homedir(), '.claude');
  const possiblePaths = [
    join(claudeDir, 'sessions', sessionId, 'transcript.md'),
    join(claudeDir, 'sessions', sessionId, 'messages.json'),
    join(claudeDir, 'transcripts', `${sessionId}.md`)
  ];

  for (const transcriptPath of possiblePaths) {
    if (existsSync(transcriptPath)) {
      try {
        const content = readFileSync(transcriptPath, 'utf-8');
        const pattern = new RegExp(`<promise>\\s*${escapeRegex(promise)}\\s*</promise>`, 'is');
        if (pattern.test(content)) {
          return true;
        }
      } catch {
        continue;
      }
    }
  }

  return false;
}

/**
 * Escape regex special characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Create a The Ascent hook instance
 */
export function createAscentLoopHook(directory: string): AscentLoopHook {
  const startLoop = (
    sessionId: string,
    prompt: string,
    options?: AscentLoopOptions
  ): boolean => {
    const state: AscentLoopState = {
      active: true,
      iteration: 1,
      max_iterations: options?.maxIterations ?? DEFAULT_MAX_ITERATIONS,
      completion_promise: options?.completionPromise ?? DEFAULT_COMPLETION_PROMISE,
      started_at: new Date().toISOString(),
      prompt,
      session_id: sessionId
    };

    return writeAscentState(directory, state);
  };

  const cancelLoop = (sessionId: string): boolean => {
    const state = readAscentState(directory);

    if (!state || state.session_id !== sessionId) {
      return false;
    }

    return clearAscentState(directory);
  };

  const getState = (): AscentLoopState | null => {
    return readAscentState(directory);
  };

  return {
    startLoop,
    cancelLoop,
    getState
  };
}
