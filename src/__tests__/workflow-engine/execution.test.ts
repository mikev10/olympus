/**
 * Execution Module Tests
 *
 * Comprehensive tests for task status tracking and master plan progress updates.
 */

import * as fs from 'fs-extra';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  updateTaskStatus,
  getTaskStatus,
  getBlockedTasks,
  getNextReadyTask,
  getExecutionOrder,
  updateMasterPlanProgress,
} from '../../features/workflow-engine/execution.js';
import { saveCheckpoint } from '../../features/workflow-engine/checkpoint.js';
import type { WorkflowCheckpointV3 } from '../../features/workflow-engine/phase-types.js';
import type { DependencyGraph } from '../../features/workflow-engine/types.js';

// Helper to create a V3 checkpoint for testing
function createCheckpointV3(overrides: Partial<WorkflowCheckpointV3> = {}): WorkflowCheckpointV3 {
  return {
    schema_version: '3.0.0',
    workflow_id: 'test-workflow',
    feature_name: 'test-feature',
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
    trust_state_path: 'aidlc-docs/test-workflow/trust-state.json',
    created_at: '2024-01-15T10:00:00Z',
    updated_at: '2024-01-15T10:00:00Z',
    ...overrides,
  };
}

describe('Execution Module', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(join(tmpdir(), 'execution-test-'));
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  describe('updateTaskStatus', () => {
    it('creates new task status record', async () => {
      const checkpoint = createCheckpointV3();

      await saveCheckpoint(tmpDir, checkpoint);

      await updateTaskStatus(tmpDir, 'test-workflow', 'TASK-001', 'in_progress');

      const status = await getTaskStatus(tmpDir, 'test-workflow', 'TASK-001');
      expect(status).toBe('in_progress');
    });

    it('updates existing task status record', async () => {
      const checkpoint = createCheckpointV3({
        resume_context: {
          task_statuses: [
            {
              task_id: 'TASK-001',
              status: 'pending',
              updated_at: '2024-01-15T10:00:00Z',
            },
          ],
        },
      });

      await saveCheckpoint(tmpDir, checkpoint);

      await updateTaskStatus(tmpDir, 'test-workflow', 'TASK-001', 'complete');

      const status = await getTaskStatus(tmpDir, 'test-workflow', 'TASK-001');
      expect(status).toBe('complete');
    });

    it('stores error message for failed tasks', async () => {
      const checkpoint = createCheckpointV3();

      await saveCheckpoint(tmpDir, checkpoint);

      await updateTaskStatus(tmpDir, 'test-workflow', 'TASK-001', 'failed', 'Test error');

      const status = await getTaskStatus(tmpDir, 'test-workflow', 'TASK-001');
      expect(status).toBe('failed');
    });
  });

  describe('getTaskStatus', () => {
    it('returns pending for non-existent task', async () => {
      const checkpoint = createCheckpointV3();

      await saveCheckpoint(tmpDir, checkpoint);

      const status = await getTaskStatus(tmpDir, 'test-workflow', 'NON-EXISTENT');
      expect(status).toBe('pending');
    });
  });

  describe('getBlockedTasks', () => {
    it('identifies tasks blocked by incomplete dependencies', async () => {
      const checkpoint = createCheckpointV3({
        resume_context: {
          task_statuses: [
            {
              task_id: 'TASK-001',
              status: 'pending',
              updated_at: '2024-01-15T10:00:00Z',
            },
          ],
        },
      });

      const graph: DependencyGraph = {
        nodes: [
          { id: 'TASK-001', title: 'Task 1', component: 'A', estimated_effort: 3 },
          { id: 'TASK-002', title: 'Task 2', component: 'A', estimated_effort: 2 },
        ],
        edges: [{ from: 'TASK-001', to: 'TASK-002' }],
      };

      await saveCheckpoint(tmpDir, checkpoint);

      const graphDir = join(tmpDir, 'aidlc-docs/test-workflow/intents');
      await fs.ensureDir(graphDir);
      await fs.writeJson(join(graphDir, 'dependency-graph.json'), graph);

      const blockedTasks = await getBlockedTasks(tmpDir, 'test-workflow');
      expect(blockedTasks).toContain('TASK-002');
    });

    it('returns empty array when no tasks are blocked', async () => {
      const checkpoint = createCheckpointV3({
        resume_context: {
          task_statuses: [
            {
              task_id: 'TASK-001',
              status: 'complete',
              updated_at: '2024-01-15T10:00:00Z',
            },
          ],
        },
      });

      const graph: DependencyGraph = {
        nodes: [
          { id: 'TASK-001', title: 'Task 1', component: 'A', estimated_effort: 3 },
          { id: 'TASK-002', title: 'Task 2', component: 'A', estimated_effort: 2 },
        ],
        edges: [{ from: 'TASK-001', to: 'TASK-002' }],
      };

      await saveCheckpoint(tmpDir, checkpoint);

      const graphDir = join(tmpDir, 'aidlc-docs/test-workflow/intents');
      await fs.ensureDir(graphDir);
      await fs.writeJson(join(graphDir, 'dependency-graph.json'), graph);

      const blockedTasks = await getBlockedTasks(tmpDir, 'test-workflow');
      expect(blockedTasks).not.toContain('TASK-002');
    });
  });

  describe('getNextReadyTask', () => {
    it('returns first pending task with all dependencies met', async () => {
      const checkpoint = createCheckpointV3();

      const graph: DependencyGraph = {
        nodes: [
          { id: 'TASK-001', title: 'Task 1', component: 'A', estimated_effort: 3 },
          { id: 'TASK-002', title: 'Task 2', component: 'A', estimated_effort: 2 },
        ],
        edges: [],
      };

      await saveCheckpoint(tmpDir, checkpoint);

      const graphDir = join(tmpDir, 'aidlc-docs/test-workflow/intents');
      await fs.ensureDir(graphDir);
      await fs.writeJson(join(graphDir, 'dependency-graph.json'), graph);

      const nextTask = await getNextReadyTask(tmpDir, 'test-workflow');
      expect(nextTask).toBe('TASK-001');
    });

    it('returns null when no tasks are ready', async () => {
      const checkpoint = createCheckpointV3({
        resume_context: {
          task_statuses: [
            {
              task_id: 'TASK-001',
              status: 'pending',
              updated_at: '2024-01-15T10:00:00Z',
            },
            {
              task_id: 'TASK-002',
              status: 'in_progress',
              updated_at: '2024-01-15T10:00:00Z',
            },
          ],
        },
      });

      const graph: DependencyGraph = {
        nodes: [
          { id: 'TASK-001', title: 'Task 1', component: 'A', estimated_effort: 3 },
          { id: 'TASK-002', title: 'Task 2', component: 'A', estimated_effort: 2 },
        ],
        edges: [{ from: 'TASK-002', to: 'TASK-001' }],
      };

      await saveCheckpoint(tmpDir, checkpoint);

      const graphDir = join(tmpDir, 'aidlc-docs/test-workflow/intents');
      await fs.ensureDir(graphDir);
      await fs.writeJson(join(graphDir, 'dependency-graph.json'), graph);

      const nextTask = await getNextReadyTask(tmpDir, 'test-workflow');
      expect(nextTask).toBeNull();
    });
  });

  describe('getExecutionOrder', () => {
    it('returns topologically sorted task order', async () => {
      const checkpoint = createCheckpointV3();

      const graph: DependencyGraph = {
        nodes: [
          { id: 'TASK-001', title: 'Task 1', component: 'A', estimated_effort: 3 },
          { id: 'TASK-002', title: 'Task 2', component: 'A', estimated_effort: 2 },
          { id: 'TASK-003', title: 'Task 3', component: 'A', estimated_effort: 1 },
        ],
        edges: [
          { from: 'TASK-001', to: 'TASK-002' },
          { from: 'TASK-002', to: 'TASK-003' },
        ],
      };

      await saveCheckpoint(tmpDir, checkpoint);

      const graphDir = join(tmpDir, 'aidlc-docs/test-workflow/intents');
      await fs.ensureDir(graphDir);
      await fs.writeJson(join(graphDir, 'dependency-graph.json'), graph);

      const order = await getExecutionOrder(tmpDir, 'test-workflow');
      expect(order).toEqual(['TASK-001', 'TASK-002', 'TASK-003']);
    });

    it('throws error for circular dependencies', async () => {
      const checkpoint = createCheckpointV3();

      const graph: DependencyGraph = {
        nodes: [
          { id: 'TASK-001', title: 'Task 1', component: 'A', estimated_effort: 3 },
          { id: 'TASK-002', title: 'Task 2', component: 'A', estimated_effort: 2 },
        ],
        edges: [
          { from: 'TASK-001', to: 'TASK-002' },
          { from: 'TASK-002', to: 'TASK-001' },
        ],
      };

      await saveCheckpoint(tmpDir, checkpoint);

      const graphDir = join(tmpDir, 'aidlc-docs/test-workflow/intents');
      await fs.ensureDir(graphDir);
      await fs.writeJson(join(graphDir, 'dependency-graph.json'), graph);

      await expect(getExecutionOrder(tmpDir, 'test-workflow')).rejects.toThrow(
        'Circular dependencies detected'
      );
    });
  });

  describe('updateMasterPlanProgress', () => {
    it('creates progress section in plan file', async () => {
      const checkpoint = createCheckpointV3({
        workflow_id: 'test-plan',
        resume_context: {
          task_statuses: [
            {
              task_id: 'TASK-001',
              status: 'complete',
              updated_at: '2024-01-15T10:00:00Z',
            },
            {
              task_id: 'TASK-002',
              status: 'in_progress',
              updated_at: '2024-01-15T10:30:00Z',
            },
          ],
        },
      });

      const graph: DependencyGraph = {
        nodes: [
          { id: 'TASK-001', title: 'Setup database', component: 'DB', estimated_effort: 3 },
          { id: 'TASK-002', title: 'Create schema', component: 'DB', estimated_effort: 2 },
          { id: 'TASK-003', title: 'Add migrations', component: 'DB', estimated_effort: 1 },
        ],
        edges: [
          { from: 'TASK-001', to: 'TASK-002' },
          { from: 'TASK-002', to: 'TASK-003' },
        ],
      };

      await saveCheckpoint(tmpDir, checkpoint);

      const graphDir = join(tmpDir, 'aidlc-docs/test-plan/intents');
      await fs.ensureDir(graphDir);
      await fs.writeJson(join(graphDir, 'dependency-graph.json'), graph);

      // Create plan file
      const planDir = join(tmpDir, '.olympus/plans');
      await fs.ensureDir(planDir);
      const planPath = join(planDir, 'test-plan-plan.md');
      await fs.writeFile(
        planPath,
        '# Test Plan\n\nThis is a test plan.\n\n## Phase 1\n\nSome content here.\n'
      );

      await updateMasterPlanProgress(tmpDir, 'test-plan');

      const updatedPlan = await fs.readFile(planPath, 'utf-8');
      expect(updatedPlan).toContain('## Progress');
      expect(updatedPlan).toContain('**Completion**: 1/3 tasks (33%)');
      expect(updatedPlan).toContain('**Current Task**: TASK-002 - Create schema');
    });

    it('updates existing progress section', async () => {
      const checkpoint = createCheckpointV3({
        workflow_id: 'test-plan',
        resume_context: {
          task_statuses: [
            {
              task_id: 'TASK-001',
              status: 'complete',
              updated_at: '2024-01-15T10:00:00Z',
            },
            {
              task_id: 'TASK-002',
              status: 'complete',
              updated_at: '2024-01-15T10:30:00Z',
            },
          ],
        },
      });

      const graph: DependencyGraph = {
        nodes: [
          { id: 'TASK-001', title: 'Setup database', component: 'DB', estimated_effort: 3 },
          { id: 'TASK-002', title: 'Create schema', component: 'DB', estimated_effort: 2 },
        ],
        edges: [{ from: 'TASK-001', to: 'TASK-002' }],
      };

      await saveCheckpoint(tmpDir, checkpoint);

      const graphDir = join(tmpDir, 'aidlc-docs/test-plan/intents');
      await fs.ensureDir(graphDir);
      await fs.writeJson(join(graphDir, 'dependency-graph.json'), graph);

      // Create plan file with existing progress section
      const planDir = join(tmpDir, '.olympus/plans');
      await fs.ensureDir(planDir);
      const planPath = join(planDir, 'test-plan-plan.md');
      await fs.writeFile(
        planPath,
        '# Test Plan\n\n## Progress\n\n**Completion**: 0/2 tasks (0%)\n\n## Phase 1\n\nContent.\n'
      );

      await updateMasterPlanProgress(tmpDir, 'test-plan');

      const updatedPlan = await fs.readFile(planPath, 'utf-8');
      expect(updatedPlan).toContain('**Completion**: 2/2 tasks (100%)');
      expect(updatedPlan).not.toContain('**Completion**: 0/2 tasks (0%)');
    });

    it('shows blocked tasks in progress section', async () => {
      const checkpoint = createCheckpointV3({
        workflow_id: 'test-plan',
        resume_context: {
          task_statuses: [
            {
              task_id: 'TASK-001',
              status: 'pending',
              updated_at: '2024-01-15T10:00:00Z',
            },
          ],
        },
      });

      const graph: DependencyGraph = {
        nodes: [
          { id: 'TASK-001', title: 'Setup database', component: 'DB', estimated_effort: 3 },
          { id: 'TASK-002', title: 'Create schema', component: 'DB', estimated_effort: 2 },
        ],
        edges: [{ from: 'TASK-001', to: 'TASK-002' }],
      };

      await saveCheckpoint(tmpDir, checkpoint);

      const graphDir = join(tmpDir, 'aidlc-docs/test-plan/intents');
      await fs.ensureDir(graphDir);
      await fs.writeJson(join(graphDir, 'dependency-graph.json'), graph);

      // Create plan file
      const planDir = join(tmpDir, '.olympus/plans');
      await fs.ensureDir(planDir);
      const planPath = join(planDir, 'test-plan-plan.md');
      await fs.writeFile(planPath, '# Test Plan\n\nThis is a test plan.\n');

      await updateMasterPlanProgress(tmpDir, 'test-plan');

      const updatedPlan = await fs.readFile(planPath, 'utf-8');
      expect(updatedPlan).toContain('**Blocked Tasks**:');
      expect(updatedPlan).toContain('- TASK-002 - Create schema');
    });

    it('handles non-existent plan file gracefully', async () => {
      const checkpoint = createCheckpointV3({
        workflow_id: 'test-plan',
      });

      const graph: DependencyGraph = {
        nodes: [
          { id: 'TASK-001', title: 'Setup database', component: 'DB', estimated_effort: 3 },
        ],
        edges: [],
      };

      await saveCheckpoint(tmpDir, checkpoint);

      const graphDir = join(tmpDir, 'aidlc-docs/test-plan/intents');
      await fs.ensureDir(graphDir);
      await fs.writeJson(join(graphDir, 'dependency-graph.json'), graph);

      // Should not throw error
      await expect(updateMasterPlanProgress(tmpDir, 'test-plan')).resolves.not.toThrow();
    });
  });
});
