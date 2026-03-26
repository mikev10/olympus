import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import {
  validateBoltCoverage,
  parseAgentResponse,
  writeBoltArtifacts,
  registerBoltsInCheckpoint,
  buildDecompositionPrompt,
  BoltPlannerError,
} from '../../../features/workflow-engine/bolts/bolt-planner.js';
import type {
  BoltSpec,
  WorkflowCheckpointV3,
  HierarchicalNode,
} from '../../../features/workflow-engine/phase-types.js';

function makeBoltSpec(overrides: Partial<BoltSpec> = {}): BoltSpec {
  return {
    id: 'BOLT-001-test-bolt',
    type: 'bolt',
    title: 'Test Bolt',
    parent_id: 'UNIT-001-test',
    children_ids: [],
    status: 'pending',
    assigned_agent: null,
    estimated_effort: 4,
    parent_unit_id: 'UNIT-001-test',
    sequence: 1,
    scope: 'Test scope',
    acceptance_criteria: ['criterion one'],
    target_files: ['src/test.ts'],
    dependencies: [],
    depth_target: 5,
    express_mode: false,
    estimated_effort_hours: 4,
    requirements: [],
    stories: [],
    docs_impact: ['none'],
    ...overrides,
  };
}

function makeUnit(overrides: Partial<HierarchicalNode> = {}): HierarchicalNode {
  return {
    id: 'UNIT-001-test',
    type: 'unit',
    title: 'Test Unit',
    parent_id: null,
    children_ids: [],
    status: 'pending',
    assigned_agent: null,
    estimated_effort: 20,
    ...overrides,
  };
}

function makeCheckpoint(overrides: Partial<WorkflowCheckpointV3> = {}): WorkflowCheckpointV3 {
  return {
    schema_version: '3.0.0',
    workflow_id: 'test-workflow',
    feature_name: 'Test Feature',
    current_phase: 'construction',
    current_stage: 'code-generation',
    status: 'in_progress',
    phases: {
      discovery: { status: 'completed', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
      inception: { status: 'completed', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
      construction: { status: 'in_progress', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
      operations: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
    },
    manifest_path: '',
    trust_state_path: '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

const TEST_DIR = path.join(process.cwd(), '.test-bolt-planner');

afterEach(async () => {
  await fs.remove(TEST_DIR).catch(() => {});
});

describe('validateBoltCoverage', () => {
  it('returns 100% pass for full coverage', () => {
    const bolts = [
      makeBoltSpec({ acceptance_criteria: ['criterion A', 'criterion B'] }),
    ];
    const result = validateBoltCoverage(['criterion A', 'criterion B'], bolts);
    expect(result.coverage_percent).toBe(100);
    expect(result.passed).toBe(true);
    expect(result.requiresAcknowledgment).toBe(false);
    expect(result.uncovered_criteria).toEqual([]);
  });

  it('returns pass silently at 95% coverage', () => {
    const criteria = Array.from({ length: 20 }, (_, i) => `criterion ${i}`);
    const boltCriteria = criteria.slice(0, 19).map((c) => c);
    const bolts = [makeBoltSpec({ acceptance_criteria: boltCriteria })];
    const result = validateBoltCoverage(criteria, bolts);
    expect(result.coverage_percent).toBe(95);
    expect(result.passed).toBe(true);
    expect(result.requiresAcknowledgment).toBe(false);
  });

  it('returns warn+ack at 85% coverage', () => {
    const criteria = Array.from({ length: 20 }, (_, i) => `criterion ${i}`);
    const boltCriteria = criteria.slice(0, 17).map((c) => c);
    const bolts = [makeBoltSpec({ acceptance_criteria: boltCriteria })];
    const result = validateBoltCoverage(criteria, bolts);
    expect(result.coverage_percent).toBe(85);
    expect(result.passed).toBe(true);
    expect(result.requiresAcknowledgment).toBe(true);
    expect(result.uncovered_criteria.length).toBeGreaterThan(0);
  });

  it('returns block at 79% coverage', () => {
    const criteria = Array.from({ length: 100 }, (_, i) => `criterion ${i}`);
    const boltCriteria = criteria.slice(0, 79).map((c) => c);
    const bolts = [makeBoltSpec({ acceptance_criteria: boltCriteria })];
    const result = validateBoltCoverage(criteria, bolts);
    expect(result.coverage_percent).toBe(79);
    expect(result.passed).toBe(false);
  });

  it('returns 100% pass for empty unit criteria (vacuously true)', () => {
    const bolts = [makeBoltSpec()];
    const result = validateBoltCoverage([], bolts);
    expect(result.coverage_percent).toBe(100);
    expect(result.passed).toBe(true);
    expect(result.requiresAcknowledgment).toBe(false);
  });
});

describe('parseAgentResponse', () => {
  const unit = makeUnit();

  it('parses valid JSON array into BoltSpec[] with hydrated fields', () => {
    const agentJson = JSON.stringify([
      {
        title: 'Add Login',
        scope: 'Implement login flow',
        acceptance_criteria: ['User can log in'],
        target_files: ['src/auth.ts'],
        dependencies: [],
        estimated_effort_hours: 3,
      },
    ]);
    const bolts = parseAgentResponse(agentJson, unit, 1, 5);
    expect(bolts).toHaveLength(1);
    expect(bolts[0].id).toBe('BOLT-001-add-login');
    expect(bolts[0].type).toBe('bolt');
    expect(bolts[0].parent_unit_id).toBe('UNIT-001-test');
    expect(bolts[0].sequence).toBe(1);
    expect(bolts[0].depth_target).toBe(5);
    expect(bolts[0].express_mode).toBe(false);
  });

  it('throws BoltPlannerError for invalid JSON', () => {
    expect(() => parseAgentResponse('not json', unit, 1, 5)).toThrow(BoltPlannerError);
    try {
      parseAgentResponse('not json at all', unit, 1, 5);
    } catch (e) {
      expect((e as BoltPlannerError).code).toBe('AGENT_PARSE_FAILURE');
    }
  });

  it('throws BoltValidationError for spec failing validation (empty scope)', () => {
    const agentJson = JSON.stringify([
      {
        title: 'Bad Bolt',
        scope: '',
        acceptance_criteria: ['some criterion'],
        target_files: [],
        dependencies: [],
        estimated_effort_hours: 1,
      },
    ]);
    expect(() => parseAgentResponse(agentJson, unit, 1, 5)).toThrow();
  });

  it('assigns correct BOLT-NNN-slug IDs', () => {
    const agentJson = JSON.stringify([
      {
        title: 'First Task',
        scope: 'Do something',
        acceptance_criteria: ['it works'],
        target_files: ['a.ts'],
        dependencies: [],
        estimated_effort_hours: 2,
      },
      {
        title: 'Second Task',
        scope: 'Do more',
        acceptance_criteria: ['it also works'],
        target_files: ['b.ts'],
        dependencies: [],
        estimated_effort_hours: 2,
      },
    ]);
    const bolts = parseAgentResponse(agentJson, unit, 5, 3);
    expect(bolts[0].id).toBe('BOLT-005-first-task');
    expect(bolts[1].id).toBe('BOLT-006-second-task');
  });

  it('sets express_mode=true when depth <= 4', () => {
    const agentJson = JSON.stringify([
      {
        title: 'Quick Bolt',
        scope: 'Fast work',
        acceptance_criteria: ['done'],
        target_files: ['x.ts'],
        dependencies: [],
        estimated_effort_hours: 1,
      },
    ]);
    const bolts = parseAgentResponse(agentJson, unit, 1, 4);
    expect(bolts[0].express_mode).toBe(true);
  });

  it('sets express_mode=false when depth >= 5', () => {
    const agentJson = JSON.stringify([
      {
        title: 'Deep Bolt',
        scope: 'Thorough work',
        acceptance_criteria: ['verified'],
        target_files: ['y.ts'],
        dependencies: [],
        estimated_effort_hours: 2,
      },
    ]);
    const bolts = parseAgentResponse(agentJson, unit, 1, 5);
    expect(bolts[0].express_mode).toBe(false);
  });
});

describe('writeBoltArtifacts', () => {
  it('creates spec.md at the correct path with frontmatter', async () => {
    const bolt = makeBoltSpec({
      id: 'BOLT-001-write-test',
      title: 'Write Test',
      parent_unit_id: 'UNIT-001-test',
    });
    await writeBoltArtifacts([bolt], TEST_DIR, 'test-wf');

    const specPath = path.join(
      TEST_DIR,
      'aidlc-docs',
      'test-wf',
      'construction',
      'bolts',
      'BOLT-001-write-test',
      'spec.md'
    );
    expect(await fs.pathExists(specPath)).toBe(true);

    const content = await fs.readFile(specPath, 'utf-8');
    expect(content).toContain('id: BOLT-001-write-test');
    expect(content).toContain('## Scope');
    expect(content).toContain('## Acceptance Criteria');
    expect(content).toContain('## Target Files');
    expect(content).toContain('## Dependencies');
  });

  it('creates bolt plan summary', async () => {
    const bolt = makeBoltSpec({ parent_unit_id: 'UNIT-002-summary' });
    await writeBoltArtifacts([bolt], TEST_DIR, 'test-wf');

    const summaryPath = path.join(
      TEST_DIR,
      'aidlc-docs',
      'test-wf',
      'construction',
      'plans',
      'UNIT-002-summary-bolt-plan.md'
    );
    expect(await fs.pathExists(summaryPath)).toBe(true);
  });

  it('creates directories if missing (ensureDir)', async () => {
    const bolt = makeBoltSpec({ id: 'BOLT-003-new-dir' });
    const deepPath = path.join(TEST_DIR, 'deep', 'nested');
    await writeBoltArtifacts([bolt], deepPath, 'test-wf');

    const specPath = path.join(
      deepPath,
      'aidlc-docs',
      'test-wf',
      'construction',
      'bolts',
      'BOLT-003-new-dir',
      'spec.md'
    );
    expect(await fs.pathExists(specPath)).toBe(true);
  });
});

describe('registerBoltsInCheckpoint', () => {
  it('adds bolt to checkpoint.construction_bolts', () => {
    const checkpoint = makeCheckpoint({ construction_bolts: {} });
    const bolt = makeBoltSpec({ id: 'BOLT-001-reg-test' });
    registerBoltsInCheckpoint([bolt], checkpoint);
    expect(checkpoint.construction_bolts!['BOLT-001-reg-test']).toBeDefined();
    expect(checkpoint.construction_bolts!['BOLT-001-reg-test'].bolt_id).toBe('BOLT-001-reg-test');
    expect(checkpoint.construction_bolts!['BOLT-001-reg-test'].status).toBe('planned');
  });

  it('initializes all four stage keys', () => {
    const checkpoint = makeCheckpoint({ construction_bolts: {} });
    const bolt = makeBoltSpec();
    registerBoltsInCheckpoint([bolt], checkpoint);
    const progress = checkpoint.construction_bolts![bolt.id];
    expect(progress.stages.elaboration).toBeDefined();
    expect(progress.stages.code_generation).toBeDefined();
    expect(progress.stages.build_and_test).toBeDefined();
    expect(progress.stages.review).toBeDefined();
  });

  it('initializes stages to not_started', () => {
    const checkpoint = makeCheckpoint({ construction_bolts: {} });
    const bolt = makeBoltSpec();
    registerBoltsInCheckpoint([bolt], checkpoint);
    const progress = checkpoint.construction_bolts![bolt.id];
    for (const stage of Object.values(progress.stages)) {
      expect(stage.status).toBe('not_started');
      expect(stage.started_at).toBeNull();
      expect(stage.completed_at).toBeNull();
      expect(stage.failure_count).toBe(0);
      expect(stage.last_error).toBeNull();
      expect(stage.artifact_path).toBeNull();
    }
  });

  it('initializes construction_bolts from undefined', () => {
    const checkpoint = makeCheckpoint();
    delete checkpoint.construction_bolts;
    const bolt = makeBoltSpec();
    registerBoltsInCheckpoint([bolt], checkpoint);
    expect(checkpoint.construction_bolts).toBeDefined();
    expect(checkpoint.construction_bolts![bolt.id]).toBeDefined();
  });

  it('registers multiple bolts', () => {
    const checkpoint = makeCheckpoint({ construction_bolts: {} });
    const bolt1 = makeBoltSpec({ id: 'BOLT-001-first', sequence: 1 });
    const bolt2 = makeBoltSpec({ id: 'BOLT-002-second', sequence: 2 });
    registerBoltsInCheckpoint([bolt1, bolt2], checkpoint);
    expect(Object.keys(checkpoint.construction_bolts!)).toHaveLength(2);
    expect(checkpoint.construction_bolts!['BOLT-001-first']).toBeDefined();
    expect(checkpoint.construction_bolts!['BOLT-002-second']).toBeDefined();
  });
});

describe('buildDecompositionPrompt', () => {
  it('includes unit ID, title, and estimated effort', () => {
    const unit = makeUnit({ id: 'UNIT-005-auth', title: 'Auth Service', estimated_effort: 40 });
    const prompt = buildDecompositionPrompt(unit, 'Build auth', 5);
    expect(prompt).toContain('UNIT-005-auth');
    expect(prompt).toContain('Auth Service');
    expect(prompt).toContain('40');
  });

  it('includes depth and max bolts constraint', () => {
    const unit = makeUnit();
    const prompt = buildDecompositionPrompt(unit, 'Some intent', 7);
    expect(prompt).toContain('Depth Level: 7');
    expect(prompt).toContain('Maximum 8 bolts per unit');
  });

  it('requests JSON output format', () => {
    const unit = makeUnit();
    const prompt = buildDecompositionPrompt(unit, 'Some intent', 5);
    expect(prompt).toContain('JSON array');
    expect(prompt).toContain('title');
    expect(prompt).toContain('scope');
    expect(prompt).toContain('acceptance_criteria');
    expect(prompt).toContain('target_files');
  });

  it('includes acceptance criteria from unit when available', () => {
    const unit = makeUnit() as any;
    unit.acceptance_criteria = ['User can log in', 'Session persists'];
    const prompt = buildDecompositionPrompt(unit, 'Some intent', 5);
    expect(prompt).toContain('User can log in');
    expect(prompt).toContain('Session persists');
  });

  it('truncates intent summary to 500 chars', () => {
    const unit = makeUnit();
    const longIntent = 'x'.repeat(600);
    const prompt = buildDecompositionPrompt(unit, longIntent, 5);
    expect(prompt).toContain('...');
    expect(prompt).not.toContain('x'.repeat(600));
  });
});
