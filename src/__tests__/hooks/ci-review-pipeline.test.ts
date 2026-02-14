import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { clearHooks, getHooksForEvent } from '../../hooks/registry.js';
import type { HookContext, HookResult } from '../../hooks/types.js';

// Mock fs-extra
vi.mock('fs-extra', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(false),
    readJsonSync: vi.fn().mockReturnValue(null),
    writeJsonSync: vi.fn(),
    ensureDirSync: vi.fn(),
  },
  existsSync: vi.fn().mockReturnValue(false),
  readJsonSync: vi.fn().mockReturnValue(null),
  writeJsonSync: vi.fn(),
  ensureDirSync: vi.fn(),
}));

// Mock fs (readFileSync for artifact content)
vi.mock('fs', () => ({
  readFileSync: vi.fn().mockReturnValue(''),
}));

// Mock child_process
vi.mock('child_process', () => ({
  execSync: vi.fn().mockReturnValue(''),
}));

// Mock checkpoint module
vi.mock('../../features/workflow-engine/checkpoint.js', () => ({
  loadCheckpoint: vi.fn().mockResolvedValue(null),
  listWorkflows: vi.fn().mockResolvedValue([]),
  saveCheckpoint: vi.fn().mockResolvedValue(undefined),
}));

// Mock manifest module
vi.mock('../../features/workflow-engine/manifest.js', () => ({
  loadManifest: vi.fn().mockReturnValue(null),
  saveManifest: vi.fn(),
}));

import { registerCIReviewPipelineHook } from '../../hooks/registrations/ci-review-pipeline.js';
import { loadCheckpoint, listWorkflows } from '../../features/workflow-engine/checkpoint.js';
import { loadManifest } from '../../features/workflow-engine/manifest.js';
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import * as fsExtra from 'fs-extra';

// Helper functions
function createMockCheckpoint(overrides: Record<string, any> = {}) {
  return {
    schema_version: '2.0.0',
    workflow_id: 'test-feature',
    feature_name: 'Test Feature',
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
    current_phase: 'construction',
    phases: {
      discovery: { status: 'complete', started_at: '2025-01-01T00:00:00.000Z', completed_at: '2025-01-01T00:10:00.000Z', gate_result: null, gate_bypassed: false, bypass_reason: null },
      inception: { status: 'complete', started_at: '2025-01-01T00:10:00.000Z', completed_at: '2025-01-01T00:20:00.000Z', gate_result: null, gate_bypassed: false, bypass_reason: null },
      construction: { status: 'in_progress', started_at: '2025-01-01T00:20:00.000Z', completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
      operations: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
    },
    current_stage: 'bolt',
    status: 'in_progress',
    active_bolt_id: 'BOLT-001',
    artifacts: { idea: null, prd: null, spec: null, intent: null, complete: null },
    validation_results: { idea: null, prd: null, spec: null, intent: null, complete: null },
    manifest_path: '/test/project/aidlc-docs/test-feature/manifest.json',
    trust_state_path: null,
    risk_tier: null,
    ...overrides,
  };
}

function createMockManifest(overrides: Record<string, any> = {}) {
  return {
    schema_version: '2.0.0',
    workflow_id: 'test-feature',
    feature_name: 'Test Feature',
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
    phases: {
      discovery: { status: 'complete', started_at: '2025-01-01T00:00:00.000Z', completed_at: '2025-01-01T00:10:00.000Z', gate_result: null, gate_bypassed: false, bypass_reason: null },
      inception: { status: 'complete', started_at: '2025-01-01T00:10:00.000Z', completed_at: '2025-01-01T00:20:00.000Z', gate_result: null, gate_bypassed: false, bypass_reason: null },
      construction: { status: 'in_progress', started_at: '2025-01-01T00:20:00.000Z', completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
      operations: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
    },
    depth_assessment: null,
    artifacts: [
      {
        id: 'BOLT-001',
        type: 'bolt',
        path: '/test/project/aidlc-docs/test-feature/construction/UNIT-001/BOLT-001.md',
        created_at: '2025-01-01T00:30:00.000Z',
        updated_at: '2025-01-01T00:30:00.000Z',
        status: 'active',
      },
    ],
    gates: [],
    contracts: [],
    ...overrides,
  };
}

function createPostToolUseCtx(toolName: string, overrides: Partial<HookContext> = {}): HookContext {
  return {
    event: 'PostToolUse',
    toolName,
    toolArgs: {},
    toolResult: {},
    directory: '/test/project',
    sessionId: 'test-session',
    ...overrides,
  };
}

describe('CI Review Pipeline Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearHooks();
  });

  afterEach(() => {
    clearHooks();
  });

  describe('registration', () => {
    it('should register hook at priority 79', () => {
      registerCIReviewPipelineHook();

      const hooks = getHooksForEvent('PostToolUse');
      const ciHook = hooks.find(h => h.name === 'ciReviewPipeline');

      expect(ciHook).toBeDefined();
      expect(ciHook?.priority).toBe(79);
      expect(ciHook?.event).toBe('PostToolUse');
      expect(ciHook?.matcher).toBe('task');
    });
  });

  describe('early returns', () => {
    it('should skip non-Task tools', async () => {
      registerCIReviewPipelineHook();
      const hooks = getHooksForEvent('PostToolUse');
      const ciHook = hooks.find(h => h.name === 'ciReviewPipeline');

      const ctx = createPostToolUseCtx('Read');
      const result = await ciHook!.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput).toBeUndefined();
    });

    it('should skip when no directory', async () => {
      registerCIReviewPipelineHook();
      const hooks = getHooksForEvent('PostToolUse');
      const ciHook = hooks.find(h => h.name === 'ciReviewPipeline');

      const ctx = createPostToolUseCtx('Task', { directory: undefined });
      const result = await ciHook!.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput).toBeUndefined();
    });

    it('should skip when no active workflow', async () => {
      registerCIReviewPipelineHook();
      const hooks = getHooksForEvent('PostToolUse');
      const ciHook = hooks.find(h => h.name === 'ciReviewPipeline');

      vi.mocked(listWorkflows).mockResolvedValue([]);

      const ctx = createPostToolUseCtx('Task');
      const result = await ciHook!.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput).toBeUndefined();
    });

    it('should skip when not in construction phase', async () => {
      registerCIReviewPipelineHook();
      const hooks = getHooksForEvent('PostToolUse');
      const ciHook = hooks.find(h => h.name === 'ciReviewPipeline');

      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(
        createMockCheckpoint({ current_phase: 'inception', current_stage: 'prd', active_bolt_id: null })
      );

      const ctx = createPostToolUseCtx('Task');
      const result = await ciHook!.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput).toBeUndefined();
    });

    it('should skip when not in bolt stage', async () => {
      registerCIReviewPipelineHook();
      const hooks = getHooksForEvent('PostToolUse');
      const ciHook = hooks.find(h => h.name === 'ciReviewPipeline');

      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(
        createMockCheckpoint({ current_phase: 'construction', current_stage: 'unit', active_bolt_id: null })
      );

      const ctx = createPostToolUseCtx('Task');
      const result = await ciHook!.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput).toBeUndefined();
    });

    it('should skip when no active_bolt_id', async () => {
      registerCIReviewPipelineHook();
      const hooks = getHooksForEvent('PostToolUse');
      const ciHook = hooks.find(h => h.name === 'ciReviewPipeline');

      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(
        createMockCheckpoint({ current_phase: 'construction', current_stage: 'bolt', active_bolt_id: null })
      );

      const ctx = createPostToolUseCtx('Task');
      const result = await ciHook!.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput).toBeUndefined();
    });
  });

  describe('CI check execution', () => {
    it('should fire for construction + bolt + active_bolt_id', async () => {
      registerCIReviewPipelineHook();
      const hooks = getHooksForEvent('PostToolUse');
      const ciHook = hooks.find(h => h.name === 'ciReviewPipeline');

      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(createMockCheckpoint());
      vi.mocked(loadManifest).mockReturnValue(createMockManifest());
      vi.mocked(fsExtra.existsSync).mockReturnValue(false);
      vi.mocked(execSync).mockReturnValue('ok' as any);
      vi.mocked(readFileSync).mockReturnValue('clean code');

      const ctx = createPostToolUseCtx('Task');
      const result = await ciHook!.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput).toBeDefined();
      expect(result.hookSpecificOutput?.additionalContext).toContain('[CI Review Pipeline - PASSED]');
    });

    it('should run CI checks and inject results', async () => {
      registerCIReviewPipelineHook();
      const hooks = getHooksForEvent('PostToolUse');
      const ciHook = hooks.find(h => h.name === 'ciReviewPipeline');

      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(createMockCheckpoint());
      vi.mocked(loadManifest).mockReturnValue(createMockManifest());
      vi.mocked(fsExtra.existsSync).mockReturnValue(false);
      vi.mocked(execSync).mockReturnValue('all good' as any);
      vi.mocked(readFileSync).mockReturnValue('clean code');

      const ctx = createPostToolUseCtx('Task');
      const result = await ciHook!.handler(ctx);

      expect(result.hookSpecificOutput?.additionalContext).toContain('CI Review Pipeline');
      expect(result.hookSpecificOutput?.additionalContext).toContain('Total duration:');
    });
  });

  describe('failure blocking', () => {
    it('should inject blocking message when CI checks fail', async () => {
      registerCIReviewPipelineHook();
      const hooks = getHooksForEvent('PostToolUse');
      const ciHook = hooks.find(h => h.name === 'ciReviewPipeline');

      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(createMockCheckpoint());
      vi.mocked(loadManifest).mockReturnValue(createMockManifest());
      vi.mocked(fsExtra.existsSync).mockReturnValue(true);
      vi.mocked(fsExtra.readJsonSync).mockReturnValue({ scripts: { lint: 'eslint .' } });

      const error: any = new Error('Lint failed');
      error.status = 1;
      error.stdout = '';
      error.stderr = 'Lint errors found';
      vi.mocked(execSync).mockImplementation(() => {
        throw error;
      });
      vi.mocked(readFileSync).mockReturnValue('clean code');

      const ctx = createPostToolUseCtx('Task');
      const result = await ciHook!.handler(ctx);

      expect(result.hookSpecificOutput?.additionalContext).toContain('[CI Review Pipeline - BLOCKING]');
      expect(result.hookSpecificOutput?.additionalContext).toContain('CI checks failed for BOLT BOLT-001');
      expect(result.hookSpecificOutput?.additionalContext).toContain('Gate 4 review blocked');
      expect(result.hookSpecificOutput?.additionalContext).toContain('Fix the failing checks');
    });

    it('should include failure details in blocking message', async () => {
      registerCIReviewPipelineHook();
      const hooks = getHooksForEvent('PostToolUse');
      const ciHook = hooks.find(h => h.name === 'ciReviewPipeline');

      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(createMockCheckpoint());
      vi.mocked(loadManifest).mockReturnValue(createMockManifest());
      vi.mocked(fsExtra.existsSync).mockReturnValue(true);
      vi.mocked(fsExtra.readJsonSync).mockReturnValue({ scripts: { lint: 'eslint .' } });

      const error: any = new Error('Lint failed');
      error.status = 1;
      error.stdout = '';
      error.stderr = 'error: Unexpected token';
      vi.mocked(execSync).mockImplementation(() => {
        throw error;
      });
      vi.mocked(readFileSync).mockReturnValue('clean code');

      const ctx = createPostToolUseCtx('Task');
      const result = await ciHook!.handler(ctx);

      expect(result.hookSpecificOutput?.additionalContext).toContain('FAILED');
      expect(result.hookSpecificOutput?.additionalContext).toContain('[FAIL]');
    });
  });

  describe('success passthrough', () => {
    it('should inject informational message when all checks pass', async () => {
      registerCIReviewPipelineHook();
      const hooks = getHooksForEvent('PostToolUse');
      const ciHook = hooks.find(h => h.name === 'ciReviewPipeline');

      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(createMockCheckpoint());
      vi.mocked(loadManifest).mockReturnValue(createMockManifest());
      vi.mocked(fsExtra.existsSync).mockReturnValue(false);
      vi.mocked(execSync).mockReturnValue('success' as any);
      vi.mocked(readFileSync).mockReturnValue('clean code');

      const ctx = createPostToolUseCtx('Task');
      const result = await ciHook!.handler(ctx);

      expect(result.hookSpecificOutput?.additionalContext).toContain('[CI Review Pipeline - PASSED]');
      expect(result.hookSpecificOutput?.additionalContext).toContain('ALL CHECKS PASSED');
    });

    it('should include check details in pass message', async () => {
      registerCIReviewPipelineHook();
      const hooks = getHooksForEvent('PostToolUse');
      const ciHook = hooks.find(h => h.name === 'ciReviewPipeline');

      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(createMockCheckpoint());
      vi.mocked(loadManifest).mockReturnValue(createMockManifest());
      vi.mocked(fsExtra.existsSync).mockReturnValue(true);
      vi.mocked(fsExtra.readJsonSync).mockReturnValue({ scripts: { lint: 'eslint .' } });
      vi.mocked(execSync).mockReturnValue('ok' as any);
      vi.mocked(readFileSync).mockReturnValue('clean code');

      const ctx = createPostToolUseCtx('Task');
      const result = await ciHook!.handler(ctx);

      expect(result.hookSpecificOutput?.additionalContext).toContain('[PASS]');
    });
  });

  describe('security scanning', () => {
    it('should detect secrets and mark as failed', async () => {
      registerCIReviewPipelineHook();
      const hooks = getHooksForEvent('PostToolUse');
      const ciHook = hooks.find(h => h.name === 'ciReviewPipeline');

      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(createMockCheckpoint());
      vi.mocked(loadManifest).mockReturnValue(createMockManifest());
      vi.mocked(fsExtra.existsSync).mockReturnValue(false);
      vi.mocked(execSync).mockReturnValue('ok' as any);
      vi.mocked(readFileSync).mockReturnValue('const key = "AKIAIOSFODNN7EXAMPLE";');

      const ctx = createPostToolUseCtx('Task');
      const result = await ciHook!.handler(ctx);

      expect(result.hookSpecificOutput?.additionalContext).toContain('[CI Review Pipeline - BLOCKING]');
      expect(result.hookSpecificOutput?.additionalContext).toContain('SECURITY FINDINGS');
      expect(result.hookSpecificOutput?.additionalContext).toContain('AWS Access Key');
    });

    it('should detect risky patterns', async () => {
      registerCIReviewPipelineHook();
      const hooks = getHooksForEvent('PostToolUse');
      const ciHook = hooks.find(h => h.name === 'ciReviewPipeline');

      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(createMockCheckpoint());
      vi.mocked(loadManifest).mockReturnValue(createMockManifest());
      vi.mocked(fsExtra.existsSync).mockReturnValue(false);
      vi.mocked(execSync).mockReturnValue('ok' as any);
      vi.mocked(readFileSync).mockReturnValue('eval(userInput);');

      const ctx = createPostToolUseCtx('Task');
      const result = await ciHook!.handler(ctx);

      expect(result.hookSpecificOutput?.additionalContext).toContain('RISKY PATTERNS');
      expect(result.hookSpecificOutput?.additionalContext).toContain('eval() usage');
    });

    it('should handle missing BOLT artifact gracefully', async () => {
      registerCIReviewPipelineHook();
      const hooks = getHooksForEvent('PostToolUse');
      const ciHook = hooks.find(h => h.name === 'ciReviewPipeline');

      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(createMockCheckpoint());
      vi.mocked(loadManifest).mockReturnValue(createMockManifest({ artifacts: [] }));
      vi.mocked(fsExtra.existsSync).mockReturnValue(false);
      vi.mocked(execSync).mockReturnValue('ok' as any);

      const ctx = createPostToolUseCtx('Task');
      const result = await ciHook!.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.additionalContext).toContain('[CI Review Pipeline - PASSED]');
    });

    it('should fail open when artifact file cannot be read', async () => {
      registerCIReviewPipelineHook();
      const hooks = getHooksForEvent('PostToolUse');
      const ciHook = hooks.find(h => h.name === 'ciReviewPipeline');

      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(createMockCheckpoint());
      vi.mocked(loadManifest).mockReturnValue(createMockManifest());
      vi.mocked(fsExtra.existsSync).mockReturnValue(false);
      vi.mocked(execSync).mockReturnValue('ok' as any);
      vi.mocked(readFileSync).mockImplementation(() => {
        throw new Error('File not found');
      });

      const ctx = createPostToolUseCtx('Task');
      const result = await ciHook!.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.additionalContext).toContain('[CI Review Pipeline - PASSED]');
    });
  });

  describe('config loading', () => {
    it('should use config from .olympus/config.json', async () => {
      registerCIReviewPipelineHook();
      const hooks = getHooksForEvent('PostToolUse');
      const ciHook = hooks.find(h => h.name === 'ciReviewPipeline');

      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(createMockCheckpoint());
      vi.mocked(loadManifest).mockReturnValue(createMockManifest());
      vi.mocked(fsExtra.existsSync).mockReturnValue(true);
      vi.mocked(fsExtra.readJsonSync).mockReturnValue({
        ciChecks: {
          staticQuality: {
            enabled: true,
            commands: ['npm run custom-check'],
          },
          security: { enabled: false },
          complexity: { enabled: false },
        },
      });
      vi.mocked(execSync).mockReturnValue('ok' as any);
      vi.mocked(readFileSync).mockReturnValue('clean code');

      const ctx = createPostToolUseCtx('Task');
      const result = await ciHook!.handler(ctx);

      expect(execSync).toHaveBeenCalledWith(
        'npm run custom-check',
        expect.any(Object)
      );
    });

    it('should use defaults when no config exists', async () => {
      registerCIReviewPipelineHook();
      const hooks = getHooksForEvent('PostToolUse');
      const ciHook = hooks.find(h => h.name === 'ciReviewPipeline');

      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(createMockCheckpoint());
      vi.mocked(loadManifest).mockReturnValue(createMockManifest());
      vi.mocked(fsExtra.existsSync).mockReturnValue(false);
      vi.mocked(execSync).mockReturnValue('ok' as any);
      vi.mocked(readFileSync).mockReturnValue('clean code');

      const ctx = createPostToolUseCtx('Task');
      const result = await ciHook!.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput).toBeDefined();
    });
  });

  describe('fail-open error handling', () => {
    it('should not block when errors occur', async () => {
      registerCIReviewPipelineHook();
      const hooks = getHooksForEvent('PostToolUse');
      const ciHook = hooks.find(h => h.name === 'ciReviewPipeline');

      vi.mocked(listWorkflows).mockRejectedValue(new Error('Workflow error'));

      const ctx = createPostToolUseCtx('Task');
      const result = await ciHook!.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput).toBeUndefined();
    });

    it('should continue on loadCheckpoint error', async () => {
      registerCIReviewPipelineHook();
      const hooks = getHooksForEvent('PostToolUse');
      const ciHook = hooks.find(h => h.name === 'ciReviewPipeline');

      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockRejectedValue(new Error('Checkpoint error'));

      const ctx = createPostToolUseCtx('Task');
      const result = await ciHook!.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput).toBeUndefined();
    });
  });
});
