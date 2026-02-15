/**
 * Gate Discovery Bridge - Integration Tests
 *
 * These tests exercise the REAL persistence chain (do NOT mock recordDiscovery).
 * They verify that gate events persist to actual JSONL files and are retrievable
 * via getDiscoveriesForInjection().
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { processGateEvent } from '../../features/workflow-engine/gate-discovery-bridge.js';
import { getDiscoveriesForInjection, readDiscoveries } from '../../learning/discovery.js';
import type { GateEvent } from '../../features/workflow-engine/gate-discovery-bridge.js';
import type { WorkflowContext } from '../../features/workflow-engine/learning-bridge.js';
import type { AgentDiscovery } from '../../learning/types.js';

const TEST_DIR = join(process.cwd(), '.test-gate-discovery-integration');
const LEARNING_DIR = join(TEST_DIR, '.olympus', 'learning');

describe('Gate Discovery Bridge - Integration', () => {
  beforeEach(() => {
    // Create test directories
    mkdirSync(LEARNING_DIR, { recursive: true });
  });

  afterEach(() => {
    // Cleanup
    try {
      rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // Helper to create a WorkflowContext pointing to test dir
  function createTestContext(): WorkflowContext {
    return {
      workflowId: 'integration-test-001',
      featureName: 'Integration Test Feature',
      projectPath: TEST_DIR,
      sessionId: 'integration-session-001',
      phase: 'construction',
    };
  }

  it('gate rejection persists discovery to JSONL and appears in getDiscoveriesForInjection', () => {
    const context = createTestContext();
    const gateEvent: GateEvent = {
      gateNumber: 4,
      artifactId: 'BOLT-007',
      artifactType: 'bolt',
      action: 'rejected',
      reason: 'Insufficient error handling',
      previouslyRejected: false,
    };

    // Fire the gate rejection - this should call real recordDiscovery
    const discovery = processGateEvent(gateEvent, context);

    expect(discovery).not.toBeNull();
    expect(discovery!.category).toBe('workflow_gate');

    // Verify discovery was persisted to JSONL file
    // recordDiscovery writes to project-level learning dir
    const jsonlPath = join(LEARNING_DIR, 'discoveries.jsonl');

    // The file should exist (recordDiscovery creates it)
    expect(existsSync(jsonlPath)).toBe(true);

    // Read and parse the JSONL
    const content = readFileSync(jsonlPath, 'utf-8');
    const lines = content.trim().split('\n').filter(l => l.trim());
    expect(lines.length).toBeGreaterThanOrEqual(1);

    const persisted = JSON.parse(lines[lines.length - 1]) as AgentDiscovery;
    expect(persisted.category).toBe('workflow_gate');
    expect(persisted.summary).toContain('BOLT-007');
    expect(persisted.summary).toContain('rejected');
    expect(persisted.details).toContain('Insufficient error handling');

    // Verify getDiscoveriesForInjection returns the discovery
    const injected = getDiscoveriesForInjection(TEST_DIR);
    expect(injected.length).toBeGreaterThanOrEqual(1);

    const found = injected.find(d => d.category === 'workflow_gate' && d.summary.includes('BOLT-007'));
    expect(found).toBeDefined();
    expect(found!.details).toContain('Insufficient error handling');
  });

  it('workflow_gate discovery appears in getDiscoveriesForInjection results', () => {
    const context = createTestContext();

    // Create a workflow_gate discovery via gate rejection
    const rejectionEvent: GateEvent = {
      gateNumber: 3,
      artifactId: 'UNIT-002',
      artifactType: 'unit',
      action: 'rejected',
      reason: 'Architecture does not scale',
      previouslyRejected: false,
    };

    processGateEvent(rejectionEvent, context);

    // Create a lesson-learned discovery via approval after rejection
    const approvalEvent: GateEvent = {
      gateNumber: 3,
      artifactId: 'UNIT-002',
      artifactType: 'unit',
      action: 'approved',
      reason: 'Architecture does not scale',
      previouslyRejected: true,
      whatChanged: 'Added horizontal scaling design',
    };

    processGateEvent(approvalEvent, context);

    // Verify both discoveries appear in injection
    const injected = getDiscoveriesForInjection(TEST_DIR);

    // Should have at least 2 workflow_gate discoveries
    const gateDiscoveries = injected.filter(d => d.category === 'workflow_gate');
    expect(gateDiscoveries.length).toBeGreaterThanOrEqual(2);

    // Verify rejection discovery
    const rejection = gateDiscoveries.find(d => d.summary.includes('rejected'));
    expect(rejection).toBeDefined();
    expect(rejection!.summary).toContain('UNIT-002');
    expect(rejection!.details).toContain('Architecture does not scale');

    // Verify approval-after-rejection discovery
    const approval = gateDiscoveries.find(d => d.summary.includes('approved'));
    expect(approval).toBeDefined();
    expect(approval!.summary).toContain('after revision');
    expect(approval!.details).toContain('Added horizontal scaling design');
  });

  it('cross-session learning: rejection in session 1 is available in session 2 context', () => {
    // Session 1: create a rejection
    const context1 = createTestContext();
    context1.sessionId = 'session-1';

    const gateEvent: GateEvent = {
      gateNumber: 4,
      artifactId: 'BOLT-010',
      artifactType: 'bolt',
      action: 'rejected',
      reason: 'Missing input validation',
      previouslyRejected: false,
    };

    processGateEvent(gateEvent, context1);

    // Verify file was written
    const jsonlPath = join(LEARNING_DIR, 'discoveries.jsonl');
    expect(existsSync(jsonlPath)).toBe(true);

    // Session 2: verify the discovery is available
    // (Simulated by calling getDiscoveriesForInjection with the same project path)
    const injected = getDiscoveriesForInjection(TEST_DIR);

    const found = injected.find(
      d => d.category === 'workflow_gate' && d.summary.includes('BOLT-010')
    );
    expect(found).toBeDefined();
    expect(found!.session_id).toBe('session-1');
    expect(found!.details).toContain('Missing input validation');

    // Verify readDiscoveries also returns it
    const summary = readDiscoveries(TEST_DIR);
    expect(summary.project_discoveries.length).toBeGreaterThanOrEqual(1);
    expect(summary.categories.workflow_gate).toBeGreaterThanOrEqual(1);
  });

  it('multiple gate rejections accumulate in JSONL file', () => {
    const context = createTestContext();

    // Create 3 different gate rejections
    const events: GateEvent[] = [
      {
        gateNumber: 1,
        artifactId: 'IDEA-001',
        artifactType: 'idea',
        action: 'rejected',
        reason: 'Not aligned with business goals',
        previouslyRejected: false,
      },
      {
        gateNumber: 2,
        artifactId: 'INTENT-002',
        artifactType: 'intent',
        action: 'rejected',
        reason: 'Scope too large for single intent',
        previouslyRejected: false,
      },
      {
        gateNumber: 5,
        artifactId: 'BOLT-015',
        artifactType: 'bolt',
        action: 'rejected',
        reason: 'Failed integration tests',
        previouslyRejected: false,
      },
    ];

    events.forEach(event => processGateEvent(event, context));

    // Verify JSONL has 3 lines
    const jsonlPath = join(LEARNING_DIR, 'discoveries.jsonl');
    const content = readFileSync(jsonlPath, 'utf-8');
    const lines = content.trim().split('\n').filter(l => l.trim());
    expect(lines.length).toBe(3);

    // Verify each discovery is parseable and has correct data
    const discoveries = lines.map(line => JSON.parse(line) as AgentDiscovery);
    expect(discoveries[0].summary).toContain('IDEA-001');
    expect(discoveries[1].summary).toContain('INTENT-002');
    expect(discoveries[2].summary).toContain('BOLT-015');

    // Verify all appear in getDiscoveriesForInjection
    const injected = getDiscoveriesForInjection(TEST_DIR);
    const gateDiscoveries = injected.filter(d => d.category === 'workflow_gate');
    expect(gateDiscoveries.length).toBe(3);
  });

  it('first-time approval does not create a discovery', () => {
    const context = createTestContext();

    const approvalEvent: GateEvent = {
      gateNumber: 3,
      artifactId: 'UNIT-005',
      artifactType: 'unit',
      action: 'approved',
      reason: '',
      previouslyRejected: false,
    };

    const discovery = processGateEvent(approvalEvent, context);

    // Should return null (no discovery needed for first-time approval)
    expect(discovery).toBeNull();

    // Verify no JSONL file was created
    const jsonlPath = join(LEARNING_DIR, 'discoveries.jsonl');
    expect(existsSync(jsonlPath)).toBe(false);

    // Verify getDiscoveriesForInjection returns empty
    const injected = getDiscoveriesForInjection(TEST_DIR);
    expect(injected.length).toBe(0);
  });

  it('discovery details contain workflow context metadata', () => {
    const context = createTestContext();
    context.riskTier = { tier: 'high', flags: [], mitigations: [] };
    context.depthScore = 75;

    const gateEvent: GateEvent = {
      gateNumber: 4,
      artifactId: 'BOLT-020',
      artifactType: 'bolt',
      action: 'rejected',
      reason: 'Security vulnerability detected',
      previouslyRejected: false,
    };

    const discovery = processGateEvent(gateEvent, context);

    expect(discovery).not.toBeNull();
    expect(discovery!.details).toContain('Risk Tier: high');
    expect(discovery!.details).toContain('Depth Score: 75');
    expect(discovery!.details).toContain('Workflow: integration-test-001');
    expect(discovery!.details).toContain('Phase: construction');
  });
});
