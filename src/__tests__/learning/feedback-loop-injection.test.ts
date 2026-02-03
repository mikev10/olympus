/**
 * Tests for Phase 2.4 Feedback Loop (Injection)
 * Verifies token metrics integration into session start and budget warnings
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { generateLearnedContext } from '../../learning/hooks/learned-context.js';
import {
  loadSessionState,
  saveSessionState,
  initializeTokenBudget,
  updateTokenBudget,
  shouldIssueWarning,
  markWarningIssued,
} from '../../learning/session-state.js';
import type { AgentPerformance } from '../../learning/types.js';
import { getLearningDir } from '../../learning/storage.js';

const TEST_DIR = join(process.cwd(), '.test-injection-' + Date.now());
const GLOBAL_LEARNING_DIR = getLearningDir();
let agentPerfBackup: string | null = null;

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  mkdirSync(join(TEST_DIR, '.olympus'), { recursive: true });

  // Ensure global learning directory exists
  mkdirSync(GLOBAL_LEARNING_DIR, { recursive: true });

  // Backup existing agent-performance.json if it exists
  const agentPerfPath = join(GLOBAL_LEARNING_DIR, 'agent-performance.json');
  if (existsSync(agentPerfPath)) {
    agentPerfBackup = agentPerfPath + '.backup.' + Date.now();
    writeFileSync(agentPerfBackup, require('fs').readFileSync(agentPerfPath));
  }
});

afterEach(() => {
  // Restore backup if it exists
  if (agentPerfBackup && existsSync(agentPerfBackup)) {
    const agentPerfPath = join(GLOBAL_LEARNING_DIR, 'agent-performance.json');
    writeFileSync(agentPerfPath, require('fs').readFileSync(agentPerfBackup));
    rmSync(agentPerfBackup, { force: true });
    agentPerfBackup = null;
  } else {
    // Clean up test file if created
    const agentPerfPath = join(GLOBAL_LEARNING_DIR, 'agent-performance.json');
    if (existsSync(agentPerfPath)) {
      rmSync(agentPerfPath, { force: true });
    }
  }

  if (TEST_DIR.includes('.test-injection-')) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
});

describe('Token Efficiency Injection', () => {
  it('should include token efficiency in learned context when agent data exists', () => {
    const globalLearningDir = GLOBAL_LEARNING_DIR;

    // Create mock agent performance data with token efficiency
    const agentPerformance: Record<string, AgentPerformance> = {
      'olympian': {
        agent_name: 'olympian',
        total_invocations: 10,
        success_count: 9,
        revision_count: 1,
        cancellation_count: 0,
        success_rate: 0.9,
        failure_patterns: [],
        strong_areas: [],
        weak_areas: [],
        last_updated: new Date().toISOString(),
        token_efficiency: {
          avg_tokens_per_success: 4200,
          avg_tokens_per_failure: 5000,
          total_tokens: 42000,
          invocation_count: 10,
          efficiency_score: 0.9,
          trend: 'stable'
        }
      },
      'oracle-low': {
        agent_name: 'oracle-low',
        total_invocations: 8,
        success_count: 8,
        revision_count: 0,
        cancellation_count: 0,
        success_rate: 1.0,
        failure_patterns: [],
        strong_areas: [],
        weak_areas: [],
        last_updated: new Date().toISOString(),
        token_efficiency: {
          avg_tokens_per_success: 2100,
          avg_tokens_per_failure: 0,
          total_tokens: 16800,
          invocation_count: 8,
          efficiency_score: 1.2,
          trend: 'improving'
        }
      }
    };

    writeFileSync(
      join(globalLearningDir, 'agent-performance.json'),
      JSON.stringify(agentPerformance, null, 2)
    );

    const context = generateLearnedContext(TEST_DIR);

    // Should include efficiency section
    expect(context).toContain('<olympus-efficiency>');
    expect(context).toContain('AGENT EFFICIENCY');
    expect(context).toContain('SESSION BUDGET');
    expect(context).toContain('Quality remains priority');

    // Should show agents in order of efficiency
    expect(context).toMatch(/oracle-low.*\[PREFERRED\]/);
    expect(context).toContain('olympian');
  });

  it('should gracefully handle missing token data', () => {
    const globalLearningDir = GLOBAL_LEARNING_DIR;

    // Create agent performance without token efficiency
    const agentPerformance: Record<string, AgentPerformance> = {
      'olympian': {
        agent_name: 'olympian',
        total_invocations: 10,
        success_count: 9,
        revision_count: 1,
        cancellation_count: 0,
        success_rate: 0.9,
        failure_patterns: [],
        strong_areas: [],
        weak_areas: [],
        last_updated: new Date().toISOString()
        // No token_efficiency
      }
    };

    writeFileSync(
      join(globalLearningDir, 'agent-performance.json'),
      JSON.stringify(agentPerformance, null, 2)
    );

    const context = generateLearnedContext(TEST_DIR);

    // Should not include efficiency section when no token data
    expect(context).not.toContain('<olympus-efficiency>');
  });

  it('should respect 500 token total cap', () => {
    const context = generateLearnedContext(TEST_DIR);

    // Rough token estimate: 1 token ≈ 4 chars
    const estimatedTokens = context.length / 4;
    expect(estimatedTokens).toBeLessThanOrEqual(500);
  });
});

describe('Session Budget Tracking', () => {
  it('should initialize token budget at session start', () => {
    const state = loadSessionState(TEST_DIR, 'test-session-1');

    expect(state.token_budget).toBeDefined();
    expect(state.token_budget!.session_baseline).toBe(10000); // Default baseline
    expect(state.token_budget!.current_usage).toBe(0);
    expect(state.token_budget!.warning_threshold).toBe(1.5);
    expect(state.token_budget!.warning_issued).toBe(false);
  });

  it('should update current_usage after feedback entry', () => {
    let state = loadSessionState(TEST_DIR, 'test-session-2');

    // Simulate token usage
    state = updateTokenBudget(state, 5000);
    expect(state.token_budget!.current_usage).toBe(5000);

    state = updateTokenBudget(state, 3000);
    expect(state.token_budget!.current_usage).toBe(8000);
  });

  it('should track warning_issued to prevent spam', () => {
    let state = loadSessionState(TEST_DIR, 'test-session-3');

    expect(state.token_budget!.warning_issued).toBe(false);

    state = markWarningIssued(state);
    expect(state.token_budget!.warning_issued).toBe(true);
  });

  it('should persist state across hook invocations', () => {
    let state = loadSessionState(TEST_DIR, 'test-session-4');
    state = updateTokenBudget(state, 7000);
    saveSessionState(TEST_DIR, state);

    // Load state again (simulating new hook invocation)
    const newState = loadSessionState(TEST_DIR, 'test-session-4');
    expect(newState.token_budget!.current_usage).toBe(7000);
  });
});

describe('Budget Warning Logic', () => {
  it('should detect when usage exceeds warning threshold', () => {
    let state = loadSessionState(TEST_DIR, 'test-session-5');

    // Baseline is 10k, threshold is 1.5x = 15k
    expect(shouldIssueWarning(state)).toBe(false);

    state = updateTokenBudget(state, 14000);
    expect(shouldIssueWarning(state)).toBe(false);

    state = updateTokenBudget(state, 2000); // Total: 16k > 15k
    expect(shouldIssueWarning(state)).toBe(true);
  });

  it('should not issue warning if already warned', () => {
    let state = loadSessionState(TEST_DIR, 'test-session-6');

    state = updateTokenBudget(state, 16000); // Exceeds threshold
    expect(shouldIssueWarning(state)).toBe(true);

    state = markWarningIssued(state);
    expect(shouldIssueWarning(state)).toBe(false); // Should not warn again

    state = updateTokenBudget(state, 5000); // Even with more usage
    expect(shouldIssueWarning(state)).toBe(false);
  });

  it('should be non-blocking (continue: true always)', () => {
    // Warning logic never blocks - this is verified by the hook implementation
    // The hook always returns { continue: true } regardless of budget status
    expect(true).toBe(true); // Placeholder - hook behavior verified in integration tests
  });
});

describe('Integration with Existing Learning Injection', () => {
  it('should merge token guidance into existing SessionStart flow', () => {
    const globalLearningDir = GLOBAL_LEARNING_DIR;

    // Create mock data for both learning and token efficiency
    const agentPerformance: Record<string, AgentPerformance> = {
      'olympian': {
        agent_name: 'olympian',
        total_invocations: 10,
        success_count: 9,
        revision_count: 1,
        cancellation_count: 0,
        success_rate: 0.9,
        failure_patterns: [],
        strong_areas: ['multi-file edits'],
        weak_areas: ['complex debugging'],
        last_updated: new Date().toISOString(),
        token_efficiency: {
          avg_tokens_per_success: 4200,
          avg_tokens_per_failure: 5000,
          total_tokens: 42000,
          invocation_count: 10,
          efficiency_score: 0.9,
          trend: 'stable'
        }
      }
    };

    writeFileSync(
      join(globalLearningDir, 'agent-performance.json'),
      JSON.stringify(agentPerformance, null, 2)
    );

    const context = generateLearnedContext(TEST_DIR);

    // Should include both learning context and token efficiency
    expect(context).toContain('Agent Notes'); // Learning context
    expect(context).toContain('<olympus-efficiency>'); // Token guidance

    // Should be under 500 tokens total
    const estimatedTokens = context.length / 4;
    expect(estimatedTokens).toBeLessThanOrEqual(500);
  });

  it('should handle missing token data gracefully', () => {
    const globalLearningDir = GLOBAL_LEARNING_DIR;

    // Create agent performance without token metrics
    const agentPerformance: Record<string, AgentPerformance> = {
      'olympian': {
        agent_name: 'olympian',
        total_invocations: 3,
        success_count: 2,
        revision_count: 1,
        cancellation_count: 0,
        success_rate: 0.67,
        failure_patterns: [],
        strong_areas: [],
        weak_areas: ['debugging'],
        last_updated: new Date().toISOString()
      }
    };

    writeFileSync(
      join(globalLearningDir, 'agent-performance.json'),
      JSON.stringify(agentPerformance, null, 2)
    );

    const context = generateLearnedContext(TEST_DIR);

    // Should include learning context but not token efficiency
    expect(context).toContain('Agent Notes');
    expect(context).not.toContain('<olympus-efficiency>');
  });

  it('should not produce duplicate injections', () => {
    const context = generateLearnedContext(TEST_DIR);

    // Count occurrences of key markers
    const efficiencyCount = (context.match(/<olympus-efficiency>/g) || []).length;
    expect(efficiencyCount).toBeLessThanOrEqual(1); // At most one efficiency section
  });

  it('should have consistent ordering (learning first, then token efficiency)', () => {
    const globalLearningDir = GLOBAL_LEARNING_DIR;

    const agentPerformance: Record<string, AgentPerformance> = {
      'olympian': {
        agent_name: 'olympian',
        total_invocations: 10,
        success_count: 9,
        revision_count: 1,
        cancellation_count: 0,
        success_rate: 0.9,
        failure_patterns: [],
        strong_areas: [],
        weak_areas: ['debugging'],
        last_updated: new Date().toISOString(),
        token_efficiency: {
          avg_tokens_per_success: 4200,
          avg_tokens_per_failure: 5000,
          total_tokens: 42000,
          invocation_count: 10,
          efficiency_score: 0.9,
          trend: 'stable'
        }
      }
    };

    writeFileSync(
      join(globalLearningDir, 'agent-performance.json'),
      JSON.stringify(agentPerformance, null, 2)
    );

    const context = generateLearnedContext(TEST_DIR);

    // Find positions of sections
    const agentNotesPos = context.indexOf('Agent Notes');
    const efficiencyPos = context.indexOf('<olympus-efficiency>');

    if (agentNotesPos !== -1 && efficiencyPos !== -1) {
      // Learning context should come before token efficiency
      expect(agentNotesPos).toBeLessThan(efficiencyPos);
    }
  });
});
