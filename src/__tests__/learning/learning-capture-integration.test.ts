/**
 * Integration tests for learning-capture hooks
 * Tests the full flow: UserPromptSubmit → PostToolUse → Stop
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { registerLearningCaptureHooks } from '../../hooks/registrations/learning-capture.js';
import { routeHook } from '../../hooks/router.js';
import { loadSessionState } from '../../learning/session-state.js';
import { loadFeedback } from '../../learning/storage.js';
import type { HookContext } from '../../hooks/types.js';

const TEST_DIR = join(process.cwd(), '.test-learning-capture');

describe('Learning Capture Integration', () => {
  beforeEach(() => {
    // Create test directory
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it('should accumulate tokens across UserPromptSubmit and PostToolUse', async () => {
    // Register hooks
    registerLearningCaptureHooks();

    const sessionId = 'test-session-123';

    // 1. UserPromptSubmit - should estimate input tokens
    const promptCtx: HookContext = {
      sessionId,
      directory: TEST_DIR,
      prompt: 'Write a function that adds two numbers',
    };

    await routeHook('UserPromptSubmit', promptCtx);

    // Verify session state was updated with input tokens
    let state = loadSessionState(TEST_DIR, sessionId);
    expect(state.token_budget).toBeDefined();
    expect(state.token_budget!.current_usage).toBeGreaterThan(0);
    const afterPrompt = state.token_budget!.current_usage;

    // 2. PostToolUse - should estimate output tokens
    const toolCtx: HookContext = {
      sessionId,
      directory: TEST_DIR,
      toolName: 'Write',
      toolOutput: { content: 'function add(a, b) { return a + b; }' },
    };

    await routeHook('PostToolUse', toolCtx);

    // Verify tokens accumulated
    state = loadSessionState(TEST_DIR, sessionId);
    expect(state.token_budget!.current_usage).toBeGreaterThan(afterPrompt);
    const totalTokens = state.token_budget!.current_usage;

    // 3. Stop - should create FeedbackEntry and reset budget
    const stopCtx: HookContext = {
      sessionId,
      directory: TEST_DIR,
    };

    await routeHook('Stop', stopCtx);

    // Verify feedback was created
    const feedback = loadFeedback();
    const sessionFeedback = feedback.filter(f => f.session_id === sessionId);
    expect(sessionFeedback.length).toBeGreaterThan(0);

    const entry = sessionFeedback[0];
    expect(entry.token_usage).toBeDefined();
    expect(entry.token_usage!.total_tokens).toBe(totalTokens);
    expect(entry.token_usage!.estimated).toBe(true);

    // Verify budget was reset
    state = loadSessionState(TEST_DIR, sessionId);
    expect(state.token_budget!.current_usage).toBe(0);
  });

  it('should handle missing directory gracefully', async () => {
    registerLearningCaptureHooks();

    const ctx: HookContext = {
      sessionId: 'test-session-456',
      // directory is missing
      prompt: 'Test prompt',
    };

    // Should not throw
    const result = await routeHook('UserPromptSubmit', ctx);
    expect(result.continue).toBe(true);
  });

  it('should initialize token_budget if not present (backward compatibility)', async () => {
    registerLearningCaptureHooks();

    const sessionId = 'test-session-789';

    // Create session state without token_budget
    const olympusDir = join(TEST_DIR, '.olympus');
    if (!existsSync(olympusDir)) {
      mkdirSync(olympusDir, { recursive: true });
    }

    const ctx: HookContext = {
      sessionId,
      directory: TEST_DIR,
      prompt: 'Test prompt for backward compatibility',
    };

    await routeHook('UserPromptSubmit', ctx);

    // Verify token_budget was created
    const state = loadSessionState(TEST_DIR, sessionId);
    expect(state.token_budget).toBeDefined();
    expect(state.token_budget!.session_baseline).toBe(10000);
    expect(state.token_budget!.warning_threshold).toBe(1.5);
  });

  it('should handle Stop without any prior token accumulation', async () => {
    registerLearningCaptureHooks();

    const sessionId = 'test-session-empty';

    const stopCtx: HookContext = {
      sessionId,
      directory: TEST_DIR,
    };

    // Stop without any prior events
    const result = await routeHook('Stop', stopCtx);
    expect(result.continue).toBe(true);

    // Should not create feedback entry when tokens are 0
    const feedback = loadFeedback();
    const sessionFeedback = feedback.filter(f => f.session_id === sessionId);
    expect(sessionFeedback.length).toBe(0);
  });

  it('should handle multiple tool uses correctly', async () => {
    registerLearningCaptureHooks();

    const sessionId = 'test-session-multi';

    // Initial prompt
    await routeHook('UserPromptSubmit', {
      sessionId,
      directory: TEST_DIR,
      prompt: 'Create multiple files',
    });

    // Multiple tool uses
    const tools = ['Read', 'Write', 'Edit', 'Bash'];
    for (const tool of tools) {
      await routeHook('PostToolUse', {
        sessionId,
        directory: TEST_DIR,
        toolName: tool,
        toolOutput: { content: `Output from ${tool} tool with some content` },
      });
    }

    // Verify cumulative token count
    const state = loadSessionState(TEST_DIR, sessionId);
    expect(state.token_budget!.current_usage).toBeGreaterThan(0);

    // Stop and verify
    await routeHook('Stop', {
      sessionId,
      directory: TEST_DIR,
    });

    const feedback = loadFeedback();
    const entry = feedback.find(f => f.session_id === sessionId);
    expect(entry).toBeDefined();
    expect(entry!.token_usage!.total_tokens).toBeGreaterThan(0);
  });
});
