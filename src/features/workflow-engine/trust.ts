import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import type { TrustState, TrustLevel, TrustLevelChange, RiskTier } from './phase-types.js';

const TRUST_STATE_FILE = '.olympus/trust-state.json';

/**
 * Creates a default trust state with Level 0 and all counters at zero.
 */
export function createDefaultTrustState(): TrustState {
  return {
    current_level: 0,
    total_transitions: 0,
    rejection_count: 0,
    rejection_rate: 0,
    incident_count: 0,
    last_level_change: null,
    level_history: [],
  };
}

/**
 * Loads trust state from `.olympus/trust-state.json`.
 * Returns default state if file doesn't exist or on error.
 */
export function loadTrustState(projectPath?: string): TrustState {
  try {
    const basePath = projectPath || process.cwd();
    const filePath = join(basePath, TRUST_STATE_FILE);

    if (!existsSync(filePath)) {
      return createDefaultTrustState();
    }

    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as TrustState;
  } catch (error) {
    console.error('Error loading trust state:', error);
    return createDefaultTrustState();
  }
}

/**
 * Saves trust state to `.olympus/trust-state.json`.
 * Creates directory if needed. Silent error handling.
 */
export function saveTrustState(state: TrustState, projectPath?: string): void {
  try {
    const basePath = projectPath || process.cwd();
    const dirPath = join(basePath, '.olympus');
    const filePath = join(basePath, TRUST_STATE_FILE);

    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true });
    }

    writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8');
  } catch (error) {
    console.error('Error saving trust state:', error);
  }
}

/**
 * Evaluates the trust level based on state metrics.
 * Returns the highest level the state qualifies for.
 *
 * Levels:
 * - Level 0 (Baseline): Default
 * - Level 1 (Earned): total_transitions >= 10
 * - Level 2 (Extended): total_transitions >= 20 AND rejection_rate < 0.05
 * - Level 3 (Trusted): total_transitions >= 50 AND rejection_rate < 0.02 AND incident_count === 0
 */
export function evaluateTrustLevel(state: TrustState): TrustLevel {
  if (
    state.total_transitions >= 50 &&
    state.rejection_rate < 0.02 &&
    state.incident_count === 0
  ) {
    return 3;
  }

  if (state.total_transitions >= 20 && state.rejection_rate < 0.05) {
    return 2;
  }

  if (state.total_transitions >= 10) {
    return 1;
  }

  return 0;
}

/**
 * Records a phase transition and updates trust metrics.
 * Returns new state (immutable pattern).
 *
 * @param state - Current trust state
 * @param success - Whether transition succeeded
 * @param rejected - Whether transition was rejected by quality gate
 */
export function recordTransition(
  state: TrustState,
  success: boolean,
  rejected: boolean
): TrustState {
  const newTotalTransitions = state.total_transitions + 1;
  const newRejectionCount = rejected ? state.rejection_count + 1 : state.rejection_count;
  const newRejectionRate = newRejectionCount / newTotalTransitions;

  const newState: TrustState = {
    ...state,
    total_transitions: newTotalTransitions,
    rejection_count: newRejectionCount,
    rejection_rate: newRejectionRate,
  };

  const newLevel = evaluateTrustLevel(newState);

  if (newLevel !== state.current_level) {
    const change: TrustLevelChange = {
      from: state.current_level,
      to: newLevel,
      reason: newLevel > state.current_level ? 'Qualification threshold met' : 'Metrics degraded',
      timestamp: new Date().toISOString(),
    };

    return {
      ...newState,
      current_level: newLevel,
      last_level_change: change.timestamp,
      level_history: [...state.level_history, change],
    };
  }

  return newState;
}

/**
 * Resets trust level to 0 due to specified reason.
 * Does NOT reset historical counters (total_transitions, rejection_count).
 * Returns new state (immutable pattern).
 */
export function resetTrust(state: TrustState, reason: string): TrustState {
  const change: TrustLevelChange = {
    from: state.current_level,
    to: 0,
    reason,
    timestamp: new Date().toISOString(),
  };

  return {
    ...state,
    current_level: 0,
    last_level_change: change.timestamp,
    level_history: [...state.level_history, change],
  };
}

/**
 * Determines if a phase transition should auto-advance based on trust level and risk tier.
 *
 * Matrix:
 * - Trust 0: NEVER auto-advance (always manual)
 * - Trust 1: Only Tier 1 auto-advances
 * - Trust 2: Tier 1 AND Tier 2 auto-advance
 * - Trust 3: Tier 1, Tier 2, AND Tier 3 auto-advance (streamlined)
 */
export function shouldAutoAdvance(riskTier: RiskTier, trustLevel: TrustLevel): boolean {
  return trustLevel >= riskTier;
}

/**
 * Checks if trust should be reset based on current state.
 * Returns whether reset is needed and the reason.
 */
export function checkTrustReset(state: TrustState): { shouldReset: boolean; reason: string | null } {
  if (state.incident_count > 0 && state.current_level > 0) {
    return {
      shouldReset: true,
      reason: `Incidents detected (${state.incident_count})`,
    };
  }

  if (state.rejection_rate > 0.10 && state.total_transitions >= 10 && state.current_level > 0) {
    return {
      shouldReset: true,
      reason: `Sustained high rejection rate (${(state.rejection_rate * 100).toFixed(1)}%)`,
    };
  }

  return {
    shouldReset: false,
    reason: null,
  };
}
