/**
 * Workflow Transition Messages Hook Tests
 *
 * Tests all 5 transition message points:
 * 1. INTENT approved → correct message with depth/risk/trust info
 * 2. INTENT locked → correct message with unit/bolt counts
 * 3. UNITs created → correct message with unit names
 * 4. BOLT completion → correct message with progress (n/total)
 * 5. All BOLTs complete → correct operations message
 * 6. Risk Tier 3 triggers awaiting_dev_review checkpoint state
 * 7. Non-Write/Task tools are ignored
 * 8. Missing manifest returns continue:true
 * 9. Error handling is silent
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { clearHooks } from '../../hooks/registry.js';
import { registerWorkflowTransitionHooks } from '../../hooks/registrations/workflow-transition.js';
import type { HookContext } from '../../hooks/types.js';
import type { ManifestSchema, WorkflowCheckpointV3, TrustState } from '../../features/workflow-engine/phase-types.js';

// Mock modules using vi.hoisted()
const { mockLoadManifest, mockLoadCheckpoint, mockSaveCheckpoint, mockListWorkflows, mockLoadTrustState, mockGetBoltArtifacts, mockGetUnitArtifacts } = vi.hoisted(() => ({
  mockLoadManifest: vi.fn(),
  mockLoadCheckpoint: vi.fn(),
  mockSaveCheckpoint: vi.fn(),
  mockListWorkflows: vi.fn(),
  mockLoadTrustState: vi.fn(),
  mockGetBoltArtifacts: vi.fn(),
  mockGetUnitArtifacts: vi.fn(),
}));

vi.mock('../../features/workflow-engine/manifest.js', () => ({
  loadManifest: mockLoadManifest,
  getBoltArtifacts: mockGetBoltArtifacts,
  getUnitArtifacts: mockGetUnitArtifacts,
}));

vi.mock('../../features/workflow-engine/checkpoint.js', () => ({
  loadCheckpoint: mockLoadCheckpoint,
  saveCheckpoint: mockSaveCheckpoint,
  listWorkflows: mockListWorkflows,
}));

vi.mock('../../features/workflow-engine/trust.js', () => ({
  loadTrustState: mockLoadTrustState,
}));

/**
 * Creates a minimal mock manifest with default state.
 */
function createMockManifest(overrides?: Partial<ManifestSchema>): ManifestSchema {
  return {
    schema_version: '2.0.0',
    workflow_id: 'test-wf',
    feature_name: 'Test Feature',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    phases: {
      discovery: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
      inception: { status: 'in_progress', started_at: '2024-01-01T00:00:00Z', completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
      construction: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
      operations: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
    },
    depth_assessment: {
      clarity: 5,
      complexity: 3,
      scope: 4,
      risk: 2,
      context: 3,
      preferences: 3,
      total_score: 20,
      recommended_depth: 'standard',
      skip_units: false,
      risk_tier: { tier: 1, rationale: 'Low risk', factors: { reversibility: 'easy', blast_radius: 'isolated', data_sensitivity: 'none', compliance_impact: 'none' }, override_reason: null },
    },
    artifacts: [],
    links: [],
    risks: [],
    gate_audit: [],
    metrics: null,
    alignment_checks: [],
    risk_tier: { tier: 1, rationale: 'Low risk', factors: { reversibility: 'easy', blast_radius: 'isolated', data_sensitivity: 'none', compliance_impact: 'none' }, override_reason: null },
    ...overrides,
  };
}

/**
 * Creates a minimal mock checkpoint with default state.
 */
function createMockCheckpoint(overrides?: Partial<WorkflowCheckpointV3>): WorkflowCheckpointV3 {
  return {
    schema_version: '3.0.0',
    workflow_id: 'test-wf',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    current_phase: 'inception',
    current_stage: 'intent',
    status: 'in_progress',
    depth_assessment: null,
    risk_tier: null,
    stage_history: [],
    nfr_analysis: null,
    ...overrides,
  };
}

/**
 * Creates a minimal mock trust state.
 */
function createMockTrustState(level: number = 0): TrustState {
  return {
    current_level: level,
    total_transitions: 0,
    rejection_count: 0,
    rejection_rate: 0,
    incident_count: 0,
    last_level_change: null,
    level_history: [],
  };
}

describe('workflow-transition hook', () => {
  beforeEach(() => {
    clearHooks();
    vi.clearAllMocks();

    // Default mocks
    mockListWorkflows.mockResolvedValue(['test-wf']);
    mockLoadTrustState.mockReturnValue(createMockTrustState(1));
    mockGetBoltArtifacts.mockReturnValue([]);
    mockGetUnitArtifacts.mockReturnValue([]);
  });

  afterEach(() => {
    clearHooks();
  });

  it('should ignore non-Write/Task tool calls', async () => {
    registerWorkflowTransitionHooks();

    const ctx: HookContext = {
      directory: '/test',
      hookEvent: 'PostToolUse',
      toolName: 'Read',
      toolInput: {},
    };

    const hooks = (await import('../../hooks/registry.js')).getHooksForEvent('PostToolUse');
    const hook = hooks.find(h => h.name === 'workflowTransitionMessages');
    expect(hook).toBeDefined();

    const result = await hook!.handler(ctx);
    expect(result.continue).toBe(true);
    expect(result.hookSpecificOutput).toBeUndefined();
    expect(mockLoadManifest).not.toHaveBeenCalled();
  });

  it('should return continue:true when manifest is missing', async () => {
    registerWorkflowTransitionHooks();
    mockLoadManifest.mockReturnValue(null);

    const ctx: HookContext = {
      directory: '/test',
      hookEvent: 'PostToolUse',
      toolName: 'Write',
      toolInput: {},
    };

    const hooks = (await import('../../hooks/registry.js')).getHooksForEvent('PostToolUse');
    const hook = hooks.find(h => h.name === 'workflowTransitionMessages');

    const result = await hook!.handler(ctx);
    expect(result.continue).toBe(true);
    expect(result.hookSpecificOutput).toBeUndefined();
  });

  it('should return continue:true when no workflows exist', async () => {
    registerWorkflowTransitionHooks();
    mockLoadManifest.mockReturnValue(createMockManifest());
    mockListWorkflows.mockResolvedValue([]);

    const ctx: HookContext = {
      directory: '/test',
      hookEvent: 'PostToolUse',
      toolName: 'Write',
      toolInput: {},
    };

    const hooks = (await import('../../hooks/registry.js')).getHooksForEvent('PostToolUse');
    const hook = hooks.find(h => h.name === 'workflowTransitionMessages');

    const result = await hook!.handler(ctx);
    expect(result.continue).toBe(true);
    expect(result.hookSpecificOutput).toBeUndefined();
  });

  it('should return continue:true when checkpoint is missing', async () => {
    registerWorkflowTransitionHooks();
    mockLoadManifest.mockReturnValue(createMockManifest());
    mockLoadCheckpoint.mockResolvedValue(null);

    const ctx: HookContext = {
      directory: '/test',
      hookEvent: 'PostToolUse',
      toolName: 'Write',
      toolInput: {},
    };

    const hooks = (await import('../../hooks/registry.js')).getHooksForEvent('PostToolUse');
    const hook = hooks.find(h => h.name === 'workflowTransitionMessages');

    const result = await hook!.handler(ctx);
    expect(result.continue).toBe(true);
    expect(result.hookSpecificOutput).toBeUndefined();
  });

  it('should emit INTENT locked message when intent artifact is active', async () => {
    registerWorkflowTransitionHooks();

    const manifest = createMockManifest({
      artifacts: [
        {
          id: 'intent-001',
          stage: 'intent',
          type: 'intent',
          path: 'aidlc-docs/intent.md',
          description: 'Intent document',
          contract_status: 'active',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          checksum: 'abc123',
          version: 1,
          validation_errors: [],
        },
      ],
      gate_audit: [
        {
          phase: 'inception',
          gate_name: 'Gate 2',
          action: 'approved',
          timestamp: '2024-01-01T00:00:00Z',
          reason: 'INTENT approved',
          reviewer: 'system',
        },
      ],
    });

    mockLoadManifest.mockReturnValue(manifest);
    mockLoadCheckpoint.mockResolvedValue(createMockCheckpoint({ current_stage: 'intent' }));
    mockLoadTrustState.mockReturnValue(createMockTrustState(1));

    const ctx: HookContext = {
      directory: '/test',
      hookEvent: 'PostToolUse',
      toolName: 'Write',
      toolInput: {},
    };

    const hooks = (await import('../../hooks/registry.js')).getHooksForEvent('PostToolUse');
    const hook = hooks.find(h => h.name === 'workflowTransitionMessages');

    const result = await hook!.handler(ctx);
    expect(result.continue).toBe(true);
    expect(result.hookSpecificOutput).toBeDefined();
    expect(result.hookSpecificOutput?.additionalContext).toContain('✓ INTENT locked');
    expect(result.hookSpecificOutput?.additionalContext).toContain('Test Feature');
    expect(result.hookSpecificOutput?.additionalContext).toContain('Risk: Tier 1');
  });

  it('should emit INTENT locked message with unit/bolt counts', async () => {
    registerWorkflowTransitionHooks();

    const manifest = createMockManifest({
      artifacts: [
        {
          id: 'intent-001',
          stage: 'intent',
          type: 'intent',
          path: 'aidlc-docs/intent.md',
          description: 'Intent document',
          contract_status: 'active',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          checksum: 'abc123',
          version: 1,
          validation_errors: [],
        },
      ],
      gate_audit: [
        {
          phase: 'inception',
          gate_name: 'Gate 2',
          action: 'approved',
          timestamp: '2024-01-01T00:00:00Z',
          reason: 'INTENT approved',
          reviewer: 'system',
        },
      ],
    });

    mockLoadManifest.mockReturnValue(manifest);
    mockLoadCheckpoint.mockResolvedValue(createMockCheckpoint({ current_stage: 'intent' }));
    mockGetUnitArtifacts.mockReturnValue([
      { id: 'unit-001', stage: 'unit' },
      { id: 'unit-002', stage: 'unit' },
    ]);
    mockGetBoltArtifacts.mockReturnValue([
      { id: 'bolt-001', stage: 'bolt' },
      { id: 'bolt-002', stage: 'bolt' },
      { id: 'bolt-003', stage: 'bolt' },
    ]);

    const ctx: HookContext = {
      directory: '/test',
      hookEvent: 'PostToolUse',
      toolName: 'Write',
      toolInput: {},
    };

    const hooks = (await import('../../hooks/registry.js')).getHooksForEvent('PostToolUse');
    const hook = hooks.find(h => h.name === 'workflowTransitionMessages');

    const result = await hook!.handler(ctx);
    expect(result.continue).toBe(true);
    expect(result.hookSpecificOutput).toBeDefined();
    expect(result.hookSpecificOutput?.additionalContext).toContain('✓ INTENT locked');
    expect(result.hookSpecificOutput?.additionalContext).toContain('Test Feature');
    expect(result.hookSpecificOutput?.additionalContext).toContain('Tech spec:');
    expect(result.hookSpecificOutput?.additionalContext).toContain('Risk: Tier 1');
    expect(result.hookSpecificOutput?.additionalContext).toContain('2 UNITs decomposed');
    expect(result.hookSpecificOutput?.additionalContext).toContain('3 BOLTs queued');
    expect(result.hookSpecificOutput?.additionalContext).toContain('/ascent, /olympus, or /ultrawork');
  });

  it('should emit Risk Tier 3 dev review warning and set awaiting_dev_review state', async () => {
    registerWorkflowTransitionHooks();

    const manifest = createMockManifest({
      risk_tier: {
        tier: 3,
        rationale: 'High risk',
        factors: { reversibility: 'hard', blast_radius: 'widespread', data_sensitivity: 'pii', compliance_impact: 'high' },
        override_reason: null,
      },
      artifacts: [
        {
          id: 'intent-001',
          stage: 'intent',
          type: 'intent',
          path: 'aidlc-docs/intent.md',
          description: 'Intent document',
          contract_status: 'active',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          checksum: 'abc123',
          version: 1,
          validation_errors: [],
        },
      ],
      gate_audit: [
        {
          phase: 'inception',
          gate_name: 'Gate 2',
          action: 'approved',
          timestamp: '2024-01-01T00:00:00Z',
          reason: 'INTENT approved',
          reviewer: 'system',
        },
      ],
    });

    const mockCheckpoint = createMockCheckpoint({ current_stage: 'intent', status: 'in_progress' });

    mockLoadManifest.mockReturnValue(manifest);
    mockLoadCheckpoint.mockResolvedValue(mockCheckpoint);
    mockGetUnitArtifacts.mockReturnValue([]);
    mockGetBoltArtifacts.mockReturnValue([]);

    const ctx: HookContext = {
      directory: '/test',
      hookEvent: 'PostToolUse',
      toolName: 'Write',
      toolInput: {},
    };

    const hooks = (await import('../../hooks/registry.js')).getHooksForEvent('PostToolUse');
    const hook = hooks.find(h => h.name === 'workflowTransitionMessages');

    const result = await hook!.handler(ctx);
    expect(result.continue).toBe(true);
    expect(result.hookSpecificOutput).toBeDefined();
    expect(result.hookSpecificOutput?.additionalContext).toContain('⚠ Risk Tier 3');
    expect(result.hookSpecificOutput?.additionalContext).toContain('Dev review REQUIRED');

    // Check that awaiting_dev_review was set
    expect(mockSaveCheckpoint).toHaveBeenCalledWith('/test', expect.objectContaining({
      status: 'awaiting_dev_review',
    }));
  });

  it('should emit UNITs created message with unit names', async () => {
    registerWorkflowTransitionHooks();

    const manifest = createMockManifest({
      phases: {
        discovery: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
        inception: { status: 'complete', started_at: '2024-01-01T00:00:00Z', completed_at: '2024-01-01T01:00:00Z', gate_result: null, gate_bypassed: false, bypass_reason: null },
        construction: { status: 'in_progress', started_at: '2024-01-01T01:00:00Z', completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
        operations: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
      },
      gate_audit: [
        {
          phase: 'inception',
          gate_name: 'Gate 3',
          action: 'approved',
          timestamp: '2024-01-01T01:00:00Z',
          reason: 'UNITs created',
          reviewer: 'system',
        },
      ],
    });

    mockLoadManifest.mockReturnValue(manifest);
    mockLoadCheckpoint.mockResolvedValue(createMockCheckpoint({
      current_phase: 'construction',
      current_stage: 'unit',
    }));
    mockGetUnitArtifacts.mockReturnValue([
      { id: 'auth-unit', stage: 'unit' },
      { id: 'api-unit', stage: 'unit' },
    ]);

    const ctx: HookContext = {
      directory: '/test',
      hookEvent: 'PostToolUse',
      toolName: 'Write',
      toolInput: {},
    };

    const hooks = (await import('../../hooks/registry.js')).getHooksForEvent('PostToolUse');
    const hook = hooks.find(h => h.name === 'workflowTransitionMessages');

    const result = await hook!.handler(ctx);
    expect(result.continue).toBe(true);
    expect(result.hookSpecificOutput).toBeDefined();
    expect(result.hookSpecificOutput?.additionalContext).toContain('✓ 2 UNITs created');
    expect(result.hookSpecificOutput?.additionalContext).toContain('auth-unit, api-unit');
    expect(result.hookSpecificOutput?.additionalContext).toContain('Gate 3');
    expect(result.hookSpecificOutput?.additionalContext).toContain('Dev review required');
  });

  it('should emit BOLT completion message with progress', async () => {
    registerWorkflowTransitionHooks();

    const manifest = createMockManifest({
      phases: {
        discovery: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
        inception: { status: 'complete', started_at: '2024-01-01T00:00:00Z', completed_at: '2024-01-01T01:00:00Z', gate_result: null, gate_bypassed: false, bypass_reason: null },
        construction: { status: 'in_progress', started_at: '2024-01-01T01:00:00Z', completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
        operations: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
      },
      gate_audit: [
        {
          phase: 'construction',
          gate_name: 'Gate 4',
          action: 'approved',
          timestamp: '2024-01-01T02:00:00Z',
          reason: 'BOLT 1 complete',
          reviewer: 'dev',
        },
      ],
    });

    const allBolts = [
      { id: 'bolt-001', stage: 'bolt', contract_status: 'fulfilled' },
      { id: 'bolt-002', stage: 'bolt', contract_status: 'active' },
      { id: 'bolt-003', stage: 'bolt', contract_status: 'draft' },
    ];

    mockLoadManifest.mockReturnValue(manifest);
    mockLoadCheckpoint.mockResolvedValue(createMockCheckpoint({
      current_phase: 'construction',
      current_stage: 'bolt',
    }));
    mockGetBoltArtifacts.mockReturnValue(allBolts);

    const ctx: HookContext = {
      directory: '/test',
      hookEvent: 'PostToolUse',
      toolName: 'Write',
      toolInput: {},
    };

    const hooks = (await import('../../hooks/registry.js')).getHooksForEvent('PostToolUse');
    const hook = hooks.find(h => h.name === 'workflowTransitionMessages');

    const result = await hook!.handler(ctx);
    expect(result.continue).toBe(true);
    expect(result.hookSpecificOutput).toBeDefined();
    expect(result.hookSpecificOutput?.additionalContext).toContain('✓ BOLT 1/3 complete');
    expect(result.hookSpecificOutput?.additionalContext).toContain('bolt-001');
    expect(result.hookSpecificOutput?.additionalContext).toContain('Gate 4');
    expect(result.hookSpecificOutput?.additionalContext).toContain('2 remaining');
  });

  it('should emit all BOLTs complete message', async () => {
    registerWorkflowTransitionHooks();

    const manifest = createMockManifest({
      phases: {
        discovery: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
        inception: { status: 'complete', started_at: '2024-01-01T00:00:00Z', completed_at: '2024-01-01T01:00:00Z', gate_result: null, gate_bypassed: false, bypass_reason: null },
        construction: { status: 'complete', started_at: '2024-01-01T01:00:00Z', completed_at: '2024-01-01T03:00:00Z', gate_result: null, gate_bypassed: false, bypass_reason: null },
        operations: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
      },
    });

    const allBolts = [
      { id: 'bolt-001', stage: 'bolt', contract_status: 'fulfilled' },
      { id: 'bolt-002', stage: 'bolt', contract_status: 'fulfilled' },
    ];

    mockLoadManifest.mockReturnValue(manifest);
    mockLoadCheckpoint.mockResolvedValue(createMockCheckpoint({
      current_phase: 'construction',
      current_stage: 'bolt',
    }));
    mockGetBoltArtifacts.mockReturnValue(allBolts);

    const ctx: HookContext = {
      directory: '/test',
      hookEvent: 'PostToolUse',
      toolName: 'Write',
      toolInput: {},
    };

    const hooks = (await import('../../hooks/registry.js')).getHooksForEvent('PostToolUse');
    const hook = hooks.find(h => h.name === 'workflowTransitionMessages');

    const result = await hook!.handler(ctx);
    expect(result.continue).toBe(true);
    expect(result.hookSpecificOutput).toBeDefined();
    expect(result.hookSpecificOutput?.additionalContext).toContain('✓ All 2 BOLTs executed and reviewed');
    expect(result.hookSpecificOutput?.additionalContext).toContain('Operations phase');
    expect(result.hookSpecificOutput?.additionalContext).toContain('deployment guide');
  });

  it('should handle errors silently and return continue:true', async () => {
    registerWorkflowTransitionHooks();

    // Force an error by making loadManifest throw
    mockLoadManifest.mockImplementation(() => {
      throw new Error('Test error');
    });

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const ctx: HookContext = {
      directory: '/test',
      hookEvent: 'PostToolUse',
      toolName: 'Write',
      toolInput: {},
    };

    const hooks = (await import('../../hooks/registry.js')).getHooksForEvent('PostToolUse');
    const hook = hooks.find(h => h.name === 'workflowTransitionMessages');

    const result = await hook!.handler(ctx);
    expect(result.continue).toBe(true);
    expect(result.hookSpecificOutput).toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[Olympus Workflow Transition] Error:',
      expect.any(Error)
    );

    consoleErrorSpy.mockRestore();
  });

  it('should emit inception sub-stage transition message when stage just completed', async () => {
    registerWorkflowTransitionHooks();

    const manifest = createMockManifest();
    mockLoadManifest.mockReturnValue(manifest);
    mockLoadCheckpoint.mockResolvedValue(createMockCheckpoint({
      current_phase: 'inception',
      current_stage: 'intent',
      inception_stages: {
        'workspace-detection': { stage: 'workspace-detection', status: 'completed', started_at: '2024-01-01T00:00:00Z', completed_at: '2024-01-01T00:01:00Z', skip_reason: null, artifacts_generated: [], questions_file: null, answers_received: false },
        'reverse-engineering': { stage: 'reverse-engineering', status: 'not_started', started_at: null, completed_at: null, skip_reason: null, artifacts_generated: [], questions_file: null, answers_received: false },
        'requirements-analysis': { stage: 'requirements-analysis', status: 'not_started', started_at: null, completed_at: null, skip_reason: null, artifacts_generated: [], questions_file: null, answers_received: false },
        'user-stories': { stage: 'user-stories', status: 'not_started', started_at: null, completed_at: null, skip_reason: null, artifacts_generated: [], questions_file: null, answers_received: false },
        'workflow-planning': { stage: 'workflow-planning', status: 'not_started', started_at: null, completed_at: null, skip_reason: null, artifacts_generated: [], questions_file: null, answers_received: false },
        'application-design': { stage: 'application-design', status: 'not_started', started_at: null, completed_at: null, skip_reason: null, artifacts_generated: [], questions_file: null, answers_received: false },
        'units-generation': { stage: 'units-generation', status: 'not_started', started_at: null, completed_at: null, skip_reason: null, artifacts_generated: [], questions_file: null, answers_received: false },
      },
      current_inception_stage: 'workspace-detection',
    }));

    const ctx: HookContext = {
      directory: '/test',
      hookEvent: 'PostToolUse',
      toolName: 'Write',
      toolInput: {},
    };

    const hooks = (await import('../../hooks/registry.js')).getHooksForEvent('PostToolUse');
    const hook = hooks.find(h => h.name === 'workflowTransitionMessages');

    const result = await hook!.handler(ctx);
    expect(result.continue).toBe(true);
    expect(result.hookSpecificOutput).toBeDefined();
    expect(result.hookSpecificOutput?.additionalContext).toContain('workspace-detection');
    expect(result.hookSpecificOutput?.additionalContext).toContain('complete');
  });

  it('should not emit inception sub-stage message when no inception_stages on checkpoint', async () => {
    registerWorkflowTransitionHooks();

    const manifest = createMockManifest();
    mockLoadManifest.mockReturnValue(manifest);
    mockLoadCheckpoint.mockResolvedValue(createMockCheckpoint({
      current_phase: 'inception',
      current_stage: 'intent',
    }));

    const ctx: HookContext = {
      directory: '/test',
      hookEvent: 'PostToolUse',
      toolName: 'Write',
      toolInput: {},
    };

    const hooks = (await import('../../hooks/registry.js')).getHooksForEvent('PostToolUse');
    const hook = hooks.find(h => h.name === 'workflowTransitionMessages');

    const result = await hook!.handler(ctx);
    expect(result.continue).toBe(true);
    expect(result.hookSpecificOutput).toBeUndefined();
  });

  it('should work with Task tool as well as Write tool', async () => {
    registerWorkflowTransitionHooks();

    const manifest = createMockManifest({
      artifacts: [
        {
          id: 'intent-001',
          stage: 'intent',
          type: 'intent',
          path: 'aidlc-docs/intent.md',
          description: 'Intent document',
          contract_status: 'active',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          checksum: 'abc123',
          version: 1,
          validation_errors: [],
        },
      ],
      gate_audit: [
        {
          phase: 'inception',
          gate_name: 'Gate 2',
          action: 'approved',
          timestamp: '2024-01-01T00:00:00Z',
          reason: 'INTENT approved',
          reviewer: 'system',
        },
      ],
    });

    mockLoadManifest.mockReturnValue(manifest);
    mockLoadCheckpoint.mockResolvedValue(createMockCheckpoint({ current_stage: 'intent' }));

    const ctx: HookContext = {
      directory: '/test',
      hookEvent: 'PostToolUse',
      toolName: 'Task',
      toolInput: {},
    };

    const hooks = (await import('../../hooks/registry.js')).getHooksForEvent('PostToolUse');
    const hook = hooks.find(h => h.name === 'workflowTransitionMessages');

    const result = await hook!.handler(ctx);
    expect(result.continue).toBe(true);
    expect(result.hookSpecificOutput).toBeDefined();
    expect(result.hookSpecificOutput?.additionalContext).toContain('✓ INTENT locked');
  });
});
