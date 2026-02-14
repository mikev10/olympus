/**
 * Integration tests for agent-tracking hooks
 * Tests that the PreToolUse hook correctly populates pending_completion when Task tool is invoked
 * Tests BOLT execution detection and tracking
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { registerAgentTrackingHook } from '../../hooks/registrations/agent-tracking.js';
import { routeHook } from '../../hooks/router.js';
import { clearHooks } from '../../hooks/registry.js';
import { loadSessionState } from '../../learning/session-state.js';
import type { HookContext } from '../../hooks/types.js';
import type { WorkflowCheckpointV3 } from '../../features/workflow-engine/phase-types.js';
import type { ManifestSchema } from '../../features/workflow-engine/phase-types.js';

// Mock the checkpoint and manifest functions
vi.mock('../../features/workflow-engine/checkpoint.js', async () => {
  const actual = await vi.importActual('../../features/workflow-engine/checkpoint.js');
  return {
    ...actual,
    listWorkflows: vi.fn(),
    loadCheckpoint: vi.fn(),
  };
});

vi.mock('../../features/workflow-engine/manifest.js', async () => {
  const actual = await vi.importActual('../../features/workflow-engine/manifest.js');
  return {
    ...actual,
    loadManifest: vi.fn(),
    saveManifest: vi.fn(),
  };
});

vi.mock('../../learning/efficiency.js', async () => {
  const actual = await vi.importActual('../../learning/efficiency.js');
  return {
    ...actual,
    recordAgentExecution: vi.fn(),
  };
});

const TEST_DIR = join(process.cwd(), '.test-agent-tracking');
const TEST_LEARNING_DIR = join(TEST_DIR, '.claude', 'olympus', 'learning');

describe('Agent Tracking Integration', () => {
  beforeEach(() => {
    // Create test directory
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }
    // Create .olympus subdirectory for session state
    const olympusDir = join(TEST_DIR, '.olympus');
    if (!existsSync(olympusDir)) {
      mkdirSync(olympusDir, { recursive: true });
    }
    // Create learning directory
    mkdirSync(TEST_LEARNING_DIR, { recursive: true });

    // Override learning directory to use test directory
    process.env.OLYMPUS_TEST_LEARNING_DIR = TEST_LEARNING_DIR;
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

  it('should populate pending_completion when Task tool is invoked', async () => {
    // Register hooks
    registerAgentTrackingHook();

    const sessionId = 'test-session-at-1';

    // Create PreToolUse HookContext with Task tool
    const ctx: HookContext = {
      sessionId,
      directory: TEST_DIR,
      toolName: 'Task',
      toolInput: {
        subagent_type: 'olympian',
        prompt: 'Fix the login bug in auth.ts',
      },
    };

    // Route the hook
    await routeHook('PreToolUse', ctx);

    // Load session state
    const state = loadSessionState(TEST_DIR, sessionId);

    // Assert: pending_completion is not null
    expect(state.pending_completion).not.toBeNull();
    expect(state.pending_completion).toBeDefined();

    // Assert: task_description matches the prompt
    expect(state.pending_completion!.task_description).toBe('Fix the login bug in auth.ts');

    // Assert: agent_used matches the subagent_type
    expect(state.pending_completion!.agent_used).toBe('olympian');

    // Assert: claimed_at is defined
    expect(state.pending_completion!.claimed_at).toBeDefined();
    expect(typeof state.pending_completion!.claimed_at).toBe('string');
  });

  it('should skip non-Task tools', async () => {
    // Register hooks
    registerAgentTrackingHook();

    const sessionId = 'test-session-at-2';

    // Create context with toolName: 'Read' (not Task)
    const ctx: HookContext = {
      sessionId,
      directory: TEST_DIR,
      toolName: 'Read',
      toolInput: {
        file_path: '/some/path.ts',
      },
    };

    // Route the hook
    await routeHook('PreToolUse', ctx);

    // Load state and verify pending_completion is null
    const state = loadSessionState(TEST_DIR, sessionId);
    expect(state.pending_completion).toBeNull();
  });

  it('should track agent in agents_used array', async () => {
    // Register hooks
    registerAgentTrackingHook();

    const sessionId = 'test-session-at-3';

    // Create context for Task tool with subagent_type: 'explore'
    const ctx: HookContext = {
      sessionId,
      directory: TEST_DIR,
      toolName: 'Task',
      toolInput: {
        subagent_type: 'explore',
        prompt: 'Find all TypeScript files in the src directory',
      },
    };

    // Route the hook
    await routeHook('PreToolUse', ctx);

    // Load state and verify agents_used includes 'explore'
    const state = loadSessionState(TEST_DIR, sessionId);
    expect(state.token_budget).toBeDefined();
    expect(state.token_budget!.agents_used).toBeDefined();
    expect(state.token_budget!.agents_used).toContain('explore');
  });

  it('should handle missing toolInput gracefully', async () => {
    // Register hooks
    registerAgentTrackingHook();

    const sessionId = 'test-session-at-4';

    // Create context with toolName: 'Task' but no toolInput
    const ctx: HookContext = {
      sessionId,
      directory: TEST_DIR,
      toolName: 'Task',
      // No toolInput
    };

    // Route the hook - should not throw
    const result = await routeHook('PreToolUse', ctx);
    expect(result.continue).toBe(true);

    // Verify no errors thrown, pending_completion is null
    const state = loadSessionState(TEST_DIR, sessionId);
    expect(state.pending_completion).toBeNull();
  });
});

describe('Agent Tracking - BOLT Execution', () => {
  beforeEach(() => {
    // Create test directory
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }
    // Create .olympus subdirectory for session state
    const olympusDir = join(TEST_DIR, '.olympus');
    if (!existsSync(olympusDir)) {
      mkdirSync(olympusDir, { recursive: true });
    }
    // Create learning directory
    mkdirSync(TEST_LEARNING_DIR, { recursive: true });

    // Override learning directory to use test directory
    process.env.OLYMPUS_TEST_LEARNING_DIR = TEST_LEARNING_DIR;

    // Clear all mocks
    vi.clearAllMocks();
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

  it('should detect BOLT execution from prompt signature', async () => {
    // Import mocked functions
    const { listWorkflows, loadCheckpoint } = await import('../../features/workflow-engine/checkpoint.js');
    const { loadManifest, saveManifest } = await import('../../features/workflow-engine/manifest.js');

    // Setup mocks
    vi.mocked(listWorkflows).mockResolvedValue(['test-workflow']);

    const mockCheckpoint: WorkflowCheckpointV3 = {
      workflow_id: 'test-workflow',
      feature_name: 'Test Feature',
      schema_version: '3.0.0',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      current_phase: 'construction',
      current_stage: 'bolt',
      active_bolt_id: 'BOLT-001',
      bolt_execution_history: [],
      quality_gate_history: [],
      risks: [],
      brownfield_context: null,
      depth_tier: 'standard',
      methodology_decision: null,
    };
    vi.mocked(loadCheckpoint).mockResolvedValue(mockCheckpoint);

    const mockManifest: ManifestSchema = {
      schema_version: '2.0.0',
      workflow_id: 'test-workflow',
      feature_name: 'Test Feature',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      phases: {
        discovery: { status: 'complete', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
        inception: { status: 'complete', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
        construction: { status: 'in_progress', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
        operations: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
      },
      depth_assessment: null,
      artifacts: [
        {
          id: 'BOLT-001',
          type: 'bolt-spec',
          phase: 'construction',
          stage: 'bolt',
          path: join(TEST_DIR, 'aidlc-docs', 'construction', 'UNIT-001', 'BOLT-001.md'),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          validation_passed: true,
          write_complete: true,
          checksum: 'test-checksum',
          contract_status: 'active',
          contract_version: 1,
          stale_reason: null,
        },
      ],
      links: [],
      risks: [],
      gate_audit: [],
      metrics: null,
      alignment_checks: [],
      risk_tier: null,
    };
    vi.mocked(loadManifest).mockReturnValue(mockManifest);

    // Register hooks
    registerAgentTrackingHook();

    const sessionId = 'test-session-bolt-1';

    // Create PreToolUse HookContext with BOLT execution prompt
    const ctx: HookContext = {
      sessionId,
      directory: TEST_DIR,
      toolName: 'Task',
      toolInput: {
        subagent_type: 'olympian',
        prompt: 'You are executing a coding task as part of a structured workflow.\n\n## Your Task\nBOLT-001: Implement authentication module',
      },
    };

    // Route the hook
    await routeHook('PreToolUse', ctx);

    // Load session state
    const state = loadSessionState(TEST_DIR, sessionId);

    // Assert: BOLT metadata is populated
    expect(state.pending_completion).not.toBeNull();
    expect(state.pending_completion!.bolt_id).toBe('BOLT-001');
    expect(state.pending_completion!.workflow_id).toBe('test-workflow');
    expect(state.pending_completion!.agent_used).toBe('olympian');

    // Assert: saveManifest was called to set executedBy
    expect(vi.mocked(saveManifest)).toHaveBeenCalled();
  });

  it('should record BOLT execution on PostToolUse', async () => {
    // Import mocked functions
    const { recordAgentExecution } = await import('../../learning/efficiency.js');

    // Register hooks
    registerAgentTrackingHook();

    const sessionId = 'test-session-bolt-2';

    // First, simulate PreToolUse to populate pending_completion
    const state = loadSessionState(TEST_DIR, sessionId);
    state.pending_completion = {
      claimed_at: new Date().toISOString(),
      task_description: 'BOLT-002: Implement user profile page',
      agent_used: 'frontend-engineer',
      bolt_id: 'BOLT-002',
      workflow_id: 'test-workflow',
    };
    const { saveSessionState } = await import('../../learning/session-state.js');
    saveSessionState(TEST_DIR, state);

    // Create PostToolUse HookContext
    const ctx: HookContext = {
      sessionId,
      directory: TEST_DIR,
      toolName: 'Task',
    };

    // Route the PostToolUse hook
    await routeHook('PostToolUse', ctx);

    // Assert: recordAgentExecution was called with correct parameters
    expect(vi.mocked(recordAgentExecution)).toHaveBeenCalledWith({
      boltId: 'BOLT-002',
      agentName: 'frontend-engineer',
      success: true,
      sessionId: sessionId,
      projectPath: TEST_DIR,
      taskDescription: 'BOLT-002: Implement user profile page',
    });
  });

  it('should not record execution for non-BOLT tasks', async () => {
    // Import mocked functions
    const { recordAgentExecution } = await import('../../learning/efficiency.js');

    // Register hooks
    registerAgentTrackingHook();

    const sessionId = 'test-session-bolt-3';

    // Create pending_completion without BOLT metadata
    const state = loadSessionState(TEST_DIR, sessionId);
    state.pending_completion = {
      claimed_at: new Date().toISOString(),
      task_description: 'Regular task without BOLT',
      agent_used: 'explore',
    };
    const { saveSessionState } = await import('../../learning/session-state.js');
    saveSessionState(TEST_DIR, state);

    // Create PostToolUse HookContext
    const ctx: HookContext = {
      sessionId,
      directory: TEST_DIR,
      toolName: 'Task',
    };

    // Route the PostToolUse hook
    await routeHook('PostToolUse', ctx);

    // Assert: recordAgentExecution was NOT called
    expect(vi.mocked(recordAgentExecution)).not.toHaveBeenCalled();
  });

  it('should set executedBy on manifest artifact', async () => {
    // Import mocked functions
    const { listWorkflows, loadCheckpoint } = await import('../../features/workflow-engine/checkpoint.js');
    const { loadManifest, saveManifest } = await import('../../features/workflow-engine/manifest.js');

    // Setup mocks
    vi.mocked(listWorkflows).mockResolvedValue(['test-workflow']);

    const mockCheckpoint: WorkflowCheckpointV3 = {
      workflow_id: 'test-workflow',
      feature_name: 'Test Feature',
      schema_version: '3.0.0',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      current_phase: 'construction',
      current_stage: 'bolt',
      active_bolt_id: 'BOLT-003',
      bolt_execution_history: [],
      quality_gate_history: [],
      risks: [],
      brownfield_context: null,
      depth_tier: 'standard',
      methodology_decision: null,
    };
    vi.mocked(loadCheckpoint).mockResolvedValue(mockCheckpoint);

    const mockManifest: ManifestSchema = {
      schema_version: '2.0.0',
      workflow_id: 'test-workflow',
      feature_name: 'Test Feature',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      phases: {
        discovery: { status: 'complete', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
        inception: { status: 'complete', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
        construction: { status: 'in_progress', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
        operations: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
      },
      depth_assessment: null,
      artifacts: [
        {
          id: 'BOLT-003',
          type: 'bolt-spec',
          phase: 'construction',
          stage: 'bolt',
          path: join(TEST_DIR, 'aidlc-docs', 'construction', 'UNIT-001', 'BOLT-003.md'),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          validation_passed: true,
          write_complete: true,
          checksum: 'test-checksum',
          contract_status: 'active',
          contract_version: 1,
          stale_reason: null,
        },
      ],
      links: [],
      risks: [],
      gate_audit: [],
      metrics: null,
      alignment_checks: [],
      risk_tier: null,
    };
    vi.mocked(loadManifest).mockReturnValue(mockManifest);

    // Register hooks
    registerAgentTrackingHook();

    const sessionId = 'test-session-bolt-4';

    // Create PreToolUse HookContext with BOLT execution prompt
    const ctx: HookContext = {
      sessionId,
      directory: TEST_DIR,
      toolName: 'Task',
      toolInput: {
        subagent_type: 'oracle',
        prompt: 'You are executing a coding task as part of a structured workflow.\n\n## Your Task\nBOLT-003: Debug performance issue',
      },
    };

    // Route the hook
    await routeHook('PreToolUse', ctx);

    // Assert: saveManifest was called
    expect(vi.mocked(saveManifest)).toHaveBeenCalled();

    // Get the manifest that was saved
    const savedManifest = vi.mocked(saveManifest).mock.calls[0][1] as ManifestSchema;
    const boltArtifact = savedManifest.artifacts.find(a => a.id === 'BOLT-003');

    // Assert: executedBy was set
    expect(boltArtifact).toBeDefined();
    expect(boltArtifact!.executedBy).toBe('oracle');
  });
});
