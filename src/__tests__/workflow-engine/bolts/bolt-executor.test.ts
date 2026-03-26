import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  BoltSpec,
  BoltStageProgress,
  BoltExecutionStage,
  WorkflowCheckpointV3,
  ConstructionBoltProgress,
} from '../../../features/workflow-engine/phase-types.js';
import type { StageHandlers } from '../../../features/workflow-engine/bolts/bolt-executor.js';

vi.mock('../../../features/workflow-engine/checkpoint.js', () => ({
  saveCheckpoint: vi.fn().mockResolvedValue(undefined),
}));

import { saveCheckpoint } from '../../../features/workflow-engine/checkpoint.js';
import { BoltExecutor } from '../../../features/workflow-engine/bolts/bolt-executor.js';

const mockedSaveCheckpoint = vi.mocked(saveCheckpoint);

function makeStageProgress(): BoltStageProgress {
  return {
    status: 'not_started',
    started_at: null,
    completed_at: null,
    failure_count: 0,
    last_error: null,
    artifact_path: null,
  };
}

function makeBoltSpec(overrides: Partial<BoltSpec> = {}): BoltSpec {
  return {
    id: 'BOLT-001-test',
    type: 'bolt',
    title: 'Test Bolt',
    parent_id: 'UNIT-001-test',
    children_ids: [],
    status: 'pending',
    assigned_agent: null,
    estimated_effort: 2,
    parent_unit_id: 'UNIT-001-test',
    sequence: 1,
    scope: 'Test scope',
    acceptance_criteria: ['It works'],
    target_files: ['src/foo.ts'],
    dependencies: [],
    depth_target: 3,
    express_mode: false,
    estimated_effort_hours: 2,
    ...overrides,
  };
}

function makeBoltProgress(boltId = 'BOLT-001-test'): ConstructionBoltProgress {
  return {
    bolt_id: boltId,
    parent_unit_id: 'UNIT-001-test',
    status: 'planned',
    stages: {
      elaboration: makeStageProgress(),
      code_generation: makeStageProgress(),
      build_and_test: makeStageProgress(),
      review: makeStageProgress(),
    },
    failure_count: 0,
    last_error: null,
    review_score: null,
    acknowledged_by: null,
    acknowledged_at: null,
  };
}

function makeCheckpoint(boltId = 'BOLT-001-test'): WorkflowCheckpointV3 {
  return {
    schema_version: '3.0.0',
    workflow_id: 'test-wf',
    feature_name: 'test',
    current_phase: 'construction',
    current_stage: 'unit',
    status: 'in_progress',
    phases: {} as any,
    manifest_path: '',
    trust_state_path: '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    construction_bolts: {
      [boltId]: makeBoltProgress(boltId),
    },
    active_bolt_id: null,
    active_bolt_stage: null,
  };
}

function makeSuccessHandlers(): StageHandlers {
  return {
    onElaboration: vi.fn().mockResolvedValue({ success: true, artifact_path: 'elab.md' }),
    onCodeGeneration: vi.fn().mockResolvedValue({ success: true, artifact_path: 'code.md' }),
    onBuildAndTest: vi.fn().mockResolvedValue({ success: true, artifact_path: 'test.md' }),
    onReview: vi.fn().mockResolvedValue({ success: true, artifact_path: 'review.md' }),
  };
}

describe('BoltExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('completes all 4 stages and returns done status', async () => {
    const bolt = makeBoltSpec();
    const checkpoint = makeCheckpoint();
    const handlers = makeSuccessHandlers();

    const result = await BoltExecutor.execute(bolt, checkpoint, '/project', 'test-wf', handlers);

    expect(result.status).toBe('done');
    expect(result.stages.elaboration.status).toBe('completed');
    expect(result.stages.code_generation.status).toBe('completed');
    expect(result.stages.build_and_test.status).toBe('completed');
    expect(result.stages.review.status).toBe('completed');
  });

  it('skips elaboration for express bolt without calling handler', async () => {
    const bolt = makeBoltSpec({ express_mode: true });
    const checkpoint = makeCheckpoint();
    const handlers = makeSuccessHandlers();

    const result = await BoltExecutor.execute(bolt, checkpoint, '/project', 'test-wf', handlers);

    expect(result.stages.elaboration.status).toBe('skipped');
    expect(result.stages.elaboration.completed_at).toBeTruthy();
    expect(handlers.onElaboration).not.toHaveBeenCalled();
  });

  it('still executes code_generation, build_and_test, review for express bolt', async () => {
    const bolt = makeBoltSpec({ express_mode: true });
    const checkpoint = makeCheckpoint();
    const handlers = makeSuccessHandlers();

    const result = await BoltExecutor.execute(bolt, checkpoint, '/project', 'test-wf', handlers);

    expect(result.status).toBe('done');
    expect(handlers.onCodeGeneration).toHaveBeenCalledOnce();
    expect(handlers.onBuildAndTest).toHaveBeenCalledOnce();
    expect(handlers.onReview).toHaveBeenCalledOnce();
  });

  it('reverts stage to not_started on first failure (failure_count=1)', async () => {
    const bolt = makeBoltSpec();
    const checkpoint = makeCheckpoint();
    const handlers = makeSuccessHandlers();
    (handlers.onCodeGeneration as any).mockResolvedValueOnce({ success: false, error: 'compile error' });

    const result = await BoltExecutor.execute(bolt, checkpoint, '/project', 'test-wf', handlers);

    expect(result.stages.code_generation.status).toBe('not_started');
    expect(result.stages.code_generation.failure_count).toBe(1);
    expect(result.stages.code_generation.last_error).toBe('compile error');
    expect(result.stages.build_and_test.status).toBe('not_started');
    expect(result.stages.review.status).toBe('not_started');
  });

  it('marks stage and bolt failed on second failure (failure_count=2)', async () => {
    const bolt = makeBoltSpec();
    const checkpoint = makeCheckpoint();
    // Pre-set failure_count to 1 to simulate prior failure
    checkpoint.construction_bolts!['BOLT-001-test'].stages.code_generation.failure_count = 1;
    const handlers = makeSuccessHandlers();
    (handlers.onCodeGeneration as any).mockResolvedValueOnce({ success: false, error: 'second fail' });

    const result = await BoltExecutor.execute(bolt, checkpoint, '/project', 'test-wf', handlers);

    expect(result.status).toBe('failed');
    expect(result.stages.code_generation.status).toBe('failed');
    expect(result.stages.code_generation.failure_count).toBe(2);
    expect(result.stages.build_and_test.status).toBe('not_started');
  });

  it('saves checkpoint after every stage transition', async () => {
    const bolt = makeBoltSpec();
    const checkpoint = makeCheckpoint();
    const handlers = makeSuccessHandlers();

    await BoltExecutor.execute(bolt, checkpoint, '/project', 'test-wf', handlers);

    expect(mockedSaveCheckpoint.mock.calls.length).toBeGreaterThanOrEqual(10);
  });

  it('sets active_bolt_id at start and clears at end on success', async () => {
    const bolt = makeBoltSpec();
    const checkpoint = makeCheckpoint();
    const handlers = makeSuccessHandlers();

    await BoltExecutor.execute(bolt, checkpoint, '/project', 'test-wf', handlers);

    expect(checkpoint.active_bolt_id).toBeNull();
    expect(checkpoint.active_bolt_stage).toBeNull();
  });

  it('clears active_bolt_id on terminal failure', async () => {
    const bolt = makeBoltSpec();
    const checkpoint = makeCheckpoint();
    checkpoint.construction_bolts!['BOLT-001-test'].stages.elaboration.failure_count = 1;
    const handlers = makeSuccessHandlers();
    (handlers.onElaboration as any).mockResolvedValueOnce({ success: false, error: 'fatal' });

    await BoltExecutor.execute(bolt, checkpoint, '/project', 'test-wf', handlers);

    expect(checkpoint.active_bolt_id).toBeNull();
    expect(checkpoint.active_bolt_stage).toBeNull();
  });

  it('transitions through planned -> in_progress -> built -> in_review -> done', async () => {
    const bolt = makeBoltSpec();
    const checkpoint = makeCheckpoint();
    const handlers = makeSuccessHandlers();
    const statusSnapshots: string[] = [];

    mockedSaveCheckpoint.mockImplementation(async (_path, cp) => {
      const progress = (cp as WorkflowCheckpointV3).construction_bolts!['BOLT-001-test'];
      statusSnapshots.push(progress.status);
    });

    await BoltExecutor.execute(bolt, checkpoint, '/project', 'test-wf', handlers);

    expect(statusSnapshots).toContain('in_progress');
    expect(statusSnapshots).toContain('built');
    expect(statusSnapshots).toContain('in_review');
    expect(statusSnapshots).toContain('done');
  });

  it('passes targetFiles from bolt.target_files to onBuildAndTest', async () => {
    const bolt = makeBoltSpec({ target_files: ['src/a.ts', 'src/b.ts'] });
    const checkpoint = makeCheckpoint();
    const handlers = makeSuccessHandlers();

    await BoltExecutor.execute(bolt, checkpoint, '/project', 'test-wf', handlers);

    expect(handlers.onBuildAndTest).toHaveBeenCalledWith(
      bolt, '/project', ['src/a.ts', 'src/b.ts'],
    );
  });
});
