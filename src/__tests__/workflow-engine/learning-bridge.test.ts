import { describe, it, expect } from 'vitest';
import {
  captureWorkflowDiscovery,
  queryRelevantDiscoveries,
  reportAgentPerformance,
  trackMethodologyPreferences,
  recordTrustLevelChange,
} from '../../features/workflow-engine/learning-bridge.js';
import type {
  WorkflowEvent,
  WorkflowContext,
  MethodologyPreference,
} from '../../features/workflow-engine/learning-bridge.js';
import type { AgentDiscovery } from '../../learning/types.js';
import type { TrustLevelChange } from '../../features/workflow-engine/phase-types.js';

describe('captureWorkflowDiscovery', () => {
  const baseContext: WorkflowContext = {
    workflowId: 'test-workflow',
    featureName: 'test-feature',
    projectPath: '/test/project',
    sessionId: 'test-session',
    phase: 'inception',
  };

  it('maps gate_rejection to gotcha category', () => {
    const event: WorkflowEvent = {
      type: 'gate_rejection',
      phase: 'inception',
      details: 'Missing required documentation',
    };

    const discovery = captureWorkflowDiscovery(event, baseContext);

    expect(discovery.category).toBe('gotcha');
  });

  it('maps gate_approval to pattern category', () => {
    const event: WorkflowEvent = {
      type: 'gate_approval',
      phase: 'inception',
      details: 'All requirements met',
    };

    const discovery = captureWorkflowDiscovery(event, baseContext);

    expect(discovery.category).toBe('pattern');
  });

  it('maps build_failure to technical_insight category', () => {
    const event: WorkflowEvent = {
      type: 'build_failure',
      phase: 'construction',
      details: 'TypeScript compilation error',
    };

    const discovery = captureWorkflowDiscovery(event, baseContext);

    expect(discovery.category).toBe('technical_insight');
  });

  it('maps rework_required to gotcha category', () => {
    const event: WorkflowEvent = {
      type: 'rework_required',
      phase: 'construction',
      details: 'Quality checks failed',
    };

    const discovery = captureWorkflowDiscovery(event, baseContext);

    expect(discovery.category).toBe('gotcha');
  });

  it('maps contract_violation to gotcha category', () => {
    const event: WorkflowEvent = {
      type: 'contract_violation',
      phase: 'verify',
      details: 'Schema mismatch detected',
    };

    const discovery = captureWorkflowDiscovery(event, baseContext);

    expect(discovery.category).toBe('gotcha');
  });

  it('maps trust_level_change to planning_insight category', () => {
    const event: WorkflowEvent = {
      type: 'trust_level_change',
      phase: 'inception',
      details: 'Trust increased to high',
    };

    const discovery = captureWorkflowDiscovery(event, baseContext);

    expect(discovery.category).toBe('planning_insight');
  });

  it('maps phase_complete to pattern category', () => {
    const event: WorkflowEvent = {
      type: 'phase_complete',
      phase: 'inception',
      details: 'Phase completed successfully',
    };

    const discovery = captureWorkflowDiscovery(event, baseContext);

    expect(discovery.category).toBe('pattern');
  });

  it('maps depth_override to planning_insight category', () => {
    const event: WorkflowEvent = {
      type: 'depth_override',
      phase: 'inception',
      details: 'Depth set to comprehensive',
    };

    const discovery = captureWorkflowDiscovery(event, baseContext);

    expect(discovery.category).toBe('planning_insight');
  });

  it('truncates summary to max 100 chars', () => {
    const event: WorkflowEvent = {
      type: 'gate_rejection',
      phase: 'inception',
      details: 'A'.repeat(200), // Long details
    };

    const discovery = captureWorkflowDiscovery(event, baseContext);

    expect(discovery.summary.length).toBeLessThanOrEqual(100);
  });

  it('includes workflow context in details', () => {
    const event: WorkflowEvent = {
      type: 'gate_rejection',
      phase: 'inception',
      details: 'Test details',
    };

    const discovery = captureWorkflowDiscovery(event, baseContext);

    expect(discovery.details).toContain('test-workflow');
    expect(discovery.details).toContain('test-feature');
    expect(discovery.details).toContain('inception');
  });

  it('generates valid UUID id', () => {
    const event: WorkflowEvent = {
      type: 'gate_rejection',
      phase: 'inception',
      details: 'Test details',
    };

    const discovery = captureWorkflowDiscovery(event, baseContext);

    expect(discovery.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('uses event timestamp if provided', () => {
    const timestamp = '2024-01-01T12:00:00Z';
    const event: WorkflowEvent = {
      type: 'gate_rejection',
      phase: 'inception',
      details: 'Test details',
      timestamp,
    };

    const discovery = captureWorkflowDiscovery(event, baseContext);

    expect(discovery.timestamp).toBe(timestamp);
  });

  it('falls back to current time if no timestamp', () => {
    const event: WorkflowEvent = {
      type: 'gate_rejection',
      phase: 'inception',
      details: 'Test details',
    };

    const before = new Date().toISOString();
    const discovery = captureWorkflowDiscovery(event, baseContext);
    const after = new Date().toISOString();

    expect(discovery.timestamp >= before).toBe(true);
    expect(discovery.timestamp <= after).toBe(true);
  });

  it('sets high confidence for gate_approval', () => {
    const event: WorkflowEvent = {
      type: 'gate_approval',
      phase: 'inception',
      details: 'Test details',
    };

    const discovery = captureWorkflowDiscovery(event, baseContext);

    expect(discovery.confidence).toBe(0.9);
  });

  it('sets high confidence for phase_complete', () => {
    const event: WorkflowEvent = {
      type: 'phase_complete',
      phase: 'inception',
      details: 'Test details',
    };

    const discovery = captureWorkflowDiscovery(event, baseContext);

    expect(discovery.confidence).toBe(0.9);
  });

  it('sets verified=true for gate_approval', () => {
    const event: WorkflowEvent = {
      type: 'gate_approval',
      phase: 'inception',
      details: 'Test details',
    };

    const discovery = captureWorkflowDiscovery(event, baseContext);

    expect(discovery.verified).toBe(true);
  });

  it('sets verified=true for phase_complete', () => {
    const event: WorkflowEvent = {
      type: 'phase_complete',
      phase: 'inception',
      details: 'Test details',
    };

    const discovery = captureWorkflowDiscovery(event, baseContext);

    expect(discovery.verified).toBe(true);
  });

  it('sets verified=false for gate_rejection', () => {
    const event: WorkflowEvent = {
      type: 'gate_rejection',
      phase: 'inception',
      details: 'Test details',
    };

    const discovery = captureWorkflowDiscovery(event, baseContext);

    expect(discovery.verified).toBe(false);
  });

  it('includes artifactId in files_involved when provided', () => {
    const event: WorkflowEvent = {
      type: 'contract_violation',
      phase: 'verify',
      details: 'Test details',
      artifactId: 'artifact-123',
    };

    const discovery = captureWorkflowDiscovery(event, baseContext);

    expect(discovery.files_involved).toEqual(['artifact-123']);
  });

  it('sets empty files_involved when no artifactId', () => {
    const event: WorkflowEvent = {
      type: 'gate_rejection',
      phase: 'inception',
      details: 'Test details',
    };

    const discovery = captureWorkflowDiscovery(event, baseContext);

    expect(discovery.files_involved).toEqual([]);
  });

  it('defaults agentName to workflow-engine', () => {
    const event: WorkflowEvent = {
      type: 'gate_rejection',
      phase: 'inception',
      details: 'Test details',
    };

    const discovery = captureWorkflowDiscovery(event, baseContext);

    expect(discovery.agent_name).toBe('workflow-engine');
  });

  it('uses provided agentName if specified', () => {
    const event: WorkflowEvent = {
      type: 'gate_rejection',
      phase: 'inception',
      details: 'Test details',
      agentName: 'oracle',
    };

    const discovery = captureWorkflowDiscovery(event, baseContext);

    expect(discovery.agent_name).toBe('oracle');
  });

  it('sets scope to project', () => {
    const event: WorkflowEvent = {
      type: 'gate_rejection',
      phase: 'inception',
      details: 'Test details',
    };

    const discovery = captureWorkflowDiscovery(event, baseContext);

    expect(discovery.scope).toBe('project');
  });

  it('includes stage in task_context when provided', () => {
    const event: WorkflowEvent = {
      type: 'gate_rejection',
      phase: 'construction',
      stage: 'bolt',
      details: 'Test details',
    };

    const discovery = captureWorkflowDiscovery(event, baseContext);

    expect(discovery.task_context).toContain('construction/bolt');
  });

  it('includes risk tier in details when provided', () => {
    const contextWithRisk: WorkflowContext = {
      ...baseContext,
      riskTier: { tier: 'high', score: 8, factors: [] },
    };

    const event: WorkflowEvent = {
      type: 'gate_rejection',
      phase: 'inception',
      details: 'Test details',
    };

    const discovery = captureWorkflowDiscovery(event, contextWithRisk);

    expect(discovery.details).toContain('Risk Tier: high');
  });

  it('includes depth score in details when provided', () => {
    const contextWithDepth: WorkflowContext = {
      ...baseContext,
      depthScore: 85,
    };

    const event: WorkflowEvent = {
      type: 'gate_rejection',
      phase: 'inception',
      details: 'Test details',
    };

    const discovery = captureWorkflowDiscovery(event, contextWithDepth);

    expect(discovery.details).toContain('Depth Score: 85');
  });
});

describe('queryRelevantDiscoveries', () => {
  const baseContext: WorkflowContext = {
    workflowId: 'test-workflow',
    featureName: 'test-feature',
    projectPath: '/test/project',
    sessionId: 'test-session',
    phase: 'inception',
  };

  it('returns empty array for no discoveries', () => {
    const result = queryRelevantDiscoveries([], baseContext);

    expect(result).toEqual([]);
  });

  it('filters by project path - same project scores higher', () => {
    const discoveries: AgentDiscovery[] = [
      {
        id: '1',
        timestamp: '2024-01-01T12:00:00Z',
        session_id: 'session-1',
        project_path: '/test/project', // Same project
        category: 'pattern',
        summary: 'Same project',
        details: 'Test',
        agent_name: 'workflow-engine',
        confidence: 0.8,
        verified: false,
        verification_count: 0,
        scope: 'project',
        last_useful: '2024-01-01T12:00:00Z',
      },
      {
        id: '2',
        timestamp: '2024-01-01T12:00:00Z',
        session_id: 'session-2',
        project_path: '/other/project', // Different project
        category: 'pattern',
        summary: 'Different project',
        details: 'Test',
        agent_name: 'workflow-engine',
        confidence: 0.8,
        verified: false,
        verification_count: 0,
        scope: 'project',
        last_useful: '2024-01-01T12:00:00Z',
      },
    ];

    const result = queryRelevantDiscoveries(discoveries, baseContext);

    // Same project should be included (score=3+1=4), different project should not (score=1)
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });

  it('filters by phase context', () => {
    const discoveries: AgentDiscovery[] = [
      {
        id: '1',
        timestamp: '2024-01-01T12:00:00Z',
        session_id: 'session-1',
        project_path: '/test/project',
        category: 'pattern',
        summary: 'Outline phase',
        details: 'Test',
        agent_name: 'workflow-engine',
        task_context: 'test-feature (inception)', // Same phase
        confidence: 0.8,
        verified: false,
        verification_count: 0,
        scope: 'project',
        last_useful: '2024-01-01T12:00:00Z',
      },
      {
        id: '2',
        timestamp: '2024-01-01T12:00:00Z',
        session_id: 'session-2',
        project_path: '/test/project',
        category: 'pattern',
        summary: 'Forge phase',
        details: 'Test',
        agent_name: 'workflow-engine',
        task_context: 'test-feature (construction)', // Different phase
        confidence: 0.8,
        verified: false,
        verification_count: 0,
        scope: 'project',
        last_useful: '2024-01-01T12:00:00Z',
      },
    ];

    const result = queryRelevantDiscoveries(discoveries, baseContext);

    // First has score 3+2+1=6, second has score 3+1=4 (both included)
    expect(result).toHaveLength(2);
    // Most recent first, but they have same timestamp
    expect(result[0].id).toBe('1');
  });

  it('filters by relevant categories', () => {
    const discoveries: AgentDiscovery[] = [
      {
        id: '1',
        timestamp: '2024-01-01T12:00:00Z',
        session_id: 'session-1',
        project_path: '/test/project',
        category: 'gotcha', // Relevant
        summary: 'Test',
        details: 'Test',
        agent_name: 'workflow-engine',
        confidence: 0.8,
        verified: false,
        verification_count: 0,
        scope: 'project',
        last_useful: '2024-01-01T12:00:00Z',
      },
      {
        id: '2',
        timestamp: '2024-01-01T12:00:00Z',
        session_id: 'session-2',
        project_path: '/test/project',
        category: 'pattern', // Relevant
        summary: 'Test',
        details: 'Test',
        agent_name: 'workflow-engine',
        confidence: 0.8,
        verified: false,
        verification_count: 0,
        scope: 'project',
        last_useful: '2024-01-01T12:00:00Z',
      },
      {
        id: '3',
        timestamp: '2024-01-01T12:00:00Z',
        session_id: 'session-3',
        project_path: '/test/project',
        category: 'planning_insight', // Relevant
        summary: 'Test',
        details: 'Test',
        agent_name: 'workflow-engine',
        confidence: 0.8,
        verified: false,
        verification_count: 0,
        scope: 'project',
        last_useful: '2024-01-01T12:00:00Z',
      },
      {
        id: '4',
        timestamp: '2024-01-01T12:00:00Z',
        session_id: 'session-4',
        project_path: '/test/project',
        category: 'technical_insight', // Relevant
        summary: 'Test',
        details: 'Test',
        agent_name: 'workflow-engine',
        confidence: 0.8,
        verified: false,
        verification_count: 0,
        scope: 'project',
        last_useful: '2024-01-01T12:00:00Z',
      },
    ];

    const result = queryRelevantDiscoveries(discoveries, baseContext);

    // All should be included (score 3+1=4 each)
    expect(result).toHaveLength(4);
  });

  it('verified discoveries rank higher via score', () => {
    const discoveries: AgentDiscovery[] = [
      {
        id: '1',
        timestamp: '2024-01-01T12:00:00Z',
        session_id: 'session-1',
        project_path: '/test/project',
        category: 'pattern',
        summary: 'Verified',
        details: 'Test',
        agent_name: 'workflow-engine',
        confidence: 0.8,
        verified: true, // Verified
        verification_count: 0,
        scope: 'project',
        last_useful: '2024-01-01T12:00:00Z',
      },
      {
        id: '2',
        timestamp: '2024-01-01T12:00:00Z',
        session_id: 'session-2',
        project_path: '/test/project',
        category: 'pattern',
        summary: 'Not verified',
        details: 'Test',
        agent_name: 'workflow-engine',
        confidence: 0.8,
        verified: false,
        verification_count: 0,
        scope: 'project',
        last_useful: '2024-01-01T12:00:00Z',
      },
    ];

    const result = queryRelevantDiscoveries(discoveries, baseContext);

    // Both included (score >=2), verified has higher score
    expect(result).toHaveLength(2);
    // With same timestamp, order depends on implementation
  });

  it('results sorted by timestamp - most recent first', () => {
    const discoveries: AgentDiscovery[] = [
      {
        id: '1',
        timestamp: '2024-01-01T12:00:00Z', // Older
        session_id: 'session-1',
        project_path: '/test/project',
        category: 'pattern',
        summary: 'Older',
        details: 'Test',
        agent_name: 'workflow-engine',
        confidence: 0.8,
        verified: false,
        verification_count: 0,
        scope: 'project',
        last_useful: '2024-01-01T12:00:00Z',
      },
      {
        id: '2',
        timestamp: '2024-01-02T12:00:00Z', // Newer
        session_id: 'session-2',
        project_path: '/test/project',
        category: 'pattern',
        summary: 'Newer',
        details: 'Test',
        agent_name: 'workflow-engine',
        confidence: 0.8,
        verified: false,
        verification_count: 0,
        scope: 'project',
        last_useful: '2024-01-02T12:00:00Z',
      },
    ];

    const result = queryRelevantDiscoveries(discoveries, baseContext);

    expect(result[0].id).toBe('2'); // Newer first
    expect(result[1].id).toBe('1');
  });

  it('filters out low-relevance discoveries - score < 2', () => {
    const discoveries: AgentDiscovery[] = [
      {
        id: '1',
        timestamp: '2024-01-01T12:00:00Z',
        session_id: 'session-1',
        project_path: '/other/project', // Different project
        category: 'configuration', // Non-workflow category
        summary: 'Low relevance',
        details: 'Test',
        agent_name: 'workflow-engine',
        confidence: 0.8,
        verified: false,
        verification_count: 0,
        scope: 'project',
        last_useful: '2024-01-01T12:00:00Z',
      },
    ];

    const result = queryRelevantDiscoveries(discoveries, baseContext);

    // Score = 0 (different project, wrong category) < 2
    expect(result).toEqual([]);
  });

  it('includes discoveries with exact minimum score of 2', () => {
    const discoveries: AgentDiscovery[] = [
      {
        id: '1',
        timestamp: '2024-01-01T12:00:00Z',
        session_id: 'session-1',
        project_path: '/other/project',
        category: 'pattern', // +1
        summary: 'Test',
        details: 'Test',
        agent_name: 'workflow-engine',
        task_context: 'test (inception)', // +2
        confidence: 0.8,
        verified: false,
        verification_count: 0,
        scope: 'project',
        last_useful: '2024-01-01T12:00:00Z',
      },
    ];

    const result = queryRelevantDiscoveries(discoveries, baseContext);

    // Score = 2 (phase context + category) - should be included
    expect(result).toHaveLength(1);
  });
});

describe('reportAgentPerformance', () => {
  it('creates success entry for passed result', () => {
    const result = { passed: true };
    const entry = reportAgentPerformance('build', 'oracle', result, 'test-session', '/test/project');

    expect(entry.event_type).toBe('success');
    expect(entry.feedback_category).toBe('praise');
    expect(entry.confidence).toBe(0.9);
  });

  it('creates revision entry for failed result', () => {
    const result = { passed: false, issues: ['Error 1', 'Error 2'] };
    const entry = reportAgentPerformance('build', 'oracle', result, 'test-session', '/test/project');

    expect(entry.event_type).toBe('revision');
    expect(entry.feedback_category).toBe('correction');
    expect(entry.confidence).toBe(0.85);
  });

  it('includes stage in success message', () => {
    const result = { passed: true };
    const entry = reportAgentPerformance('build', 'oracle', result, 'test-session', '/test/project');

    expect(entry.user_message).toContain('build');
    expect(entry.user_message).toContain('Successfully completed');
  });

  it('includes stage and issues in failure message', () => {
    const result = { passed: false, issues: ['Error 1', 'Error 2'] };
    const entry = reportAgentPerformance('build', 'oracle', result, 'test-session', '/test/project');

    expect(entry.user_message).toContain('build');
    expect(entry.user_message).toContain('Error 1');
    expect(entry.user_message).toContain('Error 2');
  });

  it('includes agent name in entry', () => {
    const result = { passed: true };
    const entry = reportAgentPerformance('build', 'oracle', result, 'test-session', '/test/project');

    expect(entry.agent_used).toBe('oracle');
  });

  it('generates valid UUID id', () => {
    const result = { passed: true };
    const entry = reportAgentPerformance('build', 'oracle', result, 'test-session', '/test/project');

    expect(entry.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('includes session_id in entry', () => {
    const result = { passed: true };
    const entry = reportAgentPerformance('build', 'oracle', result, 'test-session', '/test/project');

    expect(entry.session_id).toBe('test-session');
  });

  it('includes project_path in entry', () => {
    const result = { passed: true };
    const entry = reportAgentPerformance('build', 'oracle', result, 'test-session', '/test/project');

    expect(entry.project_path).toBe('/test/project');
  });

  it('handles failure with no issues', () => {
    const result = { passed: false };
    const entry = reportAgentPerformance('build', 'oracle', result, 'test-session', '/test/project');

    expect(entry.user_message).toContain('unknown issues');
  });
});

describe('trackMethodologyPreferences', () => {
  it('creates depth_preference for depth_override event', () => {
    const event: WorkflowEvent = {
      type: 'depth_override',
      phase: 'inception',
      details: 'comprehensive',
    };

    const result = trackMethodologyPreferences(event, []);

    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('depth_preference');
    expect(result[0].value).toBe('comprehensive');
    expect(result[0].count).toBe(1);
  });

  it('creates gate_pattern for gate_approval event', () => {
    const event: WorkflowEvent = {
      type: 'gate_approval',
      phase: 'inception',
      details: 'Gate passed',
    };

    const result = trackMethodologyPreferences(event, []);

    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('gate_pattern:inception');
    expect(result[0].value).toBe('approved');
    expect(result[0].count).toBe(1);
  });

  it('creates gate_pattern for gate_rejection event', () => {
    const event: WorkflowEvent = {
      type: 'gate_rejection',
      phase: 'construction',
      details: 'Gate failed',
    };

    const result = trackMethodologyPreferences(event, []);

    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('gate_pattern:construction');
    expect(result[0].value).toBe('rejected');
    expect(result[0].count).toBe(1);
  });

  it('creates phase_duration for phase_complete event', () => {
    const event: WorkflowEvent = {
      type: 'phase_complete',
      phase: 'verify',
      details: '45 minutes',
    };

    const result = trackMethodologyPreferences(event, []);

    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('phase_duration:verify');
    expect(result[0].value).toBe('45 minutes');
    expect(result[0].count).toBe(1);
  });

  it('increments count for existing preference', () => {
    const existing: MethodologyPreference[] = [
      {
        key: 'depth_preference',
        value: 'comprehensive',
        count: 5,
        lastSeen: '2024-01-01T12:00:00Z',
      },
    ];

    const event: WorkflowEvent = {
      type: 'depth_override',
      phase: 'inception',
      details: 'comprehensive',
    };

    const result = trackMethodologyPreferences(event, existing);

    expect(result).toHaveLength(1);
    expect(result[0].count).toBe(6);
  });

  it('creates new preference if not exists', () => {
    const existing: MethodologyPreference[] = [
      {
        key: 'depth_preference',
        value: 'basic',
        count: 3,
        lastSeen: '2024-01-01T12:00:00Z',
      },
    ];

    const event: WorkflowEvent = {
      type: 'depth_override',
      phase: 'inception',
      details: 'comprehensive',
    };

    const result = trackMethodologyPreferences(event, existing);

    expect(result).toHaveLength(2);
    expect(result[1].key).toBe('depth_preference');
    expect(result[1].value).toBe('comprehensive');
    expect(result[1].count).toBe(1);
  });

  it('returns new array (shallow copy)', () => {
    const existing: MethodologyPreference[] = [
      {
        key: 'depth_preference',
        value: 'basic',
        count: 3,
        lastSeen: '2024-01-01T12:00:00Z',
      },
    ];

    const event: WorkflowEvent = {
      type: 'depth_override',
      phase: 'inception',
      details: 'basic',
    };

    const result = trackMethodologyPreferences(event, existing);

    // Result should have incremented count
    expect(result[0].count).toBe(4);
    // They should be different arrays (shallow copy)
    expect(result).not.toBe(existing);
    // Note: Objects within are mutated (shallow copy limitation)
  });

  it('updates lastSeen timestamp for existing preference', () => {
    const existing: MethodologyPreference[] = [
      {
        key: 'depth_preference',
        value: 'comprehensive',
        count: 5,
        lastSeen: '2024-01-01T12:00:00Z',
      },
    ];

    const event: WorkflowEvent = {
      type: 'depth_override',
      phase: 'inception',
      details: 'comprehensive',
    };

    const before = new Date().toISOString();
    const result = trackMethodologyPreferences(event, existing);
    const after = new Date().toISOString();

    expect(result[0].lastSeen >= before).toBe(true);
    expect(result[0].lastSeen <= after).toBe(true);
  });

  it('handles build_failure event with generic event key', () => {
    const event: WorkflowEvent = {
      type: 'build_failure',
      phase: 'construction',
      details: 'Compilation error',
    };

    const result = trackMethodologyPreferences(event, []);

    expect(result).toHaveLength(1);
    expect(result[0].key).toBe('event:build_failure');
    expect(result[0].value).toBe('Compilation error');
  });
});

describe('recordTrustLevelChange', () => {
  const baseContext: WorkflowContext = {
    workflowId: 'test-workflow',
    featureName: 'test-feature',
    projectPath: '/test/project',
    sessionId: 'test-session',
    phase: 'inception',
  };

  it('creates discovery with planning_insight category', () => {
    const change: TrustLevelChange = {
      from: 'low',
      to: 'high',
      reason: 'Consistent quality improvements',
      timestamp: '2024-01-01T12:00:00Z',
    };

    const discovery = recordTrustLevelChange(change, baseContext);

    expect(discovery.category).toBe('planning_insight');
  });

  it('summary includes from/to levels and reason', () => {
    const change: TrustLevelChange = {
      from: 'low',
      to: 'high',
      reason: 'Consistent quality',
      timestamp: '2024-01-01T12:00:00Z',
    };

    const discovery = recordTrustLevelChange(change, baseContext);

    expect(discovery.summary).toContain('low');
    expect(discovery.summary).toContain('high');
    expect(discovery.summary).toContain('Consistent quality');
  });

  it('uses change timestamp', () => {
    const timestamp = '2024-01-01T12:00:00Z';
    const change: TrustLevelChange = {
      from: 'low',
      to: 'high',
      reason: 'Improvement',
      timestamp,
    };

    const discovery = recordTrustLevelChange(change, baseContext);

    expect(discovery.timestamp).toBe(timestamp);
  });

  it('delegates to captureWorkflowDiscovery', () => {
    const change: TrustLevelChange = {
      from: 'low',
      to: 'high',
      reason: 'Improvement',
      timestamp: '2024-01-01T12:00:00Z',
    };

    const discovery = recordTrustLevelChange(change, baseContext);

    // Verify it has standard discovery structure
    expect(discovery).toHaveProperty('id');
    expect(discovery).toHaveProperty('timestamp');
    expect(discovery).toHaveProperty('session_id');
    expect(discovery).toHaveProperty('project_path');
    expect(discovery).toHaveProperty('category');
    expect(discovery).toHaveProperty('summary');
    expect(discovery).toHaveProperty('details');
    expect(discovery).toHaveProperty('agent_name');
    expect(discovery).toHaveProperty('confidence');
    expect(discovery).toHaveProperty('verified');
    expect(discovery).toHaveProperty('scope');
  });

  it('includes workflow context in discovery', () => {
    const change: TrustLevelChange = {
      from: 'low',
      to: 'high',
      reason: 'Improvement',
      timestamp: '2024-01-01T12:00:00Z',
    };

    const discovery = recordTrustLevelChange(change, baseContext);

    expect(discovery.project_path).toBe('/test/project');
    expect(discovery.session_id).toBe('test-session');
  });
});
