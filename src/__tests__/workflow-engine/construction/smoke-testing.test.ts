import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import { ConstructionExecutor } from '../../../features/workflow-engine/construction/executor.js';

const { loadCheckpoint: mockLoadCheckpoint, saveCheckpoint: mockSaveCheckpoint } = vi.hoisted(() => ({
  loadCheckpoint: vi.fn(),
  saveCheckpoint: vi.fn(),
}));

vi.mock('../../../features/workflow-engine/checkpoint.js', () => ({
  loadCheckpoint: mockLoadCheckpoint,
  saveCheckpoint: mockSaveCheckpoint,
  clearCache: vi.fn(),
  invalidateCache: vi.fn(),
}));

const { clearHooks: mockClearHooks } = vi.hoisted(() => ({
  clearHooks: vi.fn(),
}));

vi.mock('../../../hooks/registry.js', () => ({
  clearHooks: mockClearHooks,
  registerHook: vi.fn(),
}));

describe('ConstructionExecutor.validateBugfixTestRequirement()', () => {
  const testDir = path.join(process.cwd(), '.test-smoke-testing');
  const workflowId = 'smoke-workflow';
  const unitId = 'UNIT-001-bugfix';

  function makeCheckpoint(overrides: Record<string, unknown> = {}) {
    return {
      schema_version: '3.0.0',
      workflow_id: workflowId,
      feature_name: 'Bug Fix',
      current_phase: 'construction',
      current_stage: 'code-generation',
      status: 'active',
      phases: {},
      manifest_path: '',
      trust_state_path: '',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      construction_units: {},
      ...overrides,
    };
  }

  function makeUnitProgress(tgStatus: string, testsTotal: number) {
    return {
      unitId,
      stages: {
        'functional-design': { status: 'not_started', artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
        'nfr-requirements': { status: 'not_started', artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
        'nfr-design': { status: 'not_started', artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
        'infrastructure-design': { status: 'not_started', artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
        'code-generation': { status: 'completed', artifact_path: null, completed_at: '2026-01-01T00:00:00.000Z' },
        'test-generation': { status: tgStatus, artifact_path: null, completed_at: tgStatus === 'completed' ? '2026-01-01T00:00:00.000Z' : null },
      },
      code_plan_path: null,
      code_generation_status: 'completed',
      tests_total: testsTotal,
      tests_passed: testsTotal,
      tests_failed: 0,
      test_framework: 'vitest',
      test_generation_status: tgStatus,
    };
  }

  beforeEach(async () => {
    await fs.ensureDir(testDir);
    mockLoadCheckpoint.mockReset();
    mockSaveCheckpoint.mockReset();
    mockSaveCheckpoint.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await fs.remove(testDir);
    mockClearHooks();
  });

  it('returns valid: true for non-bugfix pathway without checking test stages', async () => {
    mockLoadCheckpoint.mockResolvedValue(makeCheckpoint({ pathway_type: 'brownfield-enhancement' }));

    const executor = new ConstructionExecutor(testDir, workflowId);
    const result = await executor.validateBugfixTestRequirement(unitId);

    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('returns valid: true for greenfield pathway', async () => {
    mockLoadCheckpoint.mockResolvedValue(makeCheckpoint({ pathway_type: 'greenfield' }));

    const executor = new ConstructionExecutor(testDir, workflowId);
    const result = await executor.validateBugfixTestRequirement(unitId);

    expect(result.valid).toBe(true);
  });

  it('returns valid: false when test-generation is not completed for bugfix pathway', async () => {
    const checkpoint = makeCheckpoint({
      pathway_type: 'bugfix',
      construction_units: { [unitId]: makeUnitProgress('in_progress', 3) },
    });
    mockLoadCheckpoint.mockResolvedValue(checkpoint);

    const executor = new ConstructionExecutor(testDir, workflowId);
    const result = await executor.validateBugfixTestRequirement(unitId);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('test-generation stage not completed');
  });

  it('returns valid: false when tests_total === 0 for bugfix pathway', async () => {
    const checkpoint = makeCheckpoint({
      pathway_type: 'bugfix',
      construction_units: { [unitId]: makeUnitProgress('completed', 0) },
    });
    mockLoadCheckpoint.mockResolvedValue(checkpoint);

    const executor = new ConstructionExecutor(testDir, workflowId);
    const result = await executor.validateBugfixTestRequirement(unitId);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('tests_total === 0');
  });

  it('returns valid: true when test-generation is completed and tests_total > 0 for bugfix', async () => {
    const checkpoint = makeCheckpoint({
      pathway_type: 'bugfix',
      construction_units: { [unitId]: makeUnitProgress('completed', 2) },
    });
    mockLoadCheckpoint.mockResolvedValue(checkpoint);

    const executor = new ConstructionExecutor(testDir, workflowId);
    const result = await executor.validateBugfixTestRequirement(unitId);

    expect(result.valid).toBe(true);
  });

  it('returns valid: false gracefully when construction_units is missing from checkpoint', async () => {
    const checkpoint = makeCheckpoint({ pathway_type: 'bugfix' });
    delete (checkpoint as any).construction_units;
    mockLoadCheckpoint.mockResolvedValue(checkpoint);

    const executor = new ConstructionExecutor(testDir, workflowId);
    const result = await executor.validateBugfixTestRequirement(unitId);

    expect(result.valid).toBe(false);
    expect(result.reason).toBeDefined();
  });

  it('returns valid: false when checkpoint is not found', async () => {
    mockLoadCheckpoint.mockResolvedValue(null);

    const executor = new ConstructionExecutor(testDir, workflowId);
    const result = await executor.validateBugfixTestRequirement(unitId);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('checkpoint not found');
  });
});

describe('ConstructionExecutor.captureBugDescription()', () => {
  const testDir = path.join(process.cwd(), '.test-smoke-testing');
  const workflowId = 'smoke-workflow';

  function makeCheckpoint(overrides: Record<string, unknown> = {}) {
    return {
      schema_version: '3.0.0',
      workflow_id: workflowId,
      feature_name: 'Bug Fix',
      current_phase: 'construction',
      current_stage: 'code-generation',
      status: 'active',
      phases: {},
      manifest_path: '',
      trust_state_path: '',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      construction_units: {},
      ...overrides,
    };
  }

  beforeEach(async () => {
    await fs.ensureDir(testDir);
    mockLoadCheckpoint.mockReset();
    mockSaveCheckpoint.mockReset();
    mockSaveCheckpoint.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await fs.remove(testDir);
    mockClearHooks();
  });

  it('stores the description in checkpoint bug_description field', async () => {
    mockLoadCheckpoint.mockResolvedValue(makeCheckpoint());

    const executor = new ConstructionExecutor(testDir, workflowId);
    await executor.captureBugDescription('Login fails when session token is expired');

    const savedCheckpoint = mockSaveCheckpoint.mock.calls[0][1];
    expect(savedCheckpoint.bug_description).toBe('Login fails when session token is expired');
  });

  it('updates the updated_at timestamp', async () => {
    const before = new Date('2026-01-01T00:00:00.000Z').getTime();
    mockLoadCheckpoint.mockResolvedValue(makeCheckpoint({ updated_at: '2026-01-01T00:00:00.000Z' }));

    const executor = new ConstructionExecutor(testDir, workflowId);
    await executor.captureBugDescription('Some bug');

    const savedCheckpoint = mockSaveCheckpoint.mock.calls[0][1];
    const updatedAt = new Date(savedCheckpoint.updated_at).getTime();
    expect(updatedAt).toBeGreaterThanOrEqual(before);
  });

  it('handles missing checkpoint gracefully by creating a new one', async () => {
    mockLoadCheckpoint.mockResolvedValue(null);

    const executor = new ConstructionExecutor(testDir, workflowId);
    await executor.captureBugDescription('Null pointer in auth service');

    expect(mockSaveCheckpoint).toHaveBeenCalledOnce();
    const savedCheckpoint = mockSaveCheckpoint.mock.calls[0][1];
    expect(savedCheckpoint.bug_description).toBe('Null pointer in auth service');
  });
});
