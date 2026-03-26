import { describe, it, expect } from 'vitest';
import { isExpressBoltEligible, createExpressBolt } from '../../../features/workflow-engine/bolts/express-bolt-factory.js';
import type { HierarchicalNode, WorkflowCheckpointV3 } from '../../../features/workflow-engine/phase-types.js';

function makeUnit(overrides: Partial<HierarchicalNode> = {}): HierarchicalNode {
  return {
    id: 'UNIT-001-test',
    type: 'unit',
    title: 'Test Unit',
    parent_id: null,
    children_ids: [],
    status: 'pending',
    assigned_agent: null,
    estimated_effort: 2,
    ...overrides,
  };
}

function makeCheckpoint(existingBoltCount = 0): WorkflowCheckpointV3 {
  const bolts: Record<string, any> = {};
  for (let i = 1; i <= existingBoltCount; i++) {
    bolts[`BOLT-${String(i).padStart(3, '0')}-existing`] = { bolt_id: `BOLT-${String(i).padStart(3, '0')}-existing` };
  }
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
    construction_bolts: bolts,
  };
}

describe('isExpressBoltEligible', () => {
  it('returns true when depthTarget is 4 (boundary)', () => {
    expect(isExpressBoltEligible(4, 'greenfield')).toBe(true);
  });

  it('returns false when depthTarget is 5 for non-bugfix pathway', () => {
    expect(isExpressBoltEligible(5, 'greenfield')).toBe(false);
  });

  it('returns true for bugfix pathway regardless of depth', () => {
    expect(isExpressBoltEligible(8, 'bugfix')).toBe(true);
  });

  it('returns false when depthTarget is 5 for brownfield-enhancement', () => {
    expect(isExpressBoltEligible(5, 'brownfield-enhancement')).toBe(false);
  });

  it('returns true when depthTarget is 1 (minimum)', () => {
    expect(isExpressBoltEligible(1, 'brownfield-refactor')).toBe(true);
  });
});

describe('createExpressBolt', () => {
  it('returns BoltSpec with express_mode true', () => {
    const bolt = createExpressBolt(makeUnit(), 'some intent', makeCheckpoint());
    expect(bolt.express_mode).toBe(true);
  });

  it('sets sequence to 1 and type to bolt', () => {
    const bolt = createExpressBolt(makeUnit(), 'intent', makeCheckpoint());
    expect(bolt.sequence).toBe(1);
    expect(bolt.type).toBe('bolt');
  });

  it('generates BOLT-NNN-slug format ID', () => {
    const bolt = createExpressBolt(makeUnit({ title: 'Auth Service' }), 'intent', makeCheckpoint());
    expect(bolt.id).toBe('BOLT-001-auth-service');
  });

  it('copies acceptance_criteria from unit when present', () => {
    const unit = makeUnit() as any;
    unit.acceptance_criteria = ['Must handle auth', 'Must validate tokens'];
    const bolt = createExpressBolt(unit, 'intent', makeCheckpoint());
    expect(bolt.acceptance_criteria).toEqual(['Must handle auth', 'Must validate tokens']);
  });

  it('uses default criteria when unit has none', () => {
    const bolt = createExpressBolt(makeUnit(), 'intent', makeCheckpoint());
    expect(bolt.acceptance_criteria).toEqual(['Implement as described in intent']);
  });

  it('computes correct global bolt index from existing bolts', () => {
    const bolt = createExpressBolt(makeUnit({ title: 'New Feature' }), 'intent', makeCheckpoint(5));
    expect(bolt.id).toBe('BOLT-006-new-feature');
  });

  it('sets parent_unit_id to unit id', () => {
    const bolt = createExpressBolt(makeUnit({ id: 'UNIT-003-api' }), 'intent', makeCheckpoint());
    expect(bolt.parent_unit_id).toBe('UNIT-003-api');
  });

  it('handles empty construction_bolts on checkpoint', () => {
    const checkpoint = makeCheckpoint();
    checkpoint.construction_bolts = undefined;
    const bolt = createExpressBolt(makeUnit({ title: 'First' }), 'intent', checkpoint);
    expect(bolt.id).toBe('BOLT-001-first');
  });

  it('copies target_files from unit when present', () => {
    const unit = makeUnit() as any;
    unit.target_files = ['src/foo.ts', 'src/bar.ts'];
    const bolt = createExpressBolt(unit, 'intent', makeCheckpoint());
    expect(bolt.target_files).toEqual(['src/foo.ts', 'src/bar.ts']);
  });
});
