import { describe, it, expect, vi } from 'vitest';
import { join } from 'path';
import {
  buildBoltPrompt,
  buildBoltPlanPath,
  BOLT_PLAN_FORMAT_INSTRUCTIONS,
} from '../../features/workflow-engine/bolt-dispatcher.js';
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
  describe('buildBoltPrompt()', () => {
    it('without boltPlanPath does not include Execution Protocol', () => {
      const result = buildBoltPrompt('problem', 'plan', 'unit spec', 'bolt spec');
      expect(result).not.toContain('Execution Protocol');
    });

    it('with boltPlanPath includes plan-first instructions', () => {
      const planPath = '/project/aidlc-docs/wf/construction/UNIT-001/BOLT-001-plan.md';
      const result = buildBoltPrompt('problem', 'plan', 'unit spec', 'bolt spec', planPath);
      expect(result).toContain('Execution Protocol');
      expect(result).toContain('BEFORE implementing');
      expect(result).toContain('Save the plan to:');
      expect(result).toContain(planPath);
    });

    it('with boltPlanPath includes Do NOT begin instruction', () => {
      const result = buildBoltPrompt('p', 's', 'u', 'b', '/some/path.md');
      expect(result).toContain('Do NOT begin implementation until the plan is approved');
    });
  });

  describe('buildBoltPlanPath()', () => {
    it('returns correct path following convention', () => {
      const result = buildBoltPlanPath('/project', 'wf-001', 'UNIT-001', 'BOLT-001');
      const expected = join('/project', 'aidlc-docs', 'wf-001', 'construction', 'UNIT-001', 'BOLT-001-plan.md');
      expect(result).toBe(expected);
    });

    it('includes boltId in the filename', () => {
      const result = buildBoltPlanPath('/p', 'wf', 'U1', 'BOLT-003');
      expect(result).toContain('BOLT-003-plan.md');
    });
  });

  describe('BOLT_PLAN_FORMAT_INSTRUCTIONS', () => {
    it('is a non-empty string', () => {
      expect(typeof BOLT_PLAN_FORMAT_INSTRUCTIONS).toBe('string');
      expect(BOLT_PLAN_FORMAT_INSTRUCTIONS.length).toBeGreaterThan(0);
    });

    it('mentions checkboxes', () => {
      expect(BOLT_PLAN_FORMAT_INSTRUCTIONS).toContain('checkbox');
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
    it('awaiting_bolt_plan_approval is a valid WorkflowStatus value', () => {
      const status: WorkflowStatus = 'awaiting_bolt_plan_approval';
      expect(status).toBe('awaiting_bolt_plan_approval');
    });

    it('executing_bolt_plan is a valid WorkflowStatus value', () => {
      const status: WorkflowStatus = 'executing_bolt_plan';
      expect(status).toBe('executing_bolt_plan');
    });
  });
});
