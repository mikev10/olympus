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
  isLegacyCheckpoint,
  archiveLegacyWorkflow,
} from '../../features/workflow-engine/checkpoint.js';
import type { WorkflowCheckpointV3 } from '../../features/workflow-engine/phase-types.js';

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
        current_stage: 'idea',
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
        manifest_path: 'aidlc-docs/manifest.json',
        trust_state_path: 'aidlc-docs/trust.json',
      };

      await saveCheckpoint(tmpDir, checkpoint);

      const expectedPath = join(
        tmpDir,
        'aidlc-docs/checkpoint.json'
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
        manifest_path: 'aidlc-docs/manifest.json',
        trust_state_path: 'aidlc-docs/trust.json',
      };

      // Verify directory doesn't exist yet
      const workflowDir = join(tmpDir, 'aidlc-docs');
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
        'aidlc-docs/checkpoint.json'
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
        manifest_path: 'aidlc-docs/manifest.json',
        trust_state_path: 'aidlc-docs/trust.json',
        depth_score: 75,
        risk_tier: 2,
        active_unit_id: 'UNIT-001',
        active_bolt_id: 'BOLT-003',
        execution_mode: 'ascent',
        interview_progress: {
          stage: 'intent',
          questions_asked: 5,
          draft_artifact_path: 'aidlc-docs/intent-draft.md',
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
        draft_artifact_path: 'aidlc-docs/intent-draft.md',
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
        manifest_path: 'aidlc-docs/manifest.json',
        trust_state_path: 'aidlc-docs/trust.json',
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
      expect(loaded?.manifest_path).toBe('aidlc-docs/manifest.json');
      expect(loaded?.trust_state_path).toBe('aidlc-docs/trust.json');
    });

    it('returns null for missing checkpoint', async () => {
      const loaded = await loadCheckpoint(tmpDir, 'nonexistent-workflow');
      expect(loaded).toBeNull();
    });

    it('handles corrupt JSON gracefully', async () => {
      const workflowDir = join(tmpDir, 'aidlc-docs');
      await fs.ensureDir(workflowDir);

      const checkpointPath = join(workflowDir, 'checkpoint.json');
      await fs.writeFile(checkpointPath, '{ invalid json }');

      const loaded = await loadCheckpoint(tmpDir, 'corrupt-test');
      expect(loaded).toBeNull();
    });

    it('returns null if schema_version is missing', async () => {
      const workflowDir = join(tmpDir, 'aidlc-docs');
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
      const workflowDir = join(tmpDir, 'aidlc-docs');
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
      const workflowDir = join(tmpDir, 'aidlc-docs');
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
        current_stage: 'idea',
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
      const workflowDir = join(tmpDir, 'aidlc-docs');
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
        current_stage: 'idea',
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

      await saveCheckpoint(tmpDir, checkpoint);

      const workflowDir = join(tmpDir, 'aidlc-docs');
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
      const workflowDir = join(tmpDir, 'aidlc-docs');
      await fs.ensureDir(workflowDir);

      // Create checkpoint and additional files
      await fs.writeJson(join(workflowDir, 'checkpoint.json'), {
        schema_version: '3.0.0',
        workflow_id: 'full-delete-test',
      });
      await fs.writeFile(join(workflowDir, 'idea.md'), 'test idea');
      await fs.writeFile(join(workflowDir, 'intent.md'), 'test intent');

      const existsBefore = await fs.pathExists(workflowDir);
      expect(existsBefore).toBe(true);

      await deleteWorkflow(tmpDir, 'full-delete-test');

      const existsAfter = await fs.pathExists(workflowDir);
      expect(existsAfter).toBe(false);
    });
  });

  describe('isLegacyCheckpoint', () => {
    it('returns true for v1 checkpoints', () => {
      const v1Checkpoint = {
        schema_version: '1.0.0',
        workflow_id: 'test',
      };

      expect(isLegacyCheckpoint(v1Checkpoint)).toBe(true);
    });

    it('returns true for v2 checkpoints', () => {
      const v2Checkpoint = {
        schema_version: '2.0.0',
        workflow_id: 'test',
      };

      expect(isLegacyCheckpoint(v2Checkpoint)).toBe(true);
    });

    it('returns false for v3 checkpoints', () => {
      const v3Checkpoint = {
        schema_version: '3.0.0',
        workflow_id: 'test',
      };

      expect(isLegacyCheckpoint(v3Checkpoint)).toBe(false);
    });

    it('returns false for invalid data', () => {
      expect(isLegacyCheckpoint(null)).toBe(false);
      expect(isLegacyCheckpoint(undefined)).toBe(false);
      expect(isLegacyCheckpoint({})).toBe(false);
      expect(isLegacyCheckpoint({ workflow_id: 'test' })).toBe(false);
    });
  });

  describe('archiveLegacyWorkflow', () => {
    it('moves workflow to archive directory', async () => {
      const workflowDir = join(tmpDir, '.olympus/workflow/archive-test');
      await fs.ensureDir(workflowDir);
      await fs.writeFile(join(workflowDir, 'checkpoint.json'), 'test');
      await fs.writeFile(join(workflowDir, 'idea.md'), 'test idea');

      const existsBefore = await fs.pathExists(workflowDir);
      expect(existsBefore).toBe(true);

      await archiveLegacyWorkflow(tmpDir, 'archive-test');

      const existsAfter = await fs.pathExists(workflowDir);
      expect(existsAfter).toBe(false);

      const archiveDir = join(tmpDir, '.olympus/archive/archive-test');
      const existsArchive = await fs.pathExists(archiveDir);
      expect(existsArchive).toBe(true);

      const checkpointExists = await fs.pathExists(join(archiveDir, 'checkpoint.json'));
      const ideaExists = await fs.pathExists(join(archiveDir, 'idea.md'));
      expect(checkpointExists).toBe(true);
      expect(ideaExists).toBe(true);
    });

    it('creates archive directory if it does not exist', async () => {
      const workflowDir = join(tmpDir, '.olympus/workflow/new-archive-test');
      await fs.ensureDir(workflowDir);
      await fs.writeFile(join(workflowDir, 'checkpoint.json'), 'test');

      const archiveParent = join(tmpDir, '.olympus/archive');
      const existsBefore = await fs.pathExists(archiveParent);
      expect(existsBefore).toBe(false);

      await archiveLegacyWorkflow(tmpDir, 'new-archive-test');

      const existsAfter = await fs.pathExists(archiveParent);
      expect(existsAfter).toBe(true);
    });

    it('is idempotent - no error if workflow does not exist', async () => {
      // Should not throw
      await expect(archiveLegacyWorkflow(tmpDir, 'nonexistent-workflow')).resolves.not.toThrow();
    });

    it('overwrites existing archive if present', async () => {
      const workflowDir = join(tmpDir, '.olympus/workflow/overwrite-test');
      await fs.ensureDir(workflowDir);
      await fs.writeFile(join(workflowDir, 'checkpoint.json'), 'new content');

      const archiveDir = join(tmpDir, '.olympus/archive/overwrite-test');
      await fs.ensureDir(archiveDir);
      await fs.writeFile(join(archiveDir, 'checkpoint.json'), 'old content');

      await archiveLegacyWorkflow(tmpDir, 'overwrite-test');

      const content = await fs.readFile(join(archiveDir, 'checkpoint.json'), 'utf-8');
      expect(content).toBe('new content');
    });
  });
});
