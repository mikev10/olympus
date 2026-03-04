import { describe, it, expect, vi } from 'vitest';
import { join } from 'path';
import {
  buildCodeGenerationPrompt,
  buildCodePlanPath,
  CODE_PLAN_FORMAT_INSTRUCTIONS,
} from '../../features/workflow-engine/code-generation-executor.js';
import { shouldAutoApproveBoltPlan, createDefaultTrustState } from '../../features/workflow-engine/trust.js';
import type { TrustState } from '../../features/workflow-engine/phase-types.js';
import type { WorkflowStatus } from '../../features/workflow-engine/types.js';

const { mockGetAgentPerformance } = vi.hoisted(() => ({
  mockGetAgentPerformance: vi.fn(() => null),
}));
vi.mock('../../learning/efficiency.js', () => ({
  getAgentPerformanceForRouting: mockGetAgentPerformance,
}));

function createTrustStateWithLevel(level: 0 | 1 | 2 | 3): TrustState {
  const state = createDefaultTrustState();
  state.current_level = level;
  return state;
}

describe('plan-verify-generate', () => {
  describe('buildCodeGenerationPrompt()', () => {
    it('without codePlanPath does not include Execution Protocol', () => {
      const result = buildCodeGenerationPrompt('problem', 'plan', 'unit spec');
      expect(result).not.toContain('Execution Protocol');
    });

    it('with codePlanPath includes plan-first instructions', () => {
      const planPath = '/project/aidlc-docs/wf/construction/auth-service/code-plan.md';
      const result = buildCodeGenerationPrompt('problem', 'plan', 'unit spec', planPath);
      expect(result).toContain('Execution Protocol');
      expect(result).toContain('Save the plan to:');
      expect(result).toContain(planPath);
    });

    it('with codePlanPath includes Do NOT begin instruction', () => {
      const result = buildCodeGenerationPrompt('p', 's', 'u', '/some/path.md');
      expect(result).toContain('Do NOT begin implementation until the plan is approved');
    });
  });

  describe('buildCodePlanPath()', () => {
    it('returns correct path following convention', () => {
      const result = buildCodePlanPath('/project', 'wf-001', 'auth-service');
      const expected = join('/project', 'aidlc-docs', 'wf-001', 'construction', 'auth-service', 'code-plan.md');
      expect(result).toBe(expected);
    });

    it('includes unitName in the path', () => {
      const result = buildCodePlanPath('/p', 'wf', 'api-gateway');
      expect(result).toContain('api-gateway');
      expect(result).toContain('code-plan.md');
    });
  });

  describe('CODE_PLAN_FORMAT_INSTRUCTIONS', () => {
    it('is a non-empty string', () => {
      expect(typeof CODE_PLAN_FORMAT_INSTRUCTIONS).toBe('string');
      expect(CODE_PLAN_FORMAT_INSTRUCTIONS.length).toBeGreaterThan(0);
    });

    it('mentions checkboxes', () => {
      expect(CODE_PLAN_FORMAT_INSTRUCTIONS).toContain('checkbox');
    });
  });

  describe('shouldAutoApproveBoltPlan()', () => {
    it('returns false at trust level 0', () => {
      expect(shouldAutoApproveBoltPlan(createTrustStateWithLevel(0))).toBe(false);
    });

    it('returns false at trust level 1', () => {
      expect(shouldAutoApproveBoltPlan(createTrustStateWithLevel(1))).toBe(false);
    });

    it('returns true at trust level 2', () => {
      expect(shouldAutoApproveBoltPlan(createTrustStateWithLevel(2))).toBe(true);
    });

    it('returns true at trust level 3', () => {
      expect(shouldAutoApproveBoltPlan(createTrustStateWithLevel(3))).toBe(true);
    });
  });

  describe('WorkflowStatus type compatibility', () => {
    it('awaiting_code_plan_approval is a valid WorkflowStatus value', () => {
      const status: WorkflowStatus = 'awaiting_code_plan_approval';
      expect(status).toBe('awaiting_code_plan_approval');
    });

    it('executing_code_plan is a valid WorkflowStatus value', () => {
      const status: WorkflowStatus = 'executing_code_plan';
      expect(status).toBe('executing_code_plan');
    });
  });
});
