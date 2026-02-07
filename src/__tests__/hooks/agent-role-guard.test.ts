import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { clearHooks, getHooksForEvent } from '../../hooks/registry.js';
import type { HookContext, HookResult } from '../../hooks/types.js';

// Mock learning/session-state
vi.mock('../../learning/session-state.js', () => ({
  loadSessionState: vi.fn().mockReturnValue({
    session_id: 'test',
    started_at: '2025-01-01',
    last_updated: '2025-01-01',
    recent_prompts: [],
    pending_completion: null,
    todo_snapshot: null,
    token_budget: null,
    discovery_volume: { session_count: 0, daily_count: 0, daily_reset_at: '2025-01-01' },
  }),
}));

import { registerAgentRoleGuardHook } from '../../hooks/registrations/agent-role-guard.js';
import { loadSessionState } from '../../learning/session-state.js';

/**
 * Helper to create PreToolUse context for agent-role-guard tests
 */
function createPreToolUseCtx(toolName: string, overrides: Record<string, any> = {}): HookContext {
  return {
    sessionId: 'test-session',
    directory: '/test/project',
    toolName,
    toolInput: {},
    ...overrides,
  };
}

describe('Agent Role Guard Hook', () => {
  beforeEach(() => {
    clearHooks();
    vi.clearAllMocks();
    registerAgentRoleGuardHook();
  });

  afterEach(() => {
    clearHooks();
    vi.clearAllMocks();
  });

  describe('Hook Registration', () => {
    it('registers agentRoleGuard with PreToolUse event at priority 5', () => {
      const hooks = getHooksForEvent('PreToolUse');
      const guard = hooks.find(h => h.name === 'agentRoleGuard');

      expect(guard).toBeDefined();
      expect(guard?.priority).toBe(5);
      expect(guard?.event).toBe('PreToolUse');
    });

    it('has matcher for write|edit|multiedit|bash', () => {
      const hooks = getHooksForEvent('PreToolUse');
      const guard = hooks.find(h => h.name === 'agentRoleGuard');

      expect(guard?.matcher).toBe('write|edit|multiedit|bash');
    });
  });

  describe('Early Returns (allow)', () => {
    it('returns continue:true when no directory', async () => {
      const hooks = getHooksForEvent('PreToolUse');
      const guard = hooks.find(h => h.name === 'agentRoleGuard');

      const ctx = createPreToolUseCtx('write', { directory: undefined });
      const result = await guard!.handler(ctx);

      expect(result.continue).toBe(true);
    });

    it('returns continue:true when no sessionId', async () => {
      const hooks = getHooksForEvent('PreToolUse');
      const guard = hooks.find(h => h.name === 'agentRoleGuard');

      const ctx = createPreToolUseCtx('write', { sessionId: undefined });
      const result = await guard!.handler(ctx);

      expect(result.continue).toBe(true);
    });

    it('returns continue:true when no pending_completion', async () => {
      vi.mocked(loadSessionState).mockReturnValue({
        session_id: 'test',
        started_at: '2025-01-01',
        last_updated: '2025-01-01',
        recent_prompts: [],
        pending_completion: null,
        todo_snapshot: null,
        token_budget: null,
        discovery_volume: { session_count: 0, daily_count: 0, daily_reset_at: '2025-01-01' },
      });

      const hooks = getHooksForEvent('PreToolUse');
      const guard = hooks.find(h => h.name === 'agentRoleGuard');

      const ctx = createPreToolUseCtx('write');
      const result = await guard!.handler(ctx);

      expect(result.continue).toBe(true);
    });

    it('returns continue:true when pending_completion has no agent_used', async () => {
      vi.mocked(loadSessionState).mockReturnValue({
        session_id: 'test',
        started_at: '2025-01-01',
        last_updated: '2025-01-01',
        recent_prompts: [],
        pending_completion: {
          claimed_at: '2025-01-01T00:00:00.000Z',
          task_description: 'Test task',
          agent_used: null,
          completed_at: null,
          success: null,
          output: null,
          error_message: null,
        },
        todo_snapshot: null,
        token_budget: null,
        discovery_volume: { session_count: 0, daily_count: 0, daily_reset_at: '2025-01-01' },
      });

      const hooks = getHooksForEvent('PreToolUse');
      const guard = hooks.find(h => h.name === 'agentRoleGuard');

      const ctx = createPreToolUseCtx('write');
      const result = await guard!.handler(ctx);

      expect(result.continue).toBe(true);
    });

    it('returns continue:true when agent is NOT read-only (olympian)', async () => {
      vi.mocked(loadSessionState).mockReturnValue({
        session_id: 'test',
        started_at: '2025-01-01',
        last_updated: '2025-01-01',
        recent_prompts: [],
        pending_completion: {
          claimed_at: '2025-01-01T00:00:00.000Z',
          task_description: 'Test task',
          agent_used: 'olympian',
          completed_at: null,
          success: null,
          output: null,
          error_message: null,
        },
        todo_snapshot: null,
        token_budget: null,
        discovery_volume: { session_count: 0, daily_count: 0, daily_reset_at: '2025-01-01' },
      });

      const hooks = getHooksForEvent('PreToolUse');
      const guard = hooks.find(h => h.name === 'agentRoleGuard');

      const ctx = createPreToolUseCtx('write');
      const result = await guard!.handler(ctx);

      expect(result.continue).toBe(true);
    });

    it('returns continue:true when agent is document-writer (not in read-only list)', async () => {
      vi.mocked(loadSessionState).mockReturnValue({
        session_id: 'test',
        started_at: '2025-01-01',
        last_updated: '2025-01-01',
        recent_prompts: [],
        pending_completion: {
          claimed_at: '2025-01-01T00:00:00.000Z',
          task_description: 'Write documentation',
          agent_used: 'document-writer',
          completed_at: null,
          success: null,
          output: null,
          error_message: null,
        },
        todo_snapshot: null,
        token_budget: null,
        discovery_volume: { session_count: 0, daily_count: 0, daily_reset_at: '2025-01-01' },
      });

      const hooks = getHooksForEvent('PreToolUse');
      const guard = hooks.find(h => h.name === 'agentRoleGuard');

      const ctx = createPreToolUseCtx('write');
      const result = await guard!.handler(ctx);

      expect(result.continue).toBe(true);
    });
  });

  describe('Read-Only Agent Blocking', () => {
    it('blocks write tool for read-only agent explore', async () => {
      vi.mocked(loadSessionState).mockReturnValue({
        session_id: 'test',
        started_at: '2025-01-01',
        last_updated: '2025-01-01',
        recent_prompts: [],
        pending_completion: {
          claimed_at: '2025-01-01T00:00:00.000Z',
          task_description: 'Search codebase',
          agent_used: 'explore',
          completed_at: null,
          success: null,
          output: null,
          error_message: null,
        },
        todo_snapshot: null,
        token_budget: null,
        discovery_volume: { session_count: 0, daily_count: 0, daily_reset_at: '2025-01-01' },
      });

      const hooks = getHooksForEvent('PreToolUse');
      const guard = hooks.find(h => h.name === 'agentRoleGuard');

      const ctx = createPreToolUseCtx('write');
      const result = await guard!.handler(ctx);

      expect(result.continue).toBe(false);
      expect(result.stopReason).toContain('explore');
      expect(result.stopReason).toContain('read-only');
      expect(result.stopReason).toContain('write');
    });

    it('blocks edit tool for read-only agent oracle-low', async () => {
      vi.mocked(loadSessionState).mockReturnValue({
        session_id: 'test',
        started_at: '2025-01-01',
        last_updated: '2025-01-01',
        recent_prompts: [],
        pending_completion: {
          claimed_at: '2025-01-01T00:00:00.000Z',
          task_description: 'Analyze architecture',
          agent_used: 'oracle-low',
          completed_at: null,
          success: null,
          output: null,
          error_message: null,
        },
        todo_snapshot: null,
        token_budget: null,
        discovery_volume: { session_count: 0, daily_count: 0, daily_reset_at: '2025-01-01' },
      });

      const hooks = getHooksForEvent('PreToolUse');
      const guard = hooks.find(h => h.name === 'agentRoleGuard');

      const ctx = createPreToolUseCtx('edit');
      const result = await guard!.handler(ctx);

      expect(result.continue).toBe(false);
      expect(result.stopReason).toContain('oracle-low');
      expect(result.stopReason).toContain('read-only');
      expect(result.stopReason).toContain('edit');
    });

    it('blocks multiedit tool for read-only agent librarian', async () => {
      vi.mocked(loadSessionState).mockReturnValue({
        session_id: 'test',
        started_at: '2025-01-01',
        last_updated: '2025-01-01',
        recent_prompts: [],
        pending_completion: {
          claimed_at: '2025-01-01T00:00:00.000Z',
          task_description: 'Research documentation',
          agent_used: 'librarian',
          completed_at: null,
          success: null,
          output: null,
          error_message: null,
        },
        todo_snapshot: null,
        token_budget: null,
        discovery_volume: { session_count: 0, daily_count: 0, daily_reset_at: '2025-01-01' },
      });

      const hooks = getHooksForEvent('PreToolUse');
      const guard = hooks.find(h => h.name === 'agentRoleGuard');

      const ctx = createPreToolUseCtx('multiedit');
      const result = await guard!.handler(ctx);

      expect(result.continue).toBe(false);
      expect(result.stopReason).toContain('librarian');
      expect(result.stopReason).toContain('read-only');
      expect(result.stopReason).toContain('multiedit');
    });

    it('has meaningful stopReason when blocking', async () => {
      vi.mocked(loadSessionState).mockReturnValue({
        session_id: 'test',
        started_at: '2025-01-01',
        last_updated: '2025-01-01',
        recent_prompts: [],
        pending_completion: {
          claimed_at: '2025-01-01T00:00:00.000Z',
          task_description: 'Test task',
          agent_used: 'explore-medium',
          completed_at: null,
          success: null,
          output: null,
          error_message: null,
        },
        todo_snapshot: null,
        token_budget: null,
        discovery_volume: { session_count: 0, daily_count: 0, daily_reset_at: '2025-01-01' },
      });

      const hooks = getHooksForEvent('PreToolUse');
      const guard = hooks.find(h => h.name === 'agentRoleGuard');

      const ctx = createPreToolUseCtx('write');
      const result = await guard!.handler(ctx);

      expect(result.continue).toBe(false);
      expect(result.stopReason).toContain('explore-medium');
      expect(result.stopReason).toContain('olympian');
      expect(result.stopReason).toContain('frontend-engineer');
    });

    it('blocks write for oracle agent', async () => {
      vi.mocked(loadSessionState).mockReturnValue({
        session_id: 'test',
        started_at: '2025-01-01',
        last_updated: '2025-01-01',
        recent_prompts: [],
        pending_completion: {
          claimed_at: '2025-01-01T00:00:00.000Z',
          task_description: 'Debug issue',
          agent_used: 'oracle',
          completed_at: null,
          success: null,
          output: null,
          error_message: null,
        },
        todo_snapshot: null,
        token_budget: null,
        discovery_volume: { session_count: 0, daily_count: 0, daily_reset_at: '2025-01-01' },
      });

      const hooks = getHooksForEvent('PreToolUse');
      const guard = hooks.find(h => h.name === 'agentRoleGuard');

      const ctx = createPreToolUseCtx('write');
      const result = await guard!.handler(ctx);

      expect(result.continue).toBe(false);
      expect(result.stopReason).toContain('oracle');
    });

    it('blocks write for oracle-medium agent', async () => {
      vi.mocked(loadSessionState).mockReturnValue({
        session_id: 'test',
        started_at: '2025-01-01',
        last_updated: '2025-01-01',
        recent_prompts: [],
        pending_completion: {
          claimed_at: '2025-01-01T00:00:00.000Z',
          task_description: 'Medium analysis',
          agent_used: 'oracle-medium',
          completed_at: null,
          success: null,
          output: null,
          error_message: null,
        },
        todo_snapshot: null,
        token_budget: null,
        discovery_volume: { session_count: 0, daily_count: 0, daily_reset_at: '2025-01-01' },
      });

      const hooks = getHooksForEvent('PreToolUse');
      const guard = hooks.find(h => h.name === 'agentRoleGuard');

      const ctx = createPreToolUseCtx('write');
      const result = await guard!.handler(ctx);

      expect(result.continue).toBe(false);
      expect(result.stopReason).toContain('oracle-medium');
    });

    it('blocks write for librarian-low agent', async () => {
      vi.mocked(loadSessionState).mockReturnValue({
        session_id: 'test',
        started_at: '2025-01-01',
        last_updated: '2025-01-01',
        recent_prompts: [],
        pending_completion: {
          claimed_at: '2025-01-01T00:00:00.000Z',
          task_description: 'Quick lookup',
          agent_used: 'librarian-low',
          completed_at: null,
          success: null,
          output: null,
          error_message: null,
        },
        todo_snapshot: null,
        token_budget: null,
        discovery_volume: { session_count: 0, daily_count: 0, daily_reset_at: '2025-01-01' },
      });

      const hooks = getHooksForEvent('PreToolUse');
      const guard = hooks.find(h => h.name === 'agentRoleGuard');

      const ctx = createPreToolUseCtx('write');
      const result = await guard!.handler(ctx);

      expect(result.continue).toBe(false);
      expect(result.stopReason).toContain('librarian-low');
    });

    it('blocks write for momus agent', async () => {
      vi.mocked(loadSessionState).mockReturnValue({
        session_id: 'test',
        started_at: '2025-01-01',
        last_updated: '2025-01-01',
        recent_prompts: [],
        pending_completion: {
          claimed_at: '2025-01-01T00:00:00.000Z',
          task_description: 'Review plan',
          agent_used: 'momus',
          completed_at: null,
          success: null,
          output: null,
          error_message: null,
        },
        todo_snapshot: null,
        token_budget: null,
        discovery_volume: { session_count: 0, daily_count: 0, daily_reset_at: '2025-01-01' },
      });

      const hooks = getHooksForEvent('PreToolUse');
      const guard = hooks.find(h => h.name === 'agentRoleGuard');

      const ctx = createPreToolUseCtx('write');
      const result = await guard!.handler(ctx);

      expect(result.continue).toBe(false);
      expect(result.stopReason).toContain('momus');
    });

    it('blocks write for metis agent', async () => {
      vi.mocked(loadSessionState).mockReturnValue({
        session_id: 'test',
        started_at: '2025-01-01',
        last_updated: '2025-01-01',
        recent_prompts: [],
        pending_completion: {
          claimed_at: '2025-01-01T00:00:00.000Z',
          task_description: 'Pre-planning',
          agent_used: 'metis',
          completed_at: null,
          success: null,
          output: null,
          error_message: null,
        },
        todo_snapshot: null,
        token_budget: null,
        discovery_volume: { session_count: 0, daily_count: 0, daily_reset_at: '2025-01-01' },
      });

      const hooks = getHooksForEvent('PreToolUse');
      const guard = hooks.find(h => h.name === 'agentRoleGuard');

      const ctx = createPreToolUseCtx('write');
      const result = await guard!.handler(ctx);

      expect(result.continue).toBe(false);
      expect(result.stopReason).toContain('metis');
    });

    it('blocks write for multimodal-looker agent', async () => {
      vi.mocked(loadSessionState).mockReturnValue({
        session_id: 'test',
        started_at: '2025-01-01',
        last_updated: '2025-01-01',
        recent_prompts: [],
        pending_completion: {
          claimed_at: '2025-01-01T00:00:00.000Z',
          task_description: 'Analyze screenshot',
          agent_used: 'multimodal-looker',
          completed_at: null,
          success: null,
          output: null,
          error_message: null,
        },
        todo_snapshot: null,
        token_budget: null,
        discovery_volume: { session_count: 0, daily_count: 0, daily_reset_at: '2025-01-01' },
      });

      const hooks = getHooksForEvent('PreToolUse');
      const guard = hooks.find(h => h.name === 'agentRoleGuard');

      const ctx = createPreToolUseCtx('write');
      const result = await guard!.handler(ctx);

      expect(result.continue).toBe(false);
      expect(result.stopReason).toContain('multimodal-looker');
    });
  });

  describe('Bash Command Inspection', () => {
    it('blocks bash with rm -rf for read-only agent', async () => {
      vi.mocked(loadSessionState).mockReturnValue({
        session_id: 'test',
        started_at: '2025-01-01',
        last_updated: '2025-01-01',
        recent_prompts: [],
        pending_completion: {
          claimed_at: '2025-01-01T00:00:00.000Z',
          task_description: 'Search files',
          agent_used: 'explore',
          completed_at: null,
          success: null,
          output: null,
          error_message: null,
        },
        todo_snapshot: null,
        token_budget: null,
        discovery_volume: { session_count: 0, daily_count: 0, daily_reset_at: '2025-01-01' },
      });

      const hooks = getHooksForEvent('PreToolUse');
      const guard = hooks.find(h => h.name === 'agentRoleGuard');

      const ctx = createPreToolUseCtx('bash', {
        toolInput: { command: 'rm -rf /tmp/test' }
      });
      const result = await guard!.handler(ctx);

      expect(result.continue).toBe(false);
      expect(result.stopReason).toContain('explore');
      expect(result.stopReason).toContain('read-only');
      expect(result.stopReason).toContain('modify files');
    });

    it('blocks bash with npm install for read-only agent', async () => {
      vi.mocked(loadSessionState).mockReturnValue({
        session_id: 'test',
        started_at: '2025-01-01',
        last_updated: '2025-01-01',
        recent_prompts: [],
        pending_completion: {
          claimed_at: '2025-01-01T00:00:00.000Z',
          task_description: 'Research libraries',
          agent_used: 'librarian',
          completed_at: null,
          success: null,
          output: null,
          error_message: null,
        },
        todo_snapshot: null,
        token_budget: null,
        discovery_volume: { session_count: 0, daily_count: 0, daily_reset_at: '2025-01-01' },
      });

      const hooks = getHooksForEvent('PreToolUse');
      const guard = hooks.find(h => h.name === 'agentRoleGuard');

      const ctx = createPreToolUseCtx('bash', {
        toolInput: { command: 'npm install lodash' }
      });
      const result = await guard!.handler(ctx);

      expect(result.continue).toBe(false);
      expect(result.stopReason).toContain('librarian');
      expect(result.stopReason).toContain('read-only');
    });

    it('blocks bash with output redirect > for read-only agent', async () => {
      vi.mocked(loadSessionState).mockReturnValue({
        session_id: 'test',
        started_at: '2025-01-01',
        last_updated: '2025-01-01',
        recent_prompts: [],
        pending_completion: {
          claimed_at: '2025-01-01T00:00:00.000Z',
          task_description: 'Analyze code',
          agent_used: 'oracle',
          completed_at: null,
          success: null,
          output: null,
          error_message: null,
        },
        todo_snapshot: null,
        token_budget: null,
        discovery_volume: { session_count: 0, daily_count: 0, daily_reset_at: '2025-01-01' },
      });

      const hooks = getHooksForEvent('PreToolUse');
      const guard = hooks.find(h => h.name === 'agentRoleGuard');

      const ctx = createPreToolUseCtx('bash', {
        toolInput: { command: 'echo "test" > output.txt' }
      });
      const result = await guard!.handler(ctx);

      expect(result.continue).toBe(false);
      expect(result.stopReason).toContain('oracle');
    });

    it('blocks bash with append redirect >> for read-only agent', async () => {
      vi.mocked(loadSessionState).mockReturnValue({
        session_id: 'test',
        started_at: '2025-01-01',
        last_updated: '2025-01-01',
        recent_prompts: [],
        pending_completion: {
          claimed_at: '2025-01-01T00:00:00.000Z',
          task_description: 'Search patterns',
          agent_used: 'explore',
          completed_at: null,
          success: null,
          output: null,
          error_message: null,
        },
        todo_snapshot: null,
        token_budget: null,
        discovery_volume: { session_count: 0, daily_count: 0, daily_reset_at: '2025-01-01' },
      });

      const hooks = getHooksForEvent('PreToolUse');
      const guard = hooks.find(h => h.name === 'agentRoleGuard');

      const ctx = createPreToolUseCtx('bash', {
        toolInput: { command: 'echo "log entry" >> log.txt' }
      });
      const result = await guard!.handler(ctx);

      expect(result.continue).toBe(false);
      expect(result.stopReason).toContain('explore');
    });

    it('blocks bash with mkdir for read-only agent', async () => {
      vi.mocked(loadSessionState).mockReturnValue({
        session_id: 'test',
        started_at: '2025-01-01',
        last_updated: '2025-01-01',
        recent_prompts: [],
        pending_completion: {
          claimed_at: '2025-01-01T00:00:00.000Z',
          task_description: 'Find structure',
          agent_used: 'explore',
          completed_at: null,
          success: null,
          output: null,
          error_message: null,
        },
        todo_snapshot: null,
        token_budget: null,
        discovery_volume: { session_count: 0, daily_count: 0, daily_reset_at: '2025-01-01' },
      });

      const hooks = getHooksForEvent('PreToolUse');
      const guard = hooks.find(h => h.name === 'agentRoleGuard');

      const ctx = createPreToolUseCtx('bash', {
        toolInput: { command: 'mkdir -p /tmp/newdir' }
      });
      const result = await guard!.handler(ctx);

      expect(result.continue).toBe(false);
      expect(result.stopReason).toContain('explore');
    });

    it('blocks bash with mv for read-only agent', async () => {
      vi.mocked(loadSessionState).mockReturnValue({
        session_id: 'test',
        started_at: '2025-01-01',
        last_updated: '2025-01-01',
        recent_prompts: [],
        pending_completion: {
          claimed_at: '2025-01-01T00:00:00.000Z',
          task_description: 'Research',
          agent_used: 'librarian',
          completed_at: null,
          success: null,
          output: null,
          error_message: null,
        },
        todo_snapshot: null,
        token_budget: null,
        discovery_volume: { session_count: 0, daily_count: 0, daily_reset_at: '2025-01-01' },
      });

      const hooks = getHooksForEvent('PreToolUse');
      const guard = hooks.find(h => h.name === 'agentRoleGuard');

      const ctx = createPreToolUseCtx('bash', {
        toolInput: { command: 'mv oldfile.txt newfile.txt' }
      });
      const result = await guard!.handler(ctx);

      expect(result.continue).toBe(false);
    });

    it('blocks bash with cp for read-only agent', async () => {
      vi.mocked(loadSessionState).mockReturnValue({
        session_id: 'test',
        started_at: '2025-01-01',
        last_updated: '2025-01-01',
        recent_prompts: [],
        pending_completion: {
          claimed_at: '2025-01-01T00:00:00.000Z',
          task_description: 'Find files',
          agent_used: 'explore',
          completed_at: null,
          success: null,
          output: null,
          error_message: null,
        },
        todo_snapshot: null,
        token_budget: null,
        discovery_volume: { session_count: 0, daily_count: 0, daily_reset_at: '2025-01-01' },
      });

      const hooks = getHooksForEvent('PreToolUse');
      const guard = hooks.find(h => h.name === 'agentRoleGuard');

      const ctx = createPreToolUseCtx('bash', {
        toolInput: { command: 'cp file.txt backup.txt' }
      });
      const result = await guard!.handler(ctx);

      expect(result.continue).toBe(false);
    });

    it('blocks bash with touch for read-only agent', async () => {
      vi.mocked(loadSessionState).mockReturnValue({
        session_id: 'test',
        started_at: '2025-01-01',
        last_updated: '2025-01-01',
        recent_prompts: [],
        pending_completion: {
          claimed_at: '2025-01-01T00:00:00.000Z',
          task_description: 'Inspect files',
          agent_used: 'oracle-low',
          completed_at: null,
          success: null,
          output: null,
          error_message: null,
        },
        todo_snapshot: null,
        token_budget: null,
        discovery_volume: { session_count: 0, daily_count: 0, daily_reset_at: '2025-01-01' },
      });

      const hooks = getHooksForEvent('PreToolUse');
      const guard = hooks.find(h => h.name === 'agentRoleGuard');

      const ctx = createPreToolUseCtx('bash', {
        toolInput: { command: 'touch newfile.txt' }
      });
      const result = await guard!.handler(ctx);

      expect(result.continue).toBe(false);
    });

    it('blocks bash with pip install for read-only agent', async () => {
      vi.mocked(loadSessionState).mockReturnValue({
        session_id: 'test',
        started_at: '2025-01-01',
        last_updated: '2025-01-01',
        recent_prompts: [],
        pending_completion: {
          claimed_at: '2025-01-01T00:00:00.000Z',
          task_description: 'Check dependencies',
          agent_used: 'librarian',
          completed_at: null,
          success: null,
          output: null,
          error_message: null,
        },
        todo_snapshot: null,
        token_budget: null,
        discovery_volume: { session_count: 0, daily_count: 0, daily_reset_at: '2025-01-01' },
      });

      const hooks = getHooksForEvent('PreToolUse');
      const guard = hooks.find(h => h.name === 'agentRoleGuard');

      const ctx = createPreToolUseCtx('bash', {
        toolInput: { command: 'pip install requests' }
      });
      const result = await guard!.handler(ctx);

      expect(result.continue).toBe(false);
    });

    it('blocks bash with cargo add for read-only agent', async () => {
      vi.mocked(loadSessionState).mockReturnValue({
        session_id: 'test',
        started_at: '2025-01-01',
        last_updated: '2025-01-01',
        recent_prompts: [],
        pending_completion: {
          claimed_at: '2025-01-01T00:00:00.000Z',
          task_description: 'Review dependencies',
          agent_used: 'librarian',
          completed_at: null,
          success: null,
          output: null,
          error_message: null,
        },
        todo_snapshot: null,
        token_budget: null,
        discovery_volume: { session_count: 0, daily_count: 0, daily_reset_at: '2025-01-01' },
      });

      const hooks = getHooksForEvent('PreToolUse');
      const guard = hooks.find(h => h.name === 'agentRoleGuard');

      const ctx = createPreToolUseCtx('bash', {
        toolInput: { command: 'cargo add serde' }
      });
      const result = await guard!.handler(ctx);

      expect(result.continue).toBe(false);
    });

    it('blocks bash with sed -i for read-only agent', async () => {
      vi.mocked(loadSessionState).mockReturnValue({
        session_id: 'test',
        started_at: '2025-01-01',
        last_updated: '2025-01-01',
        recent_prompts: [],
        pending_completion: {
          claimed_at: '2025-01-01T00:00:00.000Z',
          task_description: 'Check patterns',
          agent_used: 'explore',
          completed_at: null,
          success: null,
          output: null,
          error_message: null,
        },
        todo_snapshot: null,
        token_budget: null,
        discovery_volume: { session_count: 0, daily_count: 0, daily_reset_at: '2025-01-01' },
      });

      const hooks = getHooksForEvent('PreToolUse');
      const guard = hooks.find(h => h.name === 'agentRoleGuard');

      const ctx = createPreToolUseCtx('bash', {
        toolInput: { command: 'sed -i "s/old/new/g" file.txt' }
      });
      const result = await guard!.handler(ctx);

      expect(result.continue).toBe(false);
    });

    it('blocks bash with chmod for read-only agent', async () => {
      vi.mocked(loadSessionState).mockReturnValue({
        session_id: 'test',
        started_at: '2025-01-01',
        last_updated: '2025-01-01',
        recent_prompts: [],
        pending_completion: {
          claimed_at: '2025-01-01T00:00:00.000Z',
          task_description: 'Review files',
          agent_used: 'oracle',
          completed_at: null,
          success: null,
          output: null,
          error_message: null,
        },
        todo_snapshot: null,
        token_budget: null,
        discovery_volume: { session_count: 0, daily_count: 0, daily_reset_at: '2025-01-01' },
      });

      const hooks = getHooksForEvent('PreToolUse');
      const guard = hooks.find(h => h.name === 'agentRoleGuard');

      const ctx = createPreToolUseCtx('bash', {
        toolInput: { command: 'chmod +x script.sh' }
      });
      const result = await guard!.handler(ctx);

      expect(result.continue).toBe(false);
    });

    it('allows bash with git status for read-only agent (no write pattern)', async () => {
      vi.mocked(loadSessionState).mockReturnValue({
        session_id: 'test',
        started_at: '2025-01-01',
        last_updated: '2025-01-01',
        recent_prompts: [],
        pending_completion: {
          claimed_at: '2025-01-01T00:00:00.000Z',
          task_description: 'Check status',
          agent_used: 'explore',
          completed_at: null,
          success: null,
          output: null,
          error_message: null,
        },
        todo_snapshot: null,
        token_budget: null,
        discovery_volume: { session_count: 0, daily_count: 0, daily_reset_at: '2025-01-01' },
      });

      const hooks = getHooksForEvent('PreToolUse');
      const guard = hooks.find(h => h.name === 'agentRoleGuard');

      const ctx = createPreToolUseCtx('bash', {
        toolInput: { command: 'git status' }
      });
      const result = await guard!.handler(ctx);

      expect(result.continue).toBe(true);
    });

    it('allows bash with ls -la for read-only agent (no write pattern)', async () => {
      vi.mocked(loadSessionState).mockReturnValue({
        session_id: 'test',
        started_at: '2025-01-01',
        last_updated: '2025-01-01',
        recent_prompts: [],
        pending_completion: {
          claimed_at: '2025-01-01T00:00:00.000Z',
          task_description: 'List files',
          agent_used: 'explore',
          completed_at: null,
          success: null,
          output: null,
          error_message: null,
        },
        todo_snapshot: null,
        token_budget: null,
        discovery_volume: { session_count: 0, daily_count: 0, daily_reset_at: '2025-01-01' },
      });

      const hooks = getHooksForEvent('PreToolUse');
      const guard = hooks.find(h => h.name === 'agentRoleGuard');

      const ctx = createPreToolUseCtx('bash', {
        toolInput: { command: 'ls -la /tmp' }
      });
      const result = await guard!.handler(ctx);

      expect(result.continue).toBe(true);
    });

    it('allows bash with cat for read-only agent (no write pattern)', async () => {
      vi.mocked(loadSessionState).mockReturnValue({
        session_id: 'test',
        started_at: '2025-01-01',
        last_updated: '2025-01-01',
        recent_prompts: [],
        pending_completion: {
          claimed_at: '2025-01-01T00:00:00.000Z',
          task_description: 'Read file',
          agent_used: 'oracle',
          completed_at: null,
          success: null,
          output: null,
          error_message: null,
        },
        todo_snapshot: null,
        token_budget: null,
        discovery_volume: { session_count: 0, daily_count: 0, daily_reset_at: '2025-01-01' },
      });

      const hooks = getHooksForEvent('PreToolUse');
      const guard = hooks.find(h => h.name === 'agentRoleGuard');

      const ctx = createPreToolUseCtx('bash', {
        toolInput: { command: 'cat package.json' }
      });
      const result = await guard!.handler(ctx);

      expect(result.continue).toBe(true);
    });

    it('allows bash with grep for read-only agent (no write pattern)', async () => {
      vi.mocked(loadSessionState).mockReturnValue({
        session_id: 'test',
        started_at: '2025-01-01',
        last_updated: '2025-01-01',
        recent_prompts: [],
        pending_completion: {
          claimed_at: '2025-01-01T00:00:00.000Z',
          task_description: 'Search pattern',
          agent_used: 'explore',
          completed_at: null,
          success: null,
          output: null,
          error_message: null,
        },
        todo_snapshot: null,
        token_budget: null,
        discovery_volume: { session_count: 0, daily_count: 0, daily_reset_at: '2025-01-01' },
      });

      const hooks = getHooksForEvent('PreToolUse');
      const guard = hooks.find(h => h.name === 'agentRoleGuard');

      const ctx = createPreToolUseCtx('bash', {
        toolInput: { command: 'grep -r "pattern" src/' }
      });
      const result = await guard!.handler(ctx);

      expect(result.continue).toBe(true);
    });

    it('allows bash when no command in toolInput', async () => {
      vi.mocked(loadSessionState).mockReturnValue({
        session_id: 'test',
        started_at: '2025-01-01',
        last_updated: '2025-01-01',
        recent_prompts: [],
        pending_completion: {
          claimed_at: '2025-01-01T00:00:00.000Z',
          task_description: 'Test',
          agent_used: 'explore',
          completed_at: null,
          success: null,
          output: null,
          error_message: null,
        },
        todo_snapshot: null,
        token_budget: null,
        discovery_volume: { session_count: 0, daily_count: 0, daily_reset_at: '2025-01-01' },
      });

      const hooks = getHooksForEvent('PreToolUse');
      const guard = hooks.find(h => h.name === 'agentRoleGuard');

      const ctx = createPreToolUseCtx('bash', {
        toolInput: { description: 'Test command' }
      });
      const result = await guard!.handler(ctx);

      expect(result.continue).toBe(true);
    });

    it('allows bash when command is not a string', async () => {
      vi.mocked(loadSessionState).mockReturnValue({
        session_id: 'test',
        started_at: '2025-01-01',
        last_updated: '2025-01-01',
        recent_prompts: [],
        pending_completion: {
          claimed_at: '2025-01-01T00:00:00.000Z',
          task_description: 'Test',
          agent_used: 'explore',
          completed_at: null,
          success: null,
          output: null,
          error_message: null,
        },
        todo_snapshot: null,
        token_budget: null,
        discovery_volume: { session_count: 0, daily_count: 0, daily_reset_at: '2025-01-01' },
      });

      const hooks = getHooksForEvent('PreToolUse');
      const guard = hooks.find(h => h.name === 'agentRoleGuard');

      const ctx = createPreToolUseCtx('bash', {
        toolInput: { command: 123 }
      });
      const result = await guard!.handler(ctx);

      expect(result.continue).toBe(true);
    });

    it('includes truncated command in stopReason for long commands', async () => {
      vi.mocked(loadSessionState).mockReturnValue({
        session_id: 'test',
        started_at: '2025-01-01',
        last_updated: '2025-01-01',
        recent_prompts: [],
        pending_completion: {
          claimed_at: '2025-01-01T00:00:00.000Z',
          task_description: 'Test',
          agent_used: 'explore',
          completed_at: null,
          success: null,
          output: null,
          error_message: null,
        },
        todo_snapshot: null,
        token_budget: null,
        discovery_volume: { session_count: 0, daily_count: 0, daily_reset_at: '2025-01-01' },
      });

      const hooks = getHooksForEvent('PreToolUse');
      const guard = hooks.find(h => h.name === 'agentRoleGuard');

      const longCommand = 'rm ' + 'x'.repeat(150);
      const ctx = createPreToolUseCtx('bash', {
        toolInput: { command: longCommand }
      });
      const result = await guard!.handler(ctx);

      expect(result.continue).toBe(false);
      expect(result.stopReason).toContain('...');
      expect(result.stopReason?.includes(longCommand)).toBe(false); // Should be truncated
    });
  });

  describe('Error Handling', () => {
    it('never throws, returns continue:true on error', async () => {
      vi.mocked(loadSessionState).mockImplementation(() => {
        throw new Error('Session state corrupted');
      });

      const hooks = getHooksForEvent('PreToolUse');
      const guard = hooks.find(h => h.name === 'agentRoleGuard');

      const ctx = createPreToolUseCtx('write');
      const result = await guard!.handler(ctx);

      expect(result.continue).toBe(true);
    });

    it('returns continue:true when loadSessionState throws', async () => {
      vi.mocked(loadSessionState).mockImplementation(() => {
        throw new Error('Failed to load session state');
      });

      const hooks = getHooksForEvent('PreToolUse');
      const guard = hooks.find(h => h.name === 'agentRoleGuard');

      const ctx = createPreToolUseCtx('edit');
      const result = await guard!.handler(ctx);

      expect(result.continue).toBe(true);
    });

    it('logs error with [Olympus Agent Role Guard] prefix', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      vi.mocked(loadSessionState).mockImplementation(() => {
        throw new Error('Test error');
      });

      const hooks = getHooksForEvent('PreToolUse');
      const guard = hooks.find(h => h.name === 'agentRoleGuard');

      const ctx = createPreToolUseCtx('write');
      await guard!.handler(ctx);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Olympus Agent Role Guard]'),
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });

    it('continues on undefined behavior in toolInput', async () => {
      vi.mocked(loadSessionState).mockReturnValue({
        session_id: 'test',
        started_at: '2025-01-01',
        last_updated: '2025-01-01',
        recent_prompts: [],
        pending_completion: {
          claimed_at: '2025-01-01T00:00:00.000Z',
          task_description: 'Test',
          agent_used: 'explore',
          completed_at: null,
          success: null,
          output: null,
          error_message: null,
        },
        todo_snapshot: null,
        token_budget: null,
        discovery_volume: { session_count: 0, daily_count: 0, daily_reset_at: '2025-01-01' },
      });

      const hooks = getHooksForEvent('PreToolUse');
      const guard = hooks.find(h => h.name === 'agentRoleGuard');

      const ctx = createPreToolUseCtx('bash', {
        toolInput: null
      });
      const result = await guard!.handler(ctx);

      expect(result.continue).toBe(true);
    });
  });
});
