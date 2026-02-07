import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { clearHooks, getHooksForEvent } from '../../hooks/registry.js';
import type { HookContext, HookResult } from '../../hooks/types.js';
import { join } from 'path';

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

// Mock checkpoint module
vi.mock('../../features/workflow-engine/checkpoint.js', () => ({
  loadCheckpoint: vi.fn().mockResolvedValue(null),
  listWorkflows: vi.fn().mockResolvedValue([]),
}));

// Mock validation module
vi.mock('../../features/workflow-engine/validation.js', () => ({
  validateIdea: vi.fn().mockResolvedValue({ passed: true, coverage_percentage: 100, blocking_issues: [], timestamp: '2025-01-01' }),
  validatePrd: vi.fn().mockResolvedValue({ passed: true, coverage_percentage: 100, blocking_issues: [], timestamp: '2025-01-01' }),
  validateSpec: vi.fn().mockResolvedValue({ passed: true, coverage_percentage: 100, blocking_issues: [], timestamp: '2025-01-01' }),
  validateTasks: vi.fn().mockResolvedValue({ passed: true, coverage_percentage: 100, blocking_issues: [], timestamp: '2025-01-01' }),
}));

// Mock fs
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
}));

import { registerWorkflowArtifactGateHook } from '../../hooks/registrations/workflow-artifact-gate.js';
import { loadSessionState } from '../../learning/session-state.js';
import { loadCheckpoint, listWorkflows } from '../../features/workflow-engine/checkpoint.js';
import { validateIdea, validatePrd, validateSpec, validateTasks } from '../../features/workflow-engine/validation.js';
import { existsSync } from 'fs';

describe('workflow-artifact-gate hook', () => {
  beforeEach(() => {
    clearHooks();
    vi.clearAllMocks();
  });

  afterEach(() => {
    clearHooks();
  });

  describe('Hook Registration', () => {
    it('should register workflowArtifactGate with PostToolUse at priority 78', () => {
      registerWorkflowArtifactGateHook();
      const hooks = getHooksForEvent('PostToolUse');
      expect(hooks).toHaveLength(1);
      expect(hooks[0].name).toBe('workflowArtifactGate');
      expect(hooks[0].priority).toBe(78);
    });

    it('should have matcher "task"', () => {
      registerWorkflowArtifactGateHook();
      const hooks = getHooksForEvent('PostToolUse');
      expect(hooks[0].matcher).toBe('task');
    });
  });

  describe('Early Returns', () => {
    it('should return continue:true for non-Task tools', async () => {
      registerWorkflowArtifactGateHook();
      const hooks = getHooksForEvent('PostToolUse');
      const ctx = createPostToolUseCtx({ toolName: 'Read' });
      const result = await hooks[0].handler(ctx);
      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.additionalContext).toBeUndefined();
    });

    it('should return continue:true when no directory', async () => {
      registerWorkflowArtifactGateHook();
      const hooks = getHooksForEvent('PostToolUse');
      const ctx = createPostToolUseCtx({ directory: undefined });
      const result = await hooks[0].handler(ctx);
      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.additionalContext).toBeUndefined();
    });

    it('should return continue:true when no sessionId', async () => {
      registerWorkflowArtifactGateHook();
      const hooks = getHooksForEvent('PostToolUse');
      const ctx = createPostToolUseCtx({ sessionId: undefined });
      const result = await hooks[0].handler(ctx);
      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.additionalContext).toBeUndefined();
    });

    it('should return continue:true when no pending_completion', async () => {
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

      registerWorkflowArtifactGateHook();
      const hooks = getHooksForEvent('PostToolUse');
      const ctx = createPostToolUseCtx();
      const result = await hooks[0].handler(ctx);
      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.additionalContext).toBeUndefined();
    });

    it('should return continue:true when agent_used is not a Vision stage agent', async () => {
      vi.mocked(loadSessionState).mockReturnValue({
        session_id: 'test',
        started_at: '2025-01-01',
        last_updated: '2025-01-01',
        recent_prompts: [],
        pending_completion: { agent_used: 'olympian', task_id: 'task-1' },
        todo_snapshot: null,
        token_budget: null,
        discovery_volume: { session_count: 0, daily_count: 0, daily_reset_at: '2025-01-01' },
      });

      registerWorkflowArtifactGateHook();
      const hooks = getHooksForEvent('PostToolUse');
      const ctx = createPostToolUseCtx();
      const result = await hooks[0].handler(ctx);
      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.additionalContext).toBeUndefined();
    });

    it('should return continue:true when no active workflows', async () => {
      vi.mocked(loadSessionState).mockReturnValue({
        session_id: 'test',
        started_at: '2025-01-01',
        last_updated: '2025-01-01',
        recent_prompts: [],
        pending_completion: { agent_used: 'idea-intake', task_id: 'task-1' },
        todo_snapshot: null,
        token_budget: null,
        discovery_volume: { session_count: 0, daily_count: 0, daily_reset_at: '2025-01-01' },
      });
      vi.mocked(listWorkflows).mockResolvedValue([]);

      registerWorkflowArtifactGateHook();
      const hooks = getHooksForEvent('PostToolUse');
      const ctx = createPostToolUseCtx();
      const result = await hooks[0].handler(ctx);
      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.additionalContext).toBeUndefined();
    });
  });

  describe('Vision Agent Validation', () => {
    beforeEach(() => {
      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(createMockCheckpoint());
      vi.mocked(existsSync).mockReturnValue(true);
    });

    it('should call validateIdea when idea-intake agent completes', async () => {
      vi.mocked(loadSessionState).mockReturnValue({
        session_id: 'test',
        started_at: '2025-01-01',
        last_updated: '2025-01-01',
        recent_prompts: [],
        pending_completion: { agent_used: 'idea-intake', task_id: 'task-1' },
        todo_snapshot: null,
        token_budget: null,
        discovery_volume: { session_count: 0, daily_count: 0, daily_reset_at: '2025-01-01' },
      });
      vi.mocked(validateIdea).mockResolvedValue({
        passed: true,
        coverage_percentage: 100,
        blocking_issues: [],
        timestamp: '2025-01-01',
      });

      registerWorkflowArtifactGateHook();
      const hooks = getHooksForEvent('PostToolUse');
      const ctx = createPostToolUseCtx();
      const result = await hooks[0].handler(ctx);

      expect(validateIdea).toHaveBeenCalledWith(join('/test/project', '.olympus', 'workflow', 'test-feature', 'vision', 'idea.md'));
      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.additionalContext).toContain('PASSED');
    });

    it('should call validatePrd when prd-writer agent completes', async () => {
      vi.mocked(loadSessionState).mockReturnValue({
        session_id: 'test',
        started_at: '2025-01-01',
        last_updated: '2025-01-01',
        recent_prompts: [],
        pending_completion: { agent_used: 'prd-writer', task_id: 'task-1' },
        todo_snapshot: null,
        token_budget: null,
        discovery_volume: { session_count: 0, daily_count: 0, daily_reset_at: '2025-01-01' },
      });
      vi.mocked(validatePrd).mockResolvedValue({
        passed: true,
        coverage_percentage: 100,
        blocking_issues: [],
        timestamp: '2025-01-01',
      });

      registerWorkflowArtifactGateHook();
      const hooks = getHooksForEvent('PostToolUse');
      const ctx = createPostToolUseCtx();
      const result = await hooks[0].handler(ctx);

      expect(validatePrd).toHaveBeenCalledWith(
        join('/test/project', '.olympus', 'workflow', 'test-feature', 'vision', 'prd.md'),
        join('/test/project', '.olympus', 'workflow', 'test-feature', 'vision', 'idea.md')
      );
      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.additionalContext).toContain('PASSED');
    });

    it('should call validateSpec when spec-writer agent completes', async () => {
      vi.mocked(loadSessionState).mockReturnValue({
        session_id: 'test',
        started_at: '2025-01-01',
        last_updated: '2025-01-01',
        recent_prompts: [],
        pending_completion: { agent_used: 'spec-writer', task_id: 'task-1' },
        todo_snapshot: null,
        token_budget: null,
        discovery_volume: { session_count: 0, daily_count: 0, daily_reset_at: '2025-01-01' },
      });
      vi.mocked(validateSpec).mockResolvedValue({
        passed: true,
        coverage_percentage: 100,
        blocking_issues: [],
        timestamp: '2025-01-01',
      });

      registerWorkflowArtifactGateHook();
      const hooks = getHooksForEvent('PostToolUse');
      const ctx = createPostToolUseCtx();
      const result = await hooks[0].handler(ctx);

      expect(validateSpec).toHaveBeenCalledWith(
        join('/test/project', '.olympus', 'workflow', 'test-feature', 'vision', 'spec.md'),
        join('/test/project', '.olympus', 'workflow', 'test-feature', 'vision', 'prd.md')
      );
      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.additionalContext).toContain('PASSED');
    });

    it('should call validateTasks when intent-generator agent completes', async () => {
      vi.mocked(loadSessionState).mockReturnValue({
        session_id: 'test',
        started_at: '2025-01-01',
        last_updated: '2025-01-01',
        recent_prompts: [],
        pending_completion: { agent_used: 'intent-generator', task_id: 'task-1' },
        todo_snapshot: null,
        token_budget: null,
        discovery_volume: { session_count: 0, daily_count: 0, daily_reset_at: '2025-01-01' },
      });
      vi.mocked(validateTasks).mockResolvedValue({
        passed: true,
        coverage_percentage: 100,
        blocking_issues: [],
        timestamp: '2025-01-01',
      });

      registerWorkflowArtifactGateHook();
      const hooks = getHooksForEvent('PostToolUse');
      const ctx = createPostToolUseCtx();
      const result = await hooks[0].handler(ctx);

      expect(validateTasks).toHaveBeenCalledWith(
        join('/test/project', '.olympus', 'workflow', 'test-feature', 'vision', 'intents'),
        join('/test/project', '.olympus', 'workflow', 'test-feature', 'vision', 'spec.md')
      );
      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.additionalContext).toContain('PASSED');
    });
  });

  describe('Validation Results', () => {
    beforeEach(() => {
      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(createMockCheckpoint());
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadSessionState).mockReturnValue({
        session_id: 'test',
        started_at: '2025-01-01',
        last_updated: '2025-01-01',
        recent_prompts: [],
        pending_completion: { agent_used: 'idea-intake', task_id: 'task-1' },
        todo_snapshot: null,
        token_budget: null,
        discovery_volume: { session_count: 0, daily_count: 0, daily_reset_at: '2025-01-01' },
      });
    });

    it('should inject success message when validation passes', async () => {
      vi.mocked(validateIdea).mockResolvedValue({
        passed: true,
        coverage_percentage: 100,
        blocking_issues: [],
        timestamp: '2025-01-01',
      });

      registerWorkflowArtifactGateHook();
      const hooks = getHooksForEvent('PostToolUse');
      const ctx = createPostToolUseCtx();
      const result = await hooks[0].handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.additionalContext).toContain('PASSED');
      expect(result.hookSpecificOutput?.additionalContext).toContain('100%');
    });

    it('should inject warning message when validation fails', async () => {
      vi.mocked(validateIdea).mockResolvedValue({
        passed: false,
        coverage_percentage: 60,
        blocking_issues: ['Missing critical section'],
        timestamp: '2025-01-01',
      });

      registerWorkflowArtifactGateHook();
      const hooks = getHooksForEvent('PostToolUse');
      const ctx = createPostToolUseCtx();
      const result = await hooks[0].handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.additionalContext).toContain('WARNING');
      expect(result.hookSpecificOutput?.additionalContext).toContain('FAILED');
    });

    it('should include blocking issues in warning', async () => {
      vi.mocked(validateIdea).mockResolvedValue({
        passed: false,
        coverage_percentage: 60,
        blocking_issues: ['Missing problem statement', 'Missing success metrics'],
        timestamp: '2025-01-01',
      });

      registerWorkflowArtifactGateHook();
      const hooks = getHooksForEvent('PostToolUse');
      const ctx = createPostToolUseCtx();
      const result = await hooks[0].handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.additionalContext).toContain('Missing problem statement');
      expect(result.hookSpecificOutput?.additionalContext).toContain('Missing success metrics');
    });

    it('should include coverage percentage in warning', async () => {
      vi.mocked(validateIdea).mockResolvedValue({
        passed: false,
        coverage_percentage: 45,
        blocking_issues: ['Missing critical section'],
        timestamp: '2025-01-01',
      });

      registerWorkflowArtifactGateHook();
      const hooks = getHooksForEvent('PostToolUse');
      const ctx = createPostToolUseCtx();
      const result = await hooks[0].handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.additionalContext).toContain('45%');
    });

    it('should always return continue:true even on validation failure', async () => {
      vi.mocked(validateIdea).mockResolvedValue({
        passed: false,
        coverage_percentage: 0,
        blocking_issues: ['Everything is wrong'],
        timestamp: '2025-01-01',
      });

      registerWorkflowArtifactGateHook();
      const hooks = getHooksForEvent('PostToolUse');
      const ctx = createPostToolUseCtx();
      const result = await hooks[0].handler(ctx);

      expect(result.continue).toBe(true);
    });
  });

  describe('Path Resolution', () => {
    beforeEach(() => {
      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(createMockCheckpoint());
      vi.mocked(loadSessionState).mockReturnValue({
        session_id: 'test',
        started_at: '2025-01-01',
        last_updated: '2025-01-01',
        recent_prompts: [],
        pending_completion: { agent_used: 'idea-intake', task_id: 'task-1' },
        todo_snapshot: null,
        token_budget: null,
        discovery_volume: { session_count: 0, daily_count: 0, daily_reset_at: '2025-01-01' },
      });
      vi.mocked(validateIdea).mockResolvedValue({
        passed: true,
        coverage_percentage: 100,
        blocking_issues: [],
        timestamp: '2025-01-01',
      });
    });

    it('should check nested layout first (vision/ subdirectory)', async () => {
      vi.mocked(existsSync).mockImplementation((path: any) => {
        const normalizedPath = path.toString().replace(/\\/g, '/');
        return normalizedPath.includes('.olympus/workflow/test-feature') || normalizedPath.includes('vision/idea.md');
      });

      registerWorkflowArtifactGateHook();
      const hooks = getHooksForEvent('PostToolUse');
      const ctx = createPostToolUseCtx();
      await hooks[0].handler(ctx);

      expect(validateIdea).toHaveBeenCalledWith(join('/test/project', '.olympus', 'workflow', 'test-feature', 'vision', 'idea.md'));
    });

    it('should fall back to flat layout when nested not found', async () => {
      vi.mocked(existsSync).mockImplementation((path: any) => {
        const normalizedPath = path.toString().replace(/\\/g, '/');
        // Return true for workflow directory
        if (normalizedPath.includes('.olympus/workflow/test-feature') && !normalizedPath.includes('idea.md')) {
          return true;
        }
        // Return false for nested vision/idea.md
        if (normalizedPath.includes('vision/idea.md')) {
          return false;
        }
        // Return true for flat idea.md
        return normalizedPath.endsWith('idea.md');
      });

      registerWorkflowArtifactGateHook();
      const hooks = getHooksForEvent('PostToolUse');
      const ctx = createPostToolUseCtx();
      await hooks[0].handler(ctx);

      expect(validateIdea).toHaveBeenCalledWith(join('/test/project', '.olympus', 'workflow', 'test-feature', 'idea.md'));
    });

    it('should return continue:true when artifact not found (fail open)', async () => {
      vi.mocked(existsSync).mockReturnValue(false);

      registerWorkflowArtifactGateHook();
      const hooks = getHooksForEvent('PostToolUse');
      const ctx = createPostToolUseCtx();
      const result = await hooks[0].handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.additionalContext).toBeUndefined();
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadSessionState).mockReturnValue({
        session_id: 'test',
        started_at: '2025-01-01',
        last_updated: '2025-01-01',
        recent_prompts: [],
        pending_completion: { agent_used: 'idea-intake', task_id: 'task-1' },
        todo_snapshot: null,
        token_budget: null,
        discovery_volume: { session_count: 0, daily_count: 0, daily_reset_at: '2025-01-01' },
      });
    });

    it('should never throw, returns continue:true on error', async () => {
      vi.mocked(loadCheckpoint).mockRejectedValue(new Error('Checkpoint error'));

      registerWorkflowArtifactGateHook();
      const hooks = getHooksForEvent('PostToolUse');
      const ctx = createPostToolUseCtx();
      const result = await hooks[0].handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.additionalContext).toBeUndefined();
    });

    it('should return continue:true when loadCheckpoint throws', async () => {
      vi.mocked(loadCheckpoint).mockRejectedValue(new Error('Failed to load checkpoint'));

      registerWorkflowArtifactGateHook();
      const hooks = getHooksForEvent('PostToolUse');
      const ctx = createPostToolUseCtx();
      const result = await hooks[0].handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.additionalContext).toBeUndefined();
    });

    it('should return continue:true when validation function throws', async () => {
      vi.mocked(loadCheckpoint).mockResolvedValue(createMockCheckpoint());
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(validateIdea).mockRejectedValue(new Error('Validation error'));

      registerWorkflowArtifactGateHook();
      const hooks = getHooksForEvent('PostToolUse');
      const ctx = createPostToolUseCtx();
      const result = await hooks[0].handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.additionalContext).toBeUndefined();
    });

    it('should log errors with [Olympus Artifact Gate] prefix', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(loadCheckpoint).mockRejectedValue(new Error('Test error'));

      registerWorkflowArtifactGateHook();
      const hooks = getHooksForEvent('PostToolUse');
      const ctx = createPostToolUseCtx();
      await hooks[0].handler(ctx);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Olympus Artifact Gate]'),
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });
  });
});

// Helpers
function createMockCheckpoint(overrides: Record<string, any> = {}) {
  return {
    schema_version: '2.0.0',
    workflow_id: 'test-feature',
    feature_name: 'Test Feature',
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
    current_stage: 'idea',
    status: 'in_progress',
    artifacts: { idea: null, prd: null, spec: null, intents: null, complete: null },
    validation_results: { idea: null, prd: null, spec: null, intents: null, complete: null },
    ...overrides,
  };
}

function createPostToolUseCtx(overrides: Record<string, any> = {}): HookContext {
  return {
    sessionId: 'test-session',
    directory: '/test/project',
    toolName: 'Task',
    toolInput: { subagent_type: 'idea-intake', prompt: 'test' },
    toolOutput: 'Task completed successfully',
    ...overrides,
  };
}
