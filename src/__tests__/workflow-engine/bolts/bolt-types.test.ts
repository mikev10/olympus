import { describe, it, expect } from 'vitest';
import type {
  BoltSpec,
  BoltExecutionStage,
  BoltStageProgress,
  ConstructionBoltProgress,
  HierarchicalNode,
  WorkflowCheckpointV3,
} from '../../../features/workflow-engine/phase-types.js';
import { BoltValidationError } from '../../../features/workflow-engine/phase-types.js';

describe('Bolt type foundation', () => {
  it('BoltSpec satisfies HierarchicalNode', () => {
    const spec: BoltSpec = {
      id: 'BOLT-001-test',
      type: 'bolt',
      title: 'Test',
      parent_id: 'UNIT-001',
      children_ids: [],
      status: 'pending',
      assigned_agent: null,
      estimated_effort: 2,
      parent_unit_id: 'UNIT-001',
      sequence: 1,
      scope: 'Test scope',
      acceptance_criteria: ['criterion'],
      target_files: [],
      dependencies: [],
      depth_target: 5,
      express_mode: false,
      estimated_effort_hours: 2,
    };

    const node: HierarchicalNode = spec;
    expect(node.type).toBe('bolt');
    expect(node.id).toBe('BOLT-001-test');
  });

  it('ConstructionBoltProgress has all four BoltExecutionStage keys', () => {
    const stages: BoltExecutionStage[] = [
      'elaboration',
      'code_generation',
      'build_and_test',
      'review',
    ];

    const defaultStage: BoltStageProgress = {
      status: 'not_started',
      started_at: null,
      completed_at: null,
      failure_count: 0,
      last_error: null,
      artifact_path: null,
    };

    const progress: ConstructionBoltProgress = {
      bolt_id: 'BOLT-001',
      parent_unit_id: 'UNIT-001',
      status: 'planned',
      stages: {
        elaboration: { ...defaultStage },
        code_generation: { ...defaultStage },
        build_and_test: { ...defaultStage },
        review: { ...defaultStage },
      },
      failure_count: 0,
      last_error: null,
      review_score: null,
      acknowledged_by: null,
      acknowledged_at: null,
    };

    for (const stage of stages) {
      expect(progress.stages[stage]).toBeDefined();
      expect(progress.stages[stage].status).toBe('not_started');
    }
  });

  it('BoltStageProgress has started_at field for timing', () => {
    const stage: BoltStageProgress = {
      status: 'in_progress',
      started_at: '2026-03-25T10:00:00Z',
      completed_at: null,
      failure_count: 0,
      last_error: null,
      artifact_path: null,
    };

    expect(stage.started_at).toBe('2026-03-25T10:00:00Z');
  });

  it('WorkflowCheckpointV3 accepts construction_bolts field', () => {
    const checkpoint = {
      construction_bolts: {
        'BOLT-001': {
          bolt_id: 'BOLT-001',
          parent_unit_id: 'UNIT-001',
          status: 'planned' as const,
          stages: {
            elaboration: { status: 'not_started' as const, started_at: null, completed_at: null, failure_count: 0, last_error: null, artifact_path: null },
            code_generation: { status: 'not_started' as const, started_at: null, completed_at: null, failure_count: 0, last_error: null, artifact_path: null },
            build_and_test: { status: 'not_started' as const, started_at: null, completed_at: null, failure_count: 0, last_error: null, artifact_path: null },
            review: { status: 'not_started' as const, started_at: null, completed_at: null, failure_count: 0, last_error: null, artifact_path: null },
          },
          failure_count: 0,
          last_error: null,
          review_score: null,
          acknowledged_by: null,
          acknowledged_at: null,
        },
      },
      active_bolt_id: null,
      active_bolt_stage: null,
    } satisfies Partial<WorkflowCheckpointV3>;

    expect(checkpoint.construction_bolts).toBeDefined();
    expect(checkpoint.construction_bolts['BOLT-001'].bolt_id).toBe('BOLT-001');
    expect(checkpoint.active_bolt_id).toBeNull();
    expect(checkpoint.active_bolt_stage).toBeNull();
  });

  it('BoltValidationError extends Error and has code property', () => {
    const error = new BoltValidationError('INVALID_ID_FORMAT', 'test message');

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(BoltValidationError);
    expect(error.name).toBe('BoltValidationError');
    expect(error.code).toBe('INVALID_ID_FORMAT');
    expect(error.message).toBe('test message');
  });
});
