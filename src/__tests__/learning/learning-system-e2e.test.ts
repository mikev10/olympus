/**
 * Learning System E2E Tests
 *
 * Comprehensive end-to-end tests verifying the learning system integration
 * with the AIDLC workflow pipeline. Uses real file I/O in temp directories.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Hoisted mock for os.homedir()
const mockHomedir = vi.hoisted(() => {
  return { value: '' };
});

vi.mock('os', async () => {
  const actual = await vi.importActual('os');
  return {
    ...actual,
    homedir: () => mockHomedir.value,
  };
});

import {
  recordDiscovery,
  readDiscoveries,
  getDiscoveriesForInjection,
  markDiscoveryUseful,
} from '../../learning/discovery.js';

import {
  captureWorkflowDiscovery,
  reportAgentPerformance,
  recordTrustLevelChange,
} from '../../features/workflow-engine/learning-bridge.js';

import type {
  WorkflowEvent,
  WorkflowContext,
  WorkflowEventType,
} from '../../features/workflow-engine/learning-bridge.js';

import {
  recordGateRejection,
  recordGateApprovalAfterRejection,
  processGateEvent,
  queryPreviousGateRejections,
} from '../../features/workflow-engine/gate-discovery-bridge.js';

import type { GateEvent } from '../../features/workflow-engine/gate-discovery-bridge.js';
import type { AgentDiscovery, DiscoveryCategory } from '../../learning/types.js';

// ============================================================================
// Test Setup
// ============================================================================

let tmpDir: string;
let projectDir: string;
let learningDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'learning-e2e-'));
  projectDir = join(tmpDir, 'project');
  learningDir = join(tmpDir, 'learning');

  mkdirSync(projectDir, { recursive: true });
  mkdirSync(learningDir, { recursive: true });
  mkdirSync(join(projectDir, '.olympus', 'learning'), { recursive: true });

  // Override learning directory for test isolation
  process.env.OLYMPUS_TEST_LEARNING_DIR = learningDir;
  mockHomedir.value = tmpDir;
});

afterEach(() => {
  delete process.env.OLYMPUS_TEST_LEARNING_DIR;
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup failures on Windows
  }
});

// ============================================================================
// Helpers
// ============================================================================

function readJsonlFile(filePath: string): any[] {
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, 'utf-8');
  return content
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line));
}

function makeContext(overrides?: Partial<WorkflowContext>): WorkflowContext {
  return {
    workflowId: 'WF-001',
    featureName: 'user-auth',
    projectPath: projectDir,
    sessionId: 'session-e2e-001',
    phase: 'construction',
    ...overrides,
  };
}

// ============================================================================
// Scenario 1: Discovery Capture on Stop Hook
// ============================================================================

describe('Scenario 1: Discovery Capture to JSONL', () => {
  it('records a discovery and writes it to the project JSONL file', () => {
    const discovery = recordDiscovery({
      session_id: 'sess-001',
      project_path: projectDir,
      category: 'gotcha',
      summary: 'Migration must run before seeding',
      details: 'Running seed before migration causes FK constraint failures.',
      agent_name: 'oracle',
      confidence: 0.9,
      scope: 'project',
    });

    const filePath = join(projectDir, '.olympus', 'learning', 'discoveries.jsonl');
    expect(existsSync(filePath)).toBe(true);

    const lines = readJsonlFile(filePath);
    expect(lines).toHaveLength(1);

    const persisted = lines[0] as AgentDiscovery;
    expect(persisted.id).toBe(discovery.id);
    expect(persisted.timestamp).toBeDefined();
    expect(persisted.session_id).toBe('sess-001');
    expect(persisted.project_path).toBe(projectDir);
    expect(persisted.category).toBe('gotcha');
    expect(persisted.summary).toBe('Migration must run before seeding');
    expect(persisted.details).toContain('FK constraint');
    expect(persisted.agent_name).toBe('oracle');
    expect(persisted.confidence).toBe(0.9);
    expect(persisted.verified).toBe(false);
    expect(persisted.verification_count).toBe(0);
    expect(persisted.last_useful).toBeDefined();
    expect(persisted.scope).toBe('project');
  });

  it('appends multiple discoveries as separate JSONL lines', () => {
    recordDiscovery({
      session_id: 'sess-001',
      project_path: projectDir,
      category: 'pattern',
      summary: 'Uses kebab-case for files',
      details: 'All source files use kebab-case naming convention.',
      agent_name: 'explore',
      confidence: 0.85,
      scope: 'project',
    });

    recordDiscovery({
      session_id: 'sess-001',
      project_path: projectDir,
      category: 'workaround',
      summary: 'Build requires NODE_ENV',
      details: 'Must set NODE_ENV=development for local builds.',
      agent_name: 'olympian',
      confidence: 0.95,
      scope: 'project',
    });

    recordDiscovery({
      session_id: 'sess-001',
      project_path: projectDir,
      category: 'technical_insight',
      summary: 'API uses rate limiting headers',
      details: 'The external API returns X-RateLimit-Remaining headers.',
      agent_name: 'librarian',
      confidence: 0.7,
      scope: 'project',
    });

    const filePath = join(projectDir, '.olympus', 'learning', 'discoveries.jsonl');
    const lines = readJsonlFile(filePath);
    expect(lines).toHaveLength(3);

    // Each line should have a unique ID
    const ids = lines.map((l: AgentDiscovery) => l.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('writes global scope discoveries to the global learning dir', () => {
    recordDiscovery({
      session_id: 'sess-001',
      project_path: projectDir,
      category: 'configuration',
      summary: 'Always use strict mode in tsconfig',
      details: 'TypeScript strict mode catches null issues early.',
      agent_name: 'oracle',
      confidence: 0.8,
      scope: 'global',
    });

    const globalPath = join(learningDir, 'discoveries.jsonl');
    expect(existsSync(globalPath)).toBe(true);

    const lines = readJsonlFile(globalPath);
    expect(lines).toHaveLength(1);
    expect(lines[0].scope).toBe('global');
    expect(lines[0].category).toBe('configuration');
  });

  it('records discoveries with optional fields: task_context and files_involved', () => {
    const discovery = recordDiscovery({
      session_id: 'sess-002',
      project_path: projectDir,
      category: 'dependency',
      summary: 'Package X requires peer dependency Y',
      details: 'Installing X without Y causes runtime errors.',
      agent_name: 'olympian',
      confidence: 0.75,
      scope: 'project',
      task_context: 'Setting up monorepo dependencies',
      files_involved: ['package.json', 'packages/core/package.json'],
    });

    expect(discovery.task_context).toBe('Setting up monorepo dependencies');
    expect(discovery.files_involved).toEqual(['package.json', 'packages/core/package.json']);

    const filePath = join(projectDir, '.olympus', 'learning', 'discoveries.jsonl');
    const lines = readJsonlFile(filePath);
    expect(lines[0].task_context).toBe('Setting up monorepo dependencies');
    expect(lines[0].files_involved).toEqual(['package.json', 'packages/core/package.json']);
  });
});

// ============================================================================
// Scenario 2: Session-Start Injection
// ============================================================================

describe('Scenario 2: Session-Start Injection', () => {
  it('retrieves discoveries sorted by score for injection', () => {
    // Record discoveries with varying confidence
    recordDiscovery({
      session_id: 'sess-001',
      project_path: projectDir,
      category: 'workflow_gate',
      summary: 'Gate 3 always fails on missing tests',
      details: 'Bolts without tests are consistently rejected at gate 3.',
      agent_name: 'workflow-engine',
      confidence: 0.95,
      scope: 'project',
    });

    recordDiscovery({
      session_id: 'sess-001',
      project_path: projectDir,
      category: 'pattern',
      summary: 'Always run linter before commit',
      details: 'CI will fail if linter is not run locally first.',
      agent_name: 'oracle',
      confidence: 0.6,
      scope: 'project',
    });

    recordDiscovery({
      session_id: 'sess-001',
      project_path: projectDir,
      category: 'gotcha',
      summary: 'DB migrations need downtime window',
      details: 'Schema changes require a maintenance window.',
      agent_name: 'oracle',
      confidence: 0.9,
      scope: 'project',
    });

    const injected = getDiscoveriesForInjection(projectDir, 10);
    expect(injected.length).toBe(3);

    // Higher confidence discoveries should rank higher (all brand new = same recency)
    // Score = (verification_count + 1) * recencyFactor * confidence
    // All have verification_count=0, so score = 1 * recencyFactor * confidence
    // The 0.95 confidence should rank first
    expect(injected[0].confidence).toBe(0.95);
  });

  it('markDiscoveryUseful increments verification_count and boosts ranking', () => {
    const lowConfidence = recordDiscovery({
      session_id: 'sess-001',
      project_path: projectDir,
      category: 'pattern',
      summary: 'Low confidence pattern',
      details: 'A pattern with low confidence.',
      agent_name: 'explore',
      confidence: 0.5,
      scope: 'project',
    });

    recordDiscovery({
      session_id: 'sess-001',
      project_path: projectDir,
      category: 'gotcha',
      summary: 'High confidence gotcha',
      details: 'A gotcha with high confidence.',
      agent_name: 'oracle',
      confidence: 0.9,
      scope: 'project',
    });

    // Before marking useful: high confidence should rank first
    let injected = getDiscoveriesForInjection(projectDir, 10);
    expect(injected[0].summary).toBe('High confidence gotcha');

    // Mark the low-confidence discovery useful multiple times
    markDiscoveryUseful(lowConfidence.id, projectDir);
    markDiscoveryUseful(lowConfidence.id, projectDir);
    markDiscoveryUseful(lowConfidence.id, projectDir);

    // After marking useful: the boosted discovery should now rank higher
    // Score: (3+1) * recency * 0.5 = 2.0 * recency  vs  (0+1) * recency * 0.9 = 0.9 * recency
    injected = getDiscoveriesForInjection(projectDir, 10);
    expect(injected[0].summary).toBe('Low confidence pattern');
    expect(injected[0].verification_count).toBe(3);
  });

  it('respects maxCount parameter', () => {
    // Record 5 discoveries
    for (let i = 0; i < 5; i++) {
      recordDiscovery({
        session_id: 'sess-001',
        project_path: projectDir,
        category: 'pattern',
        summary: `Discovery ${i}`,
        details: `Details for discovery ${i}`,
        agent_name: 'test',
        confidence: 0.8,
        scope: 'project',
      });
    }

    const limited = getDiscoveriesForInjection(projectDir, 2);
    expect(limited).toHaveLength(2);

    const all = getDiscoveriesForInjection(projectDir, 10);
    expect(all).toHaveLength(5);
  });

  it('returns discoveries with all expected fields for context injection', () => {
    recordDiscovery({
      session_id: 'sess-001',
      project_path: projectDir,
      category: 'workflow_gate',
      summary: 'Gate check insight',
      details: 'Important gate learning for context.',
      agent_name: 'workflow-engine',
      confidence: 0.85,
      scope: 'project',
    });

    const injected = getDiscoveriesForInjection(projectDir, 10);
    expect(injected).toHaveLength(1);

    const d = injected[0];
    expect(d.id).toBeDefined();
    expect(d.timestamp).toBeDefined();
    expect(d.session_id).toBe('sess-001');
    expect(d.project_path).toBe(projectDir);
    expect(d.category).toBe('workflow_gate');
    expect(d.summary).toBe('Gate check insight');
    expect(d.details).toBeDefined();
    expect(d.agent_name).toBe('workflow-engine');
    expect(d.confidence).toBe(0.85);
    expect(typeof d.verified).toBe('boolean');
    expect(typeof d.verification_count).toBe('number');
    expect(d.last_useful).toBeDefined();
    expect(d.scope).toBe('project');
  });
});

// ============================================================================
// Scenario 3: Token Tracking
// ============================================================================

describe('Scenario 3: Token Tracking via Agent Performance', () => {
  it('creates a FeedbackEntry for a successful stage', () => {
    const entry = reportAgentPerformance(
      'code-review',
      'oracle',
      { passed: true },
      'sess-001',
      projectDir,
    );

    expect(entry.id).toBeDefined();
    expect(entry.timestamp).toBeDefined();
    expect(entry.session_id).toBe('sess-001');
    expect(entry.project_path).toBe(projectDir);
    expect(entry.event_type).toBe('success');
    expect(entry.agent_used).toBe('oracle');
    expect(entry.user_message).toContain('Successfully completed code-review');
    expect(entry.feedback_category).toBe('praise');
    expect(entry.confidence).toBe(0.9);
  });

  it('creates a FeedbackEntry for a failed stage with issues', () => {
    const entry = reportAgentPerformance(
      'unit-testing',
      'olympian',
      { passed: false, issues: ['3 tests failed', 'Coverage below 80%'] },
      'sess-002',
      projectDir,
    );

    expect(entry.event_type).toBe('revision');
    expect(entry.agent_used).toBe('olympian');
    expect(entry.user_message).toContain('Failed unit-testing stage');
    expect(entry.user_message).toContain('3 tests failed');
    expect(entry.user_message).toContain('Coverage below 80%');
    expect(entry.feedback_category).toBe('correction');
    expect(entry.confidence).toBe(0.85);
  });

  it('creates a FeedbackEntry for a failed stage without issue details', () => {
    const entry = reportAgentPerformance(
      'build',
      'olympian-low',
      { passed: false },
      'sess-003',
      projectDir,
    );

    expect(entry.event_type).toBe('revision');
    expect(entry.user_message).toContain('unknown issues');
  });

  it('generates unique IDs for each feedback entry', () => {
    const e1 = reportAgentPerformance('stage1', 'agent1', { passed: true }, 'sess-001', projectDir);
    const e2 = reportAgentPerformance('stage2', 'agent2', { passed: true }, 'sess-001', projectDir);
    const e3 = reportAgentPerformance('stage3', 'agent3', { passed: false }, 'sess-001', projectDir);

    expect(e1.id).not.toBe(e2.id);
    expect(e2.id).not.toBe(e3.id);
    expect(e1.id).not.toBe(e3.id);
  });
});

// ============================================================================
// Scenario 4: Agent Tracking
// ============================================================================

describe('Scenario 4: Agent Tracking with BOLT Execution Events', () => {
  it('creates a discovery for bolt_execution_complete event', () => {
    const context = makeContext();
    const event: WorkflowEvent = {
      type: 'bolt_execution_complete',
      phase: 'construction',
      stage: 'code-gen',
      details: 'BOLT-001 completed code generation successfully',
      artifactId: 'BOLT-001',
      agentName: 'olympian',
    };

    const discovery = captureWorkflowDiscovery(event, context);

    expect(discovery.id).toBeDefined();
    expect(discovery.category).toBe('workflow_gate');
    expect(discovery.summary).toContain('BOLT execution complete');
    expect(discovery.summary).toContain('construction');
    expect(discovery.details).toContain('BOLT-001 completed code generation');
    expect(discovery.details).toContain('user-auth');
    expect(discovery.agent_name).toBe('olympian');
    expect(discovery.confidence).toBe(0.85);
    expect(discovery.task_context).toContain('user-auth');
    expect(discovery.task_context).toContain('construction');
    expect(discovery.verified).toBe(true); // bolt_execution_complete is auto-verified
  });

  it('creates independent discoveries for multiple BOLT executions', () => {
    const context = makeContext();

    const events: WorkflowEvent[] = [
      {
        type: 'bolt_execution_complete',
        phase: 'construction',
        stage: 'code-gen',
        details: 'BOLT-001 completed',
        artifactId: 'BOLT-001',
        agentName: 'olympian',
      },
      {
        type: 'bolt_execution_complete',
        phase: 'construction',
        stage: 'testing',
        details: 'BOLT-002 completed testing',
        artifactId: 'BOLT-002',
        agentName: 'oracle',
      },
      {
        type: 'bolt_execution_complete',
        phase: 'construction',
        stage: 'review',
        details: 'BOLT-003 completed review',
        artifactId: 'BOLT-003',
        agentName: 'momus',
      },
    ];

    const discoveries = events.map(e => captureWorkflowDiscovery(e, context));

    // All should have unique IDs
    const ids = discoveries.map(d => d.id);
    expect(new Set(ids).size).toBe(3);

    // Each should reference its own agent
    expect(discoveries[0].agent_name).toBe('olympian');
    expect(discoveries[1].agent_name).toBe('oracle');
    expect(discoveries[2].agent_name).toBe('momus');

    // Each should have the feature name in task_context
    for (const d of discoveries) {
      expect(d.task_context).toContain('user-auth');
    }
  });

  it('includes task_context with feature name and phase', () => {
    const context = makeContext({ featureName: 'payment-gateway', phase: 'operations' });
    const event: WorkflowEvent = {
      type: 'bolt_execution_complete',
      phase: 'operations',
      details: 'Deployment BOLT finished',
      agentName: 'olympian',
    };

    const discovery = captureWorkflowDiscovery(event, context);

    expect(discovery.task_context).toContain('payment-gateway');
    expect(discovery.task_context).toContain('operations');
  });

  it('records trust level changes as discoveries', () => {
    const context = makeContext();
    const discovery = recordTrustLevelChange(
      {
        from: 1,
        to: 2,
        reason: 'Consistent quality in recent bolts',
        timestamp: new Date().toISOString(),
      },
      context,
    );

    expect(discovery.category).toBe('planning_insight');
    expect(discovery.summary).toContain('Trust level change');
    expect(discovery.details).toContain('from 1 to 2');
    expect(discovery.details).toContain('Consistent quality');
    expect(discovery.confidence).toBe(0.95);
  });
});

// ============================================================================
// Scenario 5: Workflow Discovery Compatibility
// ============================================================================

describe('Scenario 5: Workflow Discovery Compatibility with recordDiscovery()', () => {
  const eventTypes: Array<{
    type: WorkflowEventType;
    expectedCategory: DiscoveryCategory;
    details: string;
    artifactId?: string;
    agentName?: string;
  }> = [
    { type: 'gate_rejection', expectedCategory: 'gotcha', details: 'Missing error handling' },
    { type: 'gate_approval', expectedCategory: 'pattern', details: 'All checks passed' },
    { type: 'build_failure', expectedCategory: 'technical_insight', details: 'TypeScript type error in module X' },
    { type: 'rework_required', expectedCategory: 'gotcha', details: 'API contract mismatch' },
    { type: 'contract_violation', expectedCategory: 'gotcha', details: 'Schema drift detected', artifactId: 'BOLT-005' },
    { type: 'trust_level_change', expectedCategory: 'planning_insight', details: 'Trust level changed from 1 to 2: good quality' },
    { type: 'phase_complete', expectedCategory: 'pattern', details: 'Phase completed successfully' },
    { type: 'depth_override', expectedCategory: 'planning_insight', details: 'Depth overridden to shallow' },
    { type: 'bolt_execution_complete', expectedCategory: 'workflow_gate', details: 'BOLT finished execution', artifactId: 'BOLT-010', agentName: 'olympian' },
    { type: 'gate_approval_after_rejection', expectedCategory: 'workflow_gate', details: 'Approved after fixing tests' },
    { type: 'depth_assessment_complete', expectedCategory: 'planning_insight', details: 'Depth assessed at 3 (moderate)' },
    { type: 'execution_mode_selected', expectedCategory: 'planning_insight', details: 'Selected autonomous mode' },
  ];

  it.each(eventTypes)(
    'maps $type to $expectedCategory and persists via recordDiscovery()',
    ({ type, expectedCategory, details, artifactId, agentName }) => {
      const context = makeContext();
      const event: WorkflowEvent = {
        type,
        phase: 'construction',
        details,
        artifactId,
        agentName,
      };

      // captureWorkflowDiscovery returns a full AgentDiscovery (with auto-generated fields)
      const captured = captureWorkflowDiscovery(event, context);

      // Verify category mapping
      expect(captured.category).toBe(expectedCategory);

      // Verify all required fields are present
      expect(captured.id).toBeDefined();
      expect(captured.timestamp).toBeDefined();
      expect(captured.session_id).toBe('session-e2e-001');
      expect(captured.project_path).toBe(projectDir);
      expect(captured.summary).toBeDefined();
      expect(captured.summary.length).toBeLessThanOrEqual(100);
      expect(captured.details).toBeDefined();
      expect(captured.agent_name).toBeDefined();
      expect(typeof captured.confidence).toBe('number');
      expect(captured.confidence).toBeGreaterThan(0);
      expect(captured.confidence).toBeLessThanOrEqual(1);
      expect(typeof captured.verified).toBe('boolean');
      expect(typeof captured.verification_count).toBe('number');
      expect(captured.last_useful).toBeDefined();
      expect(captured.scope).toBe('project');

      // Now strip auto-generated fields and pass through recordDiscovery
      const { id, timestamp, verified, verification_count, last_useful, ...input } = captured;
      const persisted = recordDiscovery(input);

      // Verify persistence succeeded
      expect(persisted.id).toBeDefined();
      expect(persisted.id).not.toBe(captured.id); // recordDiscovery generates a new ID
      expect(persisted.category).toBe(expectedCategory);
    },
  );

  it('persists all event type discoveries to JSONL', () => {
    const context = makeContext();

    for (const { type, details, artifactId, agentName } of eventTypes) {
      const event: WorkflowEvent = { type, phase: 'construction', details, artifactId, agentName };
      const captured = captureWorkflowDiscovery(event, context);
      const { id, timestamp, verified, verification_count, last_useful, ...input } = captured;
      recordDiscovery(input);
    }

    // All should be in the project JSONL file
    const filePath = join(projectDir, '.olympus', 'learning', 'discoveries.jsonl');
    const lines = readJsonlFile(filePath);
    expect(lines).toHaveLength(eventTypes.length);

    // Verify each has correct category
    const categories = lines.map((l: AgentDiscovery) => l.category);
    for (const { expectedCategory } of eventTypes) {
      expect(categories).toContain(expectedCategory);
    }
  });
});

// ============================================================================
// Scenario 6: Gate-to-Discovery-to-Injection Lifecycle
// ============================================================================

describe('Scenario 6: Gate-to-Discovery-to-Injection Lifecycle', () => {
  it('full E2E: gate rejection -> discovery captured -> new session injection', () => {
    const context = makeContext();

    // Step 1: Fire a gate rejection
    const rejectionEvent: GateEvent = {
      gateNumber: 4,
      artifactId: 'BOLT-003',
      artifactType: 'bolt',
      action: 'rejected',
      reason: 'Missing error handling',
      previouslyRejected: false,
    };

    const rejectionDiscovery = recordGateRejection(rejectionEvent, context);

    // Step 2: Verify the discovery was written to JSONL
    const filePath = join(projectDir, '.olympus', 'learning', 'discoveries.jsonl');
    expect(existsSync(filePath)).toBe(true);

    const lines = readJsonlFile(filePath);
    expect(lines.length).toBeGreaterThanOrEqual(1);

    const persisted = lines[0] as AgentDiscovery;
    expect(persisted.category).toBe('workflow_gate');
    expect(persisted.summary).toContain('Gate 4');
    expect(persisted.summary).toContain('BOLT-003');
    expect(persisted.details).toContain('Missing error handling');
    expect(persisted.details).toContain('bolt'); // artifact type
    expect(persisted.details).toContain(context.workflowId);
    expect(persisted.id).toBe(rejectionDiscovery.id);

    // Step 3: Simulate new session - inject discoveries
    const injected = getDiscoveriesForInjection(projectDir);
    expect(injected.length).toBeGreaterThanOrEqual(1);

    const injectedRejection = injected.find(d => d.id === rejectionDiscovery.id);
    expect(injectedRejection).toBeDefined();
    expect(injectedRejection!.category).toBe('workflow_gate');
  });

  it('records approval after rejection as a second discovery', () => {
    const context = makeContext();

    // First: record rejection
    const rejectionEvent: GateEvent = {
      gateNumber: 4,
      artifactId: 'BOLT-003',
      artifactType: 'bolt',
      action: 'rejected',
      reason: 'Missing error handling',
      previouslyRejected: false,
    };
    const rejectionDiscovery = recordGateRejection(rejectionEvent, context);

    // Then: record approval after rejection
    const approvalEvent: GateEvent = {
      gateNumber: 4,
      artifactId: 'BOLT-003',
      artifactType: 'bolt',
      action: 'approved',
      reason: 'Missing error handling',
      previouslyRejected: true,
      whatChanged: 'Added try-catch blocks',
    };
    const approvalDiscovery = recordGateApprovalAfterRejection(approvalEvent, context);

    // Verify both were written
    const filePath = join(projectDir, '.olympus', 'learning', 'discoveries.jsonl');
    const lines = readJsonlFile(filePath);
    expect(lines).toHaveLength(2);

    // Verify second discovery
    expect(approvalDiscovery.category).toBe('workflow_gate');
    expect(approvalDiscovery.summary).toContain('Gate 4');
    expect(approvalDiscovery.summary).toContain('BOLT-003');
    expect(approvalDiscovery.summary).toContain('revision');
    expect(approvalDiscovery.details).toContain('Added try-catch blocks');
    expect(approvalDiscovery.id).not.toBe(rejectionDiscovery.id);

    // Both should appear in injection
    const injected = getDiscoveriesForInjection(projectDir);
    const injectedIds = injected.map(d => d.id);
    expect(injectedIds).toContain(rejectionDiscovery.id);
    expect(injectedIds).toContain(approvalDiscovery.id);
  });

  describe('processGateEvent()', () => {
    it('returns discovery for rejection', () => {
      const context = makeContext();
      const event: GateEvent = {
        gateNumber: 2,
        artifactId: 'BOLT-010',
        artifactType: 'bolt',
        action: 'rejected',
        reason: 'Incomplete tests',
        previouslyRejected: false,
      };

      const result = processGateEvent(event, context);
      expect(result).not.toBeNull();
      expect(result!.category).toBe('workflow_gate');
      expect(result!.summary).toContain('Gate 2');
    });

    it('returns discovery for approval after rejection', () => {
      const context = makeContext();
      const event: GateEvent = {
        gateNumber: 3,
        artifactId: 'BOLT-020',
        artifactType: 'unit',
        action: 'approved',
        reason: 'Schema was invalid',
        previouslyRejected: true,
        whatChanged: 'Fixed schema validation',
      };

      const result = processGateEvent(event, context);
      expect(result).not.toBeNull();
      expect(result!.category).toBe('workflow_gate');
      expect(result!.summary).toContain('Gate 3');
      expect(result!.details).toContain('Fixed schema validation');
    });

    it('returns null for first-time approval (no prior rejection)', () => {
      const context = makeContext();
      const event: GateEvent = {
        gateNumber: 1,
        artifactId: 'BOLT-050',
        artifactType: 'intent',
        action: 'approved',
        reason: 'Looks good',
        previouslyRejected: false,
      };

      const result = processGateEvent(event, context);
      expect(result).toBeNull();
    });
  });

  describe('queryPreviousGateRejections()', () => {
    it('filters rejections by artifactType and gateNumber', () => {
      const context = makeContext();

      // Record several gate rejections with different artifact types and gate numbers
      const events: GateEvent[] = [
        { gateNumber: 4, artifactId: 'BOLT-001', artifactType: 'bolt', action: 'rejected', reason: 'Missing tests', previouslyRejected: false },
        { gateNumber: 4, artifactId: 'BOLT-002', artifactType: 'bolt', action: 'rejected', reason: 'Poor coverage', previouslyRejected: false },
        { gateNumber: 2, artifactId: 'UNIT-001', artifactType: 'unit', action: 'rejected', reason: 'Bad schema', previouslyRejected: false },
        { gateNumber: 4, artifactId: 'UNIT-002', artifactType: 'unit', action: 'rejected', reason: 'Missing field', previouslyRejected: false },
        { gateNumber: 3, artifactId: 'BOLT-003', artifactType: 'bolt', action: 'rejected', reason: 'Type errors', previouslyRejected: false },
      ];

      for (const event of events) {
        recordGateRejection(event, context);
      }

      // Read all discoveries
      const summary = readDiscoveries(projectDir);
      const allDiscoveries = [...summary.project_discoveries, ...summary.global_discoveries];

      // Query for bolt rejections at gate 4
      const boltGate4 = queryPreviousGateRejections(allDiscoveries, 'bolt', 4);
      expect(boltGate4).toHaveLength(2);
      for (const d of boltGate4) {
        expect(d.details).toContain('Artifact Type: bolt');
        expect(d.details).toContain('Gate Number: 4');
      }

      // Query for unit rejections at gate 2
      const unitGate2 = queryPreviousGateRejections(allDiscoveries, 'unit', 2);
      expect(unitGate2).toHaveLength(1);
      expect(unitGate2[0].details).toContain('Bad schema');

      // Query for bolt rejections at gate 3
      const boltGate3 = queryPreviousGateRejections(allDiscoveries, 'bolt', 3);
      expect(boltGate3).toHaveLength(1);
      expect(boltGate3[0].details).toContain('Type errors');

      // Query for non-existent combination
      const noResults = queryPreviousGateRejections(allDiscoveries, 'intent', 5);
      expect(noResults).toHaveLength(0);
    });

    it('returns results sorted by timestamp descending (most recent first)', () => {
      const context = makeContext();

      // Record rejections with slight timing differences
      const e1: GateEvent = { gateNumber: 4, artifactId: 'BOLT-A', artifactType: 'bolt', action: 'rejected', reason: 'First rejection', previouslyRejected: false };
      recordGateRejection(e1, context);

      const e2: GateEvent = { gateNumber: 4, artifactId: 'BOLT-B', artifactType: 'bolt', action: 'rejected', reason: 'Second rejection', previouslyRejected: false };
      recordGateRejection(e2, context);

      const summary = readDiscoveries(projectDir);
      const allDiscoveries = [...summary.project_discoveries, ...summary.global_discoveries];
      const results = queryPreviousGateRejections(allDiscoveries, 'bolt', 4);

      expect(results).toHaveLength(2);
      // Most recent should be first
      const t0 = new Date(results[0].timestamp).getTime();
      const t1 = new Date(results[1].timestamp).getTime();
      expect(t0).toBeGreaterThanOrEqual(t1);
    });
  });

  it('full lifecycle: rejection -> approval -> query -> inject', () => {
    const context = makeContext({ featureName: 'checkout-flow', phase: 'construction' });

    // 1. Gate rejection
    const rejEvent: GateEvent = {
      gateNumber: 4,
      artifactId: 'BOLT-099',
      artifactType: 'bolt',
      action: 'rejected',
      reason: 'No integration tests',
      previouslyRejected: false,
    };
    const rejDisc = processGateEvent(rejEvent, context);
    expect(rejDisc).not.toBeNull();

    // 2. Gate approval after revision
    const appEvent: GateEvent = {
      gateNumber: 4,
      artifactId: 'BOLT-099',
      artifactType: 'bolt',
      action: 'approved',
      reason: 'No integration tests',
      previouslyRejected: true,
      whatChanged: 'Added integration test suite',
    };
    const appDisc = processGateEvent(appEvent, context);
    expect(appDisc).not.toBeNull();

    // 3. First-time approval (no discovery)
    const cleanApproval: GateEvent = {
      gateNumber: 1,
      artifactId: 'BOLT-100',
      artifactType: 'bolt',
      action: 'approved',
      reason: 'Passed all checks',
      previouslyRejected: false,
    };
    const noDisc = processGateEvent(cleanApproval, context);
    expect(noDisc).toBeNull();

    // 4. Query previous rejections
    const summary = readDiscoveries(projectDir);
    const all = [...summary.project_discoveries, ...summary.global_discoveries];
    const rejections = queryPreviousGateRejections(all, 'bolt', 4);
    expect(rejections.length).toBeGreaterThanOrEqual(1);
    expect(rejections.some(d => d.details.includes('No integration tests'))).toBe(true);

    // 5. Inject into new session
    const injected = getDiscoveriesForInjection(projectDir);
    expect(injected.length).toBeGreaterThanOrEqual(2); // rejection + approval

    // Verify both the rejection and approval discoveries are present
    const categories = injected.map(d => d.category);
    expect(categories.filter(c => c === 'workflow_gate').length).toBeGreaterThanOrEqual(2);
  });
});
