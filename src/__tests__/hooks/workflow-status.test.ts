/**
 * Unit Tests for Workflow Status Hook
 *
 * Tests the workflowStatusReporter hook that detects /workflow-status invocations
 * and programmatically generates status reports via the status-reporter.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { registerWorkflowStatusHook } from '../../hooks/registrations/workflow-status.js';
import { getHooksForEvent, clearHooks } from '../../hooks/registry.js';
import type { HookContext, HookResult } from '../../hooks/types.js';
import type { ManifestSchema, TrustState } from '../../features/workflow-engine/phase-types.js';

// Mock the workflow engine modules
vi.mock('../../features/workflow-engine/manifest.js', () => ({
  loadManifest: vi.fn(),
}));

vi.mock('../../features/workflow-engine/trust.js', () => ({
  loadTrustState: vi.fn(),
}));

vi.mock('../../features/workflow-engine/status-reporter.js', () => ({
  generateWorkflowReport: vi.fn(),
}));

vi.mock('../../features/workflow-engine/checkpoint.js', () => ({
  listWorkflows: vi.fn(),
  loadCheckpoint: vi.fn(),
}));

// Import mocked modules to access mock functions
import { loadManifest } from '../../features/workflow-engine/manifest.js';
import { loadTrustState } from '../../features/workflow-engine/trust.js';
import { generateWorkflowReport } from '../../features/workflow-engine/status-reporter.js';
import { listWorkflows, loadCheckpoint } from '../../features/workflow-engine/checkpoint.js';

describe('Workflow Status Hook', () => {
  beforeEach(() => {
    clearHooks();
    vi.clearAllMocks();
  });

  afterEach(() => {
    clearHooks();
  });

  describe('Hook Registration', () => {
    it('registers hook with name "workflowStatusReporter"', () => {
      registerWorkflowStatusHook();
      const hooks = getHooksForEvent('UserPromptSubmit');
      const hookNames = hooks.map(h => h.name);
      expect(hookNames).toContain('workflowStatusReporter');
    });

    it('registers hook with priority 6', () => {
      registerWorkflowStatusHook();
      const hooks = getHooksForEvent('UserPromptSubmit');
      const statusHook = hooks.find(h => h.name === 'workflowStatusReporter');
      expect(statusHook).toBeDefined();
      expect(statusHook?.priority).toBe(6);
    });

    it('registers hook for UserPromptSubmit event', () => {
      registerWorkflowStatusHook();
      const hooks = getHooksForEvent('UserPromptSubmit');
      const statusHook = hooks.find(h => h.name === 'workflowStatusReporter');
      expect(statusHook).toBeDefined();
      expect(statusHook?.event).toBe('UserPromptSubmit');
    });

    it('hook is enabled by default', () => {
      registerWorkflowStatusHook();
      const hooks = getHooksForEvent('UserPromptSubmit');
      const statusHook = hooks.find(h => h.name === 'workflowStatusReporter');
      expect(statusHook?.enabled).not.toBe(false);
    });
  });

  describe('Detection', () => {
    let statusHook: any;

    beforeEach(() => {
      registerWorkflowStatusHook();
      const hooks = getHooksForEvent('UserPromptSubmit');
      statusHook = hooks.find(h => h.name === 'workflowStatusReporter');
    });

    it('detects /workflow-status invocation and returns report', async () => {
      const mockManifest: ManifestSchema = {
        schema_version: '2.0.0',
        workflow_id: 'test-workflow',
        feature_name: 'Test Feature',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        phases: {
          discovery: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
          inception: { status: 'in_progress', started_at: '2024-01-01T00:00:00Z', completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
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
      };

      const mockTrustState: TrustState = {
        current_level: 0,
        total_transitions: 0,
        rejection_count: 0,
        rejection_rate: 0,
        incident_count: 0,
        last_level_change: null,
        level_history: [],
      };

      const mockReport = {
        summary: '0/4 phases complete | 0 artifacts total',
        phaseProgress: [],
        artifactTree: '',
        riskSummary: 'No risks registered',
        gateSummary: 'No gate transitions recorded',
        trustDisplay: 'Trust Level 0: Baseline',
        alignmentSummary: 'No alignment checks recorded',
        fullReport: '# Workflow Status: Test Feature\nID: test-workflow\n\n0/4 phases complete | 0 artifacts total',
      };

      const mockCheckpoint = { status: 'in_progress', workflow_id: 'test-workflow' };

      vi.mocked(listWorkflows).mockResolvedValue(['test-workflow']);
      vi.mocked(loadCheckpoint).mockResolvedValue(mockCheckpoint as any);
      vi.mocked(loadManifest).mockReturnValue(mockManifest);
      vi.mocked(loadTrustState).mockReturnValue(mockTrustState);
      vi.mocked(generateWorkflowReport).mockReturnValue(mockReport);

      const ctx: HookContext = {
        prompt: '/workflow-status',
        directory: '/test/project',
        sessionId: 'test-session',
      };

      const result = await statusHook.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput).toBeDefined();
      expect(result.hookSpecificOutput?.hookEventName).toBe('UserPromptSubmit');
      expect(result.hookSpecificOutput?.additionalContext).toContain('<workflow-status>');
      expect(result.hookSpecificOutput?.additionalContext).toContain('Test Feature');
      expect(loadManifest).toHaveBeenCalled();
      expect(loadTrustState).toHaveBeenCalled();
      expect(generateWorkflowReport).toHaveBeenCalledWith(mockManifest, mockTrustState);
    });

    it('detects skill template expansion markers', async () => {
      const mockManifest: ManifestSchema = {
        schema_version: '2.0.0',
        workflow_id: 'test-workflow',
        feature_name: 'Test Feature',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        phases: {
          discovery: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
          inception: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
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
      };

      const mockReport = {
        summary: '0/4 phases complete | 0 artifacts total',
        phaseProgress: [],
        artifactTree: '',
        riskSummary: 'No risks registered',
        gateSummary: 'No gate transitions recorded',
        trustDisplay: 'Trust Level 0: Baseline',
        alignmentSummary: 'No alignment checks recorded',
        fullReport: '# Workflow Status: Test Feature',
      };

      const mockCheckpoint = { status: 'in_progress', workflow_id: 'test-workflow' };

      vi.mocked(listWorkflows).mockResolvedValue(['test-workflow']);
      vi.mocked(loadCheckpoint).mockResolvedValue(mockCheckpoint as any);
      vi.mocked(loadManifest).mockReturnValue(mockManifest);
      vi.mocked(loadTrustState).mockReturnValue({ current_level: 0, total_transitions: 0, rejection_count: 0, rejection_rate: 0, incident_count: 0, last_level_change: null, level_history: [] });
      vi.mocked(generateWorkflowReport).mockReturnValue(mockReport);

      const ctx: HookContext = {
        parts: [
          { type: 'text', text: 'Show status of all active structured workflows' },
        ],
        directory: '/test/project',
        sessionId: 'test-session',
      };

      const result = await statusHook.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.additionalContext).toContain('<workflow-status>');
    });

    it('returns "no active workflows" message when manifest not found', async () => {
      vi.mocked(listWorkflows).mockResolvedValue([]);

      const ctx: HookContext = {
        prompt: '/workflow-status',
        directory: '/test/project',
        sessionId: 'test-session',
      };

      const result = await statusHook.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput).toBeDefined();
      expect(result.hookSpecificOutput?.additionalContext).toContain('No active workflows found');
      expect(result.hookSpecificOutput?.additionalContext).toContain('/plan <description>');
      expect(generateWorkflowReport).not.toHaveBeenCalled();
    });

    it('ignores non-workflow-status prompts', async () => {
      const ctx: HookContext = {
        prompt: '/plan my-feature',
        directory: '/test/project',
        sessionId: 'test-session',
      };

      const result = await statusHook.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput).toBeUndefined();
      expect(loadManifest).not.toHaveBeenCalled();
      expect(generateWorkflowReport).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    let statusHook: any;

    beforeEach(() => {
      registerWorkflowStatusHook();
      const hooks = getHooksForEvent('UserPromptSubmit');
      statusHook = hooks.find(h => h.name === 'workflowStatusReporter');
    });

    it('handles errors gracefully and returns continue: true', async () => {
      vi.mocked(listWorkflows).mockRejectedValue(new Error('File system error'));

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const ctx: HookContext = {
        prompt: '/workflow-status',
        directory: '/test/project',
        sessionId: 'test-session',
      };

      const result = await statusHook.handler(ctx);

      expect(result.continue).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith('[Olympus Workflow Status] Error generating report:', expect.any(Error));

      consoleSpy.mockRestore();
    });

    it('handles missing directory gracefully', async () => {
      vi.mocked(listWorkflows).mockResolvedValue([]);

      const ctx: HookContext = {
        prompt: '/workflow-status',
        sessionId: 'test-session',
        // no directory
      };

      // Should use process.cwd() as fallback
      const result = await statusHook.handler(ctx);

      expect(result.continue).toBe(true);
    });

    it('handles empty prompt gracefully', async () => {
      const ctx: HookContext = {
        prompt: '',
        directory: '/test/project',
        sessionId: 'test-session',
      };

      const result = await statusHook.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput).toBeUndefined();
    });

    it('handles generateWorkflowReport errors gracefully', async () => {
      const mockManifest: ManifestSchema = {
        schema_version: '2.0.0',
        workflow_id: 'test-workflow',
        feature_name: 'Test Feature',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        phases: {
          discovery: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
          inception: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
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
      };

      const mockCheckpoint = { status: 'in_progress', workflow_id: 'test-workflow' };

      vi.mocked(listWorkflows).mockResolvedValue(['test-workflow']);
      vi.mocked(loadCheckpoint).mockResolvedValue(mockCheckpoint as any);
      vi.mocked(loadManifest).mockReturnValue(mockManifest);
      vi.mocked(loadTrustState).mockReturnValue({ current_level: 0, total_transitions: 0, rejection_count: 0, rejection_rate: 0, incident_count: 0, last_level_change: null, level_history: [] });
      vi.mocked(generateWorkflowReport).mockImplementation(() => {
        throw new Error('Report generation failed');
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const ctx: HookContext = {
        prompt: '/workflow-status',
        directory: '/test/project',
        sessionId: 'test-session',
      };

      const result = await statusHook.handler(ctx);

      expect(result.continue).toBe(true);
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('Context Extraction', () => {
    let statusHook: any;

    beforeEach(() => {
      registerWorkflowStatusHook();
      const hooks = getHooksForEvent('UserPromptSubmit');
      statusHook = hooks.find(h => h.name === 'workflowStatusReporter');
    });

    it('extracts prompt from ctx.prompt', async () => {
      vi.mocked(loadManifest).mockReturnValue(null);
      vi.mocked(listWorkflows).mockResolvedValue([]);

      const ctx: HookContext = {
        prompt: '/workflow-status',
        directory: '/test/project',
      };

      const result = await statusHook.handler(ctx);

      expect(result.continue).toBe(true);
      expect(loadManifest).not.toHaveBeenCalled(); // loadManifest not called when no workflows exist
    });

    it('extracts prompt from ctx.parts', async () => {
      vi.mocked(loadManifest).mockReturnValue(null);
      vi.mocked(listWorkflows).mockResolvedValue([]);

      const ctx: HookContext = {
        parts: [
          { type: 'text', text: '/workflow-status' },
        ],
        directory: '/test/project',
      };

      const result = await statusHook.handler(ctx);

      expect(result.continue).toBe(true);
      expect(loadManifest).not.toHaveBeenCalled(); // loadManifest not called when no workflows exist
    });

    it('handles empty parts array', async () => {
      const ctx: HookContext = {
        parts: [],
        directory: '/test/project',
      };

      const result = await statusHook.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput).toBeUndefined();
    });
  });
});
