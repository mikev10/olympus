/**
 * Tests for Plan Lifecycle Hooks
 *
 * Covers all 5 hooks:
 * 1. planFileMonitor (PostToolUse, priority 75)
 * 2. momusReviewTracker (PostToolUse, priority 76)
 * 3. completePlanTracker (UserPromptSubmit, priority 115)
 * 4. prometheusLearningsInjection (PreToolUse, priority 55)
 * 5. workflowPhaseTransitionTracker (PostToolUse, priority 83)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { clearHooks } from '../../hooks/registry.js';
import { registerPlanLifecycleHooks } from '../../hooks/registrations/plan-lifecycle.js';
import type { HookContext, HookResult } from '../../hooks/types.js';
import type { ManifestSchema, WorkflowCheckpointV3 } from '../../features/workflow-engine/phase-types.js';

// Hoisted mock functions
const mocks = vi.hoisted(() => ({
  loadManifest: vi.fn(),
  saveManifest: vi.fn(),
  loadCheckpoint: vi.fn(),
  saveCheckpoint: vi.fn(),
  listWorkflows: vi.fn(),
  loadSessionState: vi.fn(),
  saveSessionState: vi.fn(),
  loadDiscoveryConfig: vi.fn(),
  detectPlanFileChange: vi.fn(),
  parseMomusReviewOutput: vi.fn(),
  createPlanningDiscovery: vi.fn(),
  formatPlanLearnings: vi.fn(),
  recordDiscovery: vi.fn(),
  getDiscoveriesForInjection: vi.fn(),
}));

// Mock all external dependencies
vi.mock('../../features/workflow-engine/manifest.js', () => ({
  loadManifest: mocks.loadManifest,
  saveManifest: mocks.saveManifest,
}));

vi.mock('../../features/workflow-engine/checkpoint.js', () => ({
  loadCheckpoint: mocks.loadCheckpoint,
  saveCheckpoint: mocks.saveCheckpoint,
  listWorkflows: mocks.listWorkflows,
}));

vi.mock('../../learning/session-state.js', () => ({
  loadSessionState: mocks.loadSessionState,
  saveSessionState: mocks.saveSessionState,
}));

vi.mock('../../learning/config.js', () => ({
  loadDiscoveryConfig: mocks.loadDiscoveryConfig,
}));

vi.mock('../../learning/plan-tracker.js', () => ({
  detectPlanFileChange: mocks.detectPlanFileChange,
  parseMomusReviewOutput: mocks.parseMomusReviewOutput,
  createPlanningDiscovery: mocks.createPlanningDiscovery,
  formatPlanLearnings: mocks.formatPlanLearnings,
}));

vi.mock('../../learning/discovery.js', () => ({
  recordDiscovery: mocks.recordDiscovery,
  getDiscoveriesForInjection: mocks.getDiscoveriesForInjection,
}));

describe('Plan Lifecycle Hooks', () => {
  beforeEach(() => {
    clearHooks();
    vi.clearAllMocks();

    // Default mock behaviors
    mocks.loadDiscoveryConfig.mockReturnValue({ enabled: true });
    mocks.loadSessionState.mockReturnValue({
      session_id: 'test-session',
      started_at: new Date().toISOString(),
      last_updated: new Date().toISOString(),
      recent_prompts: [],
      pending_completion: null,
      todo_snapshot: null,
      token_budget: null,
      discovery_volume: null,
    });
  });

  afterEach(() => {
    clearHooks();
  });

  describe('Hook 1: planFileMonitor', () => {
    it('ignores non-Write tool calls', async () => {
      registerPlanLifecycleHooks();
      const { getHooksForEvent } = await import('../../hooks/registry.js');
      const hooks = getHooksForEvent('PostToolUse');

      const ctx: HookContext = {
        toolName: 'Read',
        directory: '/test/project',
        sessionId: 'test-session',
        toolInput: {},
      };

      const hook = hooks.find(h => h.name === 'planFileMonitor');
      expect(hook).toBeDefined();

      const result = await hook!.handler(ctx);
      expect(result.continue).toBe(true);
      expect(mocks.detectPlanFileChange).not.toHaveBeenCalled();
    });

    it('ignores non-plan files', async () => {
      registerPlanLifecycleHooks();
      const { getHooksForEvent } = await import('../../hooks/registry.js');
      const hooks = getHooksForEvent('PostToolUse', 75);

      const ctx: HookContext = {
        toolName: 'Write',
        directory: '/test/project',
        sessionId: 'test-session',
        toolInput: {
          file_path: '/test/project/src/index.ts',
        },
      };

      const hook = hooks.find(h => h.name === 'planFileMonitor');
      const result = await hook!.handler(ctx);

      expect(result.continue).toBe(true);
      expect(mocks.detectPlanFileChange).not.toHaveBeenCalled();
    });

    it('detects plan file writes in .olympus/plans/', async () => {
      registerPlanLifecycleHooks();
      const { getHooksForEvent } = await import('../../hooks/registry.js');
      const hooks = getHooksForEvent('PostToolUse', 75);

      mocks.detectPlanFileChange.mockReturnValue({
        event_type: 'plan_revised',
        revision_count: 3,
        plan_path: '/test/project/.olympus/plans/my-plan.md',
      });

      mocks.createPlanningDiscovery.mockReturnValue({
        category: 'planning_insight',
        summary: 'Plan revised 3 times',
        details: 'Multiple revisions detected',
        agent_name: 'prometheus',
        confidence: 0.7,
      });

      const ctx: HookContext = {
        toolName: 'Write',
        directory: '/test/project',
        sessionId: 'test-session',
        toolInput: {
          file_path: '/test/project/.olympus/plans/my-plan.md',
        },
      };

      const hook = hooks.find(h => h.name === 'planFileMonitor');
      const result = await hook!.handler(ctx);

      expect(result.continue).toBe(true);
      expect(mocks.detectPlanFileChange).toHaveBeenCalledWith(
        '/test/project',
        '/test/project/.olympus/plans/my-plan.md',
        'test-session'
      );
      expect(mocks.recordDiscovery).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'planning_insight',
          summary: 'Plan revised 3 times',
          project_path: '/test/project',
          session_id: 'test-session',
        })
      );
    });

    it('handles errors silently', async () => {
      registerPlanLifecycleHooks();
      const { getHooksForEvent } = await import('../../hooks/registry.js');
      const hooks = getHooksForEvent('PostToolUse', 75);

      mocks.detectPlanFileChange.mockImplementation(() => {
        throw new Error('Test error');
      });

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const ctx: HookContext = {
        toolName: 'Write',
        directory: '/test/project',
        sessionId: 'test-session',
        toolInput: {
          file_path: '/test/project/.olympus/plans/my-plan.md',
        },
      };

      const hook = hooks.find(h => h.name === 'planFileMonitor');
      const result = await hook!.handler(ctx);

      expect(result.continue).toBe(true);
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Hook 2: momusReviewTracker', () => {
    it('ignores non-Task tool calls', async () => {
      registerPlanLifecycleHooks();
      const { getHooksForEvent } = await import('../../hooks/registry.js');
      const hooks = getHooksForEvent('PostToolUse', 76);

      const ctx: HookContext = {
        toolName: 'Write',
        directory: '/test/project',
        sessionId: 'test-session',
        toolInput: {},
      };

      const hook = hooks.find(h => h.name === 'momusReviewTracker');
      const result = await hook!.handler(ctx);

      expect(result.continue).toBe(true);
      expect(mocks.parseMomusReviewOutput).not.toHaveBeenCalled();
    });

    it('ignores non-momus tasks', async () => {
      registerPlanLifecycleHooks();
      const { getHooksForEvent } = await import('../../hooks/registry.js');
      const hooks = getHooksForEvent('PostToolUse', 76);

      const ctx: HookContext = {
        toolName: 'Task',
        directory: '/test/project',
        sessionId: 'test-session',
        toolInput: {
          subagent_type: 'olympian',
        },
      };

      const hook = hooks.find(h => h.name === 'momusReviewTracker');
      const result = await hook!.handler(ctx);

      expect(result.continue).toBe(true);
      expect(mocks.parseMomusReviewOutput).not.toHaveBeenCalled();
    });

    it('records discoveries for failed momus reviews with specific issues', async () => {
      registerPlanLifecycleHooks();
      const { getHooksForEvent } = await import('../../hooks/registry.js');
      const hooks = getHooksForEvent('PostToolUse', 76);

      mocks.parseMomusReviewOutput.mockReturnValue({
        passed: false,
        issues: ['Missing acceptance criteria', 'No test plan specified'],
      });

      mocks.createPlanningDiscovery.mockReturnValue({
        category: 'planning_insight',
        summary: 'Momus review failed',
        details: 'Issues found',
        agent_name: 'momus',
        confidence: 0.9,
      });

      const ctx: HookContext = {
        toolName: 'Task',
        directory: '/test/project',
        sessionId: 'test-session',
        toolInput: {
          subagent_type: 'momus',
          prompt: 'Review .olympus/plans/feature-plan.md',
        },
        toolOutput: 'Review failed with issues',
      };

      const hook = hooks.find(h => h.name === 'momusReviewTracker');
      const result = await hook!.handler(ctx);

      expect(result.continue).toBe(true);
      expect(mocks.recordDiscovery).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'planning_insight',
          agent_name: 'momus',
          confidence: 0.9,
        })
      );
    });
  });

  describe('Hook 3: completePlanTracker', () => {
    it('detects /complete-plan markers in user prompt', async () => {
      registerPlanLifecycleHooks();
      const { getHooksForEvent } = await import('../../hooks/registry.js');
      const hooks = getHooksForEvent('UserPromptSubmit', 115);

      const ctx: HookContext = {
        directory: '/test/project',
        sessionId: 'test-session',
        prompt: '/complete-plan',
        parts: [{ text: '[PLAN COMPLETION MODE - VERIFICATION REQUIRED] Verify plan completion' }],
      };

      const hook = hooks.find(h => h.name === 'completePlanTracker');
      const result = await hook!.handler(ctx);

      expect(result.continue).toBe(true);
      expect(mocks.saveSessionState).toHaveBeenCalledWith(
        '/test/project',
        expect.objectContaining({
          pending_completion: expect.objectContaining({
            task_description: 'plan_completion_verification',
            agent_used: 'complete-plan',
          }),
        })
      );
    });

    it('ignores prompts without /complete-plan markers', async () => {
      registerPlanLifecycleHooks();
      const { getHooksForEvent } = await import('../../hooks/registry.js');
      const hooks = getHooksForEvent('UserPromptSubmit', 115);

      const ctx: HookContext = {
        directory: '/test/project',
        sessionId: 'test-session',
        prompt: 'Write some code',
        parts: [{ text: 'Write some code' }],
      };

      const hook = hooks.find(h => h.name === 'completePlanTracker');
      const result = await hook!.handler(ctx);

      expect(result.continue).toBe(true);
      expect(mocks.saveSessionState).not.toHaveBeenCalled();
    });
  });

  describe('Hook 4: prometheusLearningsInjection', () => {
    it('injects learnings for prometheus tasks', async () => {
      registerPlanLifecycleHooks();
      const { getHooksForEvent } = await import('../../hooks/registry.js');
      const hooks = getHooksForEvent('PreToolUse', 55);

      mocks.getDiscoveriesForInjection.mockReturnValue([
        { category: 'planning_insight', summary: 'Insight 1', details: 'Details 1' },
        { category: 'planning_insight', summary: 'Insight 2', details: 'Details 2' },
      ]);

      mocks.formatPlanLearnings.mockReturnValue('<plan-learnings>...</plan-learnings>');

      const ctx: HookContext = {
        toolName: 'Task',
        directory: '/test/project',
        toolInput: {
          subagent_type: 'prometheus',
        },
      };

      const hook = hooks.find(h => h.name === 'prometheusLearningsInjection');
      const result = await hook!.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput).toEqual({
        hookEventName: 'PreToolUse',
        additionalContext: '<plan-learnings>...</plan-learnings>',
      });
    });

    it('ignores non-prometheus tasks', async () => {
      registerPlanLifecycleHooks();
      const { getHooksForEvent } = await import('../../hooks/registry.js');
      const hooks = getHooksForEvent('PreToolUse', 55);

      const ctx: HookContext = {
        toolName: 'Task',
        directory: '/test/project',
        toolInput: {
          subagent_type: 'olympian',
        },
      };

      const hook = hooks.find(h => h.name === 'prometheusLearningsInjection');
      const result = await hook!.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput).toBeUndefined();
    });
  });

  describe('Hook 5: workflowPhaseTransitionTracker', () => {
    const createMockManifest = (): ManifestSchema => ({
      schema_version: '2.0.0',
      workflow_id: 'test-workflow',
      feature_name: 'Test Feature',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      phases: {
        discovery: {
          status: 'complete',
          started_at: '2024-01-01T00:00:00Z',
          completed_at: '2024-01-01T01:00:00Z',
          gate_result: null,
          gate_bypassed: false,
          bypass_reason: null,
        },
        inception: {
          status: 'complete',
          started_at: '2024-01-01T01:00:00Z',
          completed_at: '2024-01-01T02:00:00Z',
          gate_result: null,
          gate_bypassed: false,
          bypass_reason: null,
        },
        construction: {
          status: 'not_started',
          started_at: null,
          completed_at: null,
          gate_result: null,
          gate_bypassed: false,
          bypass_reason: null,
        },
        operations: {
          status: 'not_started',
          started_at: null,
          completed_at: null,
          gate_result: null,
          gate_bypassed: false,
          bypass_reason: null,
        },
      },
      depth_assessment: null,
      artifacts: [],
      links: [],
      risks: [],
      gate_audit: [],
      metrics: null,
      alignment_checks: [],
      risk_tier: null,
    });

    const createMockCheckpoint = (phase: string): WorkflowCheckpointV3 => ({
      schema_version: '3.0.0',
      workflow_id: 'test-workflow',
      feature_name: 'Test Feature',
      current_phase: phase as any,
      current_stage: 'bolt',
      status: 'in_progress',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T02:00:00Z',
      context: {
        idea: null,
        intents: [],
        units: [],
        bolts: [],
        nfrs: [],
        risks: [],
        domain_design: null,
        logical_design: null,
        deployment_units: [],
      },
      gate_history: [],
      metadata: {
        tags: [],
        assigned_to: null,
        priority: 'medium',
      },
    });

    it('detects phase transition from inception to construction', async () => {
      registerPlanLifecycleHooks();
      const { getHooksForEvent } = await import('../../hooks/registry.js');
      const hooks = getHooksForEvent('PostToolUse', 83);

      const manifest = createMockManifest();
      const checkpoint = createMockCheckpoint('construction');

      mocks.loadManifest.mockReturnValue(manifest);
      mocks.listWorkflows.mockResolvedValue(['test-workflow']);
      mocks.loadCheckpoint.mockResolvedValue(checkpoint);
      mocks.loadSessionState.mockReturnValue({
        session_id: 'test-session',
        last_tracked_phase: 'inception',
      } as any);

      const ctx: HookContext = {
        toolName: 'Write',
        directory: '/test/project',
        sessionId: 'test-session',
        toolInput: {},
      };

      const hook = hooks.find(h => h.name === 'workflowPhaseTransitionTracker');
      const result = await hook!.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.additionalContext).toContain('Phase transition: Inception → Construction');
      expect(mocks.saveManifest).toHaveBeenCalled();

      // Verify gate_audit entry was added
      const saveCall = mocks.saveManifest.mock.calls[0];
      const savedManifest = saveCall[1] as ManifestSchema;
      expect(savedManifest.gate_audit).toHaveLength(1);
      expect(savedManifest.gate_audit[0]).toEqual(
        expect.objectContaining({
          phase: 'construction',
          action: 'approved',
          actor: 'trust',
          reason: 'Phase transition: inception -> construction',
        })
      );
    });

    it('updates phase states in manifest during transition', async () => {
      registerPlanLifecycleHooks();
      const { getHooksForEvent } = await import('../../hooks/registry.js');
      const hooks = getHooksForEvent('PostToolUse', 83);

      const manifest = createMockManifest();
      const checkpoint = createMockCheckpoint('construction');

      mocks.loadManifest.mockReturnValue(manifest);
      mocks.listWorkflows.mockResolvedValue(['test-workflow']);
      mocks.loadCheckpoint.mockResolvedValue(checkpoint);
      mocks.loadSessionState.mockReturnValue({
        session_id: 'test-session',
        last_tracked_phase: 'inception',
      } as any);

      const ctx: HookContext = {
        toolName: 'Write',
        directory: '/test/project',
        sessionId: 'test-session',
        toolInput: {},
      };

      const hook = hooks.find(h => h.name === 'workflowPhaseTransitionTracker');
      await hook!.handler(ctx);

      const saveCall = mocks.saveManifest.mock.calls[0];
      const savedManifest = saveCall[1] as ManifestSchema;

      // Previous phase (inception) should be complete
      expect(savedManifest.phases.inception.status).toBe('complete');
      expect(savedManifest.phases.inception.completed_at).toBeTruthy();

      // Current phase (construction) should be in_progress
      expect(savedManifest.phases.construction.status).toBe('in_progress');
      expect(savedManifest.phases.construction.started_at).toBeTruthy();
    });

    it('tracks current phase in session state', async () => {
      registerPlanLifecycleHooks();
      const { getHooksForEvent } = await import('../../hooks/registry.js');
      const hooks = getHooksForEvent('PostToolUse', 83);

      const manifest = createMockManifest();
      const checkpoint = createMockCheckpoint('construction');

      mocks.loadManifest.mockReturnValue(manifest);
      mocks.listWorkflows.mockResolvedValue(['test-workflow']);
      mocks.loadCheckpoint.mockResolvedValue(checkpoint);
      mocks.loadSessionState.mockReturnValue({
        session_id: 'test-session',
        last_tracked_phase: 'inception',
      } as any);

      const ctx: HookContext = {
        toolName: 'Write',
        directory: '/test/project',
        sessionId: 'test-session',
        toolInput: {},
      };

      const hook = hooks.find(h => h.name === 'workflowPhaseTransitionTracker');
      await hook!.handler(ctx);

      expect(mocks.saveSessionState).toHaveBeenCalledWith(
        '/test/project',
        expect.objectContaining({
          last_tracked_phase: 'construction',
        })
      );
    });

    it('emits special message for operations phase transition', async () => {
      registerPlanLifecycleHooks();
      const { getHooksForEvent } = await import('../../hooks/registry.js');
      const hooks = getHooksForEvent('PostToolUse', 83);

      const manifest = createMockManifest();
      const checkpoint = createMockCheckpoint('operations');

      mocks.loadManifest.mockReturnValue(manifest);
      mocks.listWorkflows.mockResolvedValue(['test-workflow']);
      mocks.loadCheckpoint.mockResolvedValue(checkpoint);
      mocks.loadSessionState.mockReturnValue({
        session_id: 'test-session',
        last_tracked_phase: 'construction',
      } as any);

      const ctx: HookContext = {
        toolName: 'Write',
        directory: '/test/project',
        sessionId: 'test-session',
        toolInput: {},
      };

      const hook = hooks.find(h => h.name === 'workflowPhaseTransitionTracker');
      const result = await hook!.handler(ctx);

      expect(result.hookSpecificOutput?.additionalContext).toContain('Phase transition: Construction → Operations');
      expect(result.hookSpecificOutput?.additionalContext).toContain('Generating deployment artifacts...');
    });

    it('handles workflow completion (operations -> complete)', async () => {
      registerPlanLifecycleHooks();
      const { getHooksForEvent } = await import('../../hooks/registry.js');
      const hooks = getHooksForEvent('PostToolUse', 83);

      const manifest = createMockManifest();
      manifest.phases.operations.status = 'in_progress';

      const checkpoint = createMockCheckpoint('operations');
      checkpoint.status = 'complete';

      mocks.loadManifest.mockReturnValue(manifest);
      mocks.listWorkflows.mockResolvedValue(['test-workflow']);
      mocks.loadCheckpoint.mockResolvedValue(checkpoint);
      mocks.loadSessionState.mockReturnValue({
        session_id: 'test-session',
        last_tracked_phase: 'operations',
      } as any);

      const ctx: HookContext = {
        toolName: 'Write',
        directory: '/test/project',
        sessionId: 'test-session',
        toolInput: {},
      };

      const hook = hooks.find(h => h.name === 'workflowPhaseTransitionTracker');
      const result = await hook!.handler(ctx);

      expect(result.hookSpecificOutput?.additionalContext).toContain('Workflow complete! All phases finished.');

      const saveCall = mocks.saveManifest.mock.calls[0];
      const savedManifest = saveCall[1] as ManifestSchema;
      expect(savedManifest.phases.operations.status).toBe('complete');
    });

    it('ignores non-Write/Task tool calls', async () => {
      registerPlanLifecycleHooks();
      const { getHooksForEvent } = await import('../../hooks/registry.js');
      const hooks = getHooksForEvent('PostToolUse', 83);

      const ctx: HookContext = {
        toolName: 'Read',
        directory: '/test/project',
        sessionId: 'test-session',
        toolInput: {},
      };

      const hook = hooks.find(h => h.name === 'workflowPhaseTransitionTracker');
      const result = await hook!.handler(ctx);

      expect(result.continue).toBe(true);
      expect(mocks.loadManifest).not.toHaveBeenCalled();
    });

    it('handles missing manifest gracefully', async () => {
      registerPlanLifecycleHooks();
      const { getHooksForEvent } = await import('../../hooks/registry.js');
      const hooks = getHooksForEvent('PostToolUse', 83);

      mocks.loadManifest.mockReturnValue(null);

      const ctx: HookContext = {
        toolName: 'Write',
        directory: '/test/project',
        sessionId: 'test-session',
        toolInput: {},
      };

      const hook = hooks.find(h => h.name === 'workflowPhaseTransitionTracker');
      const result = await hook!.handler(ctx);

      expect(result.continue).toBe(true);
      expect(mocks.listWorkflows).not.toHaveBeenCalled();
    });

    it('handles errors silently', async () => {
      registerPlanLifecycleHooks();
      const { getHooksForEvent } = await import('../../hooks/registry.js');
      const hooks = getHooksForEvent('PostToolUse', 83);

      mocks.loadManifest.mockImplementation(() => {
        throw new Error('Test error');
      });

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const ctx: HookContext = {
        toolName: 'Write',
        directory: '/test/project',
        sessionId: 'test-session',
        toolInput: {},
      };

      const hook = hooks.find(h => h.name === 'workflowPhaseTransitionTracker');
      const result = await hook!.handler(ctx);

      expect(result.continue).toBe(true);
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    it('initializes last_tracked_phase on first run', async () => {
      registerPlanLifecycleHooks();
      const { getHooksForEvent } = await import('../../hooks/registry.js');
      const hooks = getHooksForEvent('PostToolUse', 83);

      const manifest = createMockManifest();
      const checkpoint = createMockCheckpoint('inception');

      mocks.loadManifest.mockReturnValue(manifest);
      mocks.listWorkflows.mockResolvedValue(['test-workflow']);
      mocks.loadCheckpoint.mockResolvedValue(checkpoint);
      mocks.loadSessionState.mockReturnValue({
        session_id: 'test-session',
        // No last_tracked_phase set
      } as any);

      const ctx: HookContext = {
        toolName: 'Write',
        directory: '/test/project',
        sessionId: 'test-session',
        toolInput: {},
      };

      const hook = hooks.find(h => h.name === 'workflowPhaseTransitionTracker');
      await hook!.handler(ctx);

      expect(mocks.saveSessionState).toHaveBeenCalledWith(
        '/test/project',
        expect.objectContaining({
          last_tracked_phase: 'inception',
        })
      );
    });
  });
});
