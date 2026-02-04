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
} from '../../features/workflow-engine/checkpoint.js';
import { WorkflowCheckpoint } from '../../features/workflow-engine/types.js';

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
      const checkpoint: WorkflowCheckpoint = {
        schema_version: '1.0.0',
        workflow_id: 'test-workflow',
        feature_name: 'test-feature',
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-15T10:00:00Z',
        current_stage: 'idea',
        status: 'in_progress',
        artifacts: {
          idea: null,
          prd: null,
          spec: null,
          intents: null,
          complete: null,
        },
        validation_results: {
          idea: null,
          prd: null,
          spec: null,
          intents: null,
          complete: null,
        },
      };

      await saveCheckpoint(tmpDir, checkpoint);

      const expectedPath = join(
        tmpDir,
        '.olympus/workflow/test-workflow/checkpoint.json'
      );
      const exists = await fs.pathExists(expectedPath);
      expect(exists).toBe(true);
    });

    it('creates directory structure on first save', async () => {
      const checkpoint: WorkflowCheckpoint = {
        schema_version: '1.0.0',
        workflow_id: 'new-workflow',
        feature_name: 'new-feature',
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-15T10:00:00Z',
        current_stage: 'prd',
        status: 'not_started',
        artifacts: {
          idea: null,
          prd: null,
          spec: null,
          intents: null,
          complete: null,
        },
        validation_results: {
          idea: null,
          prd: null,
          spec: null,
          intents: null,
          complete: null,
        },
      };

      // Verify directory doesn't exist yet
      const workflowDir = join(tmpDir, '.olympus/workflow/new-workflow');
      const existsBefore = await fs.pathExists(workflowDir);
      expect(existsBefore).toBe(false);

      // Save checkpoint
      await saveCheckpoint(tmpDir, checkpoint);

      // Verify directory was created
      const existsAfter = await fs.pathExists(workflowDir);
      expect(existsAfter).toBe(true);
    });

    it('updates updated_at timestamp before saving', async () => {
      const checkpoint: WorkflowCheckpoint = {
        schema_version: '1.0.0',
        workflow_id: 'timestamp-test',
        feature_name: 'timestamp-feature',
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-15T10:00:00Z',
        current_stage: 'spec',
        status: 'in_progress',
        artifacts: {
          idea: null,
          prd: null,
          spec: null,
          intents: null,
          complete: null,
        },
        validation_results: {
          idea: null,
          prd: null,
          spec: null,
          intents: null,
          complete: null,
        },
      };

      const originalTimestamp = checkpoint.updated_at;

      // Wait a bit to ensure timestamp changes
      await new Promise(resolve => setTimeout(resolve, 10));

      await saveCheckpoint(tmpDir, checkpoint);

      // Verify timestamp was updated
      expect(checkpoint.updated_at).not.toBe(originalTimestamp);
    });

    it('formats JSON with 2-space indentation', async () => {
      const checkpoint: WorkflowCheckpoint = {
        schema_version: '1.0.0',
        workflow_id: 'format-test',
        feature_name: 'format-feature',
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-15T10:00:00Z',
        current_stage: 'intents',
        status: 'complete',
        artifacts: {
          idea: null,
          prd: null,
          spec: null,
          intents: null,
          complete: null,
        },
        validation_results: {
          idea: null,
          prd: null,
          spec: null,
          intents: null,
          complete: null,
        },
      };

      await saveCheckpoint(tmpDir, checkpoint);

      const checkpointPath = join(
        tmpDir,
        '.olympus/workflow/format-test/checkpoint.json'
      );
      const fileContent = await fs.readFile(checkpointPath, 'utf-8');

      // Check for proper indentation (2 spaces)
      expect(fileContent).toContain('  "schema_version"');
      expect(fileContent).toContain('  "workflow_id"');
    });
  });

  describe('loadCheckpoint', () => {
    it('loads checkpoint with correct schema', async () => {
      const checkpoint: WorkflowCheckpoint = {
        schema_version: '1.0.0',
        workflow_id: 'load-test',
        feature_name: 'load-feature',
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-15T11:00:00Z',
        current_stage: 'prd',
        status: 'in_progress',
        artifacts: {
          idea: {
            id: 'IDEA-001',
            path: '.olympus/workflow/load-test/idea.md',
            created_at: '2024-01-15T10:30:00Z',
            validation_passed: true,
          },
          prd: null,
          spec: null,
          intents: null,
          complete: null,
        },
        validation_results: {
          idea: {
            passed: true,
            coverage_percentage: 100,
            blocking_issues: [],
            reviewer: 'momus',
            timestamp: '2024-01-15T10:45:00Z',
          },
          prd: null,
          spec: null,
          intents: null,
          complete: null,
        },
      };

      await saveCheckpoint(tmpDir, checkpoint);
      const loaded = await loadCheckpoint(tmpDir, 'load-test');

      expect(loaded).not.toBeNull();
      expect(loaded?.schema_version).toBe('1.0.0');
      expect(loaded?.workflow_id).toBe('load-test');
      expect(loaded?.feature_name).toBe('load-feature');
      expect(loaded?.current_stage).toBe('prd');
      expect(loaded?.status).toBe('in_progress');
      expect(loaded?.artifacts.idea).toMatchObject({
        id: 'IDEA-001',
        path: '.olympus/workflow/load-test/idea.md',
        validation_passed: true,
      });
    });

    it('returns null for missing checkpoint', async () => {
      const loaded = await loadCheckpoint(tmpDir, 'nonexistent-workflow');
      expect(loaded).toBeNull();
    });

    it('handles corrupt JSON gracefully', async () => {
      const workflowDir = join(tmpDir, '.olympus/workflow/corrupt-test');
      await fs.ensureDir(workflowDir);

      const checkpointPath = join(workflowDir, 'checkpoint.json');
      await fs.writeFile(checkpointPath, '{ invalid json }');

      const loaded = await loadCheckpoint(tmpDir, 'corrupt-test');
      expect(loaded).toBeNull();
    });

    it('returns null if schema_version is missing', async () => {
      const workflowDir = join(tmpDir, '.olympus/workflow/no-version');
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
  });

  describe('listWorkflows', () => {
    it('returns empty array if workflow directory does not exist', async () => {
      const workflows = await listWorkflows(tmpDir);
      expect(workflows).toEqual([]);
    });

    it('lists all workflows in project', async () => {
      // Create multiple workflows
      const workflow1: WorkflowCheckpoint = {
        schema_version: '1.0.0',
        workflow_id: 'workflow-1',
        feature_name: 'feature-1',
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-15T10:00:00Z',
        current_stage: 'idea',
        status: 'in_progress',
        artifacts: {
          idea: null,
          prd: null,
          spec: null,
          intents: null,
          complete: null,
        },
        validation_results: {
          idea: null,
          prd: null,
          spec: null,
          intents: null,
          complete: null,
        },
      };

      const workflow2: WorkflowCheckpoint = {
        schema_version: '1.0.0',
        workflow_id: 'workflow-2',
        feature_name: 'feature-2',
        created_at: '2024-01-15T11:00:00Z',
        updated_at: '2024-01-15T11:00:00Z',
        current_stage: 'prd',
        status: 'complete',
        artifacts: {
          idea: null,
          prd: null,
          spec: null,
          intents: null,
          complete: null,
        },
        validation_results: {
          idea: null,
          prd: null,
          spec: null,
          intents: null,
          complete: null,
        },
      };

      const workflow3: WorkflowCheckpoint = {
        schema_version: '1.0.0',
        workflow_id: 'workflow-3',
        feature_name: 'feature-3',
        created_at: '2024-01-15T12:00:00Z',
        updated_at: '2024-01-15T12:00:00Z',
        current_stage: 'spec',
        status: 'blocked',
        artifacts: {
          idea: null,
          prd: null,
          spec: null,
          intents: null,
          complete: null,
        },
        validation_results: {
          idea: null,
          prd: null,
          spec: null,
          intents: null,
          complete: null,
        },
      };

      await saveCheckpoint(tmpDir, workflow1);
      await saveCheckpoint(tmpDir, workflow2);
      await saveCheckpoint(tmpDir, workflow3);

      const workflows = await listWorkflows(tmpDir);
      expect(workflows).toHaveLength(3);
      expect(workflows).toContain('workflow-1');
      expect(workflows).toContain('workflow-2');
      expect(workflows).toContain('workflow-3');
    });

    it('filters out non-directory entries', async () => {
      const workflowsDir = join(tmpDir, '.olympus/workflow');
      await fs.ensureDir(workflowsDir);

      // Create a workflow directory
      await fs.ensureDir(join(workflowsDir, 'workflow-1'));

      // Create a file (should be filtered out)
      await fs.writeFile(join(workflowsDir, 'README.md'), 'test');

      const workflows = await listWorkflows(tmpDir);
      expect(workflows).toEqual(['workflow-1']);
    });
  });

  describe('deleteWorkflow', () => {
    it('deletes workflow directory', async () => {
      const checkpoint: WorkflowCheckpoint = {
        schema_version: '1.0.0',
        workflow_id: 'delete-test',
        feature_name: 'delete-feature',
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-15T10:00:00Z',
        current_stage: 'idea',
        status: 'in_progress',
        artifacts: {
          idea: null,
          prd: null,
          spec: null,
          intents: null,
          complete: null,
        },
        validation_results: {
          idea: null,
          prd: null,
          spec: null,
          intents: null,
          complete: null,
        },
      };

      await saveCheckpoint(tmpDir, checkpoint);

      const workflowDir = join(tmpDir, '.olympus/workflow/delete-test');
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
      const workflowDir = join(tmpDir, '.olympus/workflow/full-delete-test');
      await fs.ensureDir(workflowDir);

      // Create checkpoint and additional files
      await fs.writeJson(join(workflowDir, 'checkpoint.json'), {
        schema_version: '1.0.0',
        workflow_id: 'full-delete-test',
      });
      await fs.writeFile(join(workflowDir, 'idea.md'), 'test idea');
      await fs.writeFile(join(workflowDir, 'prd.md'), 'test prd');

      const existsBefore = await fs.pathExists(workflowDir);
      expect(existsBefore).toBe(true);

      await deleteWorkflow(tmpDir, 'full-delete-test');

      const existsAfter = await fs.pathExists(workflowDir);
      expect(existsAfter).toBe(false);
    });
  });
});
