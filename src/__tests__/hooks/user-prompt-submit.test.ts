/**
 * Unit Tests for User Prompt Submit Hooks
 *
 * Comprehensive tests for the structuredWorkflowDetector hook registration
 * and behavior in the user-prompt-submit.ts file.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { registerUserPromptSubmitHooks } from '../../hooks/registrations/user-prompt-submit.js';
import { getHooksForEvent, clearHooks } from '../../hooks/registry.js';
import type { HookContext, HookResult } from '../../hooks/types.js';
import type { WorkflowCheckpoint } from '../../features/workflow-engine/types.js';

// Mock the workflow engine modules
vi.mock('../../features/workflow-engine/engine.js', () => {
  return {
    WorkflowEngine: vi.fn(function(this: any, projectPath: string, featureName: string) {
      this.start = vi.fn().mockResolvedValue(undefined);
      this.resume = vi.fn().mockResolvedValue('Resumed workflow');
      this.pause = vi.fn().mockResolvedValue('aidlc-docs/test/checkpoint.json');
      this.executeStage = vi.fn().mockResolvedValue(undefined);
      this.getStatus = vi.fn().mockResolvedValue({
        workflow_id: 'test',
        feature_name: featureName,
        current_stage: 'intent',
        status: 'in_progress',
        artifacts: [],
        updated_at: new Date().toISOString(),
      });
    }),
  };
});

vi.mock('../../features/workflow-engine/checkpoint.js', () => ({
  loadCheckpoint: vi.fn(),
  saveCheckpoint: vi.fn().mockResolvedValue(undefined),
  listWorkflows: vi.fn(),
  deleteWorkflow: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../features/workflow-engine/hooks.js', () => ({
  buildStructuredWorkflowPrompt: vi.fn((featureName: string, checkpoint: WorkflowCheckpoint) => {
    return `You are beginning a structured workflow for feature: ${featureName}\n\nCurrent stage: ${checkpoint.current_stage}\nStatus: ${checkpoint.status}\n\nNext step: Use /plan and Prometheus to create a comprehensive work plan based on the strategic context\n\nUse: /plan ${featureName}`;
  }),
  buildWorkflowResumptionPrompt: vi.fn((featureName: string, checkpoint: WorkflowCheckpoint) => {
    return `Resuming workflow for feature: ${featureName}\n\nYou were interrupted during: ${checkpoint.current_stage}\nLast update: ${checkpoint.updated_at}\n\nResume context: ${JSON.stringify(checkpoint.resume_context, null, 2)}\n\nContinue from where you left off: Use /plan and Prometheus to create a comprehensive work plan\n\nUse: /plan ${featureName}`;
  }),
  buildWorkflowTransitionPrompt: vi.fn(),
}));

// Import mocked modules to access mock functions
import { WorkflowEngine } from '../../features/workflow-engine/engine.js';
import { loadCheckpoint, listWorkflows } from '../../features/workflow-engine/checkpoint.js';
import { buildStructuredWorkflowPrompt, buildWorkflowResumptionPrompt } from '../../features/workflow-engine/hooks.js';

describe('Structured Workflow Hook', () => {
  beforeEach(() => {
    clearHooks();
    vi.clearAllMocks();
  });

  afterEach(() => {
    clearHooks();
  });

  describe('Hook Registration', () => {
    it('registers hook with name "structuredWorkflowDetector"', () => {
      registerUserPromptSubmitHooks();
      const hooks = getHooksForEvent('UserPromptSubmit');
      const hookNames = hooks.map(h => h.name);
      expect(hookNames).toContain('structuredWorkflowDetector');
    });

    it('registers hook with priority 8', () => {
      registerUserPromptSubmitHooks();
      const hooks = getHooksForEvent('UserPromptSubmit');
      const workflowHook = hooks.find(h => h.name === 'structuredWorkflowDetector');
      expect(workflowHook).toBeDefined();
      expect(workflowHook?.priority).toBe(8);
    });

    it('registers hook for UserPromptSubmit event', () => {
      registerUserPromptSubmitHooks();
      const hooks = getHooksForEvent('UserPromptSubmit');
      const workflowHook = hooks.find(h => h.name === 'structuredWorkflowDetector');
      expect(workflowHook).toBeDefined();
      expect(workflowHook?.event).toBe('UserPromptSubmit');
    });

    it('hook is enabled by default', () => {
      registerUserPromptSubmitHooks();
      const hooks = getHooksForEvent('UserPromptSubmit');
      const workflowHook = hooks.find(h => h.name === 'structuredWorkflowDetector');
      expect(workflowHook?.enabled).not.toBe(false);
    });
  });

  describe('Pattern Detection', () => {
    let workflowHook: any;

    beforeEach(() => {
      registerUserPromptSubmitHooks();
      const hooks = getHooksForEvent('UserPromptSubmit');
      workflowHook = hooks.find(h => h.name === 'structuredWorkflowDetector');
    });

    it('detects /plan {feature} --structured pattern', async () => {
      const ctx: HookContext = {
        prompt: '/plan myfeature --structured',
        directory: '/test/project',
        sessionId: 'test-session',
      };

      vi.mocked(loadCheckpoint).mockResolvedValue({
        schema_version: '1.0.0',
        workflow_id: 'myfeature',
        feature_name: 'myfeature',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        current_stage: 'intent',
        status: 'in_progress',
        artifacts: {
          prd: null,
          spec: null,
          intent: null,
          complete: null,
        },
        validation_results: {
          prd: null,
          spec: null,
          intent: null,
          complete: null,
        },
        resume_context: {
          initial_prompt: '/plan myfeature --structured',
        },
      });

      const result = await workflowHook.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput).toBeDefined();
      expect(result.hookSpecificOutput?.hookEventName).toBe('UserPromptSubmit');
      expect(result.hookSpecificOutput?.additionalContext).toContain('myfeature');
      expect(result.hookSpecificOutput?.additionalContext).toContain('/plan');
    });

    it('detects /plan with kebab-case feature names', async () => {
      const ctx: HookContext = {
        prompt: '/plan user-auth --structured',
        directory: '/test/project',
        sessionId: 'test-session',
      };

      vi.mocked(loadCheckpoint).mockResolvedValue({
        schema_version: '1.0.0',
        workflow_id: 'user-auth',
        feature_name: 'user-auth',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        current_stage: 'intent',
        status: 'in_progress',
        artifacts: {
          prd: null,
          spec: null,
          intent: null,
          complete: null,
        },
        validation_results: {
          prd: null,
          spec: null,
          intent: null,
          complete: null,
        },
        resume_context: {
          initial_prompt: '/plan user-auth --structured',
        },
      });

      const result = await workflowHook.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.additionalContext).toContain('user-auth');
    });

    it('detects /plan with multi-word feature names', async () => {
      const ctx: HookContext = {
        prompt: '/plan my awesome feature --structured',
        directory: '/test/project',
        sessionId: 'test-session',
      };

      vi.mocked(loadCheckpoint).mockResolvedValue({
        schema_version: '1.0.0',
        workflow_id: 'my-awesome-feature',
        feature_name: 'my awesome feature',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        current_stage: 'intent',
        status: 'in_progress',
        artifacts: {
          prd: null,
          spec: null,
          intent: null,
          complete: null,
        },
        validation_results: {
          prd: null,
          spec: null,
          intent: null,
          complete: null,
        },
        resume_context: {
          initial_prompt: '/plan my awesome feature --structured',
        },
      });

      const result = await workflowHook.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.additionalContext).toContain('my awesome feature');
    });

    it('matches /plan {feature} without --structured flag', async () => {
      const ctx: HookContext = {
        prompt: '/plan myfeature',
        directory: '/test/project',
        sessionId: 'test-session',
      };

      vi.mocked(loadCheckpoint).mockResolvedValue({
        schema_version: '1.0.0',
        workflow_id: 'myfeature',
        feature_name: 'myfeature',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        current_stage: 'intent',
        status: 'in_progress',
        artifacts: {
          prd: null,
          spec: null,
          intent: null,
          complete: null,
        },
        validation_results: {
          prd: null,
          spec: null,
          intent: null,
          complete: null,
        },
        resume_context: {
          initial_prompt: '/plan myfeature',
        },
      });

      const result = await workflowHook.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput).toBeDefined();
      expect(result.hookSpecificOutput?.additionalContext).toContain('myfeature');
      expect(WorkflowEngine).toHaveBeenCalled();
    });

    it('does not match regular /plan command', async () => {
      const ctx: HookContext = {
        prompt: '/plan',
        directory: '/test/project',
        sessionId: 'test-session',
      };

      const result = await workflowHook.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput).toBeUndefined();
      expect(WorkflowEngine).not.toHaveBeenCalled();
    });

    it('detects /plan continue pattern', async () => {
      const ctx: HookContext = {
        prompt: '/plan continue',
        directory: '/test/project',
        sessionId: 'test-session',
      };

      vi.mocked(listWorkflows).mockResolvedValue(['user-auth']);
      vi.mocked(loadCheckpoint).mockResolvedValue({
        schema_version: '1.0.0',
        workflow_id: 'user-auth',
        feature_name: 'user-auth',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        current_stage: 'intent',
        status: 'paused',
        artifacts: {
          intent: {
            id: 'INTENT-001',
            path: 'aidlc-docs/user-auth/intent.md',
            created_at: '2024-01-01T00:00:00Z',
            validation_passed: true,
          },
          prd: null,
          spec: null,
          unit: null,
          complete: null,
        },
        validation_results: {
          prd: null,
          spec: null,
          intent: null,
          unit: null,
          complete: null,
        },
        resume_context: {
          initial_prompt: '/plan user-auth --structured',
          interrupted_at: '2024-01-01T00:00:00Z',
        },
      });

      const result = await workflowHook.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput).toBeDefined();
      expect(result.hookSpecificOutput?.additionalContext).toContain('Resuming workflow');
      expect(result.hookSpecificOutput?.additionalContext).toContain('user-auth');
    });

    it('is case insensitive for /plan --structured', async () => {
      const ctx: HookContext = {
        prompt: '/PLAN MyFeature --STRUCTURED',
        directory: '/test/project',
        sessionId: 'test-session',
      };

      vi.mocked(loadCheckpoint).mockResolvedValue({
        schema_version: '1.0.0',
        workflow_id: 'myfeature',
        feature_name: 'MyFeature',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        current_stage: 'intent',
        status: 'in_progress',
        artifacts: {
          prd: null,
          spec: null,
          intent: null,
          complete: null,
        },
        validation_results: {
          prd: null,
          spec: null,
          intent: null,
          complete: null,
        },
        resume_context: {
          initial_prompt: '/PLAN MyFeature --STRUCTURED',
        },
      });

      const result = await workflowHook.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput).toBeDefined();
    });

    it('is case insensitive for /plan continue', async () => {
      const ctx: HookContext = {
        prompt: '/PLAN CONTINUE',
        directory: '/test/project',
        sessionId: 'test-session',
      };

      vi.mocked(listWorkflows).mockResolvedValue(['test']);
      vi.mocked(loadCheckpoint).mockResolvedValue({
        schema_version: '1.0.0',
        workflow_id: 'test',
        feature_name: 'test',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        current_stage: 'intent',
        status: 'in_progress',
        artifacts: {
          prd: null,
          spec: null,
          intent: null,
          complete: null,
        },
        validation_results: {
          prd: null,
          spec: null,
          intent: null,
          complete: null,
        },
        resume_context: {},
      });

      const result = await workflowHook.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput).toBeDefined();
    });

    it('extracts --depth flag from feature name', async () => {
      const ctx: HookContext = {
        prompt: '/plan my feature --depth shallow',
        directory: '/test/project',
        sessionId: 'test-session',
      };

      vi.mocked(loadCheckpoint).mockResolvedValue({
        schema_version: '1.0.0',
        workflow_id: 'my-feature',
        feature_name: 'my feature',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        current_stage: 'intent',
        status: 'in_progress',
        artifacts: {
          prd: null,
          spec: null,
          intent: null,
          complete: null,
        },
        validation_results: {
          prd: null,
          spec: null,
          intent: null,
          complete: null,
        },
        resume_context: {},
      });

      const result = await workflowHook.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.additionalContext).toContain('my feature');
      expect(result.hookSpecificOutput?.additionalContext).toContain('Depth override: shallow');
    });

    it('extracts --brownfield flag from feature name', async () => {
      const ctx: HookContext = {
        prompt: '/plan my feature --brownfield',
        directory: '/test/project',
        sessionId: 'test-session',
      };

      vi.mocked(loadCheckpoint).mockResolvedValue({
        schema_version: '1.0.0',
        workflow_id: 'my-feature',
        feature_name: 'my feature',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        current_stage: 'intent',
        status: 'in_progress',
        artifacts: {
          prd: null,
          spec: null,
          intent: null,
          complete: null,
        },
        validation_results: {
          prd: null,
          spec: null,
          intent: null,
          complete: null,
        },
        resume_context: {},
      });

      const result = await workflowHook.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.additionalContext).toContain('my feature');
      expect(result.hookSpecificOutput?.additionalContext).toContain('Project type: brownfield');
    });

    it('does not match /plan --abort', async () => {
      const ctx: HookContext = {
        prompt: '/plan --abort',
        directory: '/test/project',
        sessionId: 'test-session',
      };

      const result = await workflowHook.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput).toBeUndefined();
      expect(WorkflowEngine).not.toHaveBeenCalled();
    });

    it('does not match /plan --help', async () => {
      const ctx: HookContext = {
        prompt: '/plan --help',
        directory: '/test/project',
        sessionId: 'test-session',
      };

      const result = await workflowHook.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput).toBeUndefined();
      expect(WorkflowEngine).not.toHaveBeenCalled();
    });

    it('supports backward compatibility with --structured flag', async () => {
      const ctx: HookContext = {
        prompt: '/plan my feature --structured',
        directory: '/test/project',
        sessionId: 'test-session',
      };

      vi.mocked(loadCheckpoint).mockResolvedValue({
        schema_version: '1.0.0',
        workflow_id: 'my-feature',
        feature_name: 'my feature',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        current_stage: 'intent',
        status: 'in_progress',
        artifacts: {
          prd: null,
          spec: null,
          intent: null,
          complete: null,
        },
        validation_results: {
          prd: null,
          spec: null,
          intent: null,
          complete: null,
        },
        resume_context: {},
      });

      const result = await workflowHook.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput).toBeDefined();
      expect(result.hookSpecificOutput?.additionalContext).toContain('my feature');
      expect(WorkflowEngine).toHaveBeenCalled();
    });

    it('injects workflow context hint for workflow start', async () => {
      const ctx: HookContext = {
        prompt: '/plan test-workflow',
        directory: '/test/project',
        sessionId: 'test-session',
      };

      vi.mocked(loadCheckpoint).mockResolvedValue({
        schema_version: '1.0.0',
        workflow_id: 'test-workflow',
        feature_name: 'test-workflow',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        current_stage: 'intent',
        current_phase: 'inception',
        status: 'in_progress',
        artifacts: {
          prd: null,
          spec: null,
          intent: null,
          complete: null,
        },
        validation_results: {
          prd: null,
          spec: null,
          intent: null,
          complete: null,
        },
        resume_context: {},
      });

      const result = await workflowHook.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.additionalContext).toContain('[Workflow: test-workflow | Phase: inception | Stage: intent]');
    });

    it('injects workflow context hint for workflow resume', async () => {
      const ctx: HookContext = {
        prompt: '/plan continue',
        directory: '/test/project',
        sessionId: 'test-session',
      };

      vi.mocked(listWorkflows).mockResolvedValue(['my-workflow']);
      vi.mocked(loadCheckpoint).mockResolvedValue({
        schema_version: '1.0.0',
        workflow_id: 'my-workflow',
        feature_name: 'My Workflow',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        current_stage: 'intent',
        current_phase: 'forge',
        status: 'paused',
        artifacts: {
          prd: null,
          spec: null,
          intent: null,
          complete: null,
        },
        validation_results: {
          prd: null,
          spec: null,
          intent: null,
          complete: null,
        },
        resume_context: {},
      });

      const result = await workflowHook.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.additionalContext).toContain('[Workflow: my-workflow | Phase: forge | Stage: intent]');
    });
  });

  describe('Workflow Start Flow', () => {
    let workflowHook: any;

    beforeEach(() => {
      registerUserPromptSubmitHooks();
      const hooks = getHooksForEvent('UserPromptSubmit');
      workflowHook = hooks.find(h => h.name === 'structuredWorkflowDetector');
    });

    it('creates WorkflowEngine instance with correct parameters', async () => {
      const ctx: HookContext = {
        prompt: '/plan myfeature --structured',
        directory: '/test/project',
        sessionId: 'test-session',
      };

      vi.mocked(loadCheckpoint).mockResolvedValue({
        schema_version: '1.0.0',
        workflow_id: 'myfeature',
        feature_name: 'myfeature',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        current_stage: 'intent',
        status: 'in_progress',
        artifacts: {
          prd: null,
          spec: null,
          intent: null,
          complete: null,
        },
        validation_results: {
          prd: null,
          spec: null,
          intent: null,
          complete: null,
        },
        resume_context: {},
      });

      await workflowHook.handler(ctx);

      expect(WorkflowEngine).toHaveBeenCalledWith('/test/project', 'myfeature');
    });

    it('calls engine.start() with feature name', async () => {
      const ctx: HookContext = {
        prompt: '/plan test-feature --structured',
        directory: '/test/project',
        sessionId: 'test-session',
      };

      vi.mocked(loadCheckpoint).mockResolvedValue({
        schema_version: '1.0.0',
        workflow_id: 'test-feature',
        feature_name: 'test-feature',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        current_stage: 'intent',
        status: 'in_progress',
        artifacts: {
          prd: null,
          spec: null,
          intent: null,
          complete: null,
        },
        validation_results: {
          prd: null,
          spec: null,
          intent: null,
          complete: null,
        },
        resume_context: {},
      });

      await workflowHook.handler(ctx);

      // Check that WorkflowEngine was called (constructor called)
      expect(WorkflowEngine).toHaveBeenCalledWith('/test/project', 'test-feature');
      // The start method should have been called on the instance
      const engineInstance = vi.mocked(WorkflowEngine).mock.results[vi.mocked(WorkflowEngine).mock.results.length - 1].value;
      expect(engineInstance.start).toHaveBeenCalledWith('test-feature');
    });

    it('loads checkpoint after workflow start', async () => {
      const ctx: HookContext = {
        prompt: '/plan myfeature --structured',
        directory: '/test/project',
        sessionId: 'test-session',
      };

      vi.mocked(loadCheckpoint).mockResolvedValue({
        schema_version: '1.0.0',
        workflow_id: 'myfeature',
        feature_name: 'myfeature',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        current_stage: 'intent',
        status: 'in_progress',
        artifacts: {
          prd: null,
          spec: null,
          intent: null,
          complete: null,
        },
        validation_results: {
          prd: null,
          spec: null,
          intent: null,
          complete: null,
        },
        resume_context: {},
      });

      await workflowHook.handler(ctx);

      expect(loadCheckpoint).toHaveBeenCalledWith('/test/project', 'myfeature');
    });

    it('calls buildStructuredWorkflowPrompt with checkpoint', async () => {
      const ctx: HookContext = {
        prompt: '/plan myfeature --structured',
        directory: '/test/project',
        sessionId: 'test-session',
      };

      const mockCheckpoint: WorkflowCheckpoint = {
        schema_version: '1.0.0',
        workflow_id: 'myfeature',
        feature_name: 'myfeature',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        current_stage: 'intent',
        status: 'in_progress',
        artifacts: {
          prd: null,
          spec: null,
          intent: null,
          complete: null,
        },
        validation_results: {
          prd: null,
          spec: null,
          intent: null,
          complete: null,
        },
        resume_context: {},
      };

      vi.mocked(loadCheckpoint).mockResolvedValue(mockCheckpoint);

      await workflowHook.handler(ctx);

      expect(buildStructuredWorkflowPrompt).toHaveBeenCalledWith('myfeature', mockCheckpoint, true);
    });

    it('returns additionalContext with workflow prompt', async () => {
      const ctx: HookContext = {
        prompt: '/plan myfeature --structured',
        directory: '/test/project',
        sessionId: 'test-session',
      };

      vi.mocked(loadCheckpoint).mockResolvedValue({
        schema_version: '1.0.0',
        workflow_id: 'myfeature',
        feature_name: 'myfeature',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        current_stage: 'intent',
        status: 'in_progress',
        artifacts: {
          prd: null,
          spec: null,
          intent: null,
          complete: null,
        },
        validation_results: {
          prd: null,
          spec: null,
          intent: null,
          complete: null,
        },
        resume_context: {},
      });

      const result = await workflowHook.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput).toBeDefined();
      expect(result.hookSpecificOutput?.hookEventName).toBe('UserPromptSubmit');
      expect(result.hookSpecificOutput?.additionalContext).toBeDefined();
      expect(typeof result.hookSpecificOutput?.additionalContext).toBe('string');
    });
  });

  describe('Workflow Resume Flow', () => {
    let workflowHook: any;

    beforeEach(() => {
      registerUserPromptSubmitHooks();
      const hooks = getHooksForEvent('UserPromptSubmit');
      workflowHook = hooks.find(h => h.name === 'structuredWorkflowDetector');
    });

    it('calls listWorkflows to find active workflows', async () => {
      const ctx: HookContext = {
        prompt: '/plan continue',
        directory: '/test/project',
        sessionId: 'test-session',
      };

      vi.mocked(listWorkflows).mockResolvedValue(['workflow1', 'workflow2']);
      vi.mocked(loadCheckpoint).mockResolvedValue({
        schema_version: '1.0.0',
        workflow_id: 'workflow1',
        feature_name: 'workflow1',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        current_stage: 'intent',
        status: 'in_progress',
        artifacts: {
          prd: null,
          spec: null,
          intent: null,
          complete: null,
        },
        validation_results: {
          prd: null,
          spec: null,
          intent: null,
          complete: null,
        },
        resume_context: {},
      });

      await workflowHook.handler(ctx);

      expect(listWorkflows).toHaveBeenCalledWith('/test/project');
    });

    it('loads most recent workflow checkpoint', async () => {
      const ctx: HookContext = {
        prompt: '/plan continue',
        directory: '/test/project',
        sessionId: 'test-session',
      };

      vi.mocked(listWorkflows).mockResolvedValue(['recent-workflow']);
      vi.mocked(loadCheckpoint).mockResolvedValue({
        schema_version: '1.0.0',
        workflow_id: 'recent-workflow',
        feature_name: 'recent-workflow',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        current_stage: 'intent',
        status: 'paused',
        artifacts: {
          prd: null,
          spec: null,
          intent: null,
          complete: null,
        },
        validation_results: {
          prd: null,
          spec: null,
          intent: null,
          complete: null,
        },
        resume_context: {},
      });

      await workflowHook.handler(ctx);

      expect(loadCheckpoint).toHaveBeenCalledWith('/test/project', 'recent-workflow');
    });

    it('calls buildWorkflowResumptionPrompt with checkpoint', async () => {
      const ctx: HookContext = {
        prompt: '/plan continue',
        directory: '/test/project',
        sessionId: 'test-session',
      };

      const mockCheckpoint: WorkflowCheckpoint = {
        schema_version: '1.0.0',
        workflow_id: 'test-workflow',
        feature_name: 'Test Feature',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        current_stage: 'intent',
        status: 'paused',
        artifacts: {
          prd: null,
          spec: null,
          intent: null,
          complete: null,
        },
        validation_results: {
          prd: null,
          spec: null,
          intent: null,
          complete: null,
        },
        resume_context: {},
      };

      vi.mocked(listWorkflows).mockResolvedValue(['test-workflow']);
      vi.mocked(loadCheckpoint).mockResolvedValue(mockCheckpoint);

      await workflowHook.handler(ctx);

      expect(buildWorkflowResumptionPrompt).toHaveBeenCalledWith('Test Feature', mockCheckpoint);
    });

    it('returns additionalContext with resume prompt', async () => {
      const ctx: HookContext = {
        prompt: '/plan continue',
        directory: '/test/project',
        sessionId: 'test-session',
      };

      vi.mocked(listWorkflows).mockResolvedValue(['test-workflow']);
      vi.mocked(loadCheckpoint).mockResolvedValue({
        schema_version: '1.0.0',
        workflow_id: 'test-workflow',
        feature_name: 'Test Feature',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        current_stage: 'intent',
        status: 'paused',
        artifacts: {
          prd: null,
          spec: null,
          intent: null,
          complete: null,
        },
        validation_results: {
          prd: null,
          spec: null,
          intent: null,
          complete: null,
        },
        resume_context: {},
      });

      const result = await workflowHook.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput).toBeDefined();
      expect(result.hookSpecificOutput?.additionalContext).toContain('Resuming workflow');
    });
  });

  describe('Error Handling', () => {
    let workflowHook: any;

    beforeEach(() => {
      registerUserPromptSubmitHooks();
      const hooks = getHooksForEvent('UserPromptSubmit');
      workflowHook = hooks.find(h => h.name === 'structuredWorkflowDetector');
    });

    it('handles missing directory gracefully', async () => {
      const ctx: HookContext = {
        prompt: '/plan myfeature --structured',
        sessionId: 'test-session',
        // no directory
      };

      const result = await workflowHook.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput).toBeUndefined();
      expect(WorkflowEngine).not.toHaveBeenCalled();
    });

    it('handles empty prompt gracefully', async () => {
      const ctx: HookContext = {
        prompt: '',
        directory: '/test/project',
        sessionId: 'test-session',
      };

      const result = await workflowHook.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput).toBeUndefined();
    });

    it('handles no workflows found for /plan continue', async () => {
      const ctx: HookContext = {
        prompt: '/plan continue',
        directory: '/test/project',
        sessionId: 'test-session',
      };

      vi.mocked(listWorkflows).mockResolvedValue([]);

      const result = await workflowHook.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput).toBeDefined();
      expect(result.hookSpecificOutput?.additionalContext).toContain('No active workflows found');
      expect(result.hookSpecificOutput?.additionalContext).toContain('/plan {feature}');
    });

    it('handles workflow directory not existing', async () => {
      const ctx: HookContext = {
        prompt: '/plan continue',
        directory: '/test/project',
        sessionId: 'test-session',
      };

      vi.mocked(listWorkflows).mockResolvedValue([]);

      const result = await workflowHook.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.additionalContext).toContain('No active workflows found');
    });

    it('handles checkpoint load failure gracefully', async () => {
      const ctx: HookContext = {
        prompt: '/plan continue',
        directory: '/test/project',
        sessionId: 'test-session',
      };

      vi.mocked(listWorkflows).mockResolvedValue(['test-workflow']);
      vi.mocked(loadCheckpoint).mockResolvedValue(null);

      const result = await workflowHook.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput).toBeUndefined();
    });

    it('handles WorkflowEngine.start() errors', async () => {
      const ctx: HookContext = {
        prompt: '/plan myfeature --structured',
        directory: '/test/project',
        sessionId: 'test-session',
      };

      // Override the mock to throw an error
      vi.mocked(WorkflowEngine).mockImplementationOnce(function(this: any) {
        this.start = vi.fn().mockRejectedValue(new Error('Start failed'));
      } as any);

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await workflowHook.handler(ctx);

      expect(result.continue).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith('[Structured Workflow]', expect.any(Error));

      consoleSpy.mockRestore();
    });

    it('handles listWorkflows errors', async () => {
      const ctx: HookContext = {
        prompt: '/plan continue',
        directory: '/test/project',
        sessionId: 'test-session',
      };

      vi.mocked(listWorkflows).mockRejectedValue(new Error('List failed'));

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await workflowHook.handler(ctx);

      expect(result.continue).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith('[Workflow Resume]', expect.any(Error));

      consoleSpy.mockRestore();
    });

    it('handles null checkpoint after workflow start', async () => {
      const ctx: HookContext = {
        prompt: '/plan myfeature --structured',
        directory: '/test/project',
        sessionId: 'test-session',
      };

      vi.mocked(loadCheckpoint).mockResolvedValue(null);

      const result = await workflowHook.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput).toBeUndefined();
    });

    it('rejects feature name longer than 120 chars without creating workflow', async () => {
      const longName = 'a'.repeat(121);
      const ctx: HookContext = {
        prompt: `/plan ${longName}`,
        directory: '/test/project',
        sessionId: 'test-session',
      };

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await workflowHook.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput).toBeUndefined();
      expect(WorkflowEngine).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        '[Structured Workflow] Feature name too long, likely not a real feature name:',
        expect.stringContaining('...')
      );

      consoleSpy.mockRestore();
    });

    it('rejects feature name containing sentence pattern "lets proceed"', async () => {
      const ctx: HookContext = {
        prompt: '/plan lets proceed with creating the intent for this feature',
        directory: '/test/project',
        sessionId: 'test-session',
      };

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await workflowHook.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput).toBeUndefined();
      expect(WorkflowEngine).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        '[Structured Workflow] Feature name looks like conversational text, skipping:',
        expect.any(String)
      );

      consoleSpy.mockRestore();
    });

    it('rejects feature name containing sentence pattern "i want to"', async () => {
      const ctx: HookContext = {
        prompt: '/plan i want to build a shopping cart',
        directory: '/test/project',
        sessionId: 'test-session',
      };

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await workflowHook.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput).toBeUndefined();
      expect(WorkflowEngine).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('allows normal feature name "User Authentication"', async () => {
      const ctx: HookContext = {
        prompt: '/plan User Authentication',
        directory: '/test/project',
        sessionId: 'test-session',
      };

      vi.mocked(loadCheckpoint).mockResolvedValue({
        schema_version: '1.0.0',
        workflow_id: 'user-authentication',
        feature_name: 'User Authentication',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        current_stage: 'intent',
        status: 'in_progress',
        artifacts: { prd: null, spec: null, intent: null, complete: null },
        validation_results: { prd: null, spec: null, intent: null, complete: null },
        resume_context: {},
      });

      const result = await workflowHook.handler(ctx);

      expect(result.continue).toBe(true);
      expect(WorkflowEngine).toHaveBeenCalledWith('/test/project', 'User Authentication');
    });

    it('allows normal feature name "shopping-cart-feature"', async () => {
      const ctx: HookContext = {
        prompt: '/plan shopping-cart-feature',
        directory: '/test/project',
        sessionId: 'test-session',
      };

      vi.mocked(loadCheckpoint).mockResolvedValue({
        schema_version: '1.0.0',
        workflow_id: 'shopping-cart-feature',
        feature_name: 'shopping-cart-feature',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        current_stage: 'intent',
        status: 'in_progress',
        artifacts: { prd: null, spec: null, intent: null, complete: null },
        validation_results: { prd: null, spec: null, intent: null, complete: null },
        resume_context: {},
      });

      const result = await workflowHook.handler(ctx);

      expect(result.continue).toBe(true);
      expect(WorkflowEngine).toHaveBeenCalledWith('/test/project', 'shopping-cart-feature');
    });
  });

  describe('Prompt Context Extraction', () => {
    let workflowHook: any;

    beforeEach(() => {
      registerUserPromptSubmitHooks();
      const hooks = getHooksForEvent('UserPromptSubmit');
      workflowHook = hooks.find(h => h.name === 'structuredWorkflowDetector');
    });

    it('extracts prompt from ctx.prompt', async () => {
      const ctx: HookContext = {
        prompt: '/plan myfeature --structured',
        directory: '/test/project',
      };

      vi.mocked(loadCheckpoint).mockResolvedValue({
        schema_version: '1.0.0',
        workflow_id: 'myfeature',
        feature_name: 'myfeature',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        current_stage: 'intent',
        status: 'in_progress',
        artifacts: {
          prd: null,
          spec: null,
          intent: null,
          complete: null,
        },
        validation_results: {
          prd: null,
          spec: null,
          intent: null,
          complete: null,
        },
        resume_context: {},
      });

      const result = await workflowHook.handler(ctx);

      expect(result.continue).toBe(true);
      expect(WorkflowEngine).toHaveBeenCalled();
    });

    it('extracts prompt from ctx.message.content', async () => {
      const ctx: HookContext = {
        message: { content: '/plan myfeature --structured' },
        directory: '/test/project',
      };

      vi.mocked(loadCheckpoint).mockResolvedValue({
        schema_version: '1.0.0',
        workflow_id: 'myfeature',
        feature_name: 'myfeature',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        current_stage: 'intent',
        status: 'in_progress',
        artifacts: {
          prd: null,
          spec: null,
          intent: null,
          complete: null,
        },
        validation_results: {
          prd: null,
          spec: null,
          intent: null,
          complete: null,
        },
        resume_context: {},
      });

      const result = await workflowHook.handler(ctx);

      expect(result.continue).toBe(true);
      expect(WorkflowEngine).toHaveBeenCalled();
    });

    it('extracts prompt from ctx.parts', async () => {
      const ctx: HookContext = {
        parts: [
          { type: 'text', text: '/plan myfeature --structured' },
        ],
        directory: '/test/project',
      };

      vi.mocked(loadCheckpoint).mockResolvedValue({
        schema_version: '1.0.0',
        workflow_id: 'myfeature',
        feature_name: 'myfeature',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        current_stage: 'intent',
        status: 'in_progress',
        artifacts: {
          prd: null,
          spec: null,
          intent: null,
          complete: null,
        },
        validation_results: {
          prd: null,
          spec: null,
          intent: null,
          complete: null,
        },
        resume_context: {},
      });

      const result = await workflowHook.handler(ctx);

      expect(result.continue).toBe(true);
      expect(WorkflowEngine).toHaveBeenCalled();
    });
  });
});
