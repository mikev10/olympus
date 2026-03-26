/**
 * Checkpoint Persistence Tests
 *
 * Comprehensive unit tests for checkpoint save/load/delete operations.
 */

import * as fs from 'fs-extra';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  saveCheckpoint,
  loadCheckpoint,
  listWorkflows,
  deleteWorkflow,
  clearCache,
  getResumePoint,
} from '../../features/workflow-engine/checkpoint.js';
import type { WorkflowCheckpointV3, ConstructionBoltProgress, BoltStageProgress } from '../../features/workflow-engine/phase-types.js';

describe('Checkpoint Persistence', () => {
  let tmpDir: string;

  // Create isolated tmp directory for each test
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(join(tmpdir(), 'checkpoint-test-'));
  });

  // Clean up tmp directory after each test
  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  describe('saveCheckpoint', () => {
    it('saves checkpoint to correct path', async () => {
      const checkpoint: WorkflowCheckpointV3 = {
        schema_version: '3.0.0',
        workflow_id: 'test-workflow',
        feature_name: 'test-feature',
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-15T10:00:00Z',
        current_phase: 'inception',
        current_stage: 'intent',
        status: 'in_progress',
        phases: {
          discovery: {
            status: 'not_started',
            started_at: null,
            completed_at: null,
            gate_result: null,
            gate_bypassed: false,
            bypass_reason: null,
          },
          inception: {
            status: 'in_progress',
            started_at: '2024-01-15T10:00:00Z',
            completed_at: null,
            gate_result: null,
            gate_bypassed: false,
            bypass_reason: null,
          },
          construction: {
            status: 'not_started',
            started_at: null,
            completed_at: null,
            gate_result: null,
            gate_bypassed: false,
            bypass_reason: null,
          },
          operations: {
            status: 'not_started',
            started_at: null,
            completed_at: null,
            gate_result: null,
            gate_bypassed: false,
            bypass_reason: null,
          },
        },
        manifest_path: 'aidlc-docs/test-workflow/manifest.json',
        trust_state_path: 'aidlc-docs/test-workflow/trust.json',
      };

      await saveCheckpoint(tmpDir, checkpoint);

      const expectedPath = join(
        tmpDir,
        'aidlc-docs/test-workflow/checkpoint.json'
      );
      const exists = await fs.pathExists(expectedPath);
      expect(exists).toBe(true);
    });

    it('creates directory structure on first save', async () => {
      const checkpoint: WorkflowCheckpointV3 = {
        schema_version: '3.0.0',
        workflow_id: 'new-workflow',
        feature_name: 'new-feature',
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-15T10:00:00Z',
        current_phase: 'inception',
        current_stage: 'intent',
        status: 'not_started',
        phases: {
          discovery: {
            status: 'not_started',
            started_at: null,
            completed_at: null,
            gate_result: null,
            gate_bypassed: false,
            bypass_reason: null,
          },
          inception: {
            status: 'not_started',
            started_at: null,
            completed_at: null,
            gate_result: null,
            gate_bypassed: false,
            bypass_reason: null,
          },
          construction: {
            status: 'not_started',
            started_at: null,
            completed_at: null,
            gate_result: null,
            gate_bypassed: false,
            bypass_reason: null,
          },
          operations: {
            status: 'not_started',
            started_at: null,
            completed_at: null,
            gate_result: null,
            gate_bypassed: false,
            bypass_reason: null,
          },
        },
        manifest_path: 'aidlc-docs/new-workflow/manifest.json',
        trust_state_path: 'aidlc-docs/new-workflow/trust.json',
      };

      // Verify directory doesn't exist yet
      const workflowDir = join(tmpDir, 'aidlc-docs/new-workflow');
      const existsBefore = await fs.pathExists(workflowDir);
      expect(existsBefore).toBe(false);

      // Save checkpoint
      await saveCheckpoint(tmpDir, checkpoint);

      // Verify directory was created
      const existsAfter = await fs.pathExists(workflowDir);
      expect(existsAfter).toBe(true);
    });

    it('updates updated_at timestamp before saving', async () => {
      const checkpoint: WorkflowCheckpointV3 = {
        schema_version: '3.0.0',
        workflow_id: 'timestamp-test',
        feature_name: 'timestamp-feature',
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-15T10:00:00Z',
        current_phase: 'construction',
        current_stage: 'unit',
        status: 'in_progress',
        phases: {
          inception: {
            status: 'complete',
            started_at: '2024-01-15T10:00:00Z',
            completed_at: '2024-01-15T10:30:00Z',
            gate_result: null,
            gate_bypassed: false,
            bypass_reason: null,
          },
          construction: {
            status: 'in_progress',
            started_at: '2024-01-15T10:30:00Z',
            completed_at: null,
            gate_result: null,
            gate_bypassed: false,
            bypass_reason: null,
          },
          operations: {
            status: 'not_started',
            started_at: null,
            completed_at: null,
            gate_result: null,
            gate_bypassed: false,
            bypass_reason: null,
          },
        },
        manifest_path: 'aidlc-docs/manifest.json',
        trust_state_path: 'aidlc-docs/trust.json',
      };

      const originalTimestamp = checkpoint.updated_at;

      // Wait a bit to ensure timestamp changes
      await new Promise(resolve => setTimeout(resolve, 10));

      await saveCheckpoint(tmpDir, checkpoint);

      // Verify timestamp was updated
      expect(checkpoint.updated_at).not.toBe(originalTimestamp);
    });

    it('formats JSON with 2-space indentation', async () => {
      const checkpoint: WorkflowCheckpointV3 = {
        schema_version: '3.0.0',
        workflow_id: 'format-test',
        feature_name: 'format-feature',
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-15T10:00:00Z',
        current_phase: 'inception',
        current_stage: 'intent',
        status: 'complete',
        phases: {
          discovery: {
            status: 'not_started',
            started_at: null,
            completed_at: null,
            gate_result: null,
            gate_bypassed: false,
            bypass_reason: null,
          },
          inception: {
            status: 'complete',
            started_at: '2024-01-15T10:00:00Z',
            completed_at: '2024-01-15T11:00:00Z',
            gate_result: null,
            gate_bypassed: false,
            bypass_reason: null,
          },
          construction: {
            status: 'not_started',
            started_at: null,
            completed_at: null,
            gate_result: null,
            gate_bypassed: false,
            bypass_reason: null,
          },
          operations: {
            status: 'not_started',
            started_at: null,
            completed_at: null,
            gate_result: null,
            gate_bypassed: false,
            bypass_reason: null,
          },
        },
        manifest_path: 'aidlc-docs/manifest.json',
        trust_state_path: 'aidlc-docs/trust.json',
      };

      await saveCheckpoint(tmpDir, checkpoint);

      const checkpointPath = join(
        tmpDir,
        'aidlc-docs/format-test/checkpoint.json'
      );
      const fileContent = await fs.readFile(checkpointPath, 'utf-8');

      // Check for proper indentation (2 spaces)
      expect(fileContent).toContain('  "schema_version"');
      expect(fileContent).toContain('  "workflow_id"');
    });

    it('saves checkpoint with optional V3 fields', async () => {
      const checkpoint: WorkflowCheckpointV3 = {
        schema_version: '3.0.0',
        workflow_id: 'v3-fields-test',
        feature_name: 'v3-feature',
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-15T10:00:00Z',
        current_phase: 'construction',
        current_stage: 'bolt',
        status: 'in_progress',
        phases: {
          inception: {
            status: 'complete',
            started_at: '2024-01-15T10:00:00Z',
            completed_at: '2024-01-15T10:30:00Z',
            gate_result: null,
            gate_bypassed: false,
            bypass_reason: null,
          },
          construction: {
            status: 'in_progress',
            started_at: '2024-01-15T10:30:00Z',
            completed_at: null,
            gate_result: null,
            gate_bypassed: false,
            bypass_reason: null,
          },
          operations: {
            status: 'not_started',
            started_at: null,
            completed_at: null,
            gate_result: null,
            gate_bypassed: false,
            bypass_reason: null,
          },
        },
        manifest_path: 'aidlc-docs/v3-fields-test/manifest.json',
        trust_state_path: 'aidlc-docs/v3-fields-test/trust.json',
        depth_score: 75,
        risk_tier: 2,
        active_unit_id: 'UNIT-001',
        active_bolt_id: 'BOLT-003',
        execution_mode: 'ascent',
        interview_progress: {
          stage: 'intent',
          questions_asked: 5,
          draft_artifact_path: 'aidlc-docs/v3-fields-test/intent-draft.md',
        },
      };

      await saveCheckpoint(tmpDir, checkpoint);
      const loaded = await loadCheckpoint(tmpDir, 'v3-fields-test');

      expect(loaded).not.toBeNull();
      expect(loaded?.depth_score).toBe(75);
      expect(loaded?.risk_tier).toBe(2);
      expect(loaded?.active_unit_id).toBe('UNIT-001');
      expect(loaded?.active_bolt_id).toBe('BOLT-003');
      expect(loaded?.execution_mode).toBe('ascent');
      expect(loaded?.interview_progress).toEqual({
        stage: 'intent',
        questions_asked: 5,
        draft_artifact_path: 'aidlc-docs/v3-fields-test/intent-draft.md',
      });
    });
  });

  describe('loadCheckpoint', () => {
    it('loads checkpoint with correct V3 schema', async () => {
      const checkpoint: WorkflowCheckpointV3 = {
        schema_version: '3.0.0',
        workflow_id: 'load-test',
        feature_name: 'load-feature',
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-15T11:00:00Z',
        current_phase: 'inception',
        current_stage: 'intent',
        status: 'in_progress',
        phases: {
          discovery: {
            status: 'not_started',
            started_at: null,
            completed_at: null,
            gate_result: null,
            gate_bypassed: false,
            bypass_reason: null,
          },
          inception: {
            status: 'in_progress',
            started_at: '2024-01-15T10:00:00Z',
            completed_at: null,
            gate_result: null,
            gate_bypassed: false,
            bypass_reason: null,
          },
          construction: {
            status: 'not_started',
            started_at: null,
            completed_at: null,
            gate_result: null,
            gate_bypassed: false,
            bypass_reason: null,
          },
          operations: {
            status: 'not_started',
            started_at: null,
            completed_at: null,
            gate_result: null,
            gate_bypassed: false,
            bypass_reason: null,
          },
        },
        manifest_path: 'aidlc-docs/load-test/manifest.json',
        trust_state_path: 'aidlc-docs/load-test/trust.json',
      };

      await saveCheckpoint(tmpDir, checkpoint);
      const loaded = await loadCheckpoint(tmpDir, 'load-test');

      expect(loaded).not.toBeNull();
      expect(loaded?.schema_version).toBe('3.0.0');
      expect(loaded?.workflow_id).toBe('load-test');
      expect(loaded?.feature_name).toBe('load-feature');
      expect(loaded?.current_phase).toBe('inception');
      expect(loaded?.current_stage).toBe('intent');
      expect(loaded?.status).toBe('in_progress');
      expect(loaded?.manifest_path).toBe('aidlc-docs/load-test/manifest.json');
      expect(loaded?.trust_state_path).toBe('aidlc-docs/load-test/trust.json');
    });

    it('returns null for missing checkpoint', async () => {
      const loaded = await loadCheckpoint(tmpDir, 'nonexistent-workflow');
      expect(loaded).toBeNull();
    });

    it('handles corrupt JSON gracefully', async () => {
      const workflowDir = join(tmpDir, 'aidlc-docs/corrupt-test');
      await fs.ensureDir(workflowDir);

      const checkpointPath = join(workflowDir, 'checkpoint.json');
      await fs.writeFile(checkpointPath, '{ invalid json }');

      const loaded = await loadCheckpoint(tmpDir, 'corrupt-test');
      expect(loaded).toBeNull();
    });

    it('returns null if schema_version is missing', async () => {
      const workflowDir = join(tmpDir, 'aidlc-docs/no-version');
      await fs.ensureDir(workflowDir);

      const checkpointPath = join(workflowDir, 'checkpoint.json');
      await fs.writeJson(checkpointPath, {
        workflow_id: 'no-version',
        feature_name: 'test',
        // schema_version intentionally missing
      });

      const loaded = await loadCheckpoint(tmpDir, 'no-version');
      expect(loaded).toBeNull();
    });

    it('returns null for legacy v1 checkpoints', async () => {
      const workflowDir = join(tmpDir, 'aidlc-docs/legacy-v1');
      await fs.ensureDir(workflowDir);

      const checkpointPath = join(workflowDir, 'checkpoint.json');
      await fs.writeJson(checkpointPath, {
        schema_version: '1.0.0',
        workflow_id: 'legacy-v1',
        feature_name: 'legacy-feature',
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-15T10:00:00Z',
        current_stage: 'idea',
        status: 'in_progress',
      });

      const loaded = await loadCheckpoint(tmpDir, 'legacy-v1');
      expect(loaded).toBeNull();
    });

    it('returns null for legacy v2 checkpoints', async () => {
      const workflowDir = join(tmpDir, 'aidlc-docs/legacy-v2');
      await fs.ensureDir(workflowDir);

      const checkpointPath = join(workflowDir, 'checkpoint.json');
      await fs.writeJson(checkpointPath, {
        schema_version: '2.0.0',
        workflow_id: 'legacy-v2',
        feature_name: 'legacy-feature',
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-15T10:00:00Z',
        current_phase: 'inception',
        current_stage: 'idea',
        status: 'in_progress',
      });

      const loaded = await loadCheckpoint(tmpDir, 'legacy-v2');
      expect(loaded).toBeNull();
    });
  });

  describe('listWorkflows', () => {
    it('returns empty array if aidlc-docs directory does not exist', async () => {
      const workflows = await listWorkflows(tmpDir);
      expect(workflows).toEqual([]);
    });

    it('returns workflow_id from checkpoint.json', async () => {
      // Create a single workflow checkpoint
      const workflow: WorkflowCheckpointV3 = {
        schema_version: '3.0.0',
        workflow_id: 'test-workflow',
        feature_name: 'test-feature',
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-15T10:00:00Z',
        current_phase: 'inception',
        current_stage: 'intent',
        status: 'in_progress',
        phases: {
          discovery: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
          inception: { status: 'in_progress', started_at: '2024-01-15T10:00:00Z', completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
          construction: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
          operations: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
        },
        manifest_path: 'aidlc-docs/manifest.json',
        trust_state_path: 'aidlc-docs/trust.json',
      };

      await saveCheckpoint(tmpDir, workflow);

      const workflows = await listWorkflows(tmpDir);
      expect(workflows).toEqual(['test-workflow']);
    });

    it('returns empty array if checkpoint.json does not exist', async () => {
      const workflowDir = join(tmpDir, 'aidlc-docs/empty-workflow');
      await fs.ensureDir(workflowDir);

      const workflows = await listWorkflows(tmpDir);
      expect(workflows).toEqual([]);
    });
  });

  describe('deleteWorkflow', () => {
    it('deletes workflow directory', async () => {
      const checkpoint: WorkflowCheckpointV3 = {
        schema_version: '3.0.0',
        workflow_id: 'delete-test',
        feature_name: 'delete-feature',
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-15T10:00:00Z',
        current_phase: 'inception',
        current_stage: 'intent',
        status: 'in_progress',
        phases: {
          discovery: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
          inception: { status: 'in_progress', started_at: '2024-01-15T10:00:00Z', completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
          construction: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
          operations: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
        },
        manifest_path: 'aidlc-docs/delete-test/manifest.json',
        trust_state_path: 'aidlc-docs/delete-test/trust.json',
      };

      await saveCheckpoint(tmpDir, checkpoint);

      const workflowDir = join(tmpDir, 'aidlc-docs/delete-test');
      const existsBefore = await fs.pathExists(workflowDir);
      expect(existsBefore).toBe(true);

      await deleteWorkflow(tmpDir, 'delete-test');

      const existsAfter = await fs.pathExists(workflowDir);
      expect(existsAfter).toBe(false);
    });

    it('is idempotent - no error if workflow does not exist', async () => {
      // Should not throw
      await expect(deleteWorkflow(tmpDir, 'nonexistent-workflow')).resolves.not.toThrow();
    });

    it('removes entire workflow directory including artifacts', async () => {
      const workflowDir = join(tmpDir, 'aidlc-docs/full-delete-test');
      await fs.ensureDir(workflowDir);

      // Create checkpoint and additional files
      await fs.writeJson(join(workflowDir, 'checkpoint.json'), {
        schema_version: '3.0.0',
        workflow_id: 'full-delete-test',
      });
      await fs.writeFile(join(workflowDir, 'intent.md'), 'test intent');
      await fs.writeFile(join(workflowDir, 'intent-spec.md'), 'test intent spec');

      const existsBefore = await fs.pathExists(workflowDir);
      expect(existsBefore).toBe(true);

      await deleteWorkflow(tmpDir, 'full-delete-test');

      const existsAfter = await fs.pathExists(workflowDir);
      expect(existsAfter).toBe(false);
    });
  });

  describe('bolt field migration', () => {
    afterEach(() => {
      clearCache();
    });

    it('migrates v3 checkpoint without bolt fields to defaults', async () => {
      const workflowDir = join(tmpDir, 'aidlc-docs/migration-bolt-test');
      await fs.ensureDir(workflowDir);
      await fs.writeJson(join(workflowDir, 'checkpoint.json'), {
        schema_version: '3.0.0',
        workflow_id: 'migration-bolt-test',
        feature_name: 'migration test',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        current_phase: 'construction',
        current_stage: 'code-generation',
        status: 'in_progress',
        phases: {
          discovery: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
          inception: { status: 'complete', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
          construction: { status: 'in_progress', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
          operations: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
        },
        manifest_path: 'test',
        trust_state_path: 'test',
      });

      const loaded = await loadCheckpoint(tmpDir, 'migration-bolt-test');
      expect(loaded).not.toBeNull();
      expect(loaded!.construction_bolts).toEqual({});
      expect(loaded!.active_bolt_id).toBeNull();
      expect(loaded!.active_bolt_stage).toBeNull();
    });

    it('preserves already-migrated bolt fields (idempotent)', async () => {
      const checkpoint: WorkflowCheckpointV3 = {
        schema_version: '3.0.0',
        workflow_id: 'idempotent-bolt-test',
        feature_name: 'idempotent test',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        current_phase: 'construction',
        current_stage: 'code-generation',
        status: 'in_progress',
        phases: {
          discovery: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
          inception: { status: 'complete', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
          construction: { status: 'in_progress', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
          operations: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
        },
        manifest_path: 'test',
        trust_state_path: 'test',
        construction_bolts: { 'BOLT-001': { bolt_id: 'BOLT-001', parent_unit_id: 'UNIT-001', status: 'in_progress' as any, stages: {} as any, failure_count: 0, last_error: null, review_score: null, acknowledged_by: null, acknowledged_at: null } },
        active_bolt_id: 'BOLT-001',
        active_bolt_stage: 'elaboration',
      };

      await saveCheckpoint(tmpDir, checkpoint);
      clearCache();
      const loaded = await loadCheckpoint(tmpDir, 'idempotent-bolt-test');

      expect(loaded).not.toBeNull();
      expect(Object.keys(loaded!.construction_bolts!)).toEqual(['BOLT-001']);
      expect(loaded!.active_bolt_id).toBe('BOLT-001');
      expect(loaded!.active_bolt_stage).toBe('elaboration');
    });

    it('initializes failure_count and last_error on unit stages (regression guard)', async () => {
      const workflowDir = join(tmpDir, 'aidlc-docs/stage-fields-test');
      await fs.ensureDir(workflowDir);
      await fs.writeJson(join(workflowDir, 'checkpoint.json'), {
        schema_version: '3.0.0',
        workflow_id: 'stage-fields-test',
        feature_name: 'stage fields test',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        current_phase: 'construction',
        current_stage: 'code-generation',
        status: 'in_progress',
        phases: {
          discovery: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
          inception: { status: 'complete', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
          construction: { status: 'in_progress', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
          operations: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
        },
        manifest_path: 'test',
        trust_state_path: 'test',
        construction_units: {
          'UNIT-001': {
            unitId: 'UNIT-001',
            stages: {
              'functional-design': { status: 'completed', artifact_path: null, completed_at: null },
              'nfr-requirements': { status: 'skipped', artifact_path: null, completed_at: null },
              'nfr-design': { status: 'skipped', artifact_path: null, completed_at: null },
              'infrastructure-design': { status: 'skipped', artifact_path: null, completed_at: null },
              'code-generation': { status: 'not_started', artifact_path: null, completed_at: null },
            },
            code_plan_path: null,
            code_generation_status: 'not_started',
          },
        },
      });

      const loaded = await loadCheckpoint(tmpDir, 'stage-fields-test');
      expect(loaded).not.toBeNull();

      const unit = loaded!.construction_units!['UNIT-001'];
      for (const stage of Object.values(unit.stages)) {
        expect((stage as any).failure_count).toBe(0);
        expect((stage as any).last_error).toBeNull();
      }
    });
  });

});

function makeStageProgress(status: 'not_started' | 'in_progress' | 'completed' | 'skipped' | 'failed'): BoltStageProgress {
  return {
    status,
    started_at: status !== 'not_started' ? '2024-01-01T00:00:00Z' : null,
    completed_at: status === 'completed' || status === 'skipped' ? '2024-01-01T01:00:00Z' : null,
    failure_count: 0,
    last_error: null,
    artifact_path: null,
  };
}

function makeBoltProgress(overrides: Partial<ConstructionBoltProgress> = {}): ConstructionBoltProgress {
  return {
    bolt_id: 'BOLT-001',
    parent_unit_id: 'UNIT-001',
    status: 'in_progress',
    stages: {
      elaboration: makeStageProgress('not_started'),
      code_generation: makeStageProgress('not_started'),
      build_and_test: makeStageProgress('not_started'),
      review: makeStageProgress('not_started'),
    },
    failure_count: 0,
    last_error: null,
    review_score: null,
    acknowledged_by: null,
    acknowledged_at: null,
    ...overrides,
  };
}

function makeMinimalCheckpoint(overrides: Partial<WorkflowCheckpointV3> = {}): WorkflowCheckpointV3 {
  const ps = { status: 'not_started' as const, started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null };
  return {
    schema_version: '3.0.0',
    workflow_id: 'resume-test',
    feature_name: 'resume',
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

describe('getResumePoint', () => {
  it('returns both boltId and stage when active_bolt_id and active_bolt_stage are set', () => {
    const checkpoint = makeMinimalCheckpoint({
      active_bolt_id: 'BOLT-001',
      active_bolt_stage: 'code_generation',
      construction_bolts: { 'BOLT-001': makeBoltProgress() },
    });

    const result = getResumePoint(checkpoint);
    expect(result).toEqual({ boltId: 'BOLT-001', stage: 'code_generation' });
  });

  it('returns first incomplete stage when active_bolt_stage is null', () => {
    const bolt = makeBoltProgress({
      stages: {
        elaboration: makeStageProgress('completed'),
        code_generation: makeStageProgress('not_started'),
        build_and_test: makeStageProgress('not_started'),
        review: makeStageProgress('not_started'),
      },
    });
    const checkpoint = makeMinimalCheckpoint({
      active_bolt_id: 'BOLT-001',
      active_bolt_stage: null,
      construction_bolts: { 'BOLT-001': bolt },
    });

    const result = getResumePoint(checkpoint);
    expect(result).toEqual({ boltId: 'BOLT-001', stage: 'code_generation' });
  });

  it('returns null when all stages are completed or skipped', () => {
    const bolt = makeBoltProgress({
      stages: {
        elaboration: makeStageProgress('completed'),
        code_generation: makeStageProgress('completed'),
        build_and_test: makeStageProgress('skipped'),
        review: makeStageProgress('completed'),
      },
    });
    const checkpoint = makeMinimalCheckpoint({
      active_bolt_id: 'BOLT-001',
      active_bolt_stage: null,
      construction_bolts: { 'BOLT-001': bolt },
    });

    const result = getResumePoint(checkpoint);
    expect(result).toBeNull();
  });

  it('returns null when active_bolt_id is null', () => {
    const checkpoint = makeMinimalCheckpoint({ active_bolt_id: null });
    expect(getResumePoint(checkpoint)).toBeNull();
  });

  it('returns null when active_bolt_id is undefined', () => {
    const checkpoint = makeMinimalCheckpoint();
    delete (checkpoint as any).active_bolt_id;
    expect(getResumePoint(checkpoint)).toBeNull();
  });
});

