/**
 * Workflow Bridge Tests
 *
 * Comprehensive unit tests for the workflow bridge layer that connects
 * execution modes to the manifest/checkpoint system.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import type {
  ManifestSchema,
  ManifestArtifact,
  WorkflowCheckpointV3,
  GateResult,
  PhaseState,
  ArtifactLink,
  ConstructionBoltProgress,
  BoltStageProgress,
} from '../../features/workflow-engine/phase-types.js';
import {
  detectActiveWorkflow,
  getPendingBolts,
  getExecutionOrder,
  markBoltComplete,
  markUnitComplete,
  isWorkflowComplete,
  getWorkflowProgress,
  generateWorkflowSummary,
  generateBoltExecutionPlan,
  renderBoltProgress,
} from '../../features/workflow-engine/workflow-bridge.js';
import { clearCache } from '../../features/workflow-engine/checkpoint.js';

// ============================================================================
// Helpers
// ============================================================================

const defaultPhaseState: PhaseState = {
  status: 'not_started' as const,
  started_at: null,
  completed_at: null,
  gate_result: null,
  gate_bypassed: false,
  bypass_reason: null,
};

function createTestManifest(overrides?: Partial<ManifestSchema>): ManifestSchema {
  return {
    schema_version: '2.0.0',
    workflow_id: 'test-wf-001',
    feature_name: 'Test Feature',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    phases: {
      discovery: { ...defaultPhaseState },
      inception: { ...defaultPhaseState, status: 'complete' },
      construction: { ...defaultPhaseState, status: 'in_progress' },
      operations: { ...defaultPhaseState },
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

function createTestCheckpoint(overrides?: Partial<WorkflowCheckpointV3>): WorkflowCheckpointV3 {
  return {
    schema_version: '3.0.0',
    workflow_id: 'test-wf-001',
    feature_name: 'Test Feature',
    current_phase: 'construction',
    current_stage: 'code-generation',
    status: 'in_progress',
    phases: {
      discovery: { ...defaultPhaseState },
      inception: { ...defaultPhaseState, status: 'complete' },
      construction: { ...defaultPhaseState, status: 'in_progress' },
      operations: { ...defaultPhaseState },
    },
    manifest_path: 'aidlc-docs/manifest.json',
    trust_state_path: '.olympus/trust-state.json',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function createBoltArtifact(
  id: string,
  status: ManifestArtifact['contract_status'] = 'active',
  artifactPath?: string
): ManifestArtifact {
  return {
    id,
    type: 'bolt-spec',
    phase: 'construction',
    stage: 'code-generation',
    path: artifactPath ?? `aidlc-docs/test-wf-001/construction/${id}.md`,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    validation_passed: null,
    write_complete: true,
    checksum: null,
    contract_status: status,
    contract_version: 1,
    stale_reason: null,
  };
}

function createUnitArtifact(
  id: string,
  status: ManifestArtifact['contract_status'] = 'active'
): ManifestArtifact {
  return {
    id,
    type: 'unit-spec',
    phase: 'construction',
    stage: 'unit',
    path: `aidlc-docs/test-wf-001/construction/${id}/spec.md`,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    validation_passed: null,
    write_complete: true,
    checksum: null,
    contract_status: status,
    contract_version: 1,
    stale_reason: null,
  };
}

function createGateResult(passed: boolean = true): GateResult {
  return {
    passed,
    approved_by: 'auto',
    approved_at: '2024-01-01T00:00:00Z',
    feedback: null,
    verification: {
      conformance_score: 1.0,
      coverage_percentage: 100,
      missing_items: [],
      passed: true,
    },
    validation: {
      alignment_score: 1.0,
      alignment_questions: [],
      passed: true,
    },
  };
}

function createLink(
  sourceId: string,
  targetId: string,
  linkType: ArtifactLink['link_type'] = 'derives'
): ArtifactLink {
  return { source_id: sourceId, target_id: targetId, link_type: linkType };
}

/**
 * Sets up the test directory with manifest.json, checkpoint.json, and trust-state.json.
 */
function setupWorkflowFiles(
  testDir: string,
  manifest: ManifestSchema,
  checkpoint: WorkflowCheckpointV3,
  trustState?: object
): void {
  const workflowId = checkpoint.workflow_id;
  const aidlcDir = path.join(testDir, 'aidlc-docs', workflowId);
  const olympusDir = path.join(testDir, '.olympus');

  fs.ensureDirSync(aidlcDir);
  fs.ensureDirSync(olympusDir);

  fs.writeFileSync(
    path.join(aidlcDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf-8'
  );
  fs.writeFileSync(
    path.join(aidlcDir, 'checkpoint.json'),
    JSON.stringify(checkpoint, null, 2),
    'utf-8'
  );
  fs.writeFileSync(
    path.join(olympusDir, 'trust-state.json'),
    JSON.stringify(
      trustState ?? {
        current_level: 1,
        total_transitions: 15,
        rejection_count: 0,
        rejection_rate: 0,
        incident_count: 0,
        last_level_change: null,
        level_history: [],
      },
      null,
      2
    ),
    'utf-8'
  );
}

// ============================================================================
// Tests
// ============================================================================

describe('Workflow Bridge', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-bridge-test-'));
    clearCache();
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
    clearCache();
  });

  // --------------------------------------------------------------------------
  // detectActiveWorkflow
  // --------------------------------------------------------------------------

  describe('detectActiveWorkflow', () => {
    it('returns null when no workflow exists', async () => {
      const result = await detectActiveWorkflow(testDir);
      expect(result).toBeNull();
    });

    it('returns null when manifest exists but no checkpoint', async () => {
      const workflowId = 'test-wf-001';
      const aidlcDir = path.join(testDir, 'aidlc-docs', workflowId);
      fs.ensureDirSync(aidlcDir);
      fs.writeFileSync(
        path.join(aidlcDir, 'manifest.json'),
        JSON.stringify(createTestManifest(), null, 2),
        'utf-8'
      );
      const result = await detectActiveWorkflow(testDir);
      expect(result).toBeNull();
    });

    it('returns context when valid manifest + checkpoint exist', async () => {
      const manifest = createTestManifest({
        artifacts: [
          createBoltArtifact('BOLT-001', 'fulfilled'),
          createBoltArtifact('BOLT-002', 'active'),
        ],
      });
      const checkpoint = createTestCheckpoint({ execution_mode: 'olympus' });
      setupWorkflowFiles(testDir, manifest, checkpoint);

      const result = await detectActiveWorkflow(testDir);
      expect(result).not.toBeNull();
      expect(result!.workflowId).toBe('test-wf-001');
      expect(result!.featureName).toBe('Test Feature');
      expect(result!.currentPhase).toBe('construction');
      expect(result!.currentStage).toBe('code-generation');
      expect(result!.trustLevel).toBe(1);
      expect(result!.executionMode).toBe('olympus');
      expect(result!.pendingBolts).toEqual(['BOLT-002']);
      expect(result!.completedBolts).toEqual(['BOLT-001']);
    });

    it('returns default values when trust state file is missing', async () => {
      const manifest = createTestManifest();
      const checkpoint = createTestCheckpoint();
      const workflowId = checkpoint.workflow_id;
      const aidlcDir = path.join(testDir, 'aidlc-docs', workflowId);
      fs.ensureDirSync(aidlcDir);
      fs.writeFileSync(
        path.join(aidlcDir, 'manifest.json'),
        JSON.stringify(manifest, null, 2),
        'utf-8'
      );
      fs.writeFileSync(
        path.join(aidlcDir, 'checkpoint.json'),
        JSON.stringify(checkpoint, null, 2),
        'utf-8'
      );

      const result = await detectActiveWorkflow(testDir);
      expect(result).not.toBeNull();
      expect(result!.trustLevel).toBe(0); // default trust state
    });

    it('sets executionMode to manual when checkpoint has no execution_mode', async () => {
      const manifest = createTestManifest();
      const checkpoint = createTestCheckpoint();
      delete (checkpoint as any).execution_mode;
      setupWorkflowFiles(testDir, manifest, checkpoint);

      const result = await detectActiveWorkflow(testDir);
      expect(result).not.toBeNull();
      expect(result!.executionMode).toBe('manual');
    });

    it('populates pendingUnits correctly', async () => {
      const manifest = createTestManifest({
        artifacts: [
          createUnitArtifact('UNIT-001', 'fulfilled'),
          createUnitArtifact('UNIT-002', 'active'),
          createUnitArtifact('UNIT-003', 'draft'),
        ],
      });
      const checkpoint = createTestCheckpoint();
      setupWorkflowFiles(testDir, manifest, checkpoint);

      const result = await detectActiveWorkflow(testDir);
      expect(result).not.toBeNull();
      expect(result!.pendingUnits).toEqual(['UNIT-002', 'UNIT-003']);
    });
  });

  // --------------------------------------------------------------------------
  // getPendingBolts
  // --------------------------------------------------------------------------

  describe('getPendingBolts', () => {
    it('returns only non-fulfilled BOLTs', () => {
      const manifest = createTestManifest({
        artifacts: [
          createBoltArtifact('BOLT-001', 'fulfilled'),
          createBoltArtifact('BOLT-002', 'active'),
          createBoltArtifact('BOLT-003', 'draft'),
          createBoltArtifact('BOLT-004', 'fulfilled'),
        ],
      });

      const pending = getPendingBolts(manifest);
      expect(pending).toEqual(['BOLT-002', 'BOLT-003']);
    });

    it('returns empty array when all fulfilled', () => {
      const manifest = createTestManifest({
        artifacts: [
          createBoltArtifact('BOLT-001', 'fulfilled'),
          createBoltArtifact('BOLT-002', 'fulfilled'),
        ],
      });

      const pending = getPendingBolts(manifest);
      expect(pending).toEqual([]);
    });

    it('returns empty array when no bolt artifacts exist', () => {
      const manifest = createTestManifest({ artifacts: [] });
      const pending = getPendingBolts(manifest);
      expect(pending).toEqual([]);
    });

    it('includes stale and violated BOLTs as pending', () => {
      const manifest = createTestManifest({
        artifacts: [
          createBoltArtifact('BOLT-001', 'stale'),
          createBoltArtifact('BOLT-002', 'violated'),
          createBoltArtifact('BOLT-003', 'fulfilled'),
        ],
      });

      const pending = getPendingBolts(manifest);
      expect(pending).toEqual(['BOLT-001', 'BOLT-002']);
    });
  });

  // --------------------------------------------------------------------------
  // getExecutionOrder
  // --------------------------------------------------------------------------

  describe('getExecutionOrder', () => {
    it('returns BOLTs ordered by UNIT then BOLT ID', () => {
      const manifest = createTestManifest({
        artifacts: [
          createUnitArtifact('UNIT-001'),
          createUnitArtifact('UNIT-002'),
          createBoltArtifact('BOLT-002'),
          createBoltArtifact('BOLT-001'),
          createBoltArtifact('BOLT-003'),
          createBoltArtifact('BOLT-004'),
        ],
        links: [
          createLink('UNIT-001', 'BOLT-001'),
          createLink('UNIT-001', 'BOLT-002'),
          createLink('UNIT-002', 'BOLT-003'),
          createLink('UNIT-002', 'BOLT-004'),
        ],
      });

      const order = getExecutionOrder(manifest);
      expect(order).toEqual(['BOLT-001', 'BOLT-002', 'BOLT-003', 'BOLT-004']);
    });

    it('handles orphan BOLTs (no parent UNIT link)', () => {
      const manifest = createTestManifest({
        artifacts: [
          createUnitArtifact('UNIT-001'),
          createBoltArtifact('BOLT-001'),
          createBoltArtifact('BOLT-002'),
          createBoltArtifact('BOLT-ORPHAN'),
        ],
        links: [
          createLink('UNIT-001', 'BOLT-001'),
          createLink('UNIT-001', 'BOLT-002'),
          // BOLT-ORPHAN has no link
        ],
      });

      const order = getExecutionOrder(manifest);
      expect(order).toEqual(['BOLT-001', 'BOLT-002', 'BOLT-ORPHAN']);
    });

    it('returns empty array when no bolts exist', () => {
      const manifest = createTestManifest({ artifacts: [] });
      const order = getExecutionOrder(manifest);
      expect(order).toEqual([]);
    });

    it('handles bolts with no units (SHALLOW depth)', () => {
      const manifest = createTestManifest({
        artifacts: [
          createBoltArtifact('BOLT-001'),
          createBoltArtifact('BOLT-002'),
        ],
        links: [],
      });

      const order = getExecutionOrder(manifest);
      expect(order).toEqual(['BOLT-001', 'BOLT-002']);
    });

    it('orders units by ID (UNIT-001 before UNIT-002)', () => {
      const manifest = createTestManifest({
        artifacts: [
          createUnitArtifact('UNIT-002'),
          createUnitArtifact('UNIT-001'),
          createBoltArtifact('BOLT-003'),
          createBoltArtifact('BOLT-001'),
        ],
        links: [
          createLink('UNIT-002', 'BOLT-003'),
          createLink('UNIT-001', 'BOLT-001'),
        ],
      });

      const order = getExecutionOrder(manifest);
      // UNIT-001 comes first (sorted), so BOLT-001, then UNIT-002 -> BOLT-003
      expect(order).toEqual(['BOLT-001', 'BOLT-003']);
    });
  });

  // --------------------------------------------------------------------------
  // markBoltComplete
  // --------------------------------------------------------------------------

  describe('markBoltComplete', () => {
    it('transitions BOLT to fulfilled and updates checkpoint active_code_plan_path to next pending', async () => {
      const manifest = createTestManifest({
        artifacts: [
          createBoltArtifact('BOLT-001', 'active'),
          createBoltArtifact('BOLT-002', 'active'),
        ],
      });
      const checkpoint = createTestCheckpoint({ active_code_plan_path: 'BOLT-001' });
      setupWorkflowFiles(testDir, manifest, checkpoint);

      await markBoltComplete(testDir, 'test-wf-001', 'BOLT-001', createGateResult());

      // Verify manifest was updated
      const updatedManifest = JSON.parse(
        fs.readFileSync(path.join(testDir, 'aidlc-docs', 'test-wf-001', 'manifest.json'), 'utf-8')
      ) as ManifestSchema;
      const bolt = updatedManifest.artifacts.find((a) => a.id === 'BOLT-001');
      expect(bolt!.contract_status).toBe('fulfilled');
      expect(bolt!.executedBy).toBe('auto');
      expect(bolt!.reviewedBy).toBe('auto');

      // Verify checkpoint was updated
      const updatedCheckpoint = JSON.parse(
        fs.readFileSync(path.join(testDir, 'aidlc-docs', 'test-wf-001', 'checkpoint.json'), 'utf-8')
      ) as WorkflowCheckpointV3;
      expect(updatedCheckpoint.active_code_plan_path).toBe('BOLT-002');
    });

    it('clears active_code_plan_path when no more pending BOLTs', async () => {
      const manifest = createTestManifest({
        artifacts: [createBoltArtifact('BOLT-001', 'active')],
      });
      const checkpoint = createTestCheckpoint({ active_code_plan_path: 'BOLT-001' });
      setupWorkflowFiles(testDir, manifest, checkpoint);

      await markBoltComplete(testDir, 'test-wf-001', 'BOLT-001', createGateResult());

      const updatedCheckpoint = JSON.parse(
        fs.readFileSync(path.join(testDir, 'aidlc-docs', 'test-wf-001', 'checkpoint.json'), 'utf-8')
      ) as WorkflowCheckpointV3;
      expect(updatedCheckpoint.active_code_plan_path).toBeUndefined();
    });

    it('handles draft -> active -> fulfilled transition', async () => {
      const manifest = createTestManifest({
        artifacts: [createBoltArtifact('BOLT-001', 'draft')],
      });
      const checkpoint = createTestCheckpoint({ active_code_plan_path: 'BOLT-001' });
      setupWorkflowFiles(testDir, manifest, checkpoint);

      await markBoltComplete(testDir, 'test-wf-001', 'BOLT-001', createGateResult());

      const updatedManifest = JSON.parse(
        fs.readFileSync(path.join(testDir, 'aidlc-docs', 'test-wf-001', 'manifest.json'), 'utf-8')
      ) as ManifestSchema;
      const bolt = updatedManifest.artifacts.find((a) => a.id === 'BOLT-001');
      expect(bolt!.contract_status).toBe('fulfilled');
      // Should have both active and fulfilled in status history
      expect(bolt!.statusHistory).toBeDefined();
      expect(bolt!.statusHistory!.length).toBeGreaterThanOrEqual(2);
      expect(bolt!.statusHistory!.some((h) => h.status === 'active')).toBe(true);
      expect(bolt!.statusHistory!.some((h) => h.status === 'fulfilled')).toBe(true);
    });

    it('throws when manifest is not found', async () => {
      await expect(
        markBoltComplete(testDir, 'test-wf-001', 'BOLT-001', createGateResult())
      ).rejects.toThrow('Manifest not found');
    });

    it('throws when BOLT artifact is not found', async () => {
      const manifest = createTestManifest({ artifacts: [] });
      const checkpoint = createTestCheckpoint();
      setupWorkflowFiles(testDir, manifest, checkpoint);

      await expect(
        markBoltComplete(testDir, 'test-wf-001', 'BOLT-999', createGateResult())
      ).rejects.toThrow('BOLT artifact BOLT-999 not found');
    });

    it('sets executedBy and reviewedBy from gate result', async () => {
      const manifest = createTestManifest({
        artifacts: [createBoltArtifact('BOLT-001', 'active')],
      });
      const checkpoint = createTestCheckpoint();
      setupWorkflowFiles(testDir, manifest, checkpoint);

      const gate = createGateResult();
      gate.approved_by = 'human';

      await markBoltComplete(testDir, 'test-wf-001', 'BOLT-001', gate);

      const updatedManifest = JSON.parse(
        fs.readFileSync(path.join(testDir, 'aidlc-docs', 'test-wf-001', 'manifest.json'), 'utf-8')
      ) as ManifestSchema;
      const bolt = updatedManifest.artifacts.find((a) => a.id === 'BOLT-001');
      expect(bolt!.executedBy).toBe('human');
      expect(bolt!.reviewedBy).toBe('human');
    });
  });

  // --------------------------------------------------------------------------
  // markUnitComplete
  // --------------------------------------------------------------------------

  describe('markUnitComplete', () => {
    it('transitions UNIT to fulfilled and updates checkpoint active_unit_id', async () => {
      const manifest = createTestManifest({
        artifacts: [
          createUnitArtifact('UNIT-001', 'active'),
          createUnitArtifact('UNIT-002', 'active'),
        ],
      });
      const checkpoint = createTestCheckpoint({ active_unit_id: 'UNIT-001' });
      setupWorkflowFiles(testDir, manifest, checkpoint);

      await markUnitComplete(testDir, 'test-wf-001', 'UNIT-001');

      const updatedManifest = JSON.parse(
        fs.readFileSync(path.join(testDir, 'aidlc-docs', 'test-wf-001', 'manifest.json'), 'utf-8')
      ) as ManifestSchema;
      const unit = updatedManifest.artifacts.find((a) => a.id === 'UNIT-001');
      expect(unit!.contract_status).toBe('fulfilled');

      const updatedCheckpoint = JSON.parse(
        fs.readFileSync(path.join(testDir, 'aidlc-docs', 'test-wf-001', 'checkpoint.json'), 'utf-8')
      ) as WorkflowCheckpointV3;
      expect(updatedCheckpoint.active_unit_id).toBe('UNIT-002');
    });

    it('clears active_unit_id when no more pending UNITs', async () => {
      const manifest = createTestManifest({
        artifacts: [createUnitArtifact('UNIT-001', 'active')],
      });
      const checkpoint = createTestCheckpoint({ active_unit_id: 'UNIT-001' });
      setupWorkflowFiles(testDir, manifest, checkpoint);

      await markUnitComplete(testDir, 'test-wf-001', 'UNIT-001');

      const updatedCheckpoint = JSON.parse(
        fs.readFileSync(path.join(testDir, 'aidlc-docs', 'test-wf-001', 'checkpoint.json'), 'utf-8')
      ) as WorkflowCheckpointV3;
      expect(updatedCheckpoint.active_unit_id).toBeUndefined();
    });

    it('throws when manifest is not found', async () => {
      await expect(
        markUnitComplete(testDir, 'test-wf-001', 'UNIT-001')
      ).rejects.toThrow('Manifest not found');
    });

    it('throws when UNIT artifact is not found', async () => {
      const manifest = createTestManifest({ artifacts: [] });
      const checkpoint = createTestCheckpoint();
      setupWorkflowFiles(testDir, manifest, checkpoint);

      await expect(
        markUnitComplete(testDir, 'test-wf-001', 'UNIT-999')
      ).rejects.toThrow('UNIT artifact UNIT-999 not found');
    });

    it('handles draft -> active -> fulfilled transition for UNIT', async () => {
      const manifest = createTestManifest({
        artifacts: [createUnitArtifact('UNIT-001', 'draft')],
      });
      const checkpoint = createTestCheckpoint();
      setupWorkflowFiles(testDir, manifest, checkpoint);

      await markUnitComplete(testDir, 'test-wf-001', 'UNIT-001');

      const updatedManifest = JSON.parse(
        fs.readFileSync(path.join(testDir, 'aidlc-docs', 'test-wf-001', 'manifest.json'), 'utf-8')
      ) as ManifestSchema;
      const unit = updatedManifest.artifacts.find((a) => a.id === 'UNIT-001');
      expect(unit!.contract_status).toBe('fulfilled');
    });
  });

  // --------------------------------------------------------------------------
  // isWorkflowComplete
  // --------------------------------------------------------------------------

  describe('isWorkflowComplete', () => {
    it('returns true when all BOLTs fulfilled', () => {
      const manifest = createTestManifest({
        artifacts: [
          createBoltArtifact('BOLT-001', 'fulfilled'),
          createBoltArtifact('BOLT-002', 'fulfilled'),
        ],
      });

      expect(isWorkflowComplete(manifest)).toBe(true);
    });

    it('returns false when some BOLTs not fulfilled', () => {
      const manifest = createTestManifest({
        artifacts: [
          createBoltArtifact('BOLT-001', 'fulfilled'),
          createBoltArtifact('BOLT-002', 'active'),
        ],
      });

      expect(isWorkflowComplete(manifest)).toBe(false);
    });

    it('returns false when no BOLTs exist', () => {
      const manifest = createTestManifest({ artifacts: [] });
      expect(isWorkflowComplete(manifest)).toBe(false);
    });

    it('returns false when all BOLTs are draft', () => {
      const manifest = createTestManifest({
        artifacts: [
          createBoltArtifact('BOLT-001', 'draft'),
          createBoltArtifact('BOLT-002', 'draft'),
        ],
      });
      expect(isWorkflowComplete(manifest)).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // getWorkflowProgress
  // --------------------------------------------------------------------------

  describe('getWorkflowProgress', () => {
    it('returns correct counts and percentage', () => {
      const manifest = createTestManifest({
        artifacts: [
          createBoltArtifact('BOLT-001', 'fulfilled'),
          createBoltArtifact('BOLT-002', 'fulfilled'),
          createBoltArtifact('BOLT-003', 'active'),
          createBoltArtifact('BOLT-004', 'draft'),
        ],
      });

      const progress = getWorkflowProgress(manifest);
      expect(progress.completed).toBe(2);
      expect(progress.total).toBe(4);
      expect(progress.percentage).toBe(50);
    });

    it('returns 0% when no bolts are fulfilled', () => {
      const manifest = createTestManifest({
        artifacts: [
          createBoltArtifact('BOLT-001', 'active'),
          createBoltArtifact('BOLT-002', 'draft'),
        ],
      });

      const progress = getWorkflowProgress(manifest);
      expect(progress.completed).toBe(0);
      expect(progress.total).toBe(2);
      expect(progress.percentage).toBe(0);
    });

    it('returns 100% when all bolts fulfilled', () => {
      const manifest = createTestManifest({
        artifacts: [
          createBoltArtifact('BOLT-001', 'fulfilled'),
          createBoltArtifact('BOLT-002', 'fulfilled'),
        ],
      });

      const progress = getWorkflowProgress(manifest);
      expect(progress.completed).toBe(2);
      expect(progress.total).toBe(2);
      expect(progress.percentage).toBe(100);
    });

    it('returns zeros when no bolts exist', () => {
      const manifest = createTestManifest({ artifacts: [] });
      const progress = getWorkflowProgress(manifest);
      expect(progress.completed).toBe(0);
      expect(progress.total).toBe(0);
      expect(progress.percentage).toBe(0);
    });

    it('ignores non-bolt artifacts', () => {
      const manifest = createTestManifest({
        artifacts: [
          createUnitArtifact('UNIT-001', 'fulfilled'),
          createBoltArtifact('BOLT-001', 'active'),
        ],
      });

      const progress = getWorkflowProgress(manifest);
      expect(progress.total).toBe(1);
      expect(progress.completed).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // generateWorkflowSummary
  // --------------------------------------------------------------------------

  describe('generateWorkflowSummary', () => {
    it('returns empty string when no workflow', async () => {
      const result = await generateWorkflowSummary(testDir);
      expect(result).toBe('');
    });

    it('returns formatted summary when workflow exists', async () => {
      const manifest = createTestManifest({
        artifacts: [
          createBoltArtifact('BOLT-001', 'fulfilled'),
          createBoltArtifact('BOLT-002', 'active'),
        ],
      });
      const checkpoint = createTestCheckpoint({ execution_mode: 'ascent', risk_tier: 2 });
      setupWorkflowFiles(testDir, manifest, checkpoint);

      const result = await generateWorkflowSummary(testDir);

      expect(result).toContain('## Active Workflow');
      expect(result).toContain('Workflow: Test Feature (test-wf-001)');
      expect(result).toContain('Phase: construction | Stage: code-generation');
      expect(result).toContain('Trust: Level 1');
      expect(result).toContain('Risk: Tier 2');
      expect(result).toContain('Mode: ascent');
      expect(result).toContain('### Progress');
      expect(result).toContain('BOLTs: 1/2 (50%)');
      expect(result).toContain('### Pending BOLTs:');
      expect(result).toContain('BOLT-002');
      expect(result).toContain('### Completed BOLTs:');
      expect(result).toContain('BOLT-001');
    });

    it('reads bolt title from spec file', async () => {
      const manifest = createTestManifest({
        artifacts: [createBoltArtifact('BOLT-001', 'active')],
      });
      const checkpoint = createTestCheckpoint();
      setupWorkflowFiles(testDir, manifest, checkpoint);

      // Create spec file with heading
      const specDir = path.join(testDir, 'aidlc-docs', 'test-wf-001', 'construction');
      fs.ensureDirSync(specDir);
      fs.writeFileSync(
        path.join(specDir, 'BOLT-001.md'),
        '# Implement Authentication\n\nSome content here.',
        'utf-8'
      );

      const result = await generateWorkflowSummary(testDir);
      expect(result).toContain('"Implement Authentication"');
    });
  });

  // --------------------------------------------------------------------------
  // generateBoltExecutionPlan
  // --------------------------------------------------------------------------

  describe('generateBoltExecutionPlan', () => {
    it('returns empty string when no workflow', async () => {
      const result = await generateBoltExecutionPlan(testDir);
      expect(result).toBe('');
    });

    it('returns formatted plan when workflow exists', async () => {
      const manifest = createTestManifest({
        artifacts: [
          createUnitArtifact('UNIT-001'),
          createBoltArtifact('BOLT-001', 'fulfilled'),
          createBoltArtifact('BOLT-002', 'active'),
        ],
        links: [
          createLink('UNIT-001', 'BOLT-001'),
          createLink('UNIT-001', 'BOLT-002'),
        ],
      });
      const checkpoint = createTestCheckpoint({ risk_tier: 1 });
      setupWorkflowFiles(testDir, manifest, checkpoint);

      const result = await generateBoltExecutionPlan(testDir);

      expect(result).toContain('## Workflow Execution Plan');
      expect(result).toContain('Workflow: Test Feature (test-wf-001)');
      expect(result).toContain('Phase: construction');
      expect(result).toContain('Trust: Level 1');
      expect(result).toContain('Risk: Tier 1');
      expect(result).toContain('### Pending BOLTs (execute in this order):');
      expect(result).toContain('BOLT-002');
      expect(result).toContain('Agent: olympian');
      expect(result).toContain('### Completed BOLTs:');
      expect(result).toContain('BOLT-001');
      expect(result).toContain('### Instructions:');
    });

    it('suggests frontend-engineer for UI-related bolt paths', async () => {
      const manifest = createTestManifest({
        artifacts: [
          createBoltArtifact(
            'BOLT-001',
            'active',
            'aidlc-docs/test-wf-001/construction/UNIT-001/ui-component.md'
          ),
        ],
      });
      const checkpoint = createTestCheckpoint();
      setupWorkflowFiles(testDir, manifest, checkpoint);

      const result = await generateBoltExecutionPlan(testDir);
      expect(result).toContain('Agent: frontend-engineer');
    });

    it('includes unit titles when available', async () => {
      const manifest = createTestManifest({
        artifacts: [
          createUnitArtifact('UNIT-001'),
          createBoltArtifact('BOLT-001', 'active'),
        ],
        links: [createLink('UNIT-001', 'BOLT-001')],
      });
      const checkpoint = createTestCheckpoint();
      setupWorkflowFiles(testDir, manifest, checkpoint);

      // Create unit spec file
      const unitDir = path.join(testDir, 'aidlc-docs', 'test-wf-001', 'construction', 'UNIT-001');
      fs.ensureDirSync(unitDir);
      fs.writeFileSync(path.join(unitDir, 'spec.md'), '# User Auth Module\n', 'utf-8');

      const result = await generateBoltExecutionPlan(testDir);
      expect(result).toContain('UNIT-001: User Auth Module');
    });
  });

  // --------------------------------------------------------------------------
  // CRITICAL TEST: Multi-bolt workflow with execution mode change
  // --------------------------------------------------------------------------

  describe('multi-bolt workflow with execution mode change', () => {
    it('handles 5 BOLTs, marks 2 complete, changes mode, verifies remaining 3 and order', async () => {
      const manifest = createTestManifest({
        artifacts: [
          createUnitArtifact('UNIT-001'),
          createUnitArtifact('UNIT-002'),
          createBoltArtifact('BOLT-001', 'active'),
          createBoltArtifact('BOLT-002', 'active'),
          createBoltArtifact('BOLT-003', 'active'),
          createBoltArtifact('BOLT-004', 'active'),
          createBoltArtifact('BOLT-005', 'active'),
        ],
        links: [
          createLink('UNIT-001', 'BOLT-001'),
          createLink('UNIT-001', 'BOLT-002'),
          createLink('UNIT-001', 'BOLT-003'),
          createLink('UNIT-002', 'BOLT-004'),
          createLink('UNIT-002', 'BOLT-005'),
        ],
      });
      const checkpoint = createTestCheckpoint({
        execution_mode: 'olympus',
        active_code_plan_path: 'BOLT-001',
      });
      setupWorkflowFiles(testDir, manifest, checkpoint);

      // Mark first 2 bolts complete with 'olympus' mode
      await markBoltComplete(testDir, 'test-wf-001', 'BOLT-001', createGateResult());
      clearCache();
      await markBoltComplete(testDir, 'test-wf-001', 'BOLT-002', createGateResult());
      clearCache();

      // Change execution mode to 'ascent' by updating checkpoint
      const currentCheckpoint = JSON.parse(
        fs.readFileSync(path.join(testDir, 'aidlc-docs', 'test-wf-001', 'checkpoint.json'), 'utf-8')
      ) as WorkflowCheckpointV3;
      currentCheckpoint.execution_mode = 'ascent';
      fs.writeFileSync(
        path.join(testDir, 'aidlc-docs', 'test-wf-001', 'checkpoint.json'),
        JSON.stringify(currentCheckpoint, null, 2),
        'utf-8'
      );
      clearCache();

      // Reload manifest to check pending bolts
      const updatedManifest = JSON.parse(
        fs.readFileSync(path.join(testDir, 'aidlc-docs', 'test-wf-001', 'manifest.json'), 'utf-8')
      ) as ManifestSchema;

      // Verify getPendingBolts returns the remaining 3
      const pending = getPendingBolts(updatedManifest);
      expect(pending).toEqual(['BOLT-003', 'BOLT-004', 'BOLT-005']);

      // Verify getExecutionOrder returns all 5 in correct order
      const order = getExecutionOrder(updatedManifest);
      expect(order).toEqual(['BOLT-001', 'BOLT-002', 'BOLT-003', 'BOLT-004', 'BOLT-005']);

      // Verify the mode change is reflected in detectActiveWorkflow
      const ctx = await detectActiveWorkflow(testDir);
      expect(ctx).not.toBeNull();
      expect(ctx!.executionMode).toBe('ascent');
      expect(ctx!.pendingBolts).toEqual(['BOLT-003', 'BOLT-004', 'BOLT-005']);
      expect(ctx!.completedBolts).toEqual(['BOLT-001', 'BOLT-002']);

      // Verify progress
      const progress = getWorkflowProgress(updatedManifest);
      expect(progress.completed).toBe(2);
      expect(progress.total).toBe(5);
      expect(progress.percentage).toBe(40);
    });
  });
});

function makeStageProgressForBridge(status: 'not_started' | 'in_progress' | 'completed' | 'skipped' | 'failed'): BoltStageProgress {
  return {
    status,
    started_at: status !== 'not_started' ? '2024-01-01T00:00:00Z' : null,
    completed_at: status === 'completed' || status === 'skipped' ? '2024-01-01T01:00:00Z' : null,
    failure_count: 0,
    last_error: null,
    artifact_path: null,
  };
}

function makeBoltForBridge(overrides: Partial<ConstructionBoltProgress> = {}): ConstructionBoltProgress {
  return {
    bolt_id: 'BOLT-001',
    parent_unit_id: 'UNIT-001',
    status: 'in_progress',
    stages: {
      elaboration: makeStageProgressForBridge('not_started'),
      code_generation: makeStageProgressForBridge('not_started'),
      build_and_test: makeStageProgressForBridge('not_started'),
      review: makeStageProgressForBridge('not_started'),
    },
    failure_count: 0,
    last_error: null,
    review_score: null,
    acknowledged_by: null,
    acknowledged_at: null,
    ...overrides,
  };
}

function makeCheckpointForBridge(overrides: Partial<WorkflowCheckpointV3> = {}): WorkflowCheckpointV3 {
  const ps: PhaseState = { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null };
  return {
    schema_version: '3.0.0',
    workflow_id: 'progress-test',
    feature_name: 'progress',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    current_phase: 'construction',
    current_stage: 'code-generation',
    status: 'in_progress',
    phases: { discovery: { ...ps }, inception: { ...ps }, construction: { ...ps }, operations: { ...ps } },
    manifest_path: 'test',
    trust_state_path: 'test',
    construction_bolts: {},
    active_bolt_id: null,
    active_bolt_stage: null,
    ...overrides,
  };
}

describe('renderBoltProgress', () => {
  it('renders two units with bolts and correct headers and table rows', () => {
    const checkpoint = makeCheckpointForBridge({
      construction_bolts: {
        'BOLT-001': makeBoltForBridge({
          bolt_id: 'BOLT-001',
          parent_unit_id: 'UNIT-001',
          status: 'done',
          stages: {
            elaboration: makeStageProgressForBridge('completed'),
            code_generation: makeStageProgressForBridge('completed'),
            build_and_test: makeStageProgressForBridge('completed'),
            review: makeStageProgressForBridge('completed'),
          },
          review_score: 85,
        }),
        'BOLT-002': makeBoltForBridge({
          bolt_id: 'BOLT-002',
          parent_unit_id: 'UNIT-002',
          status: 'in_progress',
          stages: {
            elaboration: makeStageProgressForBridge('completed'),
            code_generation: makeStageProgressForBridge('in_progress'),
            build_and_test: makeStageProgressForBridge('not_started'),
            review: makeStageProgressForBridge('not_started'),
          },
        }),
      },
    });

    const result = renderBoltProgress(checkpoint);
    expect(result).toContain('### UNIT-001');
    expect(result).toContain('### UNIT-002');
    expect(result).toContain('BOLT-001');
    expect(result).toContain('BOLT-002');
    expect(result).toContain('| Bolt ID |');
  });

  it('shows review_score as 85 when present', () => {
    const checkpoint = makeCheckpointForBridge({
      construction_bolts: {
        'BOLT-001': makeBoltForBridge({
          bolt_id: 'BOLT-001',
          parent_unit_id: 'UNIT-001',
          status: 'done',
          stages: {
            elaboration: makeStageProgressForBridge('completed'),
            code_generation: makeStageProgressForBridge('completed'),
            build_and_test: makeStageProgressForBridge('completed'),
            review: makeStageProgressForBridge('completed'),
          },
          review_score: 85,
        }),
      },
    });

    const result = renderBoltProgress(checkpoint);
    expect(result).toContain('| 85 |');
  });

  it('shows dash when review_score is null', () => {
    const checkpoint = makeCheckpointForBridge({
      construction_bolts: {
        'BOLT-001': makeBoltForBridge({
          bolt_id: 'BOLT-001',
          parent_unit_id: 'UNIT-001',
          status: 'in_progress',
          review_score: null,
        }),
      },
    });

    const result = renderBoltProgress(checkpoint);
    expect(result).toMatch(/\|\s*—\s*\|/);
  });

  it('shows correct summary line count', () => {
    const checkpoint = makeCheckpointForBridge({
      construction_bolts: {
        'BOLT-001': makeBoltForBridge({
          bolt_id: 'BOLT-001',
          parent_unit_id: 'UNIT-001',
          status: 'done',
          stages: {
            elaboration: makeStageProgressForBridge('completed'),
            code_generation: makeStageProgressForBridge('completed'),
            build_and_test: makeStageProgressForBridge('completed'),
            review: makeStageProgressForBridge('completed'),
          },
        }),
        'BOLT-002': makeBoltForBridge({
          bolt_id: 'BOLT-002',
          parent_unit_id: 'UNIT-001',
          status: 'in_progress',
        }),
      },
    });

    const result = renderBoltProgress(checkpoint);
    expect(result).toContain('1/2 bolts complete');
  });

  it('returns empty string when construction_bolts is empty', () => {
    const checkpoint = makeCheckpointForBridge({ construction_bolts: {} });
    expect(renderBoltProgress(checkpoint)).toBe('');
  });
});
