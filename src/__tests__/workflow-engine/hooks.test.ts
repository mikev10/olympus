/**
 * Workflow Hooks Tests
 *
 * Comprehensive unit tests for workflow prompt generation functions.
 */

import {
  buildStructuredWorkflowPrompt,
  buildWorkflowResumptionPrompt,
  buildWorkflowTransitionPrompt,
} from '../../features/workflow-engine/hooks.js';
import type { WorkflowCheckpoint, WorkflowStage } from '../../features/workflow-engine/types.js';

/**
 * Create a test checkpoint fixture with sensible defaults.
 */
function createTestCheckpoint(overrides?: Partial<WorkflowCheckpoint>): WorkflowCheckpoint {
  return {
    schema_version: '1.0.0',
    workflow_id: 'test-workflow-123',
    feature_name: 'user-authentication',
    created_at: '2024-01-15T10:00:00Z',
    updated_at: '2024-01-15T12:00:00Z',
    current_stage: 'intent',
    status: 'in_progress',
    artifacts: {
      intent: null,
      unit: null,
      bolt: null,
      complete: null,
    },
    validation_results: {
      intent: null,
      unit: null,
      bolt: null,
      complete: null,
    },
    ...overrides,
  };
}

describe('Workflow Hooks', () => {
  describe('buildStructuredWorkflowPrompt', () => {
    it('includes feature name', () => {
      const checkpoint = createTestCheckpoint();
      const prompt = buildStructuredWorkflowPrompt('user-auth', checkpoint);

      expect(prompt).toContain('user-auth');
      expect(prompt).toContain('structured workflow for feature');
    });

    it('includes current stage', () => {
      const checkpoint = createTestCheckpoint({ current_stage: 'intent' });
      const prompt = buildStructuredWorkflowPrompt('test-feature', checkpoint);

      expect(prompt).toContain('Current stage: intent');
    });

    it('includes current status', () => {
      const checkpoint = createTestCheckpoint({ status: 'in_progress' });
      const prompt = buildStructuredWorkflowPrompt('test-feature', checkpoint);

      expect(prompt).toContain('Status: in_progress');
    });

    it('handles intent stage without agent', () => {
      const checkpoint = createTestCheckpoint({ current_stage: 'intent' });
      const prompt = buildStructuredWorkflowPrompt('test-feature', checkpoint);

      expect(prompt).toContain('intent');
      expect(prompt).toContain('define business requirements, technical approach, and proposed UNITs');
      expect(prompt).not.toContain('Task(subagent_type=');
    });

    it('handles unit stage without agent', () => {
      const checkpoint = createTestCheckpoint({ current_stage: 'unit' });
      const prompt = buildStructuredWorkflowPrompt('test-feature', checkpoint);

      expect(prompt).toContain('unit');
      expect(prompt).toContain('decompose into module-scoped UNITs with interface contracts');
      expect(prompt).not.toContain('Task(subagent_type=');
    });

    it('handles bolt stage without agent', () => {
      const checkpoint = createTestCheckpoint({ current_stage: 'bolt' });
      const prompt = buildStructuredWorkflowPrompt('test-feature', checkpoint);

      expect(prompt).toContain('bolt');
      expect(prompt).toContain('execute the smallest implementation unit with domain and logical design');
      expect(prompt).not.toContain('Task(subagent_type=');
    });

    it('handles complete stage without agent', () => {
      const checkpoint = createTestCheckpoint({ current_stage: 'complete' });
      const prompt = buildStructuredWorkflowPrompt('test-feature', checkpoint);

      expect(prompt).toContain('complete');
      expect(prompt).toContain('finalize and validate');
      expect(prompt).not.toContain('Task(subagent_type=');
    });

    it('returns non-empty string', () => {
      const checkpoint = createTestCheckpoint();
      const prompt = buildStructuredWorkflowPrompt('test-feature', checkpoint);

      expect(prompt).toBeTruthy();
      expect(prompt.length).toBeGreaterThan(0);
    });
  });

  describe('buildWorkflowResumptionPrompt', () => {
    it('includes feature name', () => {
      const checkpoint = createTestCheckpoint();
      const prompt = buildWorkflowResumptionPrompt('user-auth', checkpoint);

      expect(prompt).toContain('user-auth');
      expect(prompt).toContain('Resuming workflow for feature');
    });

    it('includes interrupted stage', () => {
      const checkpoint = createTestCheckpoint({ current_stage: 'intent' });
      const prompt = buildWorkflowResumptionPrompt('test-feature', checkpoint);

      expect(prompt).toContain('You were interrupted during: intent');
    });

    it('includes last update timestamp', () => {
      const checkpoint = createTestCheckpoint({ updated_at: '2024-01-15T14:30:00Z' });
      const prompt = buildWorkflowResumptionPrompt('test-feature', checkpoint);

      expect(prompt).toContain('Last update: 2024-01-15T14:30:00Z');
    });

    it('includes resume context when available', () => {
      const resumeContext = { lastAction: 'writing PRD', progress: 75 };
      const checkpoint = createTestCheckpoint({ resume_context: resumeContext });
      const prompt = buildWorkflowResumptionPrompt('test-feature', checkpoint);

      expect(prompt).toContain('Resume context:');
      expect(prompt).toContain('lastAction');
      expect(prompt).toContain('writing PRD');
      expect(prompt).toContain('progress');
    });

    it('handles missing resume context gracefully', () => {
      const checkpoint = createTestCheckpoint(); // No resume_context
      const prompt = buildWorkflowResumptionPrompt('test-feature', checkpoint);

      expect(prompt).toContain('Resume context: No additional context available');
      expect(prompt).not.toContain('undefined');
      expect(prompt).not.toContain('null');
    });

    it('handles resuming unit stage without agent', () => {
      const checkpoint = createTestCheckpoint({ current_stage: 'unit' });
      const prompt = buildWorkflowResumptionPrompt('test-feature', checkpoint);

      expect(prompt).toContain('decompose into module-scoped UNITs with interface contracts');
      expect(prompt).toContain('Continue from where you left off');
      expect(prompt).not.toContain('Task(subagent_type=');
    });

    it('returns non-empty string', () => {
      const checkpoint = createTestCheckpoint();
      const prompt = buildWorkflowResumptionPrompt('test-feature', checkpoint);

      expect(prompt).toBeTruthy();
      expect(prompt.length).toBeGreaterThan(0);
    });
  });

  describe('buildWorkflowTransitionPrompt', () => {
    it('shows completed stage', () => {
      const checkpoint = createTestCheckpoint({ current_stage: 'intent' });
      const prompt = buildWorkflowTransitionPrompt(checkpoint, 'unit');

      expect(prompt).toContain('Stage intent complete!');
      expect(prompt).toContain('✓');
    });

    it('shows next stage', () => {
      const checkpoint = createTestCheckpoint({ current_stage: 'intent' });
      const prompt = buildWorkflowTransitionPrompt(checkpoint, 'unit');

      expect(prompt).toContain('Next stage: unit');
    });

    it('lists artifacts when available', () => {
      const checkpoint = createTestCheckpoint({
        current_stage: 'intent',
        artifacts: {
          intent: {
            id: 'INTENT-001',
            path: '.olympus/workflows/user-auth/intent.md',
            created_at: '2024-01-15T10:00:00Z',
            validation_passed: true,
          },
          unit: null,
          bolt: null,
          complete: null,
        },
        validation_results: {
          intent: {
            passed: true,
            coverage_percentage: 95,
            blocking_issues: [],
            timestamp: '2024-01-15T10:30:00Z',
          },
          unit: null,
          bolt: null,
          complete: null,
        },
      });
      const prompt = buildWorkflowTransitionPrompt(checkpoint, 'unit');

      expect(prompt).toContain('Completed artifacts:');
      expect(prompt).toContain('INTENT-001');
      expect(prompt).toContain('.olympus/workflows/user-auth/intent.md');
      expect(prompt).toContain('validated: true');
    });

    it('handles missing artifacts gracefully', () => {
      const checkpoint = createTestCheckpoint({ current_stage: 'intent' });
      const prompt = buildWorkflowTransitionPrompt(checkpoint, 'unit');

      expect(prompt).toContain('Completed artifacts:');
      expect(prompt).toContain('No artifacts recorded for intent stage');
    });

    it('shows validation failed status', () => {
      const checkpoint = createTestCheckpoint({
        current_stage: 'intent',
        artifacts: {
          intent: {
            id: 'INTENT-001',
            path: '.olympus/workflows/user-auth/intent.md',
            created_at: '2024-01-15T11:00:00Z',
            validation_passed: false,
          },
          unit: null,
          bolt: null,
          complete: null,
        },
        validation_results: {
          intent: {
            passed: false,
            coverage_percentage: 60,
            blocking_issues: ['Missing security requirements'],
            timestamp: '2024-01-15T11:30:00Z',
          },
          unit: null,
          bolt: null,
          complete: null,
        },
      });
      const prompt = buildWorkflowTransitionPrompt(checkpoint, 'unit');

      expect(prompt).toContain('validated: false');
    });

    it('includes validation type for next stage', () => {
      const checkpoint = createTestCheckpoint({ current_stage: 'intent' });
      const prompt = buildWorkflowTransitionPrompt(checkpoint, 'unit');

      expect(prompt).toContain('Validation required:');
      expect(prompt).toContain('UNIT decomposition coverage and interface contracts');
    });

    it('handles next stage without agent', () => {
      const checkpoint = createTestCheckpoint({ current_stage: 'intent' });
      const prompt = buildWorkflowTransitionPrompt(checkpoint, 'unit');

      expect(prompt).toContain('decompose into module-scoped UNITs with interface contracts');
      expect(prompt).toContain('Proceed with:');
      expect(prompt).not.toContain('Task(subagent_type=');
    });

    it('handles transition to complete stage', () => {
      const checkpoint = createTestCheckpoint({ current_stage: 'bolt' });
      const prompt = buildWorkflowTransitionPrompt(checkpoint, 'complete');

      expect(prompt).toContain('Stage bolt complete!');
      expect(prompt).toContain('Next stage: complete');
      expect(prompt).toContain('Final workflow validation');
      expect(prompt).not.toContain('Task(subagent_type=');
    });

    it('returns non-empty string', () => {
      const checkpoint = createTestCheckpoint();
      const prompt = buildWorkflowTransitionPrompt(checkpoint, 'intent');

      expect(prompt).toBeTruthy();
      expect(prompt.length).toBeGreaterThan(0);
    });
  });

  describe('all prompt functions', () => {
    it('return non-empty strings for all stages', () => {
      const stages: WorkflowStage[] = ['intent', 'unit', 'bolt', 'complete'];

      stages.forEach((stage) => {
        const checkpoint = createTestCheckpoint({ current_stage: stage });

        const structuredPrompt = buildStructuredWorkflowPrompt('test-feature', checkpoint);
        expect(structuredPrompt.length).toBeGreaterThan(0);

        const resumptionPrompt = buildWorkflowResumptionPrompt('test-feature', checkpoint);
        expect(resumptionPrompt.length).toBeGreaterThan(0);

        if (stage !== 'complete') {
          const nextStageIndex = stages.indexOf(stage) + 1;
          const nextStage = stages[nextStageIndex];
          const transitionPrompt = buildWorkflowTransitionPrompt(checkpoint, nextStage);
          expect(transitionPrompt.length).toBeGreaterThan(0);
        }
      });
    });
  });
});
