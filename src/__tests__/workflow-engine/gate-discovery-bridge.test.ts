import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { GateEvent } from '../../features/workflow-engine/gate-discovery-bridge.js';
import type { WorkflowContext } from '../../features/workflow-engine/learning-bridge.js';
import type { AgentDiscovery } from '../../learning/types.js';

// Mock recordDiscovery to avoid disk writes
vi.mock('../../learning/discovery.js', () => ({
  recordDiscovery: vi.fn((discovery) => ({
    ...discovery,
    id: 'test-discovery-id',
    timestamp: '2026-01-01T00:00:00.000Z',
    verified: false,
    verification_count: 0,
    last_useful: '2026-01-01T00:00:00.000Z',
  })),
}));

// Import after mocking
const { recordDiscovery } = await import('../../learning/discovery.js');
const {
  processGateEvent,
  recordGateRejection,
  recordGateApprovalAfterRejection,
  queryPreviousGateRejections,
} = await import('../../features/workflow-engine/gate-discovery-bridge.js');

describe('Gate Discovery Bridge', () => {
  let mockContext: WorkflowContext;

  beforeEach(() => {
    mockContext = {
      workflowId: 'test-workflow-001',
      featureName: 'User Authentication',
      projectPath: '/test/project',
      sessionId: 'test-session-001',
      phase: 'construction',
      riskTier: {
        tier: 'medium',
        reasoning: 'Moderate complexity, existing patterns',
        requiredDepth: 6,
      },
      depthScore: 6,
    };

    vi.clearAllMocks();
  });

  describe('Gate rejection creates discovery', () => {
    it('should create a workflow_gate discovery for gate rejection', () => {
      const gateEvent: GateEvent = {
        gateNumber: 2,
        artifactId: 'BOLT-003',
        artifactType: 'bolt',
        action: 'rejected',
        reason: 'Missing edge case handling for empty inputs',
        previouslyRejected: false,
      };

      const discovery = processGateEvent(gateEvent, mockContext);

      expect(discovery).not.toBeNull();
      expect(discovery?.category).toBe('workflow_gate');
      expect(discovery?.summary).toContain('Gate 2');
      expect(discovery?.summary).toContain('BOLT-003');
      expect(discovery?.summary).toContain('rejected');
      expect(recordDiscovery).toHaveBeenCalledOnce();
    });

    it('should include gate metadata in details', () => {
      const gateEvent: GateEvent = {
        gateNumber: 3,
        artifactId: 'BOLT-005',
        artifactType: 'bolt',
        action: 'rejected',
        reason: 'Insufficient test coverage',
        previouslyRejected: false,
      };

      const discovery = recordGateRejection(gateEvent, mockContext);

      expect(discovery.details).toContain('Gate Number: 3');
      expect(discovery.details).toContain('Artifact ID: BOLT-005');
      expect(discovery.details).toContain('Artifact Type: bolt');
      expect(discovery.details).toContain('Workflow: test-workflow-001');
      expect(discovery.details).toContain('Phase: construction');
    });

    it('should truncate summary to max 100 chars', () => {
      const gateEvent: GateEvent = {
        gateNumber: 1,
        artifactId: 'BOLT-999',
        artifactType: 'bolt',
        action: 'rejected',
        reason: 'This is a very long rejection reason that exceeds the maximum character limit for the summary field and should be truncated to exactly 100 characters',
        previouslyRejected: false,
      };

      const discovery = recordGateRejection(gateEvent, mockContext);

      expect(discovery.summary.length).toBeLessThanOrEqual(100);
    });
  });

  describe('Gate approval after rejection creates lesson learned discovery', () => {
    it('should create discovery when approved after rejection', () => {
      const gateEvent: GateEvent = {
        gateNumber: 2,
        artifactId: 'BOLT-003',
        artifactType: 'bolt',
        action: 'approved',
        reason: 'Missing edge case handling',
        previouslyRejected: true,
        whatChanged: 'Added validation for empty inputs and null checks',
      };

      const discovery = processGateEvent(gateEvent, mockContext);

      expect(discovery).not.toBeNull();
      expect(discovery?.category).toBe('workflow_gate');
      expect(discovery?.summary).toContain('approved');
      expect(discovery?.summary).toContain('after revision');
      expect(recordDiscovery).toHaveBeenCalledOnce();
    });

    it('should include what changed in details', () => {
      const gateEvent: GateEvent = {
        gateNumber: 4,
        artifactId: 'BOLT-007',
        artifactType: 'bolt',
        action: 'approved',
        reason: 'Performance concerns',
        previouslyRejected: true,
        whatChanged: 'Optimized database queries and added caching',
      };

      const discovery = recordGateApprovalAfterRejection(gateEvent, mockContext);

      expect(discovery.details).toContain('What Changed: Optimized database queries and added caching');
      expect(discovery.details).toContain('Original Rejection Reason: Performance concerns');
      expect(discovery.details).toContain('Approved (after rejection)');
    });
  });

  describe('First-time approval creates no discovery', () => {
    it('should return null for first-time approval', () => {
      const gateEvent: GateEvent = {
        gateNumber: 1,
        artifactId: 'BOLT-001',
        artifactType: 'bolt',
        action: 'approved',
        reason: '',
        previouslyRejected: false,
      };

      const discovery = processGateEvent(gateEvent, mockContext);

      expect(discovery).toBeNull();
      expect(recordDiscovery).not.toHaveBeenCalled();
    });
  });

  describe('Query previous rejections', () => {
    it('should filter discoveries by artifact type and gate number', () => {
      const discoveries: AgentDiscovery[] = [
        {
          id: 'disc-1',
          timestamp: '2026-01-05T00:00:00.000Z',
          session_id: 'sess-1',
          project_path: '/test/project',
          category: 'workflow_gate',
          summary: 'Gate 2 rejected BOLT-003',
          details: 'Gate Number: 2\nArtifact Type: bolt\nReason: Missing tests',
          agent_name: 'workflow-engine',
          confidence: 0.85,
          verified: false,
          verification_count: 0,
          scope: 'project',
          last_useful: '2026-01-05T00:00:00.000Z',
        },
        {
          id: 'disc-2',
          timestamp: '2026-01-03T00:00:00.000Z',
          session_id: 'sess-2',
          project_path: '/test/project',
          category: 'workflow_gate',
          summary: 'Gate 2 rejected BOLT-001',
          details: 'Gate Number: 2\nArtifact Type: bolt\nReason: Poor design',
          agent_name: 'workflow-engine',
          confidence: 0.85,
          verified: false,
          verification_count: 0,
          scope: 'project',
          last_useful: '2026-01-03T00:00:00.000Z',
        },
        {
          id: 'disc-3',
          timestamp: '2026-01-04T00:00:00.000Z',
          session_id: 'sess-3',
          project_path: '/test/project',
          category: 'technical_insight',
          summary: 'Some other discovery',
          details: 'Not a gate discovery',
          agent_name: 'olympian',
          confidence: 0.9,
          verified: false,
          verification_count: 0,
          scope: 'project',
          last_useful: '2026-01-04T00:00:00.000Z',
        },
        {
          id: 'disc-4',
          timestamp: '2026-01-02T00:00:00.000Z',
          session_id: 'sess-4',
          project_path: '/test/project',
          category: 'workflow_gate',
          summary: 'Gate 3 rejected BOLT-002',
          details: 'Gate Number: 3\nArtifact Type: bolt\nReason: Security issue',
          agent_name: 'workflow-engine',
          confidence: 0.85,
          verified: false,
          verification_count: 0,
          scope: 'project',
          last_useful: '2026-01-02T00:00:00.000Z',
        },
      ];

      const results = queryPreviousGateRejections(discoveries, 'bolt', 2);

      expect(results).toHaveLength(2);
      expect(results[0].id).toBe('disc-1'); // Most recent first
      expect(results[1].id).toBe('disc-2');
    });

    it('should return empty array when no matches found', () => {
      const discoveries: AgentDiscovery[] = [
        {
          id: 'disc-1',
          timestamp: '2026-01-05T00:00:00.000Z',
          session_id: 'sess-1',
          project_path: '/test/project',
          category: 'workflow_gate',
          summary: 'Gate 3 rejected INTENT-001',
          details: 'Gate Number: 3\nArtifact Type: intent\nReason: Unclear',
          agent_name: 'workflow-engine',
          confidence: 0.85,
          verified: false,
          verification_count: 0,
          scope: 'project',
          last_useful: '2026-01-05T00:00:00.000Z',
        },
      ];

      const results = queryPreviousGateRejections(discoveries, 'bolt', 2);

      expect(results).toHaveLength(0);
    });

    it('should sort results by timestamp descending', () => {
      const discoveries: AgentDiscovery[] = [
        {
          id: 'disc-old',
          timestamp: '2026-01-01T00:00:00.000Z',
          session_id: 'sess-1',
          project_path: '/test/project',
          category: 'workflow_gate',
          summary: 'Old rejection',
          details: 'Gate Number: 1\nArtifact Type: bolt',
          agent_name: 'workflow-engine',
          confidence: 0.85,
          verified: false,
          verification_count: 0,
          scope: 'project',
          last_useful: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'disc-new',
          timestamp: '2026-01-10T00:00:00.000Z',
          session_id: 'sess-2',
          project_path: '/test/project',
          category: 'workflow_gate',
          summary: 'New rejection',
          details: 'Gate Number: 1\nArtifact Type: bolt',
          agent_name: 'workflow-engine',
          confidence: 0.85,
          verified: false,
          verification_count: 0,
          scope: 'project',
          last_useful: '2026-01-10T00:00:00.000Z',
        },
      ];

      const results = queryPreviousGateRejections(discoveries, 'bolt', 1);

      expect(results[0].id).toBe('disc-new');
      expect(results[1].id).toBe('disc-old');
    });
  });

  describe('Integration test', () => {
    it('should handle full rejection → approval cycle', () => {
      // Fire a rejection
      const rejectionEvent: GateEvent = {
        gateNumber: 2,
        artifactId: 'BOLT-010',
        artifactType: 'bolt',
        action: 'rejected',
        reason: 'Missing error handling',
        previouslyRejected: false,
      };

      const rejectionDiscovery = processGateEvent(rejectionEvent, mockContext);

      expect(rejectionDiscovery).not.toBeNull();
      expect(rejectionDiscovery?.category).toBe('workflow_gate');
      expect(rejectionDiscovery?.summary).toContain('rejected');

      // Fire an approval after rejection
      const approvalEvent: GateEvent = {
        gateNumber: 2,
        artifactId: 'BOLT-010',
        artifactType: 'bolt',
        action: 'approved',
        reason: 'Missing error handling',
        previouslyRejected: true,
        whatChanged: 'Added try-catch blocks and validation',
      };

      const approvalDiscovery = processGateEvent(approvalEvent, mockContext);

      expect(approvalDiscovery).not.toBeNull();
      expect(approvalDiscovery?.category).toBe('workflow_gate');
      expect(approvalDiscovery?.summary).toContain('approved');
      expect(approvalDiscovery?.summary).toContain('after revision');
      expect(approvalDiscovery?.details).toContain('Added try-catch blocks');

      expect(recordDiscovery).toHaveBeenCalledTimes(2);
    });
  });

  describe('Discovery content correctness', () => {
    it('should include all required metadata in rejection discovery', () => {
      const gateEvent: GateEvent = {
        gateNumber: 5,
        artifactId: 'BOLT-020',
        artifactType: 'bolt',
        action: 'rejected',
        reason: 'Incomplete documentation',
        previouslyRejected: false,
      };

      const discovery = recordGateRejection(gateEvent, mockContext);

      expect(discovery.details).toContain('Gate Number: 5');
      expect(discovery.details).toContain('Artifact ID: BOLT-020');
      expect(discovery.details).toContain('Artifact Type: bolt');
      expect(discovery.details).toContain('Workflow: test-workflow-001');
      expect(discovery.details).toContain('Phase: construction');
      expect(discovery.details).toContain('Risk Tier: medium');
      expect(discovery.details).toContain('Depth Score: 6');
      expect(discovery.category).toBe('workflow_gate');
    });

    it('should use workflow-engine as agent name', () => {
      const gateEvent: GateEvent = {
        gateNumber: 1,
        artifactId: 'BOLT-030',
        artifactType: 'bolt',
        action: 'rejected',
        reason: 'Test failure',
        previouslyRejected: false,
      };

      const discovery = recordGateRejection(gateEvent, mockContext);

      expect(discovery.agent_name).toBe('workflow-engine');
    });

    it('should use project scope for gate discoveries', () => {
      const gateEvent: GateEvent = {
        gateNumber: 2,
        artifactId: 'BOLT-040',
        artifactType: 'bolt',
        action: 'rejected',
        reason: 'Design flaw',
        previouslyRejected: false,
      };

      const discovery = recordGateRejection(gateEvent, mockContext);

      expect(discovery.scope).toBe('project');
    });
  });
});
