/**
 * Olympus State Management
 *
 * Manages persistent olympus orchestration mode state across sessions.
 * When olympus is activated and todos remain incomplete,
 * this module ensures the mode persists until all work is done.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface OlympusState {
  /** Whether olympus mode is currently active */
  active: boolean;
  /** When olympus was activated */
  started_at: string;
  /** The original prompt that triggered olympus */
  original_prompt: string;
  /** Session ID the mode is bound to */
  session_id?: string;
  /** Number of times the mode has been reinforced (for metrics) */
  reinforcement_count: number;
  /** Last time the mode was checked/reinforced */
  last_checked_at: string;
  /** Whether Oracle verification is required before completion */
  requires_oracle_verification: boolean;
  /** Whether Oracle has approved completion */
  oracle_approved: boolean;
}

const _DEFAULT_STATE: OlympusState = {
  active: false,
  started_at: '',
  original_prompt: '',
  reinforcement_count: 0,
  last_checked_at: '',
  requires_oracle_verification: false,
  oracle_approved: false
};

/**
 * Get the state file path for Olympus
 */
function getStateFilePath(directory?: string): string {
  const baseDir = directory || process.cwd();
  const olympusDir = join(baseDir, '.olympus');
  return join(olympusDir, 'olympus-state.json');
}

/**
 * Get global state file path (for cross-session persistence)
 */
function getGlobalStateFilePath(): string {
  return join(homedir(), '.claude', 'olympus-state.json');
}

/**
 * Ensure the .olympus directory exists
 */
function ensureStateDir(directory?: string): void {
  const baseDir = directory || process.cwd();
  const olympusDir = join(baseDir, '.olympus');
  if (!existsSync(olympusDir)) {
    mkdirSync(olympusDir, { recursive: true });
  }
}

/**
 * Ensure the ~/.claude directory exists
 */
function ensureGlobalStateDir(): void {
  const claudeDir = join(homedir(), '.claude');
  if (!existsSync(claudeDir)) {
    mkdirSync(claudeDir, { recursive: true });
  }
}

/**
 * Read Olympus state from disk (checks both local and global)
 */
export function readOlympusState(directory?: string): OlympusState | null {
  // Check local state first
  const localStateFile = getStateFilePath(directory);
  if (existsSync(localStateFile)) {
    try {
      const content = readFileSync(localStateFile, 'utf-8');
      return JSON.parse(content);
    } catch {
      // Fall through to global check
    }
  }

  // Check global state
  const globalStateFile = getGlobalStateFilePath();
  if (existsSync(globalStateFile)) {
    try {
      const content = readFileSync(globalStateFile, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Write Olympus state to disk (both local and global for redundancy)
 */
export function writeOlympusState(state: OlympusState, directory?: string): boolean {
  try {
    // Write to local .olympus
    ensureStateDir(directory);
    const localStateFile = getStateFilePath(directory);
    writeFileSync(localStateFile, JSON.stringify(state, null, 2));

    // Write to global ~/.claude for cross-session persistence
    ensureGlobalStateDir();
    const globalStateFile = getGlobalStateFilePath();
    writeFileSync(globalStateFile, JSON.stringify(state, null, 2));

    return true;
  } catch {
    return false;
  }
}

/**
 * Activate olympus mode
 */
export function activateOlympus(
  prompt: string,
  sessionId?: string,
  directory?: string
): boolean {
  const state: OlympusState = {
    active: true,
    started_at: new Date().toISOString(),
    original_prompt: prompt,
    session_id: sessionId,
    reinforcement_count: 0,
    last_checked_at: new Date().toISOString(),
    requires_oracle_verification: true,
    oracle_approved: false
  };

  return writeOlympusState(state, directory);
}

/**
 * Deactivate olympus mode
 */
export function deactivateOlympus(directory?: string): boolean {
  // Remove local state
  const localStateFile = getStateFilePath(directory);
  if (existsSync(localStateFile)) {
    try {
      unlinkSync(localStateFile);
    } catch {
      // Continue to global cleanup
    }
  }

  // Remove global state
  const globalStateFile = getGlobalStateFilePath();
  if (existsSync(globalStateFile)) {
    try {
      unlinkSync(globalStateFile);
      return true;
    } catch {
      return false;
    }
  }

  return true;
}

/**
 * Increment reinforcement count (called when mode is reinforced on stop)
 */
export function incrementReinforcement(directory?: string): OlympusState | null {
  const state = readOlympusState(directory);

  if (!state || !state.active) {
    return null;
  }

  state.reinforcement_count += 1;
  state.last_checked_at = new Date().toISOString();

  if (writeOlympusState(state, directory)) {
    return state;
  }

  return null;
}

/**
 * Check if olympus should be reinforced (active with pending todos)
 */
export function shouldReinforceOlympus(
  sessionId?: string,
  directory?: string
): boolean {
  const state = readOlympusState(directory);

  if (!state || !state.active) {
    return false;
  }

  // If bound to a session, only reinforce for that session
  if (state.session_id && sessionId && state.session_id !== sessionId) {
    return false;
  }

  return true;
}

/**
 * Record Oracle approval for task completion
 */
export function recordOracleApproval(directory?: string): boolean {
  const state = readOlympusState(directory);
  if (!state || !state.active) {
    return false;
  }

  state.oracle_approved = true;
  state.last_checked_at = new Date().toISOString();

  return writeOlympusState(state, directory);
}

/**
 * Get olympus persistence message for injection
 */
export function getOlympusPersistenceMessage(state: OlympusState): string {
  const verificationWarning = state.requires_oracle_verification && !state.oracle_approved
    ? `\n\n**ORACLE VERIFICATION REQUIRED**: Before declaring complete, you MUST get Oracle approval.`
    : '';

  return `<olympus-persistence>

[OLYMPUS MODE STILL ACTIVE - Reinforcement #${state.reinforcement_count + 1}]

Your orchestration session is NOT complete. Incomplete todos remain.${verificationWarning}

REMEMBER THE CONDUCTOR RULES:
- **DELEGATE**: Route specialized work to the right agents
- **PARALLEL**: Fire independent calls simultaneously
- **TODO**: Track EVERY step. Mark complete IMMEDIATELY
- **VERIFY**: Oracle must approve before completion

Continue working on the next pending task. DO NOT STOP until all tasks are complete.

Original task: ${state.original_prompt}

</olympus-persistence>

---

`;
}

/**
 * Create an Olympus State hook instance
 */
export function createOlympusStateHook(directory: string) {
  return {
    activate: (prompt: string, sessionId?: string) =>
      activateOlympus(prompt, sessionId, directory),
    deactivate: () => deactivateOlympus(directory),
    getState: () => readOlympusState(directory),
    shouldReinforce: (sessionId?: string) =>
      shouldReinforceOlympus(sessionId, directory),
    incrementReinforcement: () => incrementReinforcement(directory),
    recordOracleApproval: () => recordOracleApproval(directory)
  };
}
