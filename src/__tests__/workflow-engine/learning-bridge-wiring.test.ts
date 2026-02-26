import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { captureWorkflowDiscovery } from '../../features/workflow-engine/learning-bridge.js';
import { recordDiscovery, readDiscoveries } from '../../learning/discovery.js';
import type { WorkflowEvent, WorkflowContext } from '../../features/workflow-engine/learning-bridge.js';

const TEST_DIR = join(process.cwd(), '.test-learning-bridge-wiring');

// Override learning dir to use test directory
const originalEnv = process.env.OLYMPUS_TEST_LEARNING_DIR;

beforeEach(() => {
  process.env.OLYMPUS_TEST_LEARNING_DIR = join(TEST_DIR, 'learning');
  mkdirSync(join(TEST_DIR, '.olympus', 'learning'), { recursive: true });
  mkdirSync(join(TEST_DIR, 'learning'), { recursive: true });
});

afterEach(() => {
  if (originalEnv !== undefined) {
    process.env.OLYMPUS_TEST_LEARNING_DIR = originalEnv;
  } else {
    delete process.env.OLYMPUS_TEST_LEARNING_DIR;
  }
  try {
    rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

describe('Learning Bridge Wiring Integration', () => {
  const baseContext: WorkflowContext = {
    workflowId: 'test-workflow',
    featureName: 'test-feature',
    projectPath: TEST_DIR,
    sessionId: 'test-session',
    phase: 'construction',
  };

  it('gate rejection event creates discovery and persists to JSONL', () => {
    const event: WorkflowEvent = {
      type: 'gate_rejection',
      phase: 'inception',
      stage: 'intent',
      details: 'INTENT does not address INTENT constraints',
    };

    const discovery = captureWorkflowDiscovery(event, {
      ...baseContext,
      phase: 'inception',
    });

    // Verify discovery was created correctly
    expect(discovery.category).toBe('gotcha');
    expect(discovery.details).toContain('gate_rejection');

    // Persist via recordDiscovery
    const persisted = recordDiscovery(discovery);
    expect(persisted.id).toBeDefined();

    // Verify it can be read back
    const summary = readDiscoveries(TEST_DIR);
    expect(summary.total_discoveries).toBeGreaterThanOrEqual(1);
    const found = [...summary.project_discoveries, ...summary.global_discoveries].find(
      d => d.details.includes('INTENT does not address INTENT constraints')
    );
    expect(found).toBeDefined();
  });

  it('BOLT completion event creates discovery and persists to JSONL', () => {
    const event: WorkflowEvent = {
      type: 'bolt_execution_complete',
      phase: 'construction',
      stage: 'bolt',
      details: 'BOLT-001 executed by olympian',
      artifactId: 'BOLT-001',
      agentName: 'olympian',
    };

    const discovery = captureWorkflowDiscovery(event, baseContext);

    expect(discovery.category).toBe('workflow_gate');
    expect(discovery.agent_name).toBe('olympian');
    expect(discovery.verified).toBe(true);

    // Persist via recordDiscovery
    const persisted = recordDiscovery(discovery);
    expect(persisted.id).toBeDefined();

    // Verify it can be read back
    const summary = readDiscoveries(TEST_DIR);
    const found = [...summary.project_discoveries, ...summary.global_discoveries].find(
      d => d.details.includes('BOLT-001')
    );
    expect(found).toBeDefined();
  });

  it('depth assessment event creates discovery and persists to JSONL', () => {
    const event: WorkflowEvent = {
      type: 'depth_assessment_complete',
      phase: 'inception',
      details: 'MODERATE (score: 15)',
    };

    const discovery = captureWorkflowDiscovery(event, {
      ...baseContext,
      phase: 'inception',
      depthScore: 15,
    });

    expect(discovery.category).toBe('planning_insight');
    expect(discovery.details).toContain('Depth Score: 15');

    const persisted = recordDiscovery(discovery);
    expect(persisted.id).toBeDefined();

    const summary = readDiscoveries(TEST_DIR);
    expect(summary.total_discoveries).toBeGreaterThanOrEqual(1);
  });

  it('gate approval event creates discovery and persists to JSONL', () => {
    const event: WorkflowEvent = {
      type: 'gate_approval',
      phase: 'inception',
      stage: 'intent',
      details: 'Gate approved for inception phase',
    };

    const discovery = captureWorkflowDiscovery(event, {
      ...baseContext,
      phase: 'inception',
    });

    expect(discovery.category).toBe('pattern');
    expect(discovery.verified).toBe(true);

    const persisted = recordDiscovery(discovery);
    expect(persisted.id).toBeDefined();
  });

  it('phase transition event creates discovery and persists to JSONL', () => {
    const event: WorkflowEvent = {
      type: 'phase_complete',
      phase: 'inception',
      details: 'Inception stages completed',
    };

    const discovery = captureWorkflowDiscovery(event, {
      ...baseContext,
      phase: 'inception',
    });

    expect(discovery.category).toBe('pattern');
    expect(discovery.verified).toBe(true);

    const persisted = recordDiscovery(discovery);
    expect(persisted.id).toBeDefined();

    const summary = readDiscoveries(TEST_DIR);
    const found = [...summary.project_discoveries, ...summary.global_discoveries].find(
      d => d.details.includes('Inception stages completed')
    );
    expect(found).toBeDefined();
  });

  it('multiple events accumulate in JSONL', () => {
    // Gate rejection
    const rejectionEvent: WorkflowEvent = {
      type: 'gate_rejection',
      phase: 'inception',
      details: 'First rejection',
    };
    const d1 = captureWorkflowDiscovery(rejectionEvent, { ...baseContext, phase: 'inception' });
    recordDiscovery(d1);

    // Gate approval after rejection
    const approvalEvent: WorkflowEvent = {
      type: 'gate_approval_after_rejection',
      phase: 'inception',
      details: 'Approved after revision',
    };
    const d2 = captureWorkflowDiscovery(approvalEvent, { ...baseContext, phase: 'inception' });
    recordDiscovery(d2);

    // BOLT completion
    const boltEvent: WorkflowEvent = {
      type: 'bolt_execution_complete',
      phase: 'construction',
      details: 'BOLT-001 done',
    };
    const d3 = captureWorkflowDiscovery(boltEvent, baseContext);
    recordDiscovery(d3);

    const summary = readDiscoveries(TEST_DIR);
    expect(summary.total_discoveries).toBeGreaterThanOrEqual(3);
  });

  it('execution_mode_selected event creates discovery', () => {
    const event: WorkflowEvent = {
      type: 'execution_mode_selected',
      phase: 'construction',
      details: 'ascent',
    };

    const discovery = captureWorkflowDiscovery(event, baseContext);
    expect(discovery.category).toBe('planning_insight');

    const persisted = recordDiscovery(discovery);
    expect(persisted.id).toBeDefined();
  });
});
