/**
 * Performance benchmark test for Stop hook
 * Verifies that the Stop hook completes within acceptable time limits
 * and does NOT call loadFeedback (which would load entire log into memory)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { registerLearningCaptureHooks } from '../../hooks/registrations/learning-capture.js';
import { routeHook } from '../../hooks/router.js';
import { clearHooks } from '../../hooks/registry.js';
import { saveSessionState } from '../../learning/session-state.js';
import { estimateTokens } from '../../learning/token-estimator.js';
import * as storage from '../../learning/storage.js';
import type { HookContext } from '../../hooks/types.js';
import type { SessionState } from '../../learning/types.js';

const TEST_DIR = join(process.cwd(), '.test-stop-hook-performance');
const TEST_LEARNING_DIR = join(TEST_DIR, '.claude', 'olympus', 'learning');

describe('Stop Hook Performance', () => {
  beforeEach(async () => {
    // Create test directory
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }
    mkdirSync(TEST_LEARNING_DIR, { recursive: true });

    // Override learning directory to use test directory
    process.env.OLYMPUS_TEST_LEARNING_DIR = TEST_LEARNING_DIR;

    // Pre-initialize tokenizer to avoid async import delays during hook execution
    await estimateTokens('warm up tokenizer');
  });

  afterEach(() => {
    // Clean up environment variable
    delete process.env.OLYMPUS_TEST_LEARNING_DIR;

    // Clean up test directory
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }

    // Clear hooks registry to prevent interference between tests
    clearHooks();

    // Restore all mocks
    vi.restoreAllMocks();
  });

  it('should complete Stop hook within 80ms even with 5000 feedback entries', async () => {
    // Create a large feedback log file to simulate production scenario
    const feedbackLogPath = join(TEST_LEARNING_DIR, 'feedback-log.jsonl');
    const mockFeedbackEntry = {
      id: 'test-id',
      timestamp: new Date().toISOString(),
      session_id: 'test-session',
      project_path: TEST_DIR,
      event_type: 'success',
      user_message: 'Test entry',
      feedback_category: 'praise',
      confidence: 0.5,
      token_usage: {
        input_tokens: 1000,
        output_tokens: 2000,
        total_tokens: 3000,
        estimated: true,
        model: 'claude-sonnet-4-5',
      },
      cost_estimate: {
        input_cost: 0.003,
        output_cost: 0.015,
        total_cost: 0.018,
        pricing_version: '2025-01-01',
      },
    };

    // Write 5000 entries to simulate a large log
    const entries = Array(5000)
      .fill(mockFeedbackEntry)
      .map((entry, i) => JSON.stringify({ ...entry, id: `test-id-${i}` }))
      .join('\n');
    writeFileSync(feedbackLogPath, entries + '\n', 'utf-8');

    // Spy on loadFeedback and updateAgentPerformance to verify they're NOT called
    const loadFeedbackSpy = vi.spyOn(storage, 'loadFeedback');
    const updateAgentPerformanceSpy = vi.spyOn(storage, 'updateAgentPerformance');

    // Register the learning capture hooks
    registerLearningCaptureHooks();

    const sessionId = 'test-session-performance';

    // Create a realistic session state with token usage
    const sessionState: SessionState = {
      session_id: sessionId,
      created_at: new Date().toISOString(),
      last_updated: new Date().toISOString(),
      recent_prompts: [],
      pending_completion: {
        agent_used: 'oracle',
        task_description: 'Test task for performance benchmark',
        claimed_at: new Date().toISOString(),
      },
      token_budget: {
        session_baseline: 10000,
        current_usage: 5000,
        input_tokens: 2000,
        output_tokens: 3000,
        warning_threshold: 1.5,
        warning_issued: false,
        started_at: new Date().toISOString(),
        current_model: 'anthropic/claude-sonnet-4-5',
      },
    };

    saveSessionState(TEST_DIR, sessionState);

    // Create Stop hook context
    const ctx: HookContext = {
      sessionId,
      directory: TEST_DIR,
    };

    // Measure execution time
    const startTime = performance.now();
    await routeHook('Stop', ctx);
    const endTime = performance.now();

    const executionTime = endTime - startTime;

    // Verify performance: should complete within 80ms
    expect(executionTime).toBeLessThan(80);

    // CRITICAL: Verify loadFeedback was NOT called
    // This would be the performance bottleneck we're removing
    expect(loadFeedbackSpy).not.toHaveBeenCalled();

    // CRITICAL: Verify updateAgentPerformance was NOT called
    // This depends on loadFeedback and would be slow
    expect(updateAgentPerformanceSpy).not.toHaveBeenCalled();

    console.log(`Stop hook completed in ${executionTime.toFixed(2)}ms with 5000 feedback entries`);
  });

  it('should still append feedback entry correctly (core functionality)', async () => {
    // Spy on appendFeedback to verify it IS called (this is the core functionality we keep)
    const appendFeedbackSpy = vi.spyOn(storage, 'appendFeedback');

    registerLearningCaptureHooks();

    const sessionId = 'test-session-append';

    // Create session state with token usage
    const sessionState: SessionState = {
      session_id: sessionId,
      created_at: new Date().toISOString(),
      last_updated: new Date().toISOString(),
      recent_prompts: [],
      pending_completion: {
        agent_used: 'olympian',
        task_description: 'Test append functionality',
        claimed_at: new Date().toISOString(),
      },
      token_budget: {
        session_baseline: 10000,
        current_usage: 1000,
        input_tokens: 400,
        output_tokens: 600,
        warning_threshold: 1.5,
        warning_issued: false,
        started_at: new Date().toISOString(),
        current_model: 'anthropic/claude-sonnet-4-5',
      },
    };

    saveSessionState(TEST_DIR, sessionState);

    const ctx: HookContext = {
      sessionId,
      directory: TEST_DIR,
    };

    await routeHook('Stop', ctx);

    // Verify appendFeedback WAS called with correct data
    expect(appendFeedbackSpy).toHaveBeenCalledTimes(1);
    const feedbackEntry = appendFeedbackSpy.mock.calls[0][0];

    expect(feedbackEntry.session_id).toBe(sessionId);
    expect(feedbackEntry.agent_used).toBe('olympian');
    expect(feedbackEntry.original_task).toBe('Test append functionality');
    expect(feedbackEntry.token_usage).toBeDefined();
    expect(feedbackEntry.token_usage!.total_tokens).toBe(1000);
    expect(feedbackEntry.token_usage!.input_tokens).toBe(400);
    expect(feedbackEntry.token_usage!.output_tokens).toBe(600);
  });

  it('should complete quickly with no token usage (edge case)', async () => {
    registerLearningCaptureHooks();

    const sessionId = 'test-session-no-tokens';

    // Create session state with zero token usage
    const sessionState: SessionState = {
      session_id: sessionId,
      created_at: new Date().toISOString(),
      last_updated: new Date().toISOString(),
      recent_prompts: [],
      pending_completion: null,
      token_budget: {
        session_baseline: 10000,
        current_usage: 0,
        input_tokens: 0,
        output_tokens: 0,
        warning_threshold: 1.5,
        warning_issued: false,
        started_at: new Date().toISOString(),
      },
    };

    saveSessionState(TEST_DIR, sessionState);

    const ctx: HookContext = {
      sessionId,
      directory: TEST_DIR,
    };

    const startTime = performance.now();
    await routeHook('Stop', ctx);
    const endTime = performance.now();

    const executionTime = endTime - startTime;

    // Should be very fast when skipping (no feedback entry created)
    expect(executionTime).toBeLessThan(50);

    console.log(`Stop hook (no tokens) completed in ${executionTime.toFixed(2)}ms`);
  });
});
