/**
 * Comprehensive tests for agent tracking hook
 * Verifies that Task tool usage correctly captures agent information
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { registerAgentTrackingHook } from '../../hooks/registrations/agent-tracking.js';
import { routeHook } from '../../hooks/router.js';
import { clearHooks } from '../../hooks/registry.js';
import { loadSessionState } from '../../learning/session-state.js';
import { estimateTokens } from '../../learning/token-estimator.js';
import type { HookContext } from '../../hooks/types.js';

const TEST_DIR = join(process.cwd(), '.test-agent-tracking');
const TEST_LEARNING_DIR = join(TEST_DIR, '.claude', 'olympus', 'learning');

describe('Agent Tracking Hook', () => {
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
  });

  it('should capture agent information from Task tool usage', async () => {
    registerAgentTrackingHook();

    const sessionId = 'test-session-agent-123';
    const subagentType = 'oracle';
    const taskPrompt = 'Analyze the codebase architecture';

    // Fire PreToolUse with Task tool
    const ctx: HookContext = {
      sessionId,
      directory: TEST_DIR,
      toolName: 'Task',
      toolInput: {
        subagent_type: subagentType,
        prompt: taskPrompt,
      },
    };

    await routeHook('PreToolUse', ctx);

    // Verify session state was updated
    const state = loadSessionState(TEST_DIR, sessionId);

    // Check that pending_completion was populated
    expect(state.pending_completion).toBeDefined();
    expect(state.pending_completion).not.toBeNull();
    expect(state.pending_completion!.agent_used).toBe(subagentType);
    expect(state.pending_completion!.task_description).toBe(taskPrompt);
    expect(state.pending_completion!.claimed_at).toBeDefined();

    // Verify claimed_at is a valid ISO timestamp
    const claimedAt = new Date(state.pending_completion!.claimed_at);
    expect(claimedAt.toString()).not.toBe('Invalid Date');
  });

  it('should ignore non-Task tools without modifying session state', async () => {
    registerAgentTrackingHook();

    const sessionId = 'test-session-non-task';
    const nonTaskTools = ['Read', 'Write', 'Edit', 'Bash', 'Grep'];

    for (const toolName of nonTaskTools) {
      // Clear state between tool tests
      const stateBefore = loadSessionState(TEST_DIR, sessionId);

      const ctx: HookContext = {
        sessionId,
        directory: TEST_DIR,
        toolName,
        toolInput: {
          some_param: 'some value',
        },
      };

      const result = await routeHook('PreToolUse', ctx);

      // Hook should continue
      expect(result.continue).toBe(true);

      // Session state should not have pending_completion added
      const stateAfter = loadSessionState(TEST_DIR, sessionId);

      // If there was no pending_completion before, there shouldn't be one after
      if (!stateBefore.pending_completion) {
        expect(stateAfter.pending_completion).toBeNull();
      }
    }
  });

  it('should handle missing context fields gracefully', async () => {
    registerAgentTrackingHook();

    const sessionId = 'test-session-missing-fields';

    // Test 1: Missing directory
    const ctxNoDir: HookContext = {
      sessionId,
      // directory is missing
      toolName: 'Task',
      toolInput: {
        subagent_type: 'oracle',
        prompt: 'Test task',
      },
    };

    let result = await routeHook('PreToolUse', ctxNoDir);
    expect(result.continue).toBe(true);

    // Test 2: Missing sessionId
    const ctxNoSession: HookContext = {
      // sessionId is missing
      directory: TEST_DIR,
      toolName: 'Task',
      toolInput: {
        subagent_type: 'oracle',
        prompt: 'Test task',
      },
    };

    result = await routeHook('PreToolUse', ctxNoSession);
    expect(result.continue).toBe(true);

    // Test 3: Missing toolInput
    const ctxNoInput: HookContext = {
      sessionId,
      directory: TEST_DIR,
      toolName: 'Task',
      // toolInput is missing
    };

    result = await routeHook('PreToolUse', ctxNoInput);
    expect(result.continue).toBe(true);

    // Verify no session state was created or modified
    const state = loadSessionState(TEST_DIR, sessionId);
    expect(state.pending_completion).toBeNull();
  });

  it('should handle malformed toolInput gracefully', async () => {
    registerAgentTrackingHook();

    const sessionId = 'test-session-malformed';

    // Test 1: Missing subagent_type
    const ctxNoAgent: HookContext = {
      sessionId,
      directory: TEST_DIR,
      toolName: 'Task',
      toolInput: {
        // subagent_type is missing
        prompt: 'Test task',
      },
    };

    let result = await routeHook('PreToolUse', ctxNoAgent);
    expect(result.continue).toBe(true);

    let state = loadSessionState(TEST_DIR, sessionId);
    expect(state.pending_completion).toBeNull();

    // Test 2: Missing prompt
    const ctxNoPrompt: HookContext = {
      sessionId,
      directory: TEST_DIR,
      toolName: 'Task',
      toolInput: {
        subagent_type: 'oracle',
        // prompt is missing
      },
    };

    result = await routeHook('PreToolUse', ctxNoPrompt);
    expect(result.continue).toBe(true);

    state = loadSessionState(TEST_DIR, sessionId);
    expect(state.pending_completion).toBeNull();

    // Test 3: Wrong types (non-string values)
    const ctxWrongTypes: HookContext = {
      sessionId,
      directory: TEST_DIR,
      toolName: 'Task',
      toolInput: {
        subagent_type: 123, // number instead of string
        prompt: { nested: 'object' }, // object instead of string
      },
    };

    result = await routeHook('PreToolUse', ctxWrongTypes);
    expect(result.continue).toBe(true);

    state = loadSessionState(TEST_DIR, sessionId);
    expect(state.pending_completion).toBeNull();

    // Test 4: Empty strings
    const ctxEmptyStrings: HookContext = {
      sessionId,
      directory: TEST_DIR,
      toolName: 'Task',
      toolInput: {
        subagent_type: '',
        prompt: '',
      },
    };

    result = await routeHook('PreToolUse', ctxEmptyStrings);
    expect(result.continue).toBe(true);

    state = loadSessionState(TEST_DIR, sessionId);
    expect(state.pending_completion).toBeNull();
  });

  it('should track multiple Task invocations in sequence', async () => {
    registerAgentTrackingHook();

    const sessionId = 'test-session-multiple';

    const tasks = [
      { agent: 'oracle', prompt: 'First task - analyze architecture' },
      { agent: 'olympian', prompt: 'Second task - implement feature' },
      { agent: 'librarian', prompt: 'Third task - find documentation' },
    ];

    for (const task of tasks) {
      const ctx: HookContext = {
        sessionId,
        directory: TEST_DIR,
        toolName: 'Task',
        toolInput: {
          subagent_type: task.agent,
          prompt: task.prompt,
        },
      };

      await routeHook('PreToolUse', ctx);

      // Verify each task is tracked correctly
      const state = loadSessionState(TEST_DIR, sessionId);
      expect(state.pending_completion).toBeDefined();
      expect(state.pending_completion!.agent_used).toBe(task.agent);
      expect(state.pending_completion!.task_description).toBe(task.prompt);
    }
  });

  it('should handle various agent types correctly', async () => {
    registerAgentTrackingHook();

    const sessionId = 'test-session-agent-types';

    const agentTypes = [
      'oracle',
      'oracle-low',
      'oracle-medium',
      'olympian',
      'olympian-low',
      'olympian-high',
      'librarian',
      'explore',
      'frontend-engineer',
      'document-writer',
      'prometheus',
      'momus',
      'metis',
    ];

    for (const agentType of agentTypes) {
      const ctx: HookContext = {
        sessionId,
        directory: TEST_DIR,
        toolName: 'Task',
        toolInput: {
          subagent_type: agentType,
          prompt: `Test task for ${agentType}`,
        },
      };

      await routeHook('PreToolUse', ctx);

      const state = loadSessionState(TEST_DIR, sessionId);
      expect(state.pending_completion).toBeDefined();
      expect(state.pending_completion!.agent_used).toBe(agentType);
    }
  });

  it('should preserve session state across hook invocations', async () => {
    registerAgentTrackingHook();

    const sessionId = 'test-session-preservation';

    // First Task invocation
    const ctx1: HookContext = {
      sessionId,
      directory: TEST_DIR,
      toolName: 'Task',
      toolInput: {
        subagent_type: 'oracle',
        prompt: 'First task',
      },
    };

    await routeHook('PreToolUse', ctx1);

    const state1 = loadSessionState(TEST_DIR, sessionId);
    const firstClaimedAt = state1.pending_completion!.claimed_at;

    // Wait a tiny bit to ensure timestamp difference
    await new Promise(resolve => setTimeout(resolve, 10));

    // Second Task invocation - should update pending_completion
    const ctx2: HookContext = {
      sessionId,
      directory: TEST_DIR,
      toolName: 'Task',
      toolInput: {
        subagent_type: 'olympian',
        prompt: 'Second task',
      },
    };

    await routeHook('PreToolUse', ctx2);

    const state2 = loadSessionState(TEST_DIR, sessionId);

    // Verify the second task overwrote the first
    expect(state2.pending_completion!.agent_used).toBe('olympian');
    expect(state2.pending_completion!.task_description).toBe('Second task');
    expect(state2.pending_completion!.claimed_at).not.toBe(firstClaimedAt);
  });

  it('should not interfere with other session state fields', async () => {
    registerAgentTrackingHook();

    const sessionId = 'test-session-no-interference';

    // Load initial state to get baseline
    const initialState = loadSessionState(TEST_DIR, sessionId);

    // Verify initial state structure
    expect(initialState.session_id).toBe(sessionId);
    expect(initialState.recent_prompts).toEqual([]);
    expect(initialState.pending_completion).toBeNull();
    expect(initialState.token_budget).toBeDefined();

    // Fire Task tool
    const ctx: HookContext = {
      sessionId,
      directory: TEST_DIR,
      toolName: 'Task',
      toolInput: {
        subagent_type: 'oracle',
        prompt: 'Test task',
      },
    };

    await routeHook('PreToolUse', ctx);

    const finalState = loadSessionState(TEST_DIR, sessionId);

    // Verify only pending_completion changed
    expect(finalState.session_id).toBe(sessionId);
    expect(finalState.recent_prompts).toEqual([]);
    expect(finalState.token_budget).toBeDefined();

    // Verify token_budget structure is preserved (ignore timestamps which may vary by 1ms)
    expect(finalState.token_budget!.session_baseline).toBe(initialState.token_budget!.session_baseline);
    expect(finalState.token_budget!.current_usage).toBe(initialState.token_budget!.current_usage);
    expect(finalState.token_budget!.input_tokens).toBe(initialState.token_budget!.input_tokens);
    expect(finalState.token_budget!.output_tokens).toBe(initialState.token_budget!.output_tokens);
    expect(finalState.token_budget!.warning_threshold).toBe(initialState.token_budget!.warning_threshold);
    expect(finalState.token_budget!.warning_issued).toBe(initialState.token_budget!.warning_issued);

    // Verify pending_completion was added
    expect(finalState.pending_completion).toBeDefined();
    expect(finalState.pending_completion!.agent_used).toBe('oracle');
  });

  it('should accumulate agents_used across multiple Task invocations', async () => {
    registerAgentTrackingHook();

    const sessionId = 'test-session-accumulate-agents';

    const agents = [
      { type: 'oracle', prompt: 'Analyze the codebase' },
      { type: 'explore', prompt: 'Find files matching pattern' },
      { type: 'olympian', prompt: 'Implement feature X' },
    ];

    // Fire three different agents
    for (const agent of agents) {
      const ctx: HookContext = {
        sessionId,
        directory: TEST_DIR,
        toolName: 'Task',
        toolInput: {
          subagent_type: agent.type,
          prompt: agent.prompt,
        },
      };

      await routeHook('PreToolUse', ctx);
    }

    // Verify all three agents are accumulated
    const state = loadSessionState(TEST_DIR, sessionId);
    expect(state.token_budget).toBeDefined();
    expect(state.token_budget!.agents_used).toBeDefined();
    expect(state.token_budget!.agents_used).toHaveLength(3);
    expect(state.token_budget!.agents_used).toContain('oracle');
    expect(state.token_budget!.agents_used).toContain('explore');
    expect(state.token_budget!.agents_used).toContain('olympian');
  });

  it('should deduplicate agents_used when same agent used multiple times', async () => {
    registerAgentTrackingHook();

    const sessionId = 'test-session-deduplicate-agents';

    // Fire oracle twice
    for (let i = 0; i < 2; i++) {
      const ctx: HookContext = {
        sessionId,
        directory: TEST_DIR,
        toolName: 'Task',
        toolInput: {
          subagent_type: 'oracle',
          prompt: `Oracle task ${i + 1}`,
        },
      };

      await routeHook('PreToolUse', ctx);
    }

    // Verify oracle appears only once in agents_used
    const state = loadSessionState(TEST_DIR, sessionId);
    expect(state.token_budget).toBeDefined();
    expect(state.token_budget!.agents_used).toBeDefined();
    expect(state.token_budget!.agents_used).toHaveLength(1);
    expect(state.token_budget!.agents_used).toContain('oracle');
  });

  it('should handle backward compatibility when agents_used is undefined', async () => {
    registerAgentTrackingHook();

    const sessionId = 'test-session-backward-compat';

    // First invocation - agents_used will be undefined initially
    const ctx1: HookContext = {
      sessionId,
      directory: TEST_DIR,
      toolName: 'Task',
      toolInput: {
        subagent_type: 'oracle',
        prompt: 'First task',
      },
    };

    await routeHook('PreToolUse', ctx1);

    // Verify agents_used was initialized and contains oracle
    const state1 = loadSessionState(TEST_DIR, sessionId);
    expect(state1.token_budget).toBeDefined();
    expect(state1.token_budget!.agents_used).toBeDefined();
    expect(state1.token_budget!.agents_used).toHaveLength(1);
    expect(state1.token_budget!.agents_used).toContain('oracle');

    // Second invocation - agents_used should now exist and accumulate
    const ctx2: HookContext = {
      sessionId,
      directory: TEST_DIR,
      toolName: 'Task',
      toolInput: {
        subagent_type: 'olympian',
        prompt: 'Second task',
      },
    };

    await routeHook('PreToolUse', ctx2);

    // Verify agents_used now contains both agents
    const state2 = loadSessionState(TEST_DIR, sessionId);
    expect(state2.token_budget).toBeDefined();
    expect(state2.token_budget!.agents_used).toBeDefined();
    expect(state2.token_budget!.agents_used).toHaveLength(2);
    expect(state2.token_budget!.agents_used).toContain('oracle');
    expect(state2.token_budget!.agents_used).toContain('olympian');
  });
});
