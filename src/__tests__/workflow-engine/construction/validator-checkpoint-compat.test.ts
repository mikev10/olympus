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

describe('loadCheckpoint Group 1D backward compatibility', () => {
  it('initializes all 10 Group 1D fields with defaults when they are absent from checkpoint', async () => {
    const unit = makeUnit();
    const checkpoint = makeCheckpoint({ 'u-001': unit });
    await saveCheckpoint(testDir, checkpoint);

    const loaded = await loadCheckpoint(testDir, workflowId);
    const loadedUnit = loaded?.construction_units?.['u-001'];

    expect(loadedUnit?.security_scan_status).toBe('not_started');
    expect(loadedUnit?.security_findings_critical).toBe(0);
    expect(loadedUnit?.security_findings_warning).toBe(0);
    expect(loadedUnit?.security_findings_info).toBe(0);
    expect(loadedUnit?.feature_doc_status).toBe('not_started');
    expect(loadedUnit?.feature_doc_path).toBeNull();
    expect(loadedUnit?.recreation_readiness_score).toBeNull();
    expect(loadedUnit?.recreation_readiness_dimensions).toBeNull();
    expect(loadedUnit?.adr_count).toBe(0);
    expect(loadedUnit?.impact_scan_status).toBe('not_started');
  });

  it('preserves existing Group 1D field values when they are already present', async () => {
    const unit = makeUnit({
      security_scan_status: 'completed',
      security_findings_critical: 2,
      security_findings_warning: 5,
      security_findings_info: 10,
      feature_doc_status: 'completed',
      feature_doc_path: 'aidlc-docs/wf-compat-test/u-001/feature-doc.md',
      recreation_readiness_score: 87,
      recreation_readiness_dimensions: { completeness: 90, accuracy: 85 } as unknown as ConstructionUnitProgress['recreation_readiness_dimensions'],
      adr_count: 3,
      impact_scan_status: 'completed',
    });
    const checkpoint = makeCheckpoint({ 'u-001': unit });
    await saveCheckpoint(testDir, checkpoint);

    const loaded = await loadCheckpoint(testDir, workflowId);
    const loadedUnit = loaded?.construction_units?.['u-001'];

    expect(loadedUnit?.security_scan_status).toBe('completed');
    expect(loadedUnit?.security_findings_critical).toBe(2);
    expect(loadedUnit?.security_findings_warning).toBe(5);
    expect(loadedUnit?.security_findings_info).toBe(10);
    expect(loadedUnit?.feature_doc_status).toBe('completed');
    expect(loadedUnit?.feature_doc_path).toBe('aidlc-docs/wf-compat-test/u-001/feature-doc.md');
    expect(loadedUnit?.recreation_readiness_score).toBe(87);
    expect(loadedUnit?.recreation_readiness_dimensions).toEqual({ completeness: 90, accuracy: 85 });
    expect(loadedUnit?.adr_count).toBe(3);
    expect(loadedUnit?.impact_scan_status).toBe('completed');
  });

  it('initializes only missing Group 1D fields when checkpoint has a mix of present and absent fields', async () => {
    const unit = makeUnit({
      security_scan_status: 'completed',
      security_findings_critical: 1,
      adr_count: 2,
    });
    const checkpoint = makeCheckpoint({ 'u-001': unit });
    await saveCheckpoint(testDir, checkpoint);

    const loaded = await loadCheckpoint(testDir, workflowId);
    const loadedUnit = loaded?.construction_units?.['u-001'];

    expect(loadedUnit?.security_scan_status).toBe('completed');
    expect(loadedUnit?.security_findings_critical).toBe(1);
    expect(loadedUnit?.security_findings_warning).toBe(0);
    expect(loadedUnit?.security_findings_info).toBe(0);
    expect(loadedUnit?.feature_doc_status).toBe('not_started');
    expect(loadedUnit?.feature_doc_path).toBeNull();
    expect(loadedUnit?.recreation_readiness_score).toBeNull();
    expect(loadedUnit?.recreation_readiness_dimensions).toBeNull();
    expect(loadedUnit?.adr_count).toBe(2);
    expect(loadedUnit?.impact_scan_status).toBe('not_started');
  });

  it('initializes Group 1D fields for multiple units independently', async () => {
    const unit1 = makeUnit({ unitId: 'u-001', security_scan_status: 'completed', adr_count: 4 });
    const unit2 = makeUnit({ unitId: 'u-002' });
    const checkpoint = makeCheckpoint({ 'u-001': unit1, 'u-002': unit2 });
    await saveCheckpoint(testDir, checkpoint);

    const loaded = await loadCheckpoint(testDir, workflowId);

    expect(loaded?.construction_units?.['u-001'].security_scan_status).toBe('completed');
    expect(loaded?.construction_units?.['u-001'].adr_count).toBe(4);
    expect(loaded?.construction_units?.['u-001'].feature_doc_status).toBe('not_started');

    expect(loaded?.construction_units?.['u-002'].security_scan_status).toBe('not_started');
    expect(loaded?.construction_units?.['u-002'].adr_count).toBe(0);
    expect(loaded?.construction_units?.['u-002'].recreation_readiness_score).toBeNull();
  });

  it('preserves security_findings_critical of 0 (falsy but valid)', async () => {
    const unit = makeUnit({ security_findings_critical: 0 });
    const checkpoint = makeCheckpoint({ 'u-001': unit });
    await saveCheckpoint(testDir, checkpoint);

    const loaded = await loadCheckpoint(testDir, workflowId);
    expect(loaded?.construction_units?.['u-001'].security_findings_critical).toBe(0);
  });

  it('preserves adr_count of 0 (falsy but valid)', async () => {
    const unit = makeUnit({ adr_count: 0 });
    const checkpoint = makeCheckpoint({ 'u-001': unit });
    await saveCheckpoint(testDir, checkpoint);

    const loaded = await loadCheckpoint(testDir, workflowId);
    expect(loaded?.construction_units?.['u-001'].adr_count).toBe(0);
  });

  it('preserves adr_entries when present', async () => {
    const unit = makeUnit({
      adr_entries: [{ path: 'decisions/001-use-rest.md', title: 'Use REST', number: 1 }],
    });
    const checkpoint = makeCheckpoint({ 'u-001': unit });
    await saveCheckpoint(testDir, checkpoint);

    const loaded = await loadCheckpoint(testDir, workflowId);
    expect(loaded?.construction_units?.['u-001'].adr_entries).toEqual([
      { path: 'decisions/001-use-rest.md', title: 'Use REST', number: 1 },
    ]);
  });

  it('preserves impact_scan_report_path when present', async () => {
    const unit = makeUnit({
      impact_scan_report_path: 'aidlc-docs/wf/u-001/docs/impact-scan.md',
    });
    const checkpoint = makeCheckpoint({ 'u-001': unit });
    await saveCheckpoint(testDir, checkpoint);

    const loaded = await loadCheckpoint(testDir, workflowId);
    expect(loaded?.construction_units?.['u-001'].impact_scan_report_path).toBe('aidlc-docs/wf/u-001/docs/impact-scan.md');
  });

  it('preserves architecture_model_status when present', async () => {
    const unit = makeUnit({ architecture_model_status: 'updated' });
    const checkpoint = makeCheckpoint({ 'u-001': unit });
    await saveCheckpoint(testDir, checkpoint);

    const loaded = await loadCheckpoint(testDir, workflowId);
    expect(loaded?.construction_units?.['u-001'].architecture_model_status).toBe('updated');
  });
});
