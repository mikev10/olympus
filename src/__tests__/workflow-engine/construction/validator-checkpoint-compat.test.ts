import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import { saveCheckpoint, loadCheckpoint } from '../../../features/workflow-engine/checkpoint.js';
import type { WorkflowCheckpointV3, ConstructionUnitProgress } from '../../../features/workflow-engine/phase-types.js';

const testDir = path.join(process.cwd(), '.test-validator-compat');
const workflowId = 'wf-compat-test';

function makeUnit(overrides: Partial<ConstructionUnitProgress> = {}): ConstructionUnitProgress {
  return {
    unitId: 'u-001',
    stages: {
      'functional-design': { status: 'skipped', artifact_path: null, completed_at: null },
      'nfr-requirements': { status: 'skipped', artifact_path: null, completed_at: null },
      'nfr-design': { status: 'skipped', artifact_path: null, completed_at: null },
      'infrastructure-design': { status: 'skipped', artifact_path: null, completed_at: null },
      'code-generation': { status: 'completed', artifact_path: null, completed_at: null },
      'test-generation': { status: 'completed', artifact_path: null, completed_at: null },
    },
    code_plan_path: null,
    code_generation_status: 'completed',
    ...overrides,
  };
}

function makeCheckpoint(units: Record<string, ConstructionUnitProgress> = {}): WorkflowCheckpointV3 {
  return {
    schema_version: '3.0.0',
    workflow_id: workflowId,
    feature_name: 'compat-feature',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    current_phase: 'construction',
    current_stage: 'code-generation',
    status: 'in_progress',
    phases: {
      discovery: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
      inception: { status: 'completed', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
      construction: { status: 'in_progress', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
      operations: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
    },
    manifest_path: `aidlc-docs/${workflowId}/manifest.json`,
    trust_state_path: `aidlc-docs/${workflowId}/trust.json`,
    construction_units: units,
  };
}

beforeEach(async () => {
  await fs.ensureDir(testDir);
});

afterEach(async () => {
  await fs.remove(testDir);
});

describe('loadCheckpoint Group 1B backward compatibility', () => {
  it('initializes all 5 validator fields with defaults when they are absent from checkpoint', async () => {
    const unit = makeUnit();
    const checkpoint = makeCheckpoint({ 'u-001': unit });
    await saveCheckpoint(testDir, checkpoint);

    const loaded = await loadCheckpoint(testDir, workflowId);
    const loadedUnit = loaded?.construction_units?.['u-001'];

    expect(loadedUnit?.quality_validation_status).toBe('not_started');
    expect(loadedUnit?.traceability_status).toBe('not_started');
    expect(loadedUnit?.contract_validation_status).toBe('not_started');
    expect(loadedUnit?.coverage_status).toBe('not_started');
    expect(loadedUnit?.coverage_percentage).toBeNull();
  });

  it('preserves existing validator field values when they are already present', async () => {
    const unit = makeUnit({
      quality_validation_status: 'completed',
      traceability_status: 'in_progress',
      contract_validation_status: 'skipped',
      coverage_status: 'completed',
      coverage_percentage: 91.2,
    });
    const checkpoint = makeCheckpoint({ 'u-001': unit });
    await saveCheckpoint(testDir, checkpoint);

    const loaded = await loadCheckpoint(testDir, workflowId);
    const loadedUnit = loaded?.construction_units?.['u-001'];

    expect(loadedUnit?.quality_validation_status).toBe('completed');
    expect(loadedUnit?.traceability_status).toBe('in_progress');
    expect(loadedUnit?.contract_validation_status).toBe('skipped');
    expect(loadedUnit?.coverage_status).toBe('completed');
    expect(loadedUnit?.coverage_percentage).toBe(91.2);
  });

  it('initializes only missing fields when checkpoint has a mix of present and absent fields', async () => {
    const unit = makeUnit({
      quality_validation_status: 'completed',
      coverage_percentage: 75.0,
    });
    const checkpoint = makeCheckpoint({ 'u-001': unit });
    await saveCheckpoint(testDir, checkpoint);

    const loaded = await loadCheckpoint(testDir, workflowId);
    const loadedUnit = loaded?.construction_units?.['u-001'];

    expect(loadedUnit?.quality_validation_status).toBe('completed');
    expect(loadedUnit?.traceability_status).toBe('not_started');
    expect(loadedUnit?.contract_validation_status).toBe('not_started');
    expect(loadedUnit?.coverage_status).toBe('not_started');
    expect(loadedUnit?.coverage_percentage).toBe(75.0);
  });

  it('handles checkpoint with no construction_units without error', async () => {
    const checkpoint = makeCheckpoint({});
    await saveCheckpoint(testDir, checkpoint);

    const loaded = await loadCheckpoint(testDir, workflowId);
    expect(loaded).not.toBeNull();
    expect(loaded?.construction_units).toEqual({});
  });

  it('initializes fields for multiple units independently', async () => {
    const unit1 = makeUnit({ unitId: 'u-001', quality_validation_status: 'completed' });
    const unit2 = makeUnit({ unitId: 'u-002' });
    const checkpoint = makeCheckpoint({ 'u-001': unit1, 'u-002': unit2 });
    await saveCheckpoint(testDir, checkpoint);

    const loaded = await loadCheckpoint(testDir, workflowId);

    expect(loaded?.construction_units?.['u-001'].quality_validation_status).toBe('completed');
    expect(loaded?.construction_units?.['u-001'].traceability_status).toBe('not_started');

    expect(loaded?.construction_units?.['u-002'].quality_validation_status).toBe('not_started');
    expect(loaded?.construction_units?.['u-002'].coverage_percentage).toBeNull();
  });

  it('preserves coverage_percentage of 0 (falsy but valid)', async () => {
    const unit = makeUnit({ coverage_percentage: 0 });
    const checkpoint = makeCheckpoint({ 'u-001': unit });
    await saveCheckpoint(testDir, checkpoint);

    const loaded = await loadCheckpoint(testDir, workflowId);
    expect(loaded?.construction_units?.['u-001'].coverage_percentage).toBe(0);
  });
});
