import { describe, it, expect } from 'vitest';
import { dispatchRejection, getAgentForGate } from '../../features/workflow-engine/rejection-dispatcher.js';
import type { RejectionContext } from '../../features/workflow-engine/rejection-dispatcher.js';

describe('rejection-dispatcher', () => {
  describe('getAgentForGate', () => {
    it('returns prometheus for gate 1', () => {
      expect(getAgentForGate(1)).toBe('prometheus');
    });

    it('returns prometheus for gate 2', () => {
      expect(getAgentForGate(2)).toBe('prometheus');
    });

    it('returns construction-executor for gate 3', () => {
      expect(getAgentForGate(3)).toBe('construction-executor');
    });

    it('returns olympian for gate 4', () => {
      expect(getAgentForGate(4)).toBe('olympian');
    });

    it('returns olympian for gate 5', () => {
      expect(getAgentForGate(5)).toBe('olympian');
    });

    it('returns olympian as default for unknown gate', () => {
      expect(getAgentForGate(99)).toBe('olympian');
    });
  });

  describe('dispatchRejection', () => {
    const projectPath = '/test/project';
    const workflowId = 'test-workflow';

    describe('prompt construction', () => {
      it('gate 1 prompt includes "Revise the INTENT"', async () => {
        const context: RejectionContext = {
          gateNumber: 1,
          artifactId: 'INTENT-001',
          rejectionReason: 'Too vague',
          rejectedBy: 'human',
          attemptNumber: 1,
        };

        const result = await dispatchRejection(projectPath, workflowId, context);

        expect(result.prompt).toContain('Revise the INTENT based on this feedback: Too vague');
      });

      it('gate 2 prompt includes "Update the INTENT"', async () => {
        const context: RejectionContext = {
          gateNumber: 2,
          artifactId: 'INTENT-001',
          rejectionReason: 'Missing requirements',
          rejectedBy: 'human',
          attemptNumber: 1,
        };

        const result = await dispatchRejection(projectPath, workflowId, context);

        expect(result.prompt).toContain('Update the INTENT based on this feedback: Missing requirements');
      });

      it('gate 3 prompt includes "Regenerate UNITs"', async () => {
        const context: RejectionContext = {
          gateNumber: 3,
          artifactId: 'UNIT-001',
          rejectionReason: 'Architecture unclear',
          rejectedBy: 'human',
          attemptNumber: 1,
        };

        const result = await dispatchRejection(projectPath, workflowId, context);

        expect(result.prompt).toContain('Regenerate UNITs based on this feedback: Architecture unclear');
      });

      it('gate 4 prompt includes "Re-implement this BOLT"', async () => {
        const context: RejectionContext = {
          gateNumber: 4,
          artifactId: 'BOLT-003',
          rejectionReason: 'Code quality issues',
          rejectedBy: 'human',
          attemptNumber: 2,
        };

        const result = await dispatchRejection(projectPath, workflowId, context);

        expect(result.prompt).toContain('Re-implement this BOLT based on this feedback: Code quality issues');
      });

      it('gate 5 prompt includes "Revise operations artifacts"', async () => {
        const context: RejectionContext = {
          gateNumber: 5,
          artifactId: 'OPS-001',
          rejectionReason: 'Missing deployment steps',
          rejectedBy: 'auto',
          attemptNumber: 1,
        };

        const result = await dispatchRejection(projectPath, workflowId, context);

        expect(result.prompt).toContain('Revise operations artifacts based on this feedback: Missing deployment steps');
      });

      it('prompt includes rejection reason', async () => {
        const context: RejectionContext = {
          gateNumber: 4,
          artifactId: 'BOLT-003',
          rejectionReason: 'Code quality issues',
          rejectedBy: 'human',
          attemptNumber: 1,
        };

        const result = await dispatchRejection(projectPath, workflowId, context);

        expect(result.prompt).toContain('Code quality issues');
      });

      it('prompt includes artifact ID', async () => {
        const context: RejectionContext = {
          gateNumber: 4,
          artifactId: 'BOLT-003',
          rejectionReason: 'Code quality issues',
          rejectedBy: 'human',
          attemptNumber: 1,
        };

        const result = await dispatchRejection(projectPath, workflowId, context);

        expect(result.prompt).toContain('BOLT-003');
      });

      it('prompt includes attempt number', async () => {
        const context: RejectionContext = {
          gateNumber: 4,
          artifactId: 'BOLT-003',
          rejectionReason: 'Code quality issues',
          rejectedBy: 'human',
          attemptNumber: 3,
        };

        const result = await dispatchRejection(projectPath, workflowId, context);

        expect(result.prompt).toContain('Attempt Number: 3');
      });

      it('prompt includes workflow ID', async () => {
        const context: RejectionContext = {
          gateNumber: 4,
          artifactId: 'BOLT-003',
          rejectionReason: 'Code quality issues',
          rejectedBy: 'human',
          attemptNumber: 1,
        };

        const result = await dispatchRejection(projectPath, workflowId, context);

        expect(result.prompt).toContain('test-workflow');
      });
    });

    describe('max retries enforcement', () => {
      it('attemptNumber < maxRetries returns maxRetriesReached false', async () => {
        const context: RejectionContext = {
          gateNumber: 4,
          artifactId: 'BOLT-003',
          rejectionReason: 'Code quality issues',
          rejectedBy: 'human',
          attemptNumber: 3,
        };

        const result = await dispatchRejection(projectPath, workflowId, context, 5);

        expect(result.maxRetriesReached).toBe(false);
      });

      it('attemptNumber >= maxRetries (default 5) returns maxRetriesReached true', async () => {
        const context: RejectionContext = {
          gateNumber: 4,
          artifactId: 'BOLT-003',
          rejectionReason: 'Code quality issues',
          rejectedBy: 'human',
          attemptNumber: 5,
        };

        const result = await dispatchRejection(projectPath, workflowId, context);

        expect(result.maxRetriesReached).toBe(true);
      });

      it('custom maxRetries works (maxRetries=3)', async () => {
        const context: RejectionContext = {
          gateNumber: 4,
          artifactId: 'BOLT-003',
          rejectionReason: 'Code quality issues',
          rejectedBy: 'human',
          attemptNumber: 3,
        };

        const result = await dispatchRejection(projectPath, workflowId, context, 3);

        expect(result.maxRetriesReached).toBe(true);
      });

      it('max retries message includes artifact ID', async () => {
        const context: RejectionContext = {
          gateNumber: 4,
          artifactId: 'BOLT-003',
          rejectionReason: 'Code quality issues',
          rejectedBy: 'human',
          attemptNumber: 5,
        };

        const result = await dispatchRejection(projectPath, workflowId, context);

        expect(result.prompt).toContain('Maximum revision attempts reached for BOLT-003');
      });

      it('max retries message suggests manual intervention', async () => {
        const context: RejectionContext = {
          gateNumber: 4,
          artifactId: 'BOLT-003',
          rejectionReason: 'Code quality issues',
          rejectedBy: 'human',
          attemptNumber: 6,
        };

        const result = await dispatchRejection(projectPath, workflowId, context);

        expect(result.prompt).toContain('manual intervention');
        expect(result.prompt).toContain('scope change');
      });
    });

    describe('contract status update', () => {
      it('returns contractStatusUpdate with from violated to draft', async () => {
        const context: RejectionContext = {
          gateNumber: 4,
          artifactId: 'BOLT-003',
          rejectionReason: 'Code quality issues',
          rejectedBy: 'human',
          attemptNumber: 1,
        };

        const result = await dispatchRejection(projectPath, workflowId, context);

        expect(result.contractStatusUpdate).toEqual({
          from: 'violated',
          to: 'draft',
        });
      });

      it('returns status update even when max retries reached', async () => {
        const context: RejectionContext = {
          gateNumber: 4,
          artifactId: 'BOLT-003',
          rejectionReason: 'Code quality issues',
          rejectedBy: 'human',
          attemptNumber: 5,
        };

        const result = await dispatchRejection(projectPath, workflowId, context);

        expect(result.maxRetriesReached).toBe(true);
        expect(result.contractStatusUpdate).toEqual({
          from: 'violated',
          to: 'draft',
        });
      });
    });

    describe('agent type selection', () => {
      it('gate 1 returns prometheus agent', async () => {
        const context: RejectionContext = {
          gateNumber: 1,
          artifactId: 'INTENT-001',
          rejectionReason: 'Too vague',
          rejectedBy: 'human',
          attemptNumber: 1,
        };

        const result = await dispatchRejection(projectPath, workflowId, context);

        expect(result.agentType).toBe('prometheus');
      });

      it('gate 2 returns prometheus agent', async () => {
        const context: RejectionContext = {
          gateNumber: 2,
          artifactId: 'INTENT-001',
          rejectionReason: 'Missing requirements',
          rejectedBy: 'human',
          attemptNumber: 1,
        };

        const result = await dispatchRejection(projectPath, workflowId, context);

        expect(result.agentType).toBe('prometheus');
      });

      it('gate 3 returns construction-executor agent', async () => {
        const context: RejectionContext = {
          gateNumber: 3,
          artifactId: 'UNIT-001',
          rejectionReason: 'Architecture unclear',
          rejectedBy: 'human',
          attemptNumber: 1,
        };

        const result = await dispatchRejection(projectPath, workflowId, context);

        expect(result.agentType).toBe('construction-executor');
      });

      it('gate 4 returns olympian agent', async () => {
        const context: RejectionContext = {
          gateNumber: 4,
          artifactId: 'BOLT-003',
          rejectionReason: 'Code quality issues',
          rejectedBy: 'human',
          attemptNumber: 1,
        };

        const result = await dispatchRejection(projectPath, workflowId, context);

        expect(result.agentType).toBe('olympian');
      });

      it('gate 5 returns olympian agent', async () => {
        const context: RejectionContext = {
          gateNumber: 5,
          artifactId: 'OPS-001',
          rejectionReason: 'Missing deployment steps',
          rejectedBy: 'auto',
          attemptNumber: 1,
        };

        const result = await dispatchRejection(projectPath, workflowId, context);

        expect(result.agentType).toBe('olympian');
      });
    });

    describe('integration test', () => {
      it('gate 4 rejection of BOLT-003 returns correct dispatch', async () => {
        const context: RejectionContext = {
          gateNumber: 4,
          artifactId: 'BOLT-003',
          rejectionReason: 'Code quality issues',
          rejectedBy: 'human',
          attemptNumber: 2,
        };

        const result = await dispatchRejection(projectPath, workflowId, context);

        expect(result.agentType).toBe('olympian');
        expect(result.prompt).toContain('Re-implement this BOLT');
        expect(result.prompt).toContain('Code quality issues');
        expect(result.prompt).toContain('BOLT-003');
        expect(result.prompt).toContain('Attempt Number: 2');
        expect(result.prompt).toContain('test-workflow');
        expect(result.maxRetriesReached).toBe(false);
        expect(result.contractStatusUpdate).toEqual({
          from: 'violated',
          to: 'draft',
        });
      });
    });
  });
});
