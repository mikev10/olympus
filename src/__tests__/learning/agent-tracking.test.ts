/**
 * Integration tests for agent-tracking hooks
 * Tests that the PreToolUse hook correctly populates pending_completion when Task tool is invoked
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { registerAgentTrackingHook } from '../../hooks/registrations/agent-tracking.js';
import { routeHook } from '../../hooks/router.js';
import { clearHooks } from '../../hooks/registry.js';
import { loadSessionState } from '../../learning/session-state.js';
import type { HookContext } from '../../hooks/types.js';

const TEST_DIR = join(process.cwd(), '.test-agent-tracking');
const TEST_LEARNING_DIR = join(TEST_DIR, '.claude', 'olympus', 'learning');

describe('Agent Tracking Integration', () => {
  beforeEach(() => {
    // Create test directory
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }
    // Create .olympus subdirectory for session state
    const olympusDir = join(TEST_DIR, '.olympus');
    if (!existsSync(olympusDir)) {
      mkdirSync(olympusDir, { recursive: true });
    }
    // Create learning directory
    mkdirSync(TEST_LEARNING_DIR, { recursive: true });

    // Override learning directory to use test directory
    process.env.OLYMPUS_TEST_LEARNING_DIR = TEST_LEARNING_DIR;
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
  });

  it('should populate pending_completion when Task tool is invoked', async () => {
    // Register hooks
    registerAgentTrackingHook();

    const sessionId = 'test-session-at-1';

    // Create PreToolUse HookContext with Task tool
    const ctx: HookContext = {
      sessionId,
      directory: TEST_DIR,
      toolName: 'Task',
      toolInput: {
        subagent_type: 'olympian',
        prompt: 'Fix the login bug in auth.ts',
      },
    };

    // Route the hook
    await routeHook('PreToolUse', ctx);

    // Load session state
    const state = loadSessionState(TEST_DIR, sessionId);

    // Assert: pending_completion is not null
    expect(state.pending_completion).not.toBeNull();
    expect(state.pending_completion).toBeDefined();

    // Assert: task_description matches the prompt
    expect(state.pending_completion!.task_description).toBe('Fix the login bug in auth.ts');

    // Assert: agent_used matches the subagent_type
    expect(state.pending_completion!.agent_used).toBe('olympian');

    // Assert: claimed_at is defined
    expect(state.pending_completion!.claimed_at).toBeDefined();
    expect(typeof state.pending_completion!.claimed_at).toBe('string');
  });

  it('should skip non-Task tools', async () => {
    // Register hooks
    registerAgentTrackingHook();

    const sessionId = 'test-session-at-2';

    // Create context with toolName: 'Read' (not Task)
    const ctx: HookContext = {
      sessionId,
      directory: TEST_DIR,
      toolName: 'Read',
      toolInput: {
        file_path: '/some/path.ts',
      },
    };

    // Route the hook
    await routeHook('PreToolUse', ctx);

    // Load state and verify pending_completion is null
    const state = loadSessionState(TEST_DIR, sessionId);
    expect(state.pending_completion).toBeNull();
  });

  it('should track agent in agents_used array', async () => {
    // Register hooks
    registerAgentTrackingHook();

    const sessionId = 'test-session-at-3';

    // Create context for Task tool with subagent_type: 'explore'
    const ctx: HookContext = {
      sessionId,
      directory: TEST_DIR,
      toolName: 'Task',
      toolInput: {
        subagent_type: 'explore',
        prompt: 'Find all TypeScript files in the src directory',
      },
    };

    // Route the hook
    await routeHook('PreToolUse', ctx);

    // Load state and verify agents_used includes 'explore'
    const state = loadSessionState(TEST_DIR, sessionId);
    expect(state.token_budget).toBeDefined();
    expect(state.token_budget!.agents_used).toBeDefined();
    expect(state.token_budget!.agents_used).toContain('explore');
  });

  it('should handle missing toolInput gracefully', async () => {
    // Register hooks
    registerAgentTrackingHook();

    const sessionId = 'test-session-at-4';

    // Create context with toolName: 'Task' but no toolInput
    const ctx: HookContext = {
      sessionId,
      directory: TEST_DIR,
      toolName: 'Task',
      // No toolInput
    };

    // Route the hook - should not throw
    const result = await routeHook('PreToolUse', ctx);
    expect(result.continue).toBe(true);

    // Verify no errors thrown, pending_completion is null
    const state = loadSessionState(TEST_DIR, sessionId);
    expect(state.pending_completion).toBeNull();
  });
});
