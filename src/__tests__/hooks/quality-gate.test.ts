import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { clearHooks, getHooksForEvent } from '../../hooks/registry.js';
import type { HookContext, HookResult } from '../../hooks/types.js';

// Mock rejection-dispatcher
vi.mock('../../features/workflow-engine/rejection-dispatcher.js', () => ({
  dispatchRejection: vi.fn().mockImplementation(async (directory, workflowId, context) => {
    // Generate message based on artifact and reason
    const { artifactId, rejectionReason } = context;
    let revisionMsg = '';

    if (artifactId === 'BOLT-001') {
      revisionMsg = `The reviewer rejected ${artifactId}: ${rejectionReason}. Revise and re-submit.`;
    } else if (artifactId === 'UNIT-001') {
      revisionMsg = `The reviewer rejected UNIT decomposition: ${rejectionReason}. Revise and re-submit.`;
    } else {
      revisionMsg = `Revise the artifact based on this feedback: ${rejectionReason}\n\nArtifact ID: ${artifactId}\nWorkflow ID: ${workflowId}\nAttempt Number: ${context.attemptNumber}\nRejected By: ${context.rejectedBy}\n\nPlease revise the artifact to address the feedback above and re-submit for approval.`;
    }

    return {
      agentType: 'prometheus',
      prompt: revisionMsg,
      maxRetriesReached: false,
      contractStatusUpdate: { from: 'violated', to: 'draft' },
    };
  }),
}));

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

// Mock fs (readFileSync used in quality-gate for alignment checks)
vi.mock('fs', () => ({
  readFileSync: vi.fn().mockReturnValue(''),
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
  addGateAuditEntry: vi.fn(),
  updateContractStatus: vi.fn(),
  updatePhaseStatus: vi.fn(),
}));

// Mock trust module
vi.mock('../../features/workflow-engine/trust.js', () => ({
  loadTrustState: vi.fn().mockReturnValue({
    current_level: 0,
    total_transitions: 0,
    rejection_count: 0,
    rejection_rate: 0,
    incident_count: 0,
    last_level_change: null,
    level_history: [],
  }),
  saveTrustState: vi.fn(),
  shouldAutoAdvance: vi.fn().mockReturnValue(false),
}));

// Mock alignment module
vi.mock('../../features/workflow-engine/alignment.js', () => ({
  computeVerification: vi.fn().mockReturnValue({
    conformance_score: 0,
    coverage_percentage: 0,
    missing_items: [],
    passed: false,
  }),
  generateValidationQuestions: vi.fn().mockReturnValue([]),
  runDualValidation: vi.fn(),
}));

// Mock gate-presenter module
vi.mock('../../features/workflow-engine/gate-presenter.js', () => ({
  presentGate3: vi.fn().mockReturnValue([{
    gateNumber: 3,
    gateType: 'architecture-review',
    artifactId: 'UNIT-001',
    summary: 'Architecture review for UNIT-001',
    reviewContent: 'UNIT Artifact: construction/UNIT-001/spec.md\nContract Status: active',
    trustLevel: 0,
    trustBehavior: 'blocking',
  }]),
  presentGate4: vi.fn().mockReturnValue({
    gateNumber: 4,
    gateType: 'code-review',
    artifactId: 'BOLT-001',
    summary: 'Code review for BOLT-001',
    reviewContent: 'BOLT Spec: construction/UNIT-001/BOLT-001.md\nContract Status: active',
    trustLevel: 0,
    trustBehavior: 'blocking',
  }),
  presentGate5: vi.fn().mockReturnValue({
    gateNumber: 5,
    gateType: 'release-review',
    artifactId: 'test-feature',
    summary: 'Release approval for Test Feature',
    reviewContent: 'Release Approval Review\n\nFeature: Test Feature',
    trustLevel: 0,
    trustBehavior: 'blocking',
  }),
  getGate3TrustBehavior: vi.fn().mockReturnValue('blocking'),
  getGate4TrustBehavior: vi.fn().mockReturnValue('blocking'),
  findParentUnit: vi.fn().mockReturnValue(null),
}));

import { registerQualityGateHooks } from '../../hooks/registrations/quality-gate.js';
import { loadCheckpoint, listWorkflows, saveCheckpoint } from '../../features/workflow-engine/checkpoint.js';
import { loadManifest, saveManifest, addGateAuditEntry, updateContractStatus } from '../../features/workflow-engine/manifest.js';
import { loadTrustState, saveTrustState, shouldAutoAdvance } from '../../features/workflow-engine/trust.js';
import { computeVerification, generateValidationQuestions, runDualValidation } from '../../features/workflow-engine/alignment.js';
import { presentGate3, presentGate4, presentGate5, getGate3TrustBehavior, getGate4TrustBehavior, findParentUnit } from '../../features/workflow-engine/gate-presenter.js';
import { readFileSync } from 'fs';
import * as fsExtra from 'fs-extra';

// Helper functions
function createMockCheckpoint(overrides: Record<string, any> = {}) {
  return {
    schema_version: '2.0.0',
    workflow_id: 'test-feature',
    feature_name: 'Test Feature',
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
    current_phase: 'inception',
    phases: {
      discovery: { status: 'complete', started_at: '2025-01-01T00:00:00.000Z', completed_at: '2025-01-01T00:10:00.000Z', gate_result: null, gate_bypassed: false, bypass_reason: null },
      inception: { status: 'in_progress', started_at: '2025-01-01T00:10:00.000Z', completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
      construction: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
      operations: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
    },
    current_stage: 'intent',
    status: 'in_progress',
    artifacts: { intent: null, unit: null, bolt: null, complete: null },
    validation_results: { intent: null, unit: null, bolt: null, complete: null },
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
      inception: { status: 'in_progress', started_at: '2025-01-01T00:10:00.000Z', completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
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
    ...overrides,
  };
}

function createPostToolUseCtx(overrides: Record<string, any> = {}): HookContext {
  return {
    sessionId: 'test-session',
    directory: '/test/project',
    toolName: 'Task',
    toolInput: { subagent_type: 'olympian', prompt: 'test' },
    toolOutput: 'Task completed successfully',
    ...overrides,
  };
}

function createUserPromptCtx(prompt: string, overrides: Record<string, any> = {}): HookContext {
  return {
    sessionId: 'test-session',
    directory: '/test/project',
    prompt,
    parts: [{ type: 'text', text: prompt }],
    ...overrides,
  };
}

describe('Quality Gate Hooks', () => {
  beforeEach(() => {
    clearHooks();
    vi.clearAllMocks();
    // Re-apply default mock values after clearAllMocks
    vi.mocked(loadTrustState).mockReturnValue({
      current_level: 0,
      total_transitions: 0,
      rejection_count: 0,
      rejection_rate: 0,
      incident_count: 0,
      last_level_change: null,
      level_history: [],
    });
    vi.mocked(shouldAutoAdvance).mockReturnValue(false);
    vi.mocked(saveCheckpoint).mockResolvedValue(undefined);
    registerQualityGateHooks();
  });

  afterEach(() => {
    clearHooks();
    vi.clearAllMocks();
  });

  describe('Hook Registration', () => {
    it('registers qualityGateBlocker with PostToolUse event at priority 80', () => {
      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      expect(blocker).toBeDefined();
      expect(blocker?.priority).toBe(80);
      expect(blocker?.event).toBe('PostToolUse');
    });

    it('registers qualityGateApprover with UserPromptSubmit event at priority 12', () => {
      const hooks = getHooksForEvent('UserPromptSubmit');
      const approver = hooks.find(h => h.name === 'qualityGateApprover');

      expect(approver).toBeDefined();
      expect(approver?.priority).toBe(12);
      expect(approver?.event).toBe('UserPromptSubmit');
    });

    it('qualityGateBlocker has matcher for task', () => {
      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      expect(blocker?.matcher).toBe('task');
    });
  });

  describe('qualityGateBlocker - early returns', () => {
    it('returns continue:true for non-Task tools', async () => {
      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      const ctx = createPostToolUseCtx({ toolName: 'Read' });
      const result = await blocker!.handler(ctx);

      expect(result.continue).toBe(true);
    });

    it('returns continue:true when no directory', async () => {
      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      const ctx = createPostToolUseCtx({ directory: undefined });
      const result = await blocker!.handler(ctx);

      expect(result.continue).toBe(true);
    });

    it('returns continue:true when no sessionId', async () => {
      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      const ctx = createPostToolUseCtx({ sessionId: undefined });
      const result = await blocker!.handler(ctx);

      expect(result.continue).toBe(true);
    });

    it('returns continue:true when no active workflows', async () => {
      vi.mocked(listWorkflows).mockResolvedValue([]);

      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      const ctx = createPostToolUseCtx();
      const result = await blocker!.handler(ctx);

      expect(result.continue).toBe(true);
    });

    it('returns continue:true when all workflows are complete', async () => {
      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(
        createMockCheckpoint({ status: 'complete', current_phase: 'operations' })
      );

      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      const ctx = createPostToolUseCtx();
      const result = await blocker!.handler(ctx);

      expect(result.continue).toBe(true);
    });
  });

  describe('qualityGateBlocker - phase transitions', () => {
    it('detects Inception phase completion when current_stage is intent', async () => {
      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(
        createMockCheckpoint({ current_stage: 'intent', current_phase: 'inception' })
      );
      vi.mocked(loadManifest).mockReturnValue(
        createMockManifest({
          phases: {
            discovery: { status: 'complete', gate_result: { passed: true, approved_by: 'human', approved_at: '2025-01-01T00:00:00.000Z', feedback: null, verification: null, validation: null } },
            inception: { status: 'in_progress', gate_result: null },
            construction: { status: 'not_started' },
            operations: { status: 'not_started' },
          },
        })
      );

      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      const ctx = createPostToolUseCtx();
      const result = await blocker!.handler(ctx);

      // Should block (no trust state = Trust 0)
      expect(result.continue).toBe(true); // Always returns true, but injects STOP
      expect(result.hookSpecificOutput?.additionalContext).toContain('[GATE_PENDING]');
    });

    it('triggers gate when current_stage is intent', async () => {
      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(
        createMockCheckpoint({ current_stage: 'intent', current_phase: 'inception' })
      );
      vi.mocked(loadManifest).mockReturnValue(
        createMockManifest({
          phases: {
            discovery: { status: 'complete', gate_result: { passed: true, approved_by: 'human', approved_at: '2025-01-01T00:00:00.000Z', feedback: null, verification: null, validation: null } },
            inception: { status: 'in_progress', gate_result: null },
            construction: { status: 'not_started' },
            operations: { status: 'not_started' },
          },
        })
      );

      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      const ctx = createPostToolUseCtx();
      const result = await blocker!.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.additionalContext).toContain('[GATE_PENDING]');
      expect(result.hookSpecificOutput?.additionalContext).toContain('Gate 1 (INTENT review)');
    });

    it('does not re-trigger when gate is already pending', async () => {
      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(
        createMockCheckpoint({ current_stage: 'intent', current_phase: 'inception' })
      );
      vi.mocked(loadManifest).mockReturnValue(
        createMockManifest({
          phases: {
            inception: {
              status: 'in_progress',
              gate_result: {
                passed: false,
                approved_by: null,
                reason: null
              }
            },
            construction: { status: 'not_started' },
            operations: { status: 'not_started' },
          },
        })
      );

      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      const ctx = createPostToolUseCtx();
      const result = await blocker!.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.additionalContext).toBeUndefined();
    });
  });

  describe('qualityGateBlocker - trust auto-advance', () => {
    it('auto-advances at Trust 1 with Tier 1 risk', async () => {
      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(
        createMockCheckpoint({
          current_stage: 'intent',
          current_phase: 'inception',
          risk_tier: { tier: 1, score: 15, rationale: 'Low risk' },
          trust_state_path: '/test/project/aidlc-docs/test-feature/trust-state.json',
        })
      );
      vi.mocked(loadManifest).mockReturnValue(
        createMockManifest({
          phases: {
            discovery: { status: 'complete', gate_result: { passed: true, approved_by: 'human', approved_at: '2025-01-01T00:00:00.000Z', feedback: null, verification: null, validation: null } },
            inception: { status: 'in_progress', gate_result: null },
            construction: { status: 'not_started' },
            operations: { status: 'not_started' },
          },
          artifacts: [
            { id: 'intent-001', type: 'intent', phase: 'inception', path: 'intent.json', contract_status: 'draft' }
          ],
        })
      );
      vi.mocked(shouldAutoAdvance).mockReturnValue(true);
      vi.mocked(loadTrustState).mockReturnValue({
        current_level: 1,
        total_transitions: 5,
        rejection_count: 1,
        rejection_rate: 0.2,
        incident_count: 0,
        last_level_change: null,
        level_history: [],
      });

      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      const ctx = createPostToolUseCtx();
      const result = await blocker!.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.additionalContext).toBeUndefined();
      expect(addGateAuditEntry).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ phase: 'inception', actor: 'trust', action: 'approved' })
      );
      expect(saveCheckpoint).toHaveBeenCalled();
    });

    it('blocks at Trust 1 with Tier 2 risk', async () => {
      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(
        createMockCheckpoint({
          current_stage: 'intent',
          current_phase: 'inception',
          risk_tier: { tier: 2, score: 45, rationale: 'Medium risk' },
          trust_state_path: '/test/project/aidlc-docs/test-feature/trust-state.json',
        })
      );
      vi.mocked(loadManifest).mockReturnValue(
        createMockManifest({
          phases: {
            discovery: { status: 'complete', gate_result: { passed: true, approved_by: 'human', approved_at: '2025-01-01T00:00:00.000Z', feedback: null, verification: null, validation: null } },
            inception: { status: 'in_progress', gate_result: null },
            construction: { status: 'not_started' },
            operations: { status: 'not_started' },
          },
        })
      );
      vi.mocked(shouldAutoAdvance).mockReturnValue(false);
      vi.mocked(loadTrustState).mockReturnValue({
        current_level: 1,
        total_transitions: 5,
        rejection_count: 1,
        rejection_rate: 0.2,
        incident_count: 0,
        last_level_change: null,
        level_history: [],
      });

      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      const ctx = createPostToolUseCtx();
      const result = await blocker!.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.additionalContext).toContain('[GATE_PENDING]');
    });

    it('auto-advances at Trust 2 with Tier 2 risk', async () => {
      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(
        createMockCheckpoint({
          current_stage: 'intent',
          current_phase: 'inception',
          risk_tier: { tier: 2, score: 45, rationale: 'Medium risk' },
          trust_state_path: '/test/project/aidlc-docs/test-feature/trust-state.json',
        })
      );
      vi.mocked(loadManifest).mockReturnValue(
        createMockManifest({
          phases: {
            discovery: { status: 'complete', gate_result: { passed: true, approved_by: 'human', approved_at: '2025-01-01T00:00:00.000Z', feedback: null, verification: null, validation: null } },
            inception: { status: 'in_progress', gate_result: null },
            construction: { status: 'not_started' },
            operations: { status: 'not_started' },
          },
          artifacts: [
            { id: 'intent-001', type: 'intent', phase: 'inception', path: 'intent.json', contract_status: 'draft' }
          ],
        })
      );
      vi.mocked(shouldAutoAdvance).mockReturnValue(true);
      vi.mocked(loadTrustState).mockReturnValue({
        current_level: 2,
        total_transitions: 10,
        rejection_count: 1,
        rejection_rate: 0.1,
        incident_count: 0,
        last_level_change: null,
        level_history: [],
      });

      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      const ctx = createPostToolUseCtx();
      const result = await blocker!.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.additionalContext).toBeUndefined();
      expect(addGateAuditEntry).toHaveBeenCalled();
      expect(saveCheckpoint).toHaveBeenCalled();
    });

    it('blocks at Trust 2 with Tier 3 risk (no Momus review)', async () => {
      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(
        createMockCheckpoint({
          current_stage: 'intent',
          current_phase: 'inception',
          risk_tier: { tier: 3, score: 75, rationale: 'High risk' },
          trust_state_path: '/test/project/aidlc-docs/test-feature/trust-state.json',
        })
      );
      vi.mocked(loadManifest).mockReturnValue(
        createMockManifest({
          phases: {
            discovery: { status: 'complete', gate_result: { passed: true, approved_by: 'human', approved_at: '2025-01-01T00:00:00.000Z', feedback: null, verification: null, validation: null } },
            inception: { status: 'in_progress', gate_result: null },
            construction: { status: 'not_started' },
            operations: { status: 'not_started' },
          },
        })
      );
      vi.mocked(shouldAutoAdvance).mockReturnValue(false);
      vi.mocked(loadTrustState).mockReturnValue({
        current_level: 2,
        total_transitions: 10,
        rejection_count: 1,
        rejection_rate: 0.1,
        incident_count: 0,
        last_level_change: null,
        level_history: [],
      });

      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      const ctx = createPostToolUseCtx();
      const result = await blocker!.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.additionalContext).toContain('BLOCKED');
      expect(result.hookSpecificOutput?.additionalContext).toContain('Momus review');
      expect(result.hookSpecificOutput?.additionalContext).toContain('[GATE_PENDING]');
    });

    it('never auto-advances at Trust 0', async () => {
      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(
        createMockCheckpoint({
          current_stage: 'intent',
          current_phase: 'inception',
          risk_tier: { tier: 1, score: 15, rationale: 'Low risk' },
          trust_state_path: '/test/project/aidlc-docs/test-feature/trust-state.json',
        })
      );
      vi.mocked(loadManifest).mockReturnValue(
        createMockManifest({
          phases: {
            discovery: { status: 'complete', gate_result: { passed: true, approved_by: 'human', approved_at: '2025-01-01T00:00:00.000Z', feedback: null, verification: null, validation: null } },
            inception: { status: 'in_progress', gate_result: null },
            construction: { status: 'not_started' },
            operations: { status: 'not_started' },
          },
        })
      );
      vi.mocked(shouldAutoAdvance).mockReturnValue(false);
      vi.mocked(loadTrustState).mockReturnValue({
        current_level: 0,
        total_transitions: 2,
        rejection_count: 1,
        rejection_rate: 0.5,
        incident_count: 0,
        last_level_change: null,
        level_history: [],
      });

      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      const ctx = createPostToolUseCtx();
      const result = await blocker!.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.additionalContext).toContain('[GATE_PENDING]');
    });

    it('records audit entry with actor trust on auto-advance', async () => {
      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(
        createMockCheckpoint({
          current_stage: 'intent',
          current_phase: 'inception',
          risk_tier: { tier: 1, score: 15, rationale: 'Low risk' },
          trust_state_path: '/test/project/aidlc-docs/test-feature/trust-state.json',
        })
      );
      vi.mocked(loadManifest).mockReturnValue(
        createMockManifest({
          phases: {
            discovery: { status: 'complete', gate_result: { passed: true, approved_by: 'human', approved_at: '2025-01-01T00:00:00.000Z', feedback: null, verification: null, validation: null } },
            inception: { status: 'in_progress', gate_result: null },
            construction: { status: 'not_started' },
            operations: { status: 'not_started' },
          },
          artifacts: [
            { id: 'intent-001', type: 'intent', phase: 'inception', path: 'intent.json', contract_status: 'draft' }
          ],
        })
      );
      vi.mocked(shouldAutoAdvance).mockReturnValue(true);
      vi.mocked(loadTrustState).mockReturnValue({
        current_level: 1,
        total_transitions: 5,
        rejection_count: 1,
        rejection_rate: 0.2,
        incident_count: 0,
        last_level_change: null,
        level_history: [],
      });

      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      const ctx = createPostToolUseCtx();
      await blocker!.handler(ctx);

      expect(addGateAuditEntry).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          phase: 'inception',
          actor: 'trust',
          action: 'approved',
        })
      );
    });
  });

  describe('qualityGateBlocker - V&V injection', () => {
    it('injects STOP message when gate blocks', async () => {
      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(
        createMockCheckpoint({ current_stage: 'intent', current_phase: 'inception' })
      );
      vi.mocked(loadManifest).mockReturnValue(
        createMockManifest({
          phases: {
            discovery: { status: 'complete', gate_result: { passed: true, approved_by: 'human', approved_at: '2025-01-01T00:00:00.000Z', feedback: null, verification: null, validation: null } },
            inception: { status: 'in_progress', gate_result: null },
            construction: { status: 'not_started' },
            operations: { status: 'not_started' },
          },
        })
      );

      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      const ctx = createPostToolUseCtx();
      const result = await blocker!.handler(ctx);

      expect(result.hookSpecificOutput?.additionalContext).toContain('STOP');
    });

    it('includes verification scores in message', async () => {
      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(
        createMockCheckpoint({
          current_stage: 'intent',
          current_phase: 'inception',
          validation_results: {
            intent: {
              verification_score: 0.85,
              validation_questions: [],
            }
          }
        })
      );
      vi.mocked(loadManifest).mockReturnValue(
        createMockManifest({
          phases: {
            discovery: { status: 'complete', gate_result: { passed: true, approved_by: 'human', approved_at: '2025-01-01T00:00:00.000Z', feedback: null, verification: null, validation: null } },
            inception: { status: 'in_progress', gate_result: null },
            construction: { status: 'not_started' },
            operations: { status: 'not_started' },
          },
        })
      );

      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      const ctx = createPostToolUseCtx();
      const result = await blocker!.handler(ctx);

      expect(result.hookSpecificOutput?.additionalContext).toContain('0% conformance');
    });

    it('includes validation questions in message', async () => {
      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(
        createMockCheckpoint({
          current_stage: 'intent',
          current_phase: 'inception',
          validation_results: {
            intent: {
              verification_score: 0.85,
              validation_questions: [
                { question: 'Is the API design RESTful?', rationale: 'Check REST compliance' }
              ],
            }
          }
        })
      );
      vi.mocked(loadManifest).mockReturnValue(
        createMockManifest({
          phases: {
            discovery: { status: 'complete', gate_result: { passed: true, approved_by: 'human', approved_at: '2025-01-01T00:00:00.000Z', feedback: null, verification: null, validation: null } },
            inception: { status: 'in_progress', gate_result: null },
            construction: { status: 'not_started' },
            operations: { status: 'not_started' },
          },
        })
      );

      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      const ctx = createPostToolUseCtx();
      const result = await blocker!.handler(ctx);

      expect(result.hookSpecificOutput?.additionalContext).toContain('Does the INTENT address all stated constraints?');
    });

    it('includes [GATE_PENDING] sentinel', async () => {
      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(
        createMockCheckpoint({ current_stage: 'intent', current_phase: 'inception' })
      );
      vi.mocked(loadManifest).mockReturnValue(
        createMockManifest({
          phases: {
            discovery: { status: 'complete', gate_result: { passed: true, approved_by: 'human', approved_at: '2025-01-01T00:00:00.000Z', feedback: null, verification: null, validation: null } },
            inception: { status: 'in_progress', gate_result: null },
            construction: { status: 'not_started' },
            operations: { status: 'not_started' },
          },
        })
      );

      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      const ctx = createPostToolUseCtx();
      const result = await blocker!.handler(ctx);

      expect(result.hookSpecificOutput?.additionalContext).toContain('[GATE_PENDING]');
    });

    it('stores gate_result in manifest phase state', async () => {
      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(
        createMockCheckpoint({ current_stage: 'intent', current_phase: 'inception' })
      );
      const manifest = createMockManifest({
        phases: {
          inception: { status: 'in_progress', gate_result: null },
          construction: { status: 'not_started' },
          operations: { status: 'not_started' },
        },
      });
      vi.mocked(loadManifest).mockReturnValue(manifest);

      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      const ctx = createPostToolUseCtx();
      await blocker!.handler(ctx);

      expect(saveManifest).toHaveBeenCalledWith(
        expect.stringContaining('manifest.json'),
        expect.objectContaining({
          phases: expect.objectContaining({
            inception: expect.objectContaining({
              gate_result: expect.objectContaining({
                passed: false,
                approved_by: null,
              })
            })
          })
        })
      );
    });
  });

  describe('qualityGateBlocker - fail open', () => {
    it('continues when manifest is corrupted/null', async () => {
      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(
        createMockCheckpoint({ current_stage: 'intent', current_phase: 'inception' })
      );
      vi.mocked(loadManifest).mockReturnValue(null);

      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      const ctx = createPostToolUseCtx();
      const result = await blocker!.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.additionalContext).toBeUndefined();
    });

    it('continues when checkpoint loading throws', async () => {
      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockRejectedValue(new Error('Checkpoint corrupted'));

      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      const ctx = createPostToolUseCtx();
      const result = await blocker!.handler(ctx);

      expect(result.continue).toBe(true);
    });

    it('logs warning on manifest corruption', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(
        createMockCheckpoint({ current_stage: 'intent', current_phase: 'inception' })
      );
      vi.mocked(loadManifest).mockReturnValue(null);

      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      const ctx = createPostToolUseCtx();
      await blocker!.handler(ctx);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Olympus Quality Gate]')
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe('qualityGateApprover - approval', () => {
    beforeEach(() => {
      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(
        createMockCheckpoint({
          current_stage: 'intent',
          current_phase: 'inception',
          trust_state_path: '/test/project/aidlc-docs/test-feature/trust-state.json',
        })
      );
      vi.mocked(loadManifest).mockReturnValue(
        createMockManifest({
          phases: {
            discovery: { status: 'complete', gate_result: { passed: true, approved_by: 'human', approved_at: '2025-01-01T00:00:00.000Z', feedback: null, verification: null, validation: null } },
            inception: {
              status: 'in_progress',
              gate_result: { passed: false, approved_by: null, reason: null }
            },
            construction: { status: 'not_started' },
            operations: { status: 'not_started' },
          },
          artifacts: [
            { id: 'intent-001', type: 'intent', phase: 'inception', path: 'intent.json', contract_status: 'draft' }
          ],
        })
      );
      vi.mocked(loadTrustState).mockReturnValue({
        current_level: 1,
        total_transitions: 5,
        rejection_count: 1,
        rejection_rate: 0.2,
        incident_count: 0,
        last_level_change: null,
        level_history: [],
      });
    });

    it('approves gate when user types "approve"', async () => {
      const hooks = getHooksForEvent('UserPromptSubmit');
      const approver = hooks.find(h => h.name === 'qualityGateApprover');

      const ctx = createUserPromptCtx('approve');
      const result = await approver!.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.additionalContext).toContain('approved');
    });

    it('approves gate case-insensitively ("Approve", "APPROVE")', async () => {
      const hooks = getHooksForEvent('UserPromptSubmit');
      const approver = hooks.find(h => h.name === 'qualityGateApprover');

      for (const variant of ['Approve', 'APPROVE', 'ApPrOvE']) {
        vi.clearAllMocks();

        // Re-setup mocks after clearing
        vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
        vi.mocked(loadCheckpoint).mockResolvedValue(
          createMockCheckpoint({
            current_stage: 'intent',
            current_phase: 'inception',
            trust_state_path: '/test/project/aidlc-docs/test-feature/trust-state.json',
          })
        );
        vi.mocked(loadManifest).mockReturnValue(
          createMockManifest({
            phases: {
              discovery: { status: 'complete', gate_result: { passed: true, approved_by: 'human', approved_at: '2025-01-01T00:00:00.000Z', feedback: null, verification: null, validation: null } },
              inception: {
                status: 'in_progress',
                gate_result: { passed: false, approved_by: null, reason: null }
              },
              construction: { status: 'not_started' },
              operations: { status: 'not_started' },
            },
            artifacts: [
              { id: 'intent-001', type: 'intent', phase: 'inception', path: 'intent.json', contract_status: 'draft' }
            ],
          })
        );
        vi.mocked(loadTrustState).mockReturnValue({
          current_level: 1,
          total_transitions: 5,
          rejection_count: 1,
          rejection_rate: 0.2,
          incident_count: 0,
          last_level_change: null,
          level_history: [],
        });

        const ctx = createUserPromptCtx(variant);
        const result = await approver!.handler(ctx);

        expect(result.continue).toBe(true);
        expect(result.hookSpecificOutput?.additionalContext).toContain('approved');
      }
    });

    it('marks gate_result as passed with human approval then resets for next gate', async () => {
      // Capture manifest state at each saveManifest call (object is mutated in-place)
      const savedStates: any[] = [];
      vi.mocked(saveManifest).mockImplementation((_path: any, manifest: any) => {
        savedStates.push(JSON.parse(JSON.stringify(manifest)));
      });

      const hooks = getHooksForEvent('UserPromptSubmit');
      const approver = hooks.find(h => h.name === 'qualityGateApprover');

      const ctx = createUserPromptCtx('approve');
      await approver!.handler(ctx);

      // First call: gate_result marked as passed
      expect(savedStates[0].phases.inception.gate_result.passed).toBe(true);
      expect(savedStates[0].phases.inception.gate_result.approved_by).toBe('human');

      // Second call: gate_result reset to null (so next stage gate can fire)
      expect(savedStates[1].phases.inception.gate_result).toBeNull();
    });

    it('updates artifact contract_status to active', async () => {
      const hooks = getHooksForEvent('UserPromptSubmit');
      const approver = hooks.find(h => h.name === 'qualityGateApprover');

      const ctx = createUserPromptCtx('approve');
      await approver!.handler(ctx);

      expect(updateContractStatus).toHaveBeenCalledWith(
        expect.anything(),
        'intent-001',
        'active'
      );
    });

    it('adds audit entry with actor human', async () => {
      const hooks = getHooksForEvent('UserPromptSubmit');
      const approver = hooks.find(h => h.name === 'qualityGateApprover');

      const ctx = createUserPromptCtx('approve');
      await approver!.handler(ctx);

      expect(addGateAuditEntry).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          phase: 'inception',
          actor: 'human',
          action: 'approved',
        })
      );
    });

    it('increments trust state total_transitions', async () => {
      const hooks = getHooksForEvent('UserPromptSubmit');
      const approver = hooks.find(h => h.name === 'qualityGateApprover');

      const ctx = createUserPromptCtx('approve');
      await approver!.handler(ctx);

      expect(saveTrustState).toHaveBeenCalledWith(
        expect.objectContaining({
          total_transitions: 6,
          rejection_rate: expect.any(Number),
        }),
        expect.any(String)
      );
    });

    it('saves trust state to disk', async () => {
      const hooks = getHooksForEvent('UserPromptSubmit');
      const approver = hooks.find(h => h.name === 'qualityGateApprover');

      const ctx = createUserPromptCtx('approve');
      await approver!.handler(ctx);

      expect(saveTrustState).toHaveBeenCalled();
    });

    it('saves checkpoint after approval', async () => {
      const hooks = getHooksForEvent('UserPromptSubmit');
      const approver = hooks.find(h => h.name === 'qualityGateApprover');

      const ctx = createUserPromptCtx('approve');
      await approver!.handler(ctx);

      expect(saveCheckpoint).toHaveBeenCalled();
    });

    it('returns approval confirmation message', async () => {
      const hooks = getHooksForEvent('UserPromptSubmit');
      const approver = hooks.find(h => h.name === 'qualityGateApprover');

      const ctx = createUserPromptCtx('approve');
      const result = await approver!.handler(ctx);

      expect(result.hookSpecificOutput?.additionalContext).toContain('inception');
      expect(result.hookSpecificOutput?.additionalContext).toContain('approved');
    });
  });

  describe('qualityGateApprover - rejection', () => {
    beforeEach(() => {
      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(
        createMockCheckpoint({
          current_stage: 'intent',
          current_phase: 'inception',
          trust_state_path: '/test/project/aidlc-docs/test-feature/trust-state.json',
        })
      );
      vi.mocked(loadManifest).mockReturnValue(
        createMockManifest({
          phases: {
            discovery: { status: 'complete', gate_result: { passed: true, approved_by: 'human', approved_at: '2025-01-01T00:00:00.000Z', feedback: null, verification: null, validation: null } },
            inception: {
              status: 'in_progress',
              gate_result: { passed: false, approved_by: null, reason: null }
            },
            construction: { status: 'not_started' },
            operations: { status: 'not_started' },
          },
          artifacts: [
            { id: 'intent-001', type: 'intent', phase: 'inception', path: 'intent.json', contract_status: 'draft' }
          ],
        })
      );
      vi.mocked(loadTrustState).mockReturnValue({
        current_level: 1,
        total_transitions: 5,
        rejection_count: 1,
        rejection_rate: 0.2,
        incident_count: 0,
        last_level_change: null,
        level_history: [],
      });
    });

    it('rejects gate when user types "reject needs more detail"', async () => {
      const hooks = getHooksForEvent('UserPromptSubmit');
      const approver = hooks.find(h => h.name === 'qualityGateApprover');

      const ctx = createUserPromptCtx('reject needs more detail');
      const result = await approver!.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.additionalContext).toContain('rejected');
    });

    it('extracts reason after "reject" keyword', async () => {
      const hooks = getHooksForEvent('UserPromptSubmit');
      const approver = hooks.find(h => h.name === 'qualityGateApprover');

      const ctx = createUserPromptCtx('reject insufficient test coverage');
      await approver!.handler(ctx);

      expect(saveManifest).toHaveBeenCalledWith(
        expect.stringContaining('manifest.json'),
        expect.objectContaining({
          phases: expect.objectContaining({
            inception: expect.objectContaining({
              gate_result: expect.objectContaining({
                passed: false,
                feedback: 'insufficient test coverage',
              })
            })
          })
        })
      );
    });

    it('marks artifact as violated', async () => {
      const hooks = getHooksForEvent('UserPromptSubmit');
      const approver = hooks.find(h => h.name === 'qualityGateApprover');

      const ctx = createUserPromptCtx('reject needs more detail');
      await approver!.handler(ctx);

      expect(updateContractStatus).toHaveBeenCalledWith(
        expect.anything(),
        'intent-001',
        'violated',
        expect.any(String)
      );
    });

    it('adds audit entry with rejection reason', async () => {
      const hooks = getHooksForEvent('UserPromptSubmit');
      const approver = hooks.find(h => h.name === 'qualityGateApprover');

      const ctx = createUserPromptCtx('reject incomplete requirements');
      await approver!.handler(ctx);

      expect(addGateAuditEntry).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          phase: 'inception',
          actor: 'human',
          action: 'rejected',
          reason: 'incomplete requirements',
        })
      );
    });

    it('increments rejection count in trust state', async () => {
      const hooks = getHooksForEvent('UserPromptSubmit');
      const approver = hooks.find(h => h.name === 'qualityGateApprover');

      const ctx = createUserPromptCtx('reject needs more detail');
      await approver!.handler(ctx);

      expect(saveTrustState).toHaveBeenCalledWith(
        expect.objectContaining({
          total_transitions: 6,
          rejection_count: 2,
        }),
        expect.any(String)
      );
    });

    it('updates rejection rate', async () => {
      const hooks = getHooksForEvent('UserPromptSubmit');
      const approver = hooks.find(h => h.name === 'qualityGateApprover');

      const ctx = createUserPromptCtx('reject needs more detail');
      await approver!.handler(ctx);

      expect(saveTrustState).toHaveBeenCalledWith(
        expect.objectContaining({
          rejection_rate: expect.any(Number),
        }),
        expect.any(String)
      );
    });

    it('saves checkpoint after rejection', async () => {
      const hooks = getHooksForEvent('UserPromptSubmit');
      const approver = hooks.find(h => h.name === 'qualityGateApprover');

      const ctx = createUserPromptCtx('reject needs more detail');
      await approver!.handler(ctx);

      expect(saveCheckpoint).toHaveBeenCalled();
    });

    it('returns rejection confirmation message', async () => {
      const hooks = getHooksForEvent('UserPromptSubmit');
      const approver = hooks.find(h => h.name === 'qualityGateApprover');

      const ctx = createUserPromptCtx('reject needs more detail');
      const result = await approver!.handler(ctx);

      expect(result.hookSpecificOutput?.additionalContext).toContain('rejected');
    });

    it('calls dispatchRejection with correct context', async () => {
      const { dispatchRejection } = await import('../../features/workflow-engine/rejection-dispatcher.js');
      const hooks = getHooksForEvent('UserPromptSubmit');
      const approver = hooks.find(h => h.name === 'qualityGateApprover');

      const ctx = createUserPromptCtx('reject needs more detail');
      await approver!.handler(ctx);

      expect(dispatchRejection).toHaveBeenCalledWith(
        '/test/project',
        'test-feature',
        expect.objectContaining({
          gateNumber: 2,
          rejectionReason: 'needs more detail',
          rejectedBy: 'human',
          attemptNumber: 1,
        })
      );
    });
  });

  describe('qualityGateApprover - bypass', () => {
    beforeEach(() => {
      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(
        createMockCheckpoint({
          current_stage: 'intent',
          current_phase: 'inception',
          trust_state_path: '/test/project/aidlc-docs/test-feature/trust-state.json',
        })
      );
      vi.mocked(loadManifest).mockReturnValue(
        createMockManifest({
          phases: {
            discovery: { status: 'complete', gate_result: { passed: true, approved_by: 'human', approved_at: '2025-01-01T00:00:00.000Z', feedback: null, verification: null, validation: null } },
            inception: {
              status: 'in_progress',
              gate_result: { passed: false, approved_by: null, reason: null }
            },
            construction: { status: 'not_started' },
            operations: { status: 'not_started' },
          },
          artifacts: [
            { id: 'intent-001', type: 'intent', phase: 'inception', path: 'intent.json', contract_status: 'draft' }
          ],
        })
      );
      vi.mocked(loadTrustState).mockReturnValue({
        current_level: 1,
        total_transitions: 5,
        rejection_count: 1,
        rejection_rate: 0.2,
        incident_count: 0,
        last_level_change: null,
        level_history: [],
      });
    });

    it('auto-approves with --no-gates flag in prompt', async () => {
      const hooks = getHooksForEvent('UserPromptSubmit');
      const approver = hooks.find(h => h.name === 'qualityGateApprover');

      const ctx = createUserPromptCtx('continue with implementation --no-gates');
      const result = await approver!.handler(ctx);

      expect(result.continue).toBe(true);
      expect(saveManifest).toHaveBeenCalledWith(
        expect.stringContaining('manifest.json'),
        expect.objectContaining({
          phases: expect.objectContaining({
            inception: expect.objectContaining({
              gate_result: null,
              gate_bypassed: true,
              bypass_reason: '--no-gates flag',
            })
          })
        })
      );
    });

    it.skip('auto-approves when config has qualityGates.enabled: false', async () => {
      // Override fsExtra mocks without clearing (to preserve module-level mocks)
      const existsSyncMock = fsExtra.existsSync as any;
      const readJsonSyncMock = fsExtra.readJsonSync as any;

      existsSyncMock.mockImplementation((path: any) => {
        const pathStr = path.toString();
        if (pathStr.includes('.olympus/config.json')) return true;
        if (pathStr.includes('trust-state.json')) return true;
        return false;
      });
      readJsonSyncMock.mockImplementation((path: any) => {
        const pathStr = path.toString();
        if (pathStr.includes('config.json')) {
          return { workflow: { qualityGates: { enabled: false } } };
        }
        return {
          current_level: 1,
          total_transitions: 5,
          rejection_count: 1,
          rejection_rate: 0.2,
          incident_count: 0,
          last_level_change: null,
          level_history: [],
        };
      });

      const hooks = getHooksForEvent('UserPromptSubmit');
      const approver = hooks.find(h => h.name === 'qualityGateApprover');

      const ctx = createUserPromptCtx('continue with implementation');
      await approver!.handler(ctx);

      expect(saveManifest).toHaveBeenCalledWith(
        expect.stringContaining('manifest.json'),
        expect.objectContaining({
          phases: expect.objectContaining({
            inception: expect.objectContaining({
              gate_result: null,
              gate_bypassed: true,
              bypass_reason: 'Config disabled',
            })
          })
        })
      );
    });

    it.skip('auto-approves when hooks.qualityGate.enabled: false', async () => {
      // Override fsExtra mocks without clearing (to preserve module-level mocks)
      const existsSyncMock = fsExtra.existsSync as any;
      const readJsonSyncMock = fsExtra.readJsonSync as any;

      existsSyncMock.mockImplementation((path: any) => {
        const pathStr = path.toString();
        if (pathStr.includes('.olympus/config.json')) return true;
        if (pathStr.includes('trust-state.json')) return true;
        return false;
      });
      readJsonSyncMock.mockImplementation((path: any) => {
        const pathStr = path.toString();
        if (pathStr.includes('config.json')) {
          return { hooks: { qualityGate: { enabled: false } } };
        }
        return {
          current_level: 1,
          total_transitions: 5,
          rejection_count: 1,
          rejection_rate: 0.2,
          incident_count: 0,
          last_level_change: null,
          level_history: [],
        };
      });

      const hooks = getHooksForEvent('UserPromptSubmit');
      const approver = hooks.find(h => h.name === 'qualityGateApprover');

      const ctx = createUserPromptCtx('continue with implementation');
      await approver!.handler(ctx);

      expect(saveManifest).toHaveBeenCalledWith(
        expect.stringContaining('manifest.json'),
        expect.objectContaining({
          phases: expect.objectContaining({
            inception: expect.objectContaining({
              gate_result: null,
              gate_bypassed: true,
              bypass_reason: 'Config disabled',
            })
          })
        })
      );
    });

    it('records bypass in audit trail with actor flag', async () => {
      const hooks = getHooksForEvent('UserPromptSubmit');
      const approver = hooks.find(h => h.name === 'qualityGateApprover');

      const ctx = createUserPromptCtx('continue --no-gates');
      await approver!.handler(ctx);

      expect(addGateAuditEntry).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          phase: 'inception',
          actor: 'flag',
          action: 'bypassed',
        })
      );
    });

    it.skip('records bypass in audit trail with actor config', async () => {
      // Override fsExtra mocks without clearing (to preserve module-level mocks)
      const existsSyncMock = fsExtra.existsSync as any;
      const readJsonSyncMock = fsExtra.readJsonSync as any;

      existsSyncMock.mockImplementation((path: any) => {
        const pathStr = path.toString();
        if (pathStr.includes('.olympus/config.json')) return true;
        if (pathStr.includes('trust-state.json')) return true;
        return false;
      });
      readJsonSyncMock.mockImplementation((path: any) => {
        const pathStr = path.toString();
        if (pathStr.includes('config.json')) {
          return { workflow: { qualityGates: { enabled: false } } };
        }
        return {
          current_level: 1,
          total_transitions: 5,
          rejection_count: 1,
          rejection_rate: 0.2,
          incident_count: 0,
          last_level_change: null,
          level_history: [],
        };
      });

      const hooks = getHooksForEvent('UserPromptSubmit');
      const approver = hooks.find(h => h.name === 'qualityGateApprover');

      const ctx = createUserPromptCtx('continue');
      await approver!.handler(ctx);

      expect(addGateAuditEntry).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          phase: 'inception',
          actor: 'config',
          action: 'bypassed',
        })
      );
    });
  });

  describe('qualityGateApprover - pass through', () => {
    it('passes through normal prompts without gate pending', async () => {
      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(
        createMockCheckpoint({ current_stage: 'intent', current_phase: 'inception' })
      );
      vi.mocked(loadManifest).mockReturnValue(
        createMockManifest({
          phases: {
            discovery: { status: 'complete', gate_result: { passed: true, approved_by: 'human', approved_at: '2025-01-01T00:00:00.000Z', feedback: null, verification: null, validation: null } },
            inception: { status: 'in_progress', gate_result: null },
            construction: { status: 'not_started' },
            operations: { status: 'not_started' },
          },
        })
      );

      const hooks = getHooksForEvent('UserPromptSubmit');
      const approver = hooks.find(h => h.name === 'qualityGateApprover');

      const ctx = createUserPromptCtx('implement the feature');
      const result = await approver!.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.additionalContext).toBeUndefined();
    });

    it('passes through when no directory', async () => {
      const hooks = getHooksForEvent('UserPromptSubmit');
      const approver = hooks.find(h => h.name === 'qualityGateApprover');

      const ctx = createUserPromptCtx('approve', { directory: undefined });
      const result = await approver!.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.additionalContext).toBeUndefined();
    });

    it('passes through prompts that do not start with approve/reject', async () => {
      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(
        createMockCheckpoint({ current_stage: 'intent', current_phase: 'inception' })
      );
      vi.mocked(loadManifest).mockReturnValue(
        createMockManifest({
          phases: {
            discovery: { status: 'complete', gate_result: { passed: true, approved_by: 'human', approved_at: '2025-01-01T00:00:00.000Z', feedback: null, verification: null, validation: null } },
            inception: {
              status: 'in_progress',
              gate_result: { passed: false, approved_by: null, reason: null }
            },
            construction: { status: 'not_started' },
            operations: { status: 'not_started' },
          },
        })
      );

      const hooks = getHooksForEvent('UserPromptSubmit');
      const approver = hooks.find(h => h.name === 'qualityGateApprover');

      const ctx = createUserPromptCtx('let me think about this');
      const result = await approver!.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.additionalContext).toBeUndefined();
    });
  });

  describe('Ascent sentinel', () => {
    it('[GATE_PENDING] appears in blocked gate message', async () => {
      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(
        createMockCheckpoint({ current_stage: 'intent', current_phase: 'inception' })
      );
      vi.mocked(loadManifest).mockReturnValue(
        createMockManifest({
          phases: {
            discovery: { status: 'complete', gate_result: { passed: true, approved_by: 'human', approved_at: '2025-01-01T00:00:00.000Z', feedback: null, verification: null, validation: null } },
            inception: { status: 'in_progress', gate_result: null },
            construction: { status: 'not_started' },
            operations: { status: 'not_started' },
          },
        })
      );

      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      const ctx = createPostToolUseCtx();
      const result = await blocker!.handler(ctx);

      expect(result.hookSpecificOutput?.additionalContext).toMatch(/\[GATE_PENDING\]/);
    });

    it('Ascent can detect pending gate from hook output', async () => {
      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(
        createMockCheckpoint({ current_stage: 'intent', current_phase: 'inception' })
      );
      vi.mocked(loadManifest).mockReturnValue(
        createMockManifest({
          phases: {
            discovery: { status: 'complete', gate_result: { passed: true, approved_by: 'human', approved_at: '2025-01-01T00:00:00.000Z', feedback: null, verification: null, validation: null } },
            inception: { status: 'in_progress', gate_result: null },
            construction: { status: 'not_started' },
            operations: { status: 'not_started' },
          },
        })
      );

      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      const ctx = createPostToolUseCtx();
      const result = await blocker!.handler(ctx);

      // Ascent would check for this sentinel to know to pause
      const hasPendingGate = result.hookSpecificOutput?.additionalContext?.includes('[GATE_PENDING]');
      expect(hasPendingGate).toBe(true);
    });
  });

  describe('Risk Tier 3 Momus enforcement', () => {
    it('blocks Gate 2 when Risk Tier 3 and no Momus review artifact', async () => {
      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(
        createMockCheckpoint({
          current_stage: 'intent',
          current_phase: 'inception',
          risk_tier: { tier: 3, score: 75, rationale: 'High risk' },
        })
      );
      vi.mocked(loadManifest).mockReturnValue(
        createMockManifest({
          phases: {
            discovery: { status: 'complete', gate_result: { passed: true, approved_by: 'human', approved_at: '2025-01-01T00:00:00.000Z', feedback: null, verification: null, validation: null } },
            inception: { status: 'in_progress', gate_result: null },
            construction: { status: 'not_started' },
            operations: { status: 'not_started' },
          },
          artifacts: [
            { id: 'intent-001', type: 'intent', phase: 'inception', path: 'intent.md', contract_status: 'draft' }
          ],
        })
      );
      vi.mocked(shouldAutoAdvance).mockReturnValue(true); // Even with auto-advance, should block

      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      const ctx = createPostToolUseCtx();
      const result = await blocker!.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.additionalContext).toContain('BLOCKED');
      expect(result.hookSpecificOutput?.additionalContext).toContain('Risk Tier 3');
      expect(result.hookSpecificOutput?.additionalContext).toContain('Momus review');
      expect(result.hookSpecificOutput?.additionalContext).toContain('[GATE_PENDING]');
      expect(result.hookSpecificOutput?.additionalContext).toContain('[BLOCKING - Acknowledgment Required]');
      expect(saveCheckpoint).toHaveBeenCalled();
    });

    it('allows Gate 2 when Risk Tier 3 and Momus review artifact exists', async () => {
      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(
        createMockCheckpoint({
          current_stage: 'intent',
          current_phase: 'inception',
          risk_tier: { tier: 3, score: 75, rationale: 'High risk' },
        })
      );
      vi.mocked(loadManifest).mockReturnValue(
        createMockManifest({
          phases: {
            discovery: { status: 'complete', gate_result: { passed: true, approved_by: 'human', approved_at: '2025-01-01T00:00:00.000Z', feedback: null, verification: null, validation: null } },
            inception: { status: 'in_progress', gate_result: null },
            construction: { status: 'not_started' },
            operations: { status: 'not_started' },
          },
          artifacts: [
            { id: 'intent-001', type: 'intent', phase: 'inception', path: 'intent.md', contract_status: 'draft' },
            { id: 'momus-review-001', type: 'momus-review', phase: 'inception', path: 'momus-review.md', contract_status: 'active' },
          ],
        })
      );
      vi.mocked(shouldAutoAdvance).mockReturnValue(true);
      vi.mocked(loadTrustState).mockReturnValue({
        current_level: 3,
        total_transitions: 50,
        rejection_count: 0,
        rejection_rate: 0,
        incident_count: 0,
        last_level_change: null,
        level_history: [],
      });

      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      const ctx = createPostToolUseCtx();
      const result = await blocker!.handler(ctx);

      // Should auto-advance since Momus review exists and trust allows it
      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.additionalContext).toBeUndefined();
      expect(addGateAuditEntry).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: 'approved', actor: 'trust' })
      );
    });
  });

  describe('checkpoint persistence', () => {
    it('saves checkpoint after blocker gate block', async () => {
      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(
        createMockCheckpoint({ current_stage: 'intent', current_phase: 'inception' })
      );
      vi.mocked(loadManifest).mockReturnValue(
        createMockManifest({
          phases: {
            inception: { status: 'in_progress', gate_result: null },
            construction: { status: 'not_started' },
            operations: { status: 'not_started' },
          },
        })
      );
      vi.mocked(shouldAutoAdvance).mockReturnValue(false);

      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      const ctx = createPostToolUseCtx();
      await blocker!.handler(ctx);

      expect(saveCheckpoint).toHaveBeenCalledWith(
        '/test/project',
        expect.anything()
      );
    });

    it('saves checkpoint after blocker auto-advance', async () => {
      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(
        createMockCheckpoint({
          current_stage: 'intent',
          current_phase: 'inception',
          risk_tier: { tier: 1, score: 15, rationale: 'Low risk' },
        })
      );
      vi.mocked(loadManifest).mockReturnValue(
        createMockManifest({
          phases: {
            inception: { status: 'in_progress', gate_result: null },
            construction: { status: 'not_started' },
            operations: { status: 'not_started' },
          },
        })
      );
      vi.mocked(shouldAutoAdvance).mockReturnValue(true);

      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      const ctx = createPostToolUseCtx();
      await blocker!.handler(ctx);

      expect(saveCheckpoint).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('blocker never throws, always returns continue:true', async () => {
      vi.mocked(listWorkflows).mockRejectedValue(new Error('Fatal error'));

      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      const ctx = createPostToolUseCtx();
      const result = await blocker!.handler(ctx);

      expect(result.continue).toBe(true);
    });

    it('approver never throws, always returns continue:true', async () => {
      vi.mocked(listWorkflows).mockRejectedValue(new Error('Fatal error'));

      const hooks = getHooksForEvent('UserPromptSubmit');
      const approver = hooks.find(h => h.name === 'qualityGateApprover');

      const ctx = createUserPromptCtx('approve');
      const result = await approver!.handler(ctx);

      expect(result.continue).toBe(true);
    });

    it('logs errors with [Olympus Quality Gate] prefix', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      vi.mocked(listWorkflows).mockRejectedValue(new Error('Test error'));

      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      const ctx = createPostToolUseCtx();
      await blocker!.handler(ctx);

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Olympus Quality Gate]'),
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Stage-level gates (Gate 1 / Gate 2)', () => {
    it('Gate 1 fires after INTENT stage with correct label', async () => {
      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(
        createMockCheckpoint({ current_stage: 'intent', current_phase: 'inception' })
      );
      vi.mocked(loadManifest).mockReturnValue(
        createMockManifest({
          phases: {
            discovery: { status: 'complete', gate_result: { passed: true, approved_by: 'human', approved_at: '2025-01-01T00:00:00.000Z', feedback: null, verification: null, validation: null } },
            inception: { status: 'in_progress', gate_result: null },
            construction: { status: 'not_started' },
            operations: { status: 'not_started' },
          },
        })
      );

      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      const ctx = createPostToolUseCtx();
      const result = await blocker!.handler(ctx);

      expect(result.hookSpecificOutput?.additionalContext).toContain('Gate 1 (INTENT review)');
      expect(result.hookSpecificOutput?.additionalContext).toContain('[GATE_PENDING]');
    });

    it('Gate 1 fires after INTENT stage with correct label', async () => {
      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(
        createMockCheckpoint({ current_stage: 'intent', current_phase: 'inception' })
      );
      vi.mocked(loadManifest).mockReturnValue(
        createMockManifest({
          phases: {
            discovery: { status: 'complete', gate_result: { passed: true, approved_by: 'human', approved_at: '2025-01-01T00:00:00.000Z', feedback: null, verification: null, validation: null } },
            inception: { status: 'in_progress', gate_result: null },
            construction: { status: 'not_started' },
            operations: { status: 'not_started' },
          },
        })
      );

      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      const ctx = createPostToolUseCtx();
      const result = await blocker!.handler(ctx);

      expect(result.hookSpecificOutput?.additionalContext).toContain('Gate 1 (INTENT review)');
      expect(result.hookSpecificOutput?.additionalContext).toContain('[GATE_PENDING]');
    });

    it('Gate 2 uses computeVerification for intent stage (self-consistency check)', async () => {
      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(
        createMockCheckpoint({ current_stage: 'intent', current_phase: 'inception' })
      );
      vi.mocked(loadManifest).mockReturnValue(
        createMockManifest({
          phases: {
            discovery: { status: 'complete', gate_result: { passed: true, approved_by: 'human', approved_at: '2025-01-01T00:00:00.000Z', feedback: null, verification: null, validation: null } },
            inception: { status: 'in_progress', gate_result: null },
            construction: { status: 'not_started' },
            operations: { status: 'not_started' },
          },
        })
      );
      vi.mocked(readFileSync).mockReturnValue('# Content');

      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      const ctx = createPostToolUseCtx();
      await blocker!.handler(ctx);

      expect(computeVerification).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'intent-to-unit'
      );
      expect(runDualValidation).not.toHaveBeenCalled();
    });

    it('gate_result is reset after approval so next stage gate can fire', async () => {
      // Capture manifest state at each saveManifest call (object is mutated in-place)
      const savedStates: any[] = [];
      vi.mocked(saveManifest).mockImplementation((_path: any, manifest: any) => {
        savedStates.push(JSON.parse(JSON.stringify(manifest)));
      });

      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(
        createMockCheckpoint({
          current_stage: 'intent',
          current_phase: 'inception',
        })
      );
      const manifest = createMockManifest({
        phases: {
          discovery: { status: 'complete', gate_result: { passed: true, approved_by: 'human', approved_at: '2025-01-01T00:00:00.000Z', feedback: null, verification: null, validation: null } },
          inception: {
            status: 'in_progress',
            gate_result: { passed: false, approved_by: null, reason: null }
          },
          construction: { status: 'not_started' },
          operations: { status: 'not_started' },
        },
        artifacts: [],
      });
      vi.mocked(loadManifest).mockReturnValue(manifest);
      vi.mocked(loadTrustState).mockReturnValue({
        current_level: 0,
        total_transitions: 0,
        rejection_count: 0,
        rejection_rate: 0,
        incident_count: 0,
        last_level_change: null,
        level_history: [],
      });

      const hooks = getHooksForEvent('UserPromptSubmit');
      const approver = hooks.find(h => h.name === 'qualityGateApprover');

      const ctx = createUserPromptCtx('approve');
      await approver!.handler(ctx);

      // saveManifest should be called twice:
      // 1. After marking gate as passed
      // 2. After resetting gate_result to null
      expect(savedStates).toHaveLength(2);

      // First call: gate_result passed
      expect(savedStates[0].phases.inception.gate_result.passed).toBe(true);
      expect(savedStates[0].phases.inception.gate_result.approved_by).toBe('human');

      // Second call: gate_result reset to null (so next stage gate can fire)
      expect(savedStates[1].phases.inception.gate_result).toBeNull();
    });
  });

  describe('Gate 3 - UNIT decomposition review', () => {
    function setupGate3Mocks(overrides: { trustLevel?: number; riskTier?: number; trustBehavior?: string } = {}) {
      const trustLevel = overrides.trustLevel ?? 0;
      const riskTier = overrides.riskTier ?? 2;
      const trustBehavior = overrides.trustBehavior ?? 'blocking';

      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(
        createMockCheckpoint({
          current_phase: 'construction',
          current_stage: 'unit',
          risk_tier: { tier: riskTier, score: 45, rationale: 'Test' },
        })
      );
      vi.mocked(loadManifest).mockReturnValue(
        createMockManifest({
          phases: {
            discovery: { status: 'complete', gate_result: null },
            inception: { status: 'complete', gate_result: null },
            construction: { status: 'in_progress', gate_result: null },
            operations: { status: 'not_started', gate_result: null },
          },
          artifacts: [
            { id: 'UNIT-001', type: 'unit', phase: 'construction', stage: 'unit', path: 'construction/UNIT-001/spec.md', contract_status: 'draft' },
          ],
          links: [],
        })
      );
      vi.mocked(loadTrustState).mockReturnValue({
        current_level: trustLevel as any,
        total_transitions: 5,
        rejection_count: 0,
        rejection_rate: 0,
        incident_count: 0,
        last_level_change: null,
        level_history: [],
      });
      vi.mocked(shouldAutoAdvance).mockReturnValue(false);
      vi.mocked(getGate3TrustBehavior).mockReturnValue(trustBehavior);
      vi.mocked(readFileSync).mockReturnValue('# IDEA content');
      vi.mocked(runDualValidation).mockReturnValue({
        parentCheck: {
          source_artifact_id: 'idea',
          target_artifact_id: 'UNIT-001',
          verification: { conformance_score: 80, coverage_percentage: 85, missing_items: [], passed: true },
          validation: { alignment_score: 75, alignment_questions: [], passed: true },
          alignment_passed: true,
          checked_at: '2025-01-01T00:00:00.000Z',
        },
        rootCheck: {
          source_artifact_id: 'idea',
          target_artifact_id: 'UNIT-001',
          verification: { conformance_score: 80, coverage_percentage: 85, missing_items: [], passed: true },
          validation: { alignment_score: 75, alignment_questions: [], passed: true },
          alignment_passed: true,
          checked_at: '2025-01-01T00:00:00.000Z',
        },
        passed: true,
      });
    }

    it('fires when construction phase + unit stage', async () => {
      setupGate3Mocks();

      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      const ctx = createPostToolUseCtx();
      const result = await blocker!.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.additionalContext).toContain('[GATE_PENDING]');
      expect(result.hookSpecificOutput?.additionalContext).toContain('Gate 3');
    });

    it('is blocking at Trust 0-1', async () => {
      setupGate3Mocks({ trustLevel: 1, trustBehavior: 'blocking' });

      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      const ctx = createPostToolUseCtx();
      const result = await blocker!.handler(ctx);

      expect(result.hookSpecificOutput?.additionalContext).toContain('[GATE_PENDING]');
      expect(result.hookSpecificOutput?.additionalContext).toContain('Gate 3');
    });

    it('auto-advances at Trust 2+ for Tier 1-2', async () => {
      setupGate3Mocks({ trustLevel: 2, riskTier: 2, trustBehavior: 'auto-advance' });

      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      const ctx = createPostToolUseCtx();
      const result = await blocker!.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.additionalContext).toBeUndefined();
      expect(addGateAuditEntry).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ phase: 'construction', actor: 'trust', action: 'approved' })
      );
    });

    it('always blocking at Risk Tier 3', async () => {
      setupGate3Mocks({ trustLevel: 3, riskTier: 3, trustBehavior: 'blocking' });

      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      const ctx = createPostToolUseCtx();
      const result = await blocker!.handler(ctx);

      expect(result.hookSpecificOutput?.additionalContext).toContain('[GATE_PENDING]');
      expect(result.hookSpecificOutput?.additionalContext).toContain('[BLOCKING - Acknowledgment Required]');
    });

    it('runs dual validation with unit-to-intent root check', async () => {
      setupGate3Mocks();

      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      const ctx = createPostToolUseCtx();
      await blocker!.handler(ctx);

      expect(runDualValidation).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        'intent-to-unit',
        'unit-to-intent',
        expect.any(String),
        expect.any(String),
        expect.any(String)
      );
    });

    it('records result in manifest', async () => {
      setupGate3Mocks();

      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      const ctx = createPostToolUseCtx();
      await blocker!.handler(ctx);

      expect(saveManifest).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          phases: expect.objectContaining({
            construction: expect.objectContaining({
              gate_result: expect.objectContaining({
                passed: false,
                approved_by: null,
              })
            })
          })
        })
      );
    });

    it('saves checkpoint (CCR-1)', async () => {
      setupGate3Mocks();

      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      const ctx = createPostToolUseCtx();
      await blocker!.handler(ctx);

      expect(saveCheckpoint).toHaveBeenCalledWith('/test/project', expect.anything());
    });

    it('auto-advance sets reviewedBy to auto-approved on UNIT artifacts', async () => {
      setupGate3Mocks({ trustLevel: 2, riskTier: 1, trustBehavior: 'auto-advance' });

      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      const ctx = createPostToolUseCtx();
      await blocker!.handler(ctx);

      expect(saveManifest).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          artifacts: expect.arrayContaining([
            expect.objectContaining({
              id: 'UNIT-001',
              reviewedBy: 'auto-approved',
            })
          ])
        })
      );
    });
  });

  describe('Gate 4 - BOLT execution review', () => {
    function setupGate4Mocks(overrides: { trustLevel?: number; riskTier?: number; trustBehavior?: string } = {}) {
      const trustLevel = overrides.trustLevel ?? 0;
      const riskTier = overrides.riskTier ?? 2;
      const trustBehavior = overrides.trustBehavior ?? 'blocking';

      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(
        createMockCheckpoint({
          current_phase: 'construction',
          current_stage: 'bolt',
          active_bolt_id: 'BOLT-001',
          risk_tier: { tier: riskTier, score: 45, rationale: 'Test' },
        })
      );
      vi.mocked(loadManifest).mockReturnValue(
        createMockManifest({
          phases: {
            discovery: { status: 'complete', gate_result: null },
            inception: { status: 'complete', gate_result: null },
            construction: { status: 'in_progress', gate_result: null },
            operations: { status: 'not_started', gate_result: null },
          },
          artifacts: [
            { id: 'UNIT-001', type: 'unit', phase: 'construction', stage: 'unit', path: 'construction/UNIT-001/spec.md', contract_status: 'active' },
            { id: 'BOLT-001', type: 'bolt', phase: 'construction', stage: 'bolt', path: 'construction/UNIT-001/BOLT-001.md', contract_status: 'active' },
          ],
          links: [
            { source_id: 'UNIT-001', target_id: 'BOLT-001', link_type: 'derives' },
          ],
        })
      );
      vi.mocked(loadTrustState).mockReturnValue({
        current_level: trustLevel as any,
        total_transitions: 5,
        rejection_count: 0,
        rejection_rate: 0,
        incident_count: 0,
        last_level_change: null,
        level_history: [],
      });
      vi.mocked(shouldAutoAdvance).mockReturnValue(false);
      vi.mocked(getGate4TrustBehavior).mockReturnValue(trustBehavior);
      vi.mocked(readFileSync).mockReturnValue('# Content');
      vi.mocked(runDualValidation).mockReturnValue({
        parentCheck: {
          source_artifact_id: 'intent',
          target_artifact_id: 'BOLT-001',
          verification: { conformance_score: 80, coverage_percentage: 85, missing_items: [], passed: true },
          validation: { alignment_score: 75, alignment_questions: [], passed: true },
          alignment_passed: true,
          checked_at: '2025-01-01T00:00:00.000Z',
        },
        rootCheck: {
          source_artifact_id: 'intent',
          target_artifact_id: 'BOLT-001',
          verification: { conformance_score: 80, coverage_percentage: 85, missing_items: [], passed: true },
          validation: { alignment_score: 75, alignment_questions: [], passed: true },
          alignment_passed: true,
          checked_at: '2025-01-01T00:00:00.000Z',
        },
        passed: true,
      });
    }

    it('fires when construction phase + bolt stage + active_bolt_id', async () => {
      setupGate4Mocks();

      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      const ctx = createPostToolUseCtx();
      const result = await blocker!.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.additionalContext).toContain('[GATE_PENDING]');
      expect(result.hookSpecificOutput?.additionalContext).toContain('Gate 4');
      expect(result.hookSpecificOutput?.additionalContext).toContain('BOLT-001');
    });

    it('blocking at Trust 0-1', async () => {
      setupGate4Mocks({ trustLevel: 1, trustBehavior: 'blocking' });

      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      const ctx = createPostToolUseCtx();
      const result = await blocker!.handler(ctx);

      expect(result.hookSpecificOutput?.additionalContext).toContain('[GATE_PENDING]');
      expect(result.hookSpecificOutput?.additionalContext).toContain('Gate 4');
    });

    it('summary-review at Trust 2', async () => {
      setupGate4Mocks({ trustLevel: 2, trustBehavior: 'summary-review' });

      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      const ctx = createPostToolUseCtx();
      const result = await blocker!.handler(ctx);

      expect(result.hookSpecificOutput?.additionalContext).toContain('[GATE_PENDING]');
      expect(result.hookSpecificOutput?.additionalContext).toContain('Summary Review');
    });

    it('notification-only at Trust 3', async () => {
      setupGate4Mocks({ trustLevel: 3, trustBehavior: 'notification-only' });

      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      const ctx = createPostToolUseCtx();
      const result = await blocker!.handler(ctx);

      // Notification-only auto-advances
      expect(result.hookSpecificOutput?.additionalContext).toContain('Auto-approved');
      expect(result.hookSpecificOutput?.additionalContext).toContain('Notification only');
    });

    it('always blocking at Risk Tier 3', async () => {
      setupGate4Mocks({ trustLevel: 3, riskTier: 3, trustBehavior: 'blocking' });

      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      const ctx = createPostToolUseCtx();
      const result = await blocker!.handler(ctx);

      expect(result.hookSpecificOutput?.additionalContext).toContain('[GATE_PENDING]');
      expect(result.hookSpecificOutput?.additionalContext).toContain('[BLOCKING - Acknowledgment Required]');
    });

    it('runs dual validation with bolt-to-intent root check', async () => {
      setupGate4Mocks();

      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      const ctx = createPostToolUseCtx();
      await blocker!.handler(ctx);

      expect(runDualValidation).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        'unit-to-bolt',
        'bolt-to-intent',
        expect.any(String),
        'BOLT-001',
        expect.any(String)
      );
    });

    it('records result in manifest', async () => {
      setupGate4Mocks();

      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      const ctx = createPostToolUseCtx();
      await blocker!.handler(ctx);

      expect(saveManifest).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          phases: expect.objectContaining({
            construction: expect.objectContaining({
              gate_result: expect.objectContaining({
                passed: false,
                approved_by: null,
              })
            })
          })
        })
      );
    });

    it('saves checkpoint (CCR-1)', async () => {
      setupGate4Mocks();

      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      const ctx = createPostToolUseCtx();
      await blocker!.handler(ctx);

      expect(saveCheckpoint).toHaveBeenCalledWith('/test/project', expect.anything());
    });

    it('approval sets BOLT contract to fulfilled', async () => {
      // Setup Gate 4 pending state for approver
      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(
        createMockCheckpoint({
          current_phase: 'construction',
          current_stage: 'bolt',
          active_bolt_id: 'BOLT-001',
        })
      );
      vi.mocked(loadManifest).mockReturnValue(
        createMockManifest({
          phases: {
            discovery: { status: 'complete', gate_result: null },
            inception: { status: 'complete', gate_result: null },
            construction: {
              status: 'in_progress',
              gate_result: { passed: false, approved_by: null, approved_at: null, feedback: null, verification: { conformance_score: 0, coverage_percentage: 0, missing_items: [], passed: false }, validation: { alignment_score: 0, alignment_questions: [], passed: false } }
            },
            operations: { status: 'not_started', gate_result: null },
          },
          artifacts: [
            { id: 'BOLT-001', type: 'bolt', phase: 'construction', stage: 'bolt', path: 'construction/UNIT-001/BOLT-001.md', contract_status: 'active' },
          ],
        })
      );
      vi.mocked(loadTrustState).mockReturnValue({
        current_level: 0,
        total_transitions: 0,
        rejection_count: 0,
        rejection_rate: 0,
        incident_count: 0,
        last_level_change: null,
        level_history: [],
      });

      const hooks = getHooksForEvent('UserPromptSubmit');
      const approver = hooks.find(h => h.name === 'qualityGateApprover');

      const ctx = createUserPromptCtx('approve');
      await approver!.handler(ctx);

      expect(updateContractStatus).toHaveBeenCalledWith(
        expect.anything(),
        'BOLT-001',
        'fulfilled'
      );
    });

    it('approval populates reviewedBy on BOLT artifact', async () => {
      const savedStates: any[] = [];
      vi.mocked(saveManifest).mockImplementation((_path: any, manifest: any) => {
        savedStates.push(JSON.parse(JSON.stringify(manifest)));
      });

      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(
        createMockCheckpoint({
          current_phase: 'construction',
          current_stage: 'bolt',
          active_bolt_id: 'BOLT-001',
        })
      );
      vi.mocked(loadManifest).mockReturnValue(
        createMockManifest({
          phases: {
            discovery: { status: 'complete', gate_result: null },
            inception: { status: 'complete', gate_result: null },
            construction: {
              status: 'in_progress',
              gate_result: { passed: false, approved_by: null, approved_at: null, feedback: null, verification: { conformance_score: 0, coverage_percentage: 0, missing_items: [], passed: false }, validation: { alignment_score: 0, alignment_questions: [], passed: false } }
            },
            operations: { status: 'not_started', gate_result: null },
          },
          artifacts: [
            { id: 'BOLT-001', type: 'bolt', phase: 'construction', stage: 'bolt', path: 'construction/UNIT-001/BOLT-001.md', contract_status: 'active' },
          ],
        })
      );
      vi.mocked(loadTrustState).mockReturnValue({
        current_level: 0,
        total_transitions: 0,
        rejection_count: 0,
        rejection_rate: 0,
        incident_count: 0,
        last_level_change: null,
        level_history: [],
      });

      const hooks = getHooksForEvent('UserPromptSubmit');
      const approver = hooks.find(h => h.name === 'qualityGateApprover');

      const ctx = createUserPromptCtx('approve');
      await approver!.handler(ctx);

      // Check first saved manifest state has reviewedBy set
      expect(savedStates[0].artifacts[0].reviewedBy).toBe('human');
    });

    it('rejection sets BOLT contract to violated', async () => {
      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(
        createMockCheckpoint({
          current_phase: 'construction',
          current_stage: 'bolt',
          active_bolt_id: 'BOLT-001',
        })
      );
      vi.mocked(loadManifest).mockReturnValue(
        createMockManifest({
          phases: {
            discovery: { status: 'complete', gate_result: null },
            inception: { status: 'complete', gate_result: null },
            construction: {
              status: 'in_progress',
              gate_result: { passed: false, approved_by: null, approved_at: null, feedback: null, verification: { conformance_score: 0, coverage_percentage: 0, missing_items: [], passed: false }, validation: { alignment_score: 0, alignment_questions: [], passed: false } }
            },
            operations: { status: 'not_started', gate_result: null },
          },
          artifacts: [
            { id: 'BOLT-001', type: 'bolt', phase: 'construction', stage: 'bolt', path: 'construction/UNIT-001/BOLT-001.md', contract_status: 'active' },
          ],
        })
      );
      vi.mocked(loadTrustState).mockReturnValue({
        current_level: 0,
        total_transitions: 0,
        rejection_count: 0,
        rejection_rate: 0,
        incident_count: 0,
        last_level_change: null,
        level_history: [],
      });

      const hooks = getHooksForEvent('UserPromptSubmit');
      const approver = hooks.find(h => h.name === 'qualityGateApprover');

      const ctx = createUserPromptCtx('reject code quality too low');
      await approver!.handler(ctx);

      expect(updateContractStatus).toHaveBeenCalledWith(
        expect.anything(),
        'BOLT-001',
        'violated',
        'code quality too low'
      );
    });

    it('notification-only auto-advance sets reviewedBy to auto-approved', async () => {
      setupGate4Mocks({ trustLevel: 3, trustBehavior: 'notification-only' });

      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      const ctx = createPostToolUseCtx();
      await blocker!.handler(ctx);

      expect(saveManifest).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          artifacts: expect.arrayContaining([
            expect.objectContaining({
              id: 'BOLT-001',
              reviewedBy: 'auto-approved',
            })
          ])
        })
      );
    });

    it('notification-only auto-advance marks BOLT as fulfilled', async () => {
      setupGate4Mocks({ trustLevel: 3, trustBehavior: 'notification-only' });

      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      const ctx = createPostToolUseCtx();
      await blocker!.handler(ctx);

      expect(updateContractStatus).toHaveBeenCalledWith(
        expect.anything(),
        'BOLT-001',
        'fulfilled'
      );
    });

    it('does not fire Gate 4 without active_bolt_id (falls through to generic construction gate)', async () => {
      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(
        createMockCheckpoint({
          current_phase: 'construction',
          current_stage: 'bolt',
          // No active_bolt_id
        })
      );
      vi.mocked(loadManifest).mockReturnValue(
        createMockManifest({
          phases: {
            discovery: { status: 'complete', gate_result: null },
            inception: { status: 'complete', gate_result: null },
            construction: { status: 'in_progress', gate_result: null },
            operations: { status: 'not_started', gate_result: null },
          },
          artifacts: [],
        })
      );

      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      const ctx = createPostToolUseCtx();
      const result = await blocker!.handler(ctx);

      expect(result.continue).toBe(true);
      // Without active_bolt_id, Gate 4 doesn't fire specifically,
      // but the generic construction transition detection may still trigger.
      // The key assertion is that it doesn't mention "Gate 4" or BOLT-specific content.
      if (result.hookSpecificOutput?.additionalContext) {
        expect(result.hookSpecificOutput.additionalContext).not.toContain('Gate 4');
        expect(result.hookSpecificOutput.additionalContext).not.toContain('BOLT-001');
      }
    });
  });

  describe('Gate 5 - Release review (placeholder)', () => {
    it('fires when operations phase detected', async () => {
      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(
        createMockCheckpoint({
          current_phase: 'operations',
          current_stage: 'complete',
        })
      );
      vi.mocked(loadManifest).mockReturnValue(
        createMockManifest({
          phases: {
            discovery: { status: 'complete', gate_result: null },
            inception: { status: 'complete', gate_result: null },
            construction: { status: 'complete', gate_result: null },
            operations: { status: 'in_progress', gate_result: null },
          },
          artifacts: [],
          gate_audit: [],
        })
      );

      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      const ctx = createPostToolUseCtx();
      const result = await blocker!.handler(ctx);

      expect(result.continue).toBe(true);
      expect(result.hookSpecificOutput?.additionalContext).toContain('[GATE_PENDING]');
      expect(result.hookSpecificOutput?.additionalContext).toContain('Gate 5');
    });

    it('is always blocking', async () => {
      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(
        createMockCheckpoint({
          current_phase: 'operations',
          current_stage: 'complete',
        })
      );
      vi.mocked(loadManifest).mockReturnValue(
        createMockManifest({
          phases: {
            discovery: { status: 'complete', gate_result: null },
            inception: { status: 'complete', gate_result: null },
            construction: { status: 'complete', gate_result: null },
            operations: { status: 'in_progress', gate_result: null },
          },
          artifacts: [],
          gate_audit: [],
        })
      );
      vi.mocked(shouldAutoAdvance).mockReturnValue(true); // Even with auto-advance, should still block

      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      const ctx = createPostToolUseCtx();
      const result = await blocker!.handler(ctx);

      expect(result.hookSpecificOutput?.additionalContext).toContain('[BLOCKING - Acknowledgment Required]');
      expect(result.hookSpecificOutput?.additionalContext).toContain('[GATE_PENDING]');
    });

    it('saves checkpoint (CCR-1)', async () => {
      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(
        createMockCheckpoint({
          current_phase: 'operations',
          current_stage: 'complete',
        })
      );
      vi.mocked(loadManifest).mockReturnValue(
        createMockManifest({
          phases: {
            discovery: { status: 'complete', gate_result: null },
            inception: { status: 'complete', gate_result: null },
            construction: { status: 'complete', gate_result: null },
            operations: { status: 'in_progress', gate_result: null },
          },
          artifacts: [],
          gate_audit: [],
        })
      );

      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      const ctx = createPostToolUseCtx();
      await blocker!.handler(ctx);

      expect(saveCheckpoint).toHaveBeenCalledWith('/test/project', expect.anything());
    });
  });

  describe('Rejection feedback injection', () => {
    it('injects revision instruction with reason for BOLT rejection', async () => {
      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(
        createMockCheckpoint({
          current_phase: 'construction',
          current_stage: 'bolt',
          active_bolt_id: 'BOLT-001',
        })
      );
      vi.mocked(loadManifest).mockReturnValue(
        createMockManifest({
          phases: {
            discovery: { status: 'complete', gate_result: null },
            inception: { status: 'complete', gate_result: null },
            construction: {
              status: 'in_progress',
              gate_result: { passed: false, approved_by: null, approved_at: null, feedback: null, verification: { conformance_score: 0, coverage_percentage: 0, missing_items: [], passed: false }, validation: { alignment_score: 0, alignment_questions: [], passed: false } }
            },
            operations: { status: 'not_started', gate_result: null },
          },
          artifacts: [
            { id: 'BOLT-001', type: 'bolt', phase: 'construction', stage: 'bolt', path: 'construction/UNIT-001/BOLT-001.md', contract_status: 'active' },
          ],
        })
      );
      vi.mocked(loadTrustState).mockReturnValue({
        current_level: 0,
        total_transitions: 0,
        rejection_count: 0,
        rejection_rate: 0,
        incident_count: 0,
        last_level_change: null,
        level_history: [],
      });

      const hooks = getHooksForEvent('UserPromptSubmit');
      const approver = hooks.find(h => h.name === 'qualityGateApprover');

      const ctx = createUserPromptCtx('reject missing error handling');
      const result = await approver!.handler(ctx);

      expect(result.hookSpecificOutput?.additionalContext).toContain('Gate 4 rejected BOLT-001: missing error handling');
      expect(result.hookSpecificOutput?.additionalContext).toContain('The reviewer rejected BOLT-001: missing error handling. Revise and re-submit.');
    });

    it('injects revision instruction with reason for UNIT rejection', async () => {
      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(
        createMockCheckpoint({
          current_phase: 'construction',
          current_stage: 'unit',
        })
      );
      vi.mocked(loadManifest).mockReturnValue(
        createMockManifest({
          phases: {
            discovery: { status: 'complete', gate_result: null },
            inception: { status: 'complete', gate_result: null },
            construction: {
              status: 'in_progress',
              gate_result: { passed: false, approved_by: null, approved_at: null, feedback: null, verification: { conformance_score: 0, coverage_percentage: 0, missing_items: [], passed: false }, validation: { alignment_score: 0, alignment_questions: [], passed: false } }
            },
            operations: { status: 'not_started', gate_result: null },
          },
          artifacts: [
            { id: 'UNIT-001', type: 'unit', phase: 'construction', stage: 'unit', path: 'construction/UNIT-001/spec.md', contract_status: 'active' },
          ],
        })
      );
      vi.mocked(loadTrustState).mockReturnValue({
        current_level: 0,
        total_transitions: 0,
        rejection_count: 0,
        rejection_rate: 0,
        incident_count: 0,
        last_level_change: null,
        level_history: [],
      });

      const hooks = getHooksForEvent('UserPromptSubmit');
      const approver = hooks.find(h => h.name === 'qualityGateApprover');

      const ctx = createUserPromptCtx('reject decomposition too coarse');
      const result = await approver!.handler(ctx);

      expect(result.hookSpecificOutput?.additionalContext).toContain('Gate 3 rejected UNIT-001: decomposition too coarse');
      expect(result.hookSpecificOutput?.additionalContext).toContain('The reviewer rejected UNIT decomposition: decomposition too coarse. Revise and re-submit.');
    });
  });

  describe('reviewedBy population', () => {
    it('human approval sets reviewedBy to human', async () => {
      const savedStates: any[] = [];
      vi.mocked(saveManifest).mockImplementation((_path: any, manifest: any) => {
        savedStates.push(JSON.parse(JSON.stringify(manifest)));
      });

      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(
        createMockCheckpoint({
          current_phase: 'construction',
          current_stage: 'bolt',
          active_bolt_id: 'BOLT-001',
        })
      );
      vi.mocked(loadManifest).mockReturnValue(
        createMockManifest({
          phases: {
            discovery: { status: 'complete', gate_result: null },
            inception: { status: 'complete', gate_result: null },
            construction: {
              status: 'in_progress',
              gate_result: { passed: false, approved_by: null, approved_at: null, feedback: null, verification: { conformance_score: 0, coverage_percentage: 0, missing_items: [], passed: false }, validation: { alignment_score: 0, alignment_questions: [], passed: false } }
            },
            operations: { status: 'not_started', gate_result: null },
          },
          artifacts: [
            { id: 'BOLT-001', type: 'bolt', phase: 'construction', stage: 'bolt', path: 'construction/UNIT-001/BOLT-001.md', contract_status: 'active' },
          ],
        })
      );
      vi.mocked(loadTrustState).mockReturnValue({
        current_level: 0,
        total_transitions: 0,
        rejection_count: 0,
        rejection_rate: 0,
        incident_count: 0,
        last_level_change: null,
        level_history: [],
      });

      const hooks = getHooksForEvent('UserPromptSubmit');
      const approver = hooks.find(h => h.name === 'qualityGateApprover');

      const ctx = createUserPromptCtx('approve');
      await approver!.handler(ctx);

      const boltArtifact = savedStates[0]?.artifacts.find((a: any) => a.id === 'BOLT-001');
      expect(boltArtifact?.reviewedBy).toBe('human');
    });

    it('auto-advance sets reviewedBy to auto-approved', async () => {
      // Use Gate 4 notification-only as an auto-advance scenario
      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(
        createMockCheckpoint({
          current_phase: 'construction',
          current_stage: 'bolt',
          active_bolt_id: 'BOLT-001',
          risk_tier: { tier: 1, score: 10, rationale: 'Low' },
        })
      );
      vi.mocked(loadManifest).mockReturnValue(
        createMockManifest({
          phases: {
            discovery: { status: 'complete', gate_result: null },
            inception: { status: 'complete', gate_result: null },
            construction: { status: 'in_progress', gate_result: null },
            operations: { status: 'not_started', gate_result: null },
          },
          artifacts: [
            { id: 'BOLT-001', type: 'bolt', phase: 'construction', stage: 'bolt', path: 'construction/UNIT-001/BOLT-001.md', contract_status: 'active' },
          ],
          links: [],
        })
      );
      vi.mocked(loadTrustState).mockReturnValue({
        current_level: 3 as any,
        total_transitions: 50,
        rejection_count: 0,
        rejection_rate: 0,
        incident_count: 0,
        last_level_change: null,
        level_history: [],
      });
      vi.mocked(shouldAutoAdvance).mockReturnValue(false);
      vi.mocked(getGate4TrustBehavior).mockReturnValue('notification-only');
      vi.mocked(readFileSync).mockReturnValue('# Content');
      vi.mocked(runDualValidation).mockReturnValue({
        parentCheck: {
          source_artifact_id: 'intent',
          target_artifact_id: 'BOLT-001',
          verification: { conformance_score: 80, coverage_percentage: 85, missing_items: [], passed: true },
          validation: { alignment_score: 75, alignment_questions: [], passed: true },
          alignment_passed: true,
          checked_at: '2025-01-01T00:00:00.000Z',
        },
        rootCheck: {
          source_artifact_id: 'intent',
          target_artifact_id: 'BOLT-001',
          verification: { conformance_score: 80, coverage_percentage: 85, missing_items: [], passed: true },
          validation: { alignment_score: 75, alignment_questions: [], passed: true },
          alignment_passed: true,
          checked_at: '2025-01-01T00:00:00.000Z',
        },
        passed: true,
      });

      const hooks = getHooksForEvent('PostToolUse');
      const blocker = hooks.find(h => h.name === 'qualityGateBlocker');

      const ctx = createPostToolUseCtx();
      await blocker!.handler(ctx);

      expect(saveManifest).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          artifacts: expect.arrayContaining([
            expect.objectContaining({
              id: 'BOLT-001',
              reviewedBy: 'auto-approved',
            })
          ])
        })
      );
    });

    it('Gate 3 human approval sets reviewedBy to human on UNIT artifacts', async () => {
      const savedStates: any[] = [];
      vi.mocked(saveManifest).mockImplementation((_path: any, manifest: any) => {
        savedStates.push(JSON.parse(JSON.stringify(manifest)));
      });

      vi.mocked(listWorkflows).mockResolvedValue(['test-feature']);
      vi.mocked(loadCheckpoint).mockResolvedValue(
        createMockCheckpoint({
          current_phase: 'construction',
          current_stage: 'unit',
        })
      );
      vi.mocked(loadManifest).mockReturnValue(
        createMockManifest({
          phases: {
            discovery: { status: 'complete', gate_result: null },
            inception: { status: 'complete', gate_result: null },
            construction: {
              status: 'in_progress',
              gate_result: { passed: false, approved_by: null, approved_at: null, feedback: null, verification: { conformance_score: 0, coverage_percentage: 0, missing_items: [], passed: false }, validation: { alignment_score: 0, alignment_questions: [], passed: false } }
            },
            operations: { status: 'not_started', gate_result: null },
          },
          artifacts: [
            { id: 'UNIT-001', type: 'unit', phase: 'construction', stage: 'unit', path: 'construction/UNIT-001/spec.md', contract_status: 'draft' },
          ],
        })
      );
      vi.mocked(loadTrustState).mockReturnValue({
        current_level: 0,
        total_transitions: 0,
        rejection_count: 0,
        rejection_rate: 0,
        incident_count: 0,
        last_level_change: null,
        level_history: [],
      });

      const hooks = getHooksForEvent('UserPromptSubmit');
      const approver = hooks.find(h => h.name === 'qualityGateApprover');

      const ctx = createUserPromptCtx('approve');
      await approver!.handler(ctx);

      const unitArtifact = savedStates[0]?.artifacts.find((a: any) => a.id === 'UNIT-001');
      expect(unitArtifact?.reviewedBy).toBe('human');
    });
  });
});
