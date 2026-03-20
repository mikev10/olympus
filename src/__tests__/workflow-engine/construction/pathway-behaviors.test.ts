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

describe('Pathway dispatch — validateBugfixTestRequirement', () => {
  const testDir = path.join(process.cwd(), '.test-pathway-behaviors');
  const workflowId = 'pathway-workflow';
  const unitId = 'u-001-unit';

  function makeCheckpoint(pathwayType: string) {
    return {
      schema_version: '3.0.0',
      workflow_id: workflowId,
      feature_name: 'Feature',
      current_phase: 'construction',
      current_stage: 'code-generation',
      status: 'active',
      phases: {},
      manifest_path: '',
      trust_state_path: '',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      pathway_type: pathwayType,
      construction_units: {
        [unitId]: {
          unitId,
          stages: {
            'functional-design': { status: 'not_started', artifact_path: null, completed_at: null },
            'nfr-requirements': { status: 'not_started', artifact_path: null, completed_at: null },
            'nfr-design': { status: 'not_started', artifact_path: null, completed_at: null },
            'infrastructure-design': { status: 'not_started', artifact_path: null, completed_at: null },
            'code-generation': { status: 'completed', artifact_path: null, completed_at: '2026-01-01T00:00:00.000Z' },
            'test-generation': { status: 'completed', artifact_path: null, completed_at: '2026-01-01T00:00:00.000Z' },
          },
          code_plan_path: null,
          code_generation_status: 'completed',
          tests_total: 5,
          tests_passed: 5,
          tests_failed: 0,
          test_framework: 'vitest',
          test_generation_status: 'completed',
        },
      },
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

  it('bugfix pathway: enforcement fires and passes when test-generation completed with tests', async () => {
    mockLoadCheckpoint.mockResolvedValue(makeCheckpoint('bugfix'));

    const executor = new ConstructionExecutor(testDir, workflowId);
    const result = await executor.validateBugfixTestRequirement(unitId);

    expect(result.valid).toBe(true);
  });

  it('optimization pathway: enforcement does not apply (returns valid: true)', async () => {
    mockLoadCheckpoint.mockResolvedValue(makeCheckpoint('optimization'));

    const executor = new ConstructionExecutor(testDir, workflowId);
    const result = await executor.validateBugfixTestRequirement(unitId);

    expect(result.valid).toBe(true);
  });

  it('greenfield pathway: enforcement does not apply (returns valid: true)', async () => {
    mockLoadCheckpoint.mockResolvedValue(makeCheckpoint('greenfield'));

    const executor = new ConstructionExecutor(testDir, workflowId);
    const result = await executor.validateBugfixTestRequirement(unitId);

    expect(result.valid).toBe(true);
  });

  it('brownfield-enhancement pathway: enforcement does not apply (returns valid: true)', async () => {
    mockLoadCheckpoint.mockResolvedValue(makeCheckpoint('brownfield-enhancement'));

    const executor = new ConstructionExecutor(testDir, workflowId);
    const result = await executor.validateBugfixTestRequirement(unitId);

    expect(result.valid).toBe(true);
  });
});
