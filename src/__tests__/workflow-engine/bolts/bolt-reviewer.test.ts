import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import fs from 'fs-extra';
import type {
  BoltSpec,
  BoltStageProgress,
  WorkflowCheckpointV3,
  ConstructionBoltProgress,
} from '../../../features/workflow-engine/phase-types.js';
import type { AgentReviewResult } from '../../../features/workflow-engine/bolts/bolt-reviewer.js';

vi.mock('../../../features/workflow-engine/checkpoint.js', () => ({
  saveCheckpoint: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../features/workflow-engine/trust.js', () => ({
  loadTrustState: vi.fn().mockReturnValue({
    current_level: 0,
    total_transitions: 0,
    rejection_count: 0,
    rejection_rate: 0,
    incident_count: 0,
    last_level_change: null,
    level_history: [],
    consecutive_rejections: 0,
    transition_history: [],
  }),
}));

import { saveCheckpoint } from '../../../features/workflow-engine/checkpoint.js';
import { loadTrustState } from '../../../features/workflow-engine/trust.js';
import { applyTierLogic, BoltReviewer } from '../../../features/workflow-engine/bolts/bolt-reviewer.js';

const mockedSaveCheckpoint = vi.mocked(saveCheckpoint);
const mockedLoadTrustState = vi.mocked(loadTrustState);

function makeStageProgress(overrides: Partial<BoltStageProgress> = {}): BoltStageProgress {
  return {
    status: 'not_started',
    started_at: null,
    completed_at: null,
    failure_count: 0,
    last_error: null,
    artifact_path: null,
    ...overrides,
  };
}

function makeBoltSpec(overrides: Partial<BoltSpec> = {}): BoltSpec {
  return {
    id: 'BOLT-001',
    type: 'bolt',
    title: 'Test Bolt',
    parent_id: 'UNIT-001',
    children_ids: [],
    status: 'pending',
    assigned_agent: null,
    estimated_effort: 2,
    parent_unit_id: 'UNIT-001',
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

function makeCheckpointWithBolt(
  boltId: string,
  reviewFailureCount: number,
  lastError: string | null = null,
): WorkflowCheckpointV3 {
  const boltProgress: ConstructionBoltProgress = {
    bolt_id: boltId,
    parent_unit_id: 'UNIT-001',
    status: 'in_review',
    stages: {
      elaboration: makeStageProgress({ status: 'completed' }),
      code_generation: makeStageProgress({ status: 'completed' }),
      build_and_test: makeStageProgress({ status: 'completed' }),
      review: makeStageProgress({ failure_count: reviewFailureCount, last_error: lastError }),
    },
    failure_count: 0,
    last_error: null,
    review_score: null,
    acknowledged_by: null,
    acknowledged_at: null,
  };

  return {
    schema_version: '3.0.0',
    workflow_id: 'test-wf',
    feature_name: 'test',
    current_phase: 'construction',
    current_stage: 'unit',
    status: 'in_progress',
    phases: {
      discovery: { status: 'complete', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
      inception: { status: 'complete', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
      construction: { status: 'in_progress', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
      operations: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
    },
    manifest_path: '',
    trust_state_path: '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    construction_bolts: {
      [boltId]: boltProgress,
    },
  };
}

function makeReviewCallback(result: AgentReviewResult) {
  return vi.fn().mockResolvedValue(result);
}

let tmpDir: string;

beforeEach(() => {
  vi.clearAllMocks();
  tmpDir = mkdtempSync(join(tmpdir(), 'bolt-reviewer-'));
  mockedLoadTrustState.mockReturnValue({
    current_level: 0,
    total_transitions: 0,
    rejection_count: 0,
    rejection_rate: 0,
    incident_count: 0,
    last_level_change: null,
    level_history: [],
    consecutive_rejections: 0,
    transition_history: [],
  });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('applyTierLogic', () => {
  it('returns auto_approve for score 75', () => {
    expect(applyTierLogic(75)).toBe('auto_approve');
  });

  it('returns auto_approve for boundary score 70', () => {
    expect(applyTierLogic(70)).toBe('auto_approve');
  });

  it('returns advisory_ack for score 60', () => {
    expect(applyTierLogic(60)).toBe('advisory_ack');
  });

  it('returns advisory_ack for boundary score 50', () => {
    expect(applyTierLogic(50)).toBe('advisory_ack');
  });

  it('returns hard_block for score 49', () => {
    expect(applyTierLogic(49)).toBe('hard_block');
  });

  it('returns hard_block for score 45', () => {
    expect(applyTierLogic(45)).toBe('hard_block');
  });

  it('returns hard_block for score 0', () => {
    expect(applyTierLogic(0)).toBe('hard_block');
  });

  it('returns auto_approve for score 100', () => {
    expect(applyTierLogic(100)).toBe('auto_approve');
  });
});

describe('review', () => {
  const reviewer = new BoltReviewer();

  it('auto-approves score 75 with trust 0', async () => {
    const bolt = makeBoltSpec();
    const checkpoint = makeCheckpointWithBolt('BOLT-001', 0);
    const callback = makeReviewCallback({ score: 75, feedback: 'Good work', concerns: [] });

    const decision = await reviewer.review(bolt, ['src/foo.ts'], tmpDir, 'test-wf', checkpoint, callback);

    expect(decision.approved).toBe(true);
    expect(decision.requiresAcknowledgment).toBe(false);
    expect(decision.tier).toBe('auto_approve');
    expect(decision.score).toBe(75);
  });

  it('returns advisory_ack for score 60 with trust 0', async () => {
    const bolt = makeBoltSpec();
    const checkpoint = makeCheckpointWithBolt('BOLT-001', 0);
    const callback = makeReviewCallback({ score: 60, feedback: 'Needs work', concerns: ['Missing tests'] });

    const decision = await reviewer.review(bolt, ['src/foo.ts'], tmpDir, 'test-wf', checkpoint, callback);

    expect(decision.approved).toBe(true);
    expect(decision.requiresAcknowledgment).toBe(true);
    expect(decision.tier).toBe('advisory_ack');
  });

  it('hard-blocks score 45 with trust 0', async () => {
    const bolt = makeBoltSpec();
    const checkpoint = makeCheckpointWithBolt('BOLT-001', 0);
    const callback = makeReviewCallback({ score: 45, feedback: 'Major issues', concerns: ['Broken'] });

    const decision = await reviewer.review(bolt, ['src/foo.ts'], tmpDir, 'test-wf', checkpoint, callback);

    expect(decision.approved).toBe(false);
    expect(decision.requiresAcknowledgment).toBe(false);
    expect(decision.tier).toBe('hard_block');
  });

  it('upgrades advisory_ack to auto_approve when trust >= 2', async () => {
    mockedLoadTrustState.mockReturnValue({
      current_level: 2,
      total_transitions: 20,
      rejection_count: 0,
      rejection_rate: 0,
      incident_count: 0,
      last_level_change: null,
      level_history: [],
      consecutive_rejections: 0,
      transition_history: [],
    });

    const bolt = makeBoltSpec();
    const checkpoint = makeCheckpointWithBolt('BOLT-001', 0);
    const callback = makeReviewCallback({ score: 60, feedback: 'OK', concerns: [] });

    const decision = await reviewer.review(bolt, ['src/foo.ts'], tmpDir, 'test-wf', checkpoint, callback);

    expect(decision.approved).toBe(true);
    expect(decision.requiresAcknowledgment).toBe(false);
    expect(decision.tier).toBe('auto_approve');
  });

  it('does NOT override hard_block even with trust >= 2', async () => {
    mockedLoadTrustState.mockReturnValue({
      current_level: 2,
      total_transitions: 20,
      rejection_count: 0,
      rejection_rate: 0,
      incident_count: 0,
      last_level_change: null,
      level_history: [],
      consecutive_rejections: 0,
      transition_history: [],
    });

    const bolt = makeBoltSpec();
    const checkpoint = makeCheckpointWithBolt('BOLT-001', 0);
    const callback = makeReviewCallback({ score: 45, feedback: 'Bad', concerns: ['Critical'] });

    const decision = await reviewer.review(bolt, ['src/foo.ts'], tmpDir, 'test-wf', checkpoint, callback);

    expect(decision.approved).toBe(false);
    expect(decision.tier).toBe('hard_block');
  });
});

describe('escalation', () => {
  const reviewer = new BoltReviewer();

  it('attaches escalation when failure_count >= 2', async () => {
    const bolt = makeBoltSpec();
    const checkpoint = makeCheckpointWithBolt('BOLT-001', 2, 'Previous error');
    const callback = makeReviewCallback({ score: 60, feedback: 'Retry', concerns: [] });

    const decision = await reviewer.review(bolt, ['src/foo.ts'], tmpDir, 'test-wf', checkpoint, callback);

    expect(decision.escalation).toBeDefined();
    expect(decision.escalation!.bolt_id).toBe('BOLT-001');
    expect(decision.escalation!.failure_count).toBe(2);
    expect(decision.escalation!.recommended_actions).toEqual(['re-scope', 'split']);
    expect(decision.escalation!.last_errors).toContain('Previous error');
  });

  it('does not attach escalation when failure_count is 1', async () => {
    const bolt = makeBoltSpec();
    const checkpoint = makeCheckpointWithBolt('BOLT-001', 1);
    const callback = makeReviewCallback({ score: 60, feedback: 'OK', concerns: [] });

    const decision = await reviewer.review(bolt, ['src/foo.ts'], tmpDir, 'test-wf', checkpoint, callback);

    expect(decision.escalation).toBeUndefined();
  });

  it('does not attach escalation when failure_count is 0', async () => {
    const bolt = makeBoltSpec();
    const checkpoint = makeCheckpointWithBolt('BOLT-001', 0);
    const callback = makeReviewCallback({ score: 45, feedback: 'Bad', concerns: [] });

    const decision = await reviewer.review(bolt, ['src/foo.ts'], tmpDir, 'test-wf', checkpoint, callback);

    expect(decision.escalation).toBeUndefined();
  });
});

describe('artifacts and checkpoint', () => {
  const reviewer = new BoltReviewer();

  it('writes review.md to the correct path', async () => {
    const bolt = makeBoltSpec();
    const checkpoint = makeCheckpointWithBolt('BOLT-001', 0);
    const callback = makeReviewCallback({ score: 80, feedback: 'Great', concerns: [] });

    const decision = await reviewer.review(bolt, ['src/foo.ts'], tmpDir, 'test-wf', checkpoint, callback);

    const expectedRelative = join('aidlc-docs', 'test-wf', 'construction', 'bolts', 'BOLT-001', 'review.md');
    expect(decision.artifact_path).toBe(expectedRelative);

    const absolutePath = join(tmpDir, expectedRelative);
    const exists = await fs.pathExists(absolutePath);
    expect(exists).toBe(true);

    const content = await fs.readFile(absolutePath, 'utf-8');
    expect(content).toContain('bolt_id: "BOLT-001"');
    expect(content).toContain('score: 80');
    expect(content).toContain('## Score');
    expect(content).toContain('## Decision');
    expect(content).toContain('## Feedback');
  });

  it('updates checkpoint review_score', async () => {
    const bolt = makeBoltSpec();
    const checkpoint = makeCheckpointWithBolt('BOLT-001', 0);
    const callback = makeReviewCallback({ score: 72, feedback: 'OK', concerns: [] });

    await reviewer.review(bolt, ['src/foo.ts'], tmpDir, 'test-wf', checkpoint, callback);

    expect(checkpoint.construction_bolts!['BOLT-001'].review_score).toBe(72);
  });

  it('calls saveCheckpoint after updating score', async () => {
    const bolt = makeBoltSpec();
    const checkpoint = makeCheckpointWithBolt('BOLT-001', 0);
    const callback = makeReviewCallback({ score: 65, feedback: 'OK', concerns: [] });

    await reviewer.review(bolt, ['src/foo.ts'], tmpDir, 'test-wf', checkpoint, callback);

    expect(mockedSaveCheckpoint).toHaveBeenCalledOnce();
    expect(mockedSaveCheckpoint).toHaveBeenCalledWith(tmpDir, checkpoint);
  });

  it('passes correct arguments to reviewCallback', async () => {
    const bolt = makeBoltSpec({ id: 'BOLT-002' });
    const codePaths = ['src/a.ts', 'src/b.ts'];
    const checkpoint = makeCheckpointWithBolt('BOLT-002', 0);
    const callback = makeReviewCallback({ score: 90, feedback: 'Perfect', concerns: [] });

    await reviewer.review(bolt, codePaths, tmpDir, 'test-wf', checkpoint, callback);

    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(bolt, codePaths, tmpDir);
  });
});
