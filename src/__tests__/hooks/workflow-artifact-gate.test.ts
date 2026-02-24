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
  saveCheckpoint: vi.fn().mockResolvedValue(undefined),
}));

// Mock validation module
vi.mock('../../features/workflow-engine/validation.js', () => ({
  validateIdea: vi.fn().mockResolvedValue({ passed: true, coverage_percentage: 100, blocking_issues: [], timestamp: '2025-01-01' }),
  validateIntent: vi.fn().mockResolvedValue({ passed: true, coverage_percentage: 100, blocking_issues: [], timestamp: '2025-01-01' }),
}));

// Mock depth-assessment module
vi.mock('../../features/workflow-engine/depth-assessment.js', () => ({
  assessDepthFromIntent: vi.fn().mockReturnValue({
    clarity: 2,
    complexity: 3,
    scope: 2,
    risk: 2,
    context: 3,
    preferences: 2,
    total_score: 14,
    recommended_depth: 'standard',
    skip_units: false,
    risk_tier: { tier: 2, rationale: 'Moderate risk', factors: { reversibility: 'moderate', blast_radius: 'isolated', data_sensitivity: 'none', compliance_impact: 'none' }, override_reason: null },
  }),
}));

// Mock manifest module
vi.mock('../../features/workflow-engine/manifest.js', () => ({
  loadManifest: vi.fn().mockReturnValue(null),
  saveManifest: vi.fn(),
}));

// Mock fs
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue('# INTENT\n## Business Requirements\nTest'),
}));

import { registerWorkflowArtifactGateHook } from '../../hooks/registrations/workflow-artifact-gate.js';
import { loadSessionState } from '../../learning/session-state.js';
import { loadCheckpoint, listWorkflows, saveCheckpoint } from '../../features/workflow-engine/checkpoint.js';
import { validateIdea, validateIntent } from '../../features/workflow-engine/validation.js';
import { assessDepthFromIntent } from '../../features/workflow-engine/depth-assessment.js';
import { loadManifest, saveManifest } from '../../features/workflow-engine/manifest.js';
import { existsSync, readFileSync } from 'fs';

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

    it('should return continue:true when agent_used is not an Inception stage agent', async () => {
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
        pending_completion: { agent_used: 'prometheus', task_id: 'task-1' },
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

  describe('Inception Agent Validation', () => {
    beforeEach(() => {
      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(createMockCheckpoint());
      vi.mocked(existsSync).mockReturnValue(true);
    });

    it('should call validateIntent when prometheus agent completes with current_stage=intent', async () => {
      vi.mocked(loadSessionState).mockReturnValue({
        session_id: 'test',
        started_at: '2025-01-01',
        last_updated: '2025-01-01',
        recent_prompts: [],
        pending_completion: { agent_used: 'prometheus', task_id: 'task-1' },
        todo_snapshot: null,
        token_budget: null,
        discovery_volume: { session_count: 0, daily_count: 0, daily_reset_at: '2025-01-01' },
      });
      vi.mocked(loadCheckpoint).mockResolvedValue(createMockCheckpoint({ current_stage: 'intent' }));
      vi.mocked(validateIntent).mockResolvedValue({
        passed: true,
        coverage_percentage: 100,
        blocking_issues: [],
        timestamp: '2025-01-01',
      });

      registerWorkflowArtifactGateHook();
      const hooks = getHooksForEvent('PostToolUse');
      const ctx = createPostToolUseCtx();
      const result = await hooks[0].handler(ctx);

      expect(validateIntent).toHaveBeenCalledWith(join('/test/project', 'aidlc-docs', 'test-feature', 'inception', 'intent.md'));
      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.additionalContext).toContain('PASSED');
    });

    it('should call validateIntent when prometheus agent completes with current_stage=intent', async () => {
      vi.mocked(loadSessionState).mockReturnValue({
        session_id: 'test',
        started_at: '2025-01-01',
        last_updated: '2025-01-01',
        recent_prompts: [],
        pending_completion: { agent_used: 'prometheus', task_id: 'task-1' },
        todo_snapshot: null,
        token_budget: null,
        discovery_volume: { session_count: 0, daily_count: 0, daily_reset_at: '2025-01-01' },
      });
      vi.mocked(loadCheckpoint).mockResolvedValue(createMockCheckpoint({ current_stage: 'intent' }));
      vi.mocked(validateIntent).mockResolvedValue({
        passed: true,
        coverage_percentage: 100,
        blocking_issues: [],
        timestamp: '2025-01-01',
      });

      registerWorkflowArtifactGateHook();
      const hooks = getHooksForEvent('PostToolUse');
      const ctx = createPostToolUseCtx();
      const result = await hooks[0].handler(ctx);

      expect(validateIntent).toHaveBeenCalledWith(
        join('/test/project', 'aidlc-docs', 'test-feature', 'inception', 'intent.md')
      );
      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.additionalContext).toContain('PASSED');
    });

    it('should default to intent validation for prometheus with unknown stage', async () => {
      vi.mocked(loadSessionState).mockReturnValue({
        session_id: 'test',
        started_at: '2025-01-01',
        last_updated: '2025-01-01',
        recent_prompts: [],
        pending_completion: { agent_used: 'prometheus', task_id: 'task-1' },
        todo_snapshot: null,
        token_budget: null,
        discovery_volume: { session_count: 0, daily_count: 0, daily_reset_at: '2025-01-01' },
      });
      vi.mocked(loadCheckpoint).mockResolvedValue(createMockCheckpoint({ current_stage: 'discovery' }));
      vi.mocked(validateIntent).mockResolvedValue({
        passed: true,
        coverage_percentage: 100,
        blocking_issues: [],
        timestamp: '2025-01-01',
      });

      registerWorkflowArtifactGateHook();
      const hooks = getHooksForEvent('PostToolUse');
      const ctx = createPostToolUseCtx();
      const result = await hooks[0].handler(ctx);

      expect(validateIntent).toHaveBeenCalled();
      expect(result.continue).toBe(true);
    });
  });

  describe('Validation Results', () => {
    beforeEach(() => {
      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(createMockCheckpoint({ current_stage: 'intent' }));
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadSessionState).mockReturnValue({
        session_id: 'test',
        started_at: '2025-01-01',
        last_updated: '2025-01-01',
        recent_prompts: [],
        pending_completion: { agent_used: 'prometheus', task_id: 'task-1' },
        todo_snapshot: null,
        token_budget: null,
        discovery_volume: { session_count: 0, daily_count: 0, daily_reset_at: '2025-01-01' },
      });
    });

    it('should inject success message when validation passes', async () => {
      vi.mocked(validateIntent).mockResolvedValue({
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
      vi.mocked(validateIntent).mockResolvedValue({
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
      vi.mocked(validateIntent).mockResolvedValue({
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
      vi.mocked(validateIntent).mockResolvedValue({
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
      vi.mocked(validateIntent).mockResolvedValue({
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
      vi.mocked(loadCheckpoint).mockResolvedValue(createMockCheckpoint({ current_stage: 'intent' }));
      vi.mocked(loadSessionState).mockReturnValue({
        session_id: 'test',
        started_at: '2025-01-01',
        last_updated: '2025-01-01',
        recent_prompts: [],
        pending_completion: { agent_used: 'prometheus', task_id: 'task-1' },
        todo_snapshot: null,
        token_budget: null,
        discovery_volume: { session_count: 0, daily_count: 0, daily_reset_at: '2025-01-01' },
      });
      vi.mocked(validateIntent).mockResolvedValue({
        passed: true,
        coverage_percentage: 100,
        blocking_issues: [],
        timestamp: '2025-01-01',
      });
    });

    it('should check nested layout first (inception/ subdirectory)', async () => {
      vi.mocked(existsSync).mockImplementation((path: any) => {
        const normalizedPath = path.toString().replace(/\\/g, '/');
        return normalizedPath.includes('aidlc-docs/test-feature') || normalizedPath.includes('inception/intent.md');
      });

      registerWorkflowArtifactGateHook();
      const hooks = getHooksForEvent('PostToolUse');
      const ctx = createPostToolUseCtx();
      await hooks[0].handler(ctx);

      expect(validateIntent).toHaveBeenCalledWith(join('/test/project', 'aidlc-docs', 'test-feature', 'inception', 'intent.md'));
    });

    it('should fall back to flat layout when nested not found', async () => {
      vi.mocked(existsSync).mockImplementation((path: any) => {
        const normalizedPath = path.toString().replace(/\\/g, '/');
        if (normalizedPath.includes('aidlc-docs/test-feature') && !normalizedPath.includes('intent.md')) {
          return true;
        }
        if (normalizedPath.includes('inception/intent.md')) {
          return false;
        }
        return normalizedPath.endsWith('intent.md');
      });

      registerWorkflowArtifactGateHook();
      const hooks = getHooksForEvent('PostToolUse');
      const ctx = createPostToolUseCtx();
      await hooks[0].handler(ctx);

      expect(validateIntent).toHaveBeenCalledWith(join('/test/project', 'aidlc-docs', 'test-feature', 'intent.md'));
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
        pending_completion: { agent_used: 'prometheus', task_id: 'task-1' },
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
      vi.mocked(loadCheckpoint).mockResolvedValue(createMockCheckpoint({ current_stage: 'intent' }));
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(validateIntent).mockRejectedValue(new Error('Validation error'));

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

  describe('Depth Assessment after INTENT validation', () => {
    beforeEach(() => {
      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(createMockCheckpoint({ current_stage: 'intent' }));
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadSessionState).mockReturnValue({
        session_id: 'test',
        started_at: '2025-01-01',
        last_updated: '2025-01-01',
        recent_prompts: [],
        pending_completion: { agent_used: 'prometheus', task_id: 'task-1' },
        todo_snapshot: null,
        token_budget: null,
        discovery_volume: { session_count: 0, daily_count: 0, daily_reset_at: '2025-01-01' },
      });
      vi.mocked(readFileSync).mockReturnValue('# INTENT\n## Business Requirements\nTest requirement');
    });

    it('should run depth assessment after INTENT validation passes', async () => {
      vi.mocked(validateIntent).mockResolvedValue({
        passed: true,
        coverage_percentage: 100,
        blocking_issues: [],
        timestamp: '2025-01-01',
      });
      vi.mocked(loadManifest).mockReturnValue({
        schema_version: '2.0.0',
        workflow_id: 'test-feature',
        feature_name: 'Test',
        created_at: '2025-01-01',
        updated_at: '2025-01-01',
        phases: {
          discovery: { status: 'complete', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
          inception: { status: 'in_progress', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
          construction: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
          operations: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
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

      registerWorkflowArtifactGateHook();
      const hooks = getHooksForEvent('PostToolUse');
      const ctx = createPostToolUseCtx();
      const result = await hooks[0].handler(ctx);

      expect(assessDepthFromIntent).toHaveBeenCalled();
      expect(result.hookSpecificOutput?.additionalContext).toContain('[Depth Assessment]');
      expect(result.hookSpecificOutput?.additionalContext).toContain('Score: 14/30');
      expect(result.hookSpecificOutput?.additionalContext).toContain('MEDIUM');
    });

    it('should store depth score in manifest and checkpoint', async () => {
      vi.mocked(validateIntent).mockResolvedValue({
        passed: true,
        coverage_percentage: 100,
        blocking_issues: [],
        timestamp: '2025-01-01',
      });
      const manifest = {
        schema_version: '2.0.0' as const,
        workflow_id: 'test-feature',
        feature_name: 'Test',
        created_at: '2025-01-01',
        updated_at: '2025-01-01',
        phases: {
          discovery: { status: 'complete' as const, started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
          inception: { status: 'in_progress' as const, started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
          construction: { status: 'not_started' as const, started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
          operations: { status: 'not_started' as const, started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
        },
        depth_assessment: null as any,
        artifacts: [] as any[],
        links: [] as any[],
        risks: [] as any[],
        gate_audit: [] as any[],
        metrics: null,
        alignment_checks: [] as any[],
        risk_tier: null as any,
      };
      vi.mocked(loadManifest).mockReturnValue(manifest);

      registerWorkflowArtifactGateHook();
      const hooks = getHooksForEvent('PostToolUse');
      const ctx = createPostToolUseCtx();
      await hooks[0].handler(ctx);

      // Manifest should have depth_assessment and risk_tier set
      expect(saveManifest).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          depth_assessment: expect.objectContaining({ total_score: 14 }),
          risk_tier: expect.objectContaining({ tier: 2 }),
        })
      );

      // Checkpoint should have depth_score and risk_tier set
      expect(saveCheckpoint).toHaveBeenCalledWith(
        '/test/project',
        expect.objectContaining({
          depth_score: 14,
          risk_tier: 2,
        })
      );
    });

    it('should NOT run depth assessment if INTENT validation fails', async () => {
      vi.mocked(validateIntent).mockResolvedValue({
        passed: false,
        coverage_percentage: 40,
        blocking_issues: ['Missing business requirements'],
        timestamp: '2025-01-01',
      });

      registerWorkflowArtifactGateHook();
      const hooks = getHooksForEvent('PostToolUse');
      const ctx = createPostToolUseCtx();
      const result = await hooks[0].handler(ctx);

      expect(assessDepthFromIntent).not.toHaveBeenCalled();
      expect(result.hookSpecificOutput?.additionalContext).not.toContain('[Depth Assessment]');
    });

    it('should run depth assessment for intent validation when it passes', async () => {
      vi.mocked(loadCheckpoint).mockResolvedValue(createMockCheckpoint({ current_stage: 'intent' }));
      vi.mocked(validateIntent).mockResolvedValue({
        passed: true,
        coverage_percentage: 100,
        blocking_issues: [],
        timestamp: '2025-01-01',
      });
      vi.mocked(loadManifest).mockReturnValue({
        schema_version: '2.0.0',
        workflow_id: 'test-feature',
        feature_name: 'Test',
        created_at: '2025-01-01',
        updated_at: '2025-01-01',
        phases: {
          discovery: { status: 'complete' as const, started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
          inception: { status: 'in_progress' as const, started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
          construction: { status: 'not_started' as const, started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
          operations: { status: 'not_started' as const, started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
        },
        depth_assessment: null as any,
        artifacts: [] as any[],
        links: [] as any[],
        risks: [] as any[],
        gate_audit: [] as any[],
        metrics: null,
        alignment_checks: [] as any[],
        risk_tier: null as any,
      });

      registerWorkflowArtifactGateHook();
      const hooks = getHooksForEvent('PostToolUse');
      const ctx = createPostToolUseCtx();
      await hooks[0].handler(ctx);

      expect(assessDepthFromIntent).toHaveBeenCalled();
    });

    it('should fail open if depth assessment throws', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(validateIntent).mockResolvedValue({
        passed: true,
        coverage_percentage: 100,
        blocking_issues: [],
        timestamp: '2025-01-01',
      });
      vi.mocked(readFileSync).mockImplementation(() => { throw new Error('File read error'); });

      registerWorkflowArtifactGateHook();
      const hooks = getHooksForEvent('PostToolUse');
      const ctx = createPostToolUseCtx();
      const result = await hooks[0].handler(ctx);

      // Should still return the validation message, just without depth info
      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.additionalContext).toContain('PASSED');
      expect(result.hookSpecificOutput?.additionalContext).not.toContain('[Depth Assessment]');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Olympus Artifact Gate] Failed to assess depth'),
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });
  });
});

// Helpers
function createMockCheckpoint(overrides: Record<string, any> = {}) {
  return {
    schema_version: '3.0.0',
    workflow_id: 'test-feature',
    feature_name: 'Test Feature',
    current_phase: 'inception',
    current_stage: 'intent',
    status: 'in_progress',
    phases: {
      discovery: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
      inception: { status: 'in_progress', started_at: '2025-01-01T00:00:00.000Z', completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
      construction: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
      operations: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
    },
    manifest_path: 'aidlc-docs/test-feature/manifest.json',
    trust_state_path: 'aidlc-docs/test-feature/trust-state.json',
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function createPostToolUseCtx(overrides: Record<string, any> = {}): HookContext {
  return {
    sessionId: 'test-session',
    directory: '/test/project',
    toolName: 'Task',
    toolInput: { subagent_type: 'prometheus', prompt: 'test' },
    toolOutput: 'Task completed successfully',
    ...overrides,
  };
}
