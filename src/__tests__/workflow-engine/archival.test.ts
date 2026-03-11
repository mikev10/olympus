import * as fs from 'fs-extra';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  saveCheckpoint,
  loadCheckpoint,
  listWorkflows,
  findActiveWorkflow,
  archiveWorkflow,
  clearCache,
} from '../../features/workflow-engine/checkpoint.js';
import { WorkflowEngine } from '../../features/workflow-engine/engine.js';
import type { WorkflowCheckpointV3 } from '../../features/workflow-engine/phase-types.js';

function makeCheckpoint(overrides: Partial<WorkflowCheckpointV3> = {}): WorkflowCheckpointV3 {
  return {
    schema_version: '3.0.0',
    workflow_id: 'test-workflow',
    feature_name: 'Test Feature',
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
    manifest_path: 'aidlc-docs/test-workflow/manifest.json',
    trust_state_path: '.olympus/trust-state.json',
    ...overrides,
  };
}

describe('Workflow Completion Archival', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(join(tmpdir(), 'archival-test-'));
    clearCache();
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
    clearCache();
  });

  describe('archiveWorkflow()', () => {
    it('moves completed workflow folder to aidlc-docs/completed/{workflowId}/', async () => {
      const checkpoint = makeCheckpoint({ status: 'complete', current_stage: 'complete' });
      await saveCheckpoint(tmpDir, checkpoint);

      await archiveWorkflow(tmpDir, 'test-workflow');

      const targetPath = join(tmpDir, 'aidlc-docs', 'completed', 'test-workflow', 'checkpoint.json');
      expect(await fs.pathExists(targetPath)).toBe(true);

      const sourcePath = join(tmpDir, 'aidlc-docs', 'test-workflow');
      expect(await fs.pathExists(sourcePath)).toBe(false);
    });

    it('sets archived_at and archived_path on checkpoint before move', async () => {
      const checkpoint = makeCheckpoint({ status: 'complete', current_stage: 'complete' });
      await saveCheckpoint(tmpDir, checkpoint);

      await archiveWorkflow(tmpDir, 'test-workflow');

      const targetPath = join(tmpDir, 'aidlc-docs', 'completed', 'test-workflow', 'checkpoint.json');
      const content = await fs.readJson(targetPath);
      expect(content.archived_at).toBeDefined();
      expect(content.archived_path).toBe('aidlc-docs/completed/test-workflow');
    });

    it('creates completed/ directory if it does not exist', async () => {
      const checkpoint = makeCheckpoint({ status: 'complete', current_stage: 'complete' });
      await saveCheckpoint(tmpDir, checkpoint);

      const completedDir = join(tmpDir, 'aidlc-docs', 'completed');
      expect(await fs.pathExists(completedDir)).toBe(false);

      await archiveWorkflow(tmpDir, 'test-workflow');

      expect(await fs.pathExists(completedDir)).toBe(true);
    });

    it('is idempotent — skips if already archived (FR-013)', async () => {
      const checkpoint = makeCheckpoint({ status: 'complete', current_stage: 'complete' });
      await saveCheckpoint(tmpDir, checkpoint);

      await archiveWorkflow(tmpDir, 'test-workflow');

      const targetCheckpoint = join(tmpDir, 'aidlc-docs', 'completed', 'test-workflow', 'checkpoint.json');
      const firstContent = await fs.readJson(targetCheckpoint);

      clearCache();
      await archiveWorkflow(tmpDir, 'test-workflow');

      const secondContent = await fs.readJson(targetCheckpoint);
      expect(secondContent.archived_at).toBe(firstContent.archived_at);
    });

    it('skips if checkpoint is not complete', async () => {
      const checkpoint = makeCheckpoint({ status: 'in_progress' });
      await saveCheckpoint(tmpDir, checkpoint);

      await archiveWorkflow(tmpDir, 'test-workflow');

      const targetPath = join(tmpDir, 'aidlc-docs', 'completed', 'test-workflow');
      expect(await fs.pathExists(targetPath)).toBe(false);
    });

    it('skips if checkpoint is null', async () => {
      await expect(archiveWorkflow(tmpDir, 'nonexistent')).resolves.toBeUndefined();
    });

    it('is non-fatal on move failure', async () => {
      const checkpoint = makeCheckpoint({ status: 'complete', current_stage: 'complete' });
      await saveCheckpoint(tmpDir, checkpoint);

      const targetPath = join(tmpDir, 'aidlc-docs', 'completed', 'test-workflow');
      await fs.ensureDir(targetPath);
      await fs.writeFile(join(targetPath, 'blocker.txt'), 'blocks overwrite');

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await expect(archiveWorkflow(tmpDir, 'test-workflow')).resolves.toBeUndefined();

      warnSpy.mockRestore();
    });

    it('updates master plan file if it exists (FR-015)', async () => {
      const checkpoint = makeCheckpoint({ status: 'complete', current_stage: 'complete' });
      await saveCheckpoint(tmpDir, checkpoint);

      const planDir = join(tmpDir, '.olympus', 'plans');
      await fs.ensureDir(planDir);
      await fs.writeFile(join(planDir, 'test-workflow-plan.md'), '# Plan\n');

      await archiveWorkflow(tmpDir, 'test-workflow');

      const planContent = await fs.readFile(join(planDir, 'test-workflow-plan.md'), 'utf-8');
      expect(planContent).toContain('archived to');
      expect(planContent).toContain('aidlc-docs/completed/test-workflow');
    });
  });

  describe('listWorkflows() exclusion', () => {
    it('excludes completed/ directory from results', async () => {
      const active = makeCheckpoint({ workflow_id: 'active-wf', status: 'in_progress' });
      await saveCheckpoint(tmpDir, active);

      const completed = makeCheckpoint({ workflow_id: 'done-wf', status: 'complete' });
      await saveCheckpoint(tmpDir, completed);
      await archiveWorkflow(tmpDir, 'done-wf');

      clearCache();
      const workflows = await listWorkflows(tmpDir);
      expect(workflows).toContain('active-wf');
      expect(workflows).not.toContain('done-wf');
    });
  });

  describe('findActiveWorkflow() exclusion', () => {
    it('excludes completed/ directory from scanning', async () => {
      const completed = makeCheckpoint({ workflow_id: 'archived-wf', status: 'complete', current_stage: 'complete' });
      await saveCheckpoint(tmpDir, completed);

      const completedDir = join(tmpDir, 'aidlc-docs', 'completed', 'archived-wf');
      await fs.ensureDir(completedDir);
      const fakeActive = makeCheckpoint({ workflow_id: 'archived-wf', status: 'in_progress' });
      await fs.writeJson(join(completedDir, 'checkpoint.json'), fakeActive);

      clearCache();
      const result = await findActiveWorkflow(tmpDir);

      if (result) {
        expect(result.workflowId).not.toBe('archived-wf');
      }
    });
  });

  describe('WorkflowEngine constructor validation', () => {
    it('rejects "completed" as a feature name', () => {
      expect(() => new WorkflowEngine(tmpDir, 'completed')).toThrow(
        "'completed' is a reserved directory name"
      );
    });

    it('rejects feature names that slugify to "completed"', () => {
      expect(() => new WorkflowEngine(tmpDir, 'Completed')).toThrow(
        "'completed' is a reserved directory name"
      );
    });

    it('allows feature names that contain "completed" but slugify differently', () => {
      expect(() => new WorkflowEngine(tmpDir, 'completed-tasks')).not.toThrow();
    });
  });

  describe('backward compatibility', () => {
    it('loads checkpoints without archived_at/archived_path fields', async () => {
      const checkpoint = makeCheckpoint();
      await saveCheckpoint(tmpDir, checkpoint);

      clearCache();
      const loaded = await loadCheckpoint(tmpDir, 'test-workflow');
      expect(loaded).not.toBeNull();
      expect(loaded!.workflow_id).toBe('test-workflow');
      expect(loaded!.archived_at).toBeUndefined();
      expect(loaded!.archived_path).toBeUndefined();
    });

    it('loads checkpoints with archived_at/archived_path fields set', async () => {
      const checkpoint = makeCheckpoint({
        status: 'complete',
        archived_at: '2024-06-01T12:00:00Z',
        archived_path: 'aidlc-docs/completed/test-workflow',
      });
      await saveCheckpoint(tmpDir, checkpoint);

      clearCache();
      const loaded = await loadCheckpoint(tmpDir, 'test-workflow');
      expect(loaded).not.toBeNull();
      expect(loaded!.archived_at).toBe('2024-06-01T12:00:00Z');
      expect(loaded!.archived_path).toBe('aidlc-docs/completed/test-workflow');
    });
  });
});
