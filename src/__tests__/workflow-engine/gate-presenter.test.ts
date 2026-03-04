import { describe, it, expect } from 'vitest';
import type { ManifestSchema } from '../../features/workflow-engine/phase-types.js';
import {
  presentGate3,
  presentGate4,
  presentGate4Batch,
  presentGate5,
  getGate3TrustBehavior,
  getGate4TrustBehavior,
  findParentUnit,
} from '../../features/workflow-engine/gate-presenter.js';

function createMockManifest(overrides?: Partial<ManifestSchema>): ManifestSchema {
  return {
    schema_version: '2.0.0' as const,
    workflow_id: 'test-workflow',
    feature_name: 'Test Feature',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    phases: {
      discovery: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
      inception: { status: 'complete', started_at: '2024-01-01', completed_at: '2024-01-02', gate_result: null, gate_bypassed: false, bypass_reason: null },
      construction: { status: 'in_progress', started_at: '2024-01-03', completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
      operations: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
    },
    depth_assessment: null,
    artifacts: [],
    links: [],
    risks: [],
    gate_audit: [],
    metrics: null,
    alignment_checks: [],
    risk_tier: null,
    ...overrides,
  };
}

describe('gate-presenter', () => {
  describe('getGate3TrustBehavior', () => {
    it('returns blocking for trust 0', () => {
      expect(getGate3TrustBehavior(0, null)).toBe('blocking');
    });

    it('returns blocking for trust 1', () => {
      expect(getGate3TrustBehavior(1, null)).toBe('blocking');
    });

    it('returns auto-advance for trust 2', () => {
      expect(getGate3TrustBehavior(2, null)).toBe('auto-advance');
    });

    it('returns auto-advance for trust 3', () => {
      expect(getGate3TrustBehavior(3, null)).toBe('auto-advance');
    });

    it('returns blocking for Risk Tier 3 regardless of trust level', () => {
      expect(getGate3TrustBehavior(0, 3)).toBe('blocking');
      expect(getGate3TrustBehavior(1, 3)).toBe('blocking');
      expect(getGate3TrustBehavior(2, 3)).toBe('blocking');
      expect(getGate3TrustBehavior(3, 3)).toBe('blocking');
    });
  });

  describe('getGate4TrustBehavior', () => {
    it('returns blocking for trust 0', () => {
      expect(getGate4TrustBehavior(0, 1)).toBe('blocking');
    });

    it('returns blocking for trust 1', () => {
      expect(getGate4TrustBehavior(1, 1)).toBe('blocking');
    });

    it('returns summary-review for trust 2', () => {
      expect(getGate4TrustBehavior(2, 1)).toBe('summary-review');
    });

    it('returns notification-only for trust 3', () => {
      expect(getGate4TrustBehavior(3, 1)).toBe('notification-only');
    });

    it('returns blocking for Risk Tier 3 regardless of trust level', () => {
      expect(getGate4TrustBehavior(0, 3)).toBe('blocking');
      expect(getGate4TrustBehavior(1, 3)).toBe('blocking');
      expect(getGate4TrustBehavior(2, 3)).toBe('blocking');
      expect(getGate4TrustBehavior(3, 3)).toBe('blocking');
    });
  });

  describe('findParentUnit', () => {
    it('returns parent UNIT id when link exists', () => {
      const manifest = createMockManifest({
        links: [
          { source_id: 'unit-1', target_id: 'bolt-1', link_type: 'derives', created_at: '2024-01-01' },
        ],
      });

      expect(findParentUnit(manifest, 'bolt-1')).toBe('unit-1');
    });

    it('returns null when no parent link exists', () => {
      const manifest = createMockManifest({
        links: [],
      });

      expect(findParentUnit(manifest, 'bolt-1')).toBe(null);
    });

    it('ignores non-derives links', () => {
      const manifest = createMockManifest({
        links: [
          { source_id: 'unit-1', target_id: 'bolt-1', link_type: 'implements', created_at: '2024-01-01' },
        ],
      });

      expect(findParentUnit(manifest, 'bolt-1')).toBe(null);
    });
  });

  describe('presentGate3', () => {
    it('returns GatePresentation for each UNIT artifact', () => {
      const manifest = createMockManifest({
        artifacts: [
          {
            id: 'unit-1',
            stage: 'unit',
            type: 'unit-spec',
            path: 'aidlc-docs/construction/unit-1.md',
            contract_status: 'active',
            contract_version: 1,
            created_at: '2024-01-01',
            updated_at: '2024-01-01',
          },
          {
            id: 'unit-2',
            stage: 'unit',
            type: 'unit-spec',
            path: 'aidlc-docs/construction/unit-2.md',
            contract_status: 'draft',
            contract_version: 1,
            created_at: '2024-01-01',
            updated_at: '2024-01-01',
          },
        ],
      });

      const presentations = presentGate3(manifest, 2);

      expect(presentations).toHaveLength(2);
      expect(presentations[0].gateNumber).toBe(3);
      expect(presentations[0].gateType).toBe('architecture-review');
      expect(presentations[0].artifactId).toBe('unit-1');
      expect(presentations[1].artifactId).toBe('unit-2');
    });

    it('trust 0 returns blocking trustBehavior', () => {
      const manifest = createMockManifest({
        artifacts: [
          {
            id: 'unit-1',
            stage: 'unit',
            type: 'unit-spec',
            path: 'aidlc-docs/construction/unit-1.md',
            contract_status: 'active',
            contract_version: 1,
            created_at: '2024-01-01',
            updated_at: '2024-01-01',
          },
        ],
      });

      const presentations = presentGate3(manifest, 0);

      expect(presentations[0].trustBehavior).toBe('blocking');
    });

    it('trust 1 returns blocking trustBehavior', () => {
      const manifest = createMockManifest({
        artifacts: [
          {
            id: 'unit-1',
            stage: 'unit',
            type: 'unit-spec',
            path: 'aidlc-docs/construction/unit-1.md',
            contract_status: 'active',
            contract_version: 1,
            created_at: '2024-01-01',
            updated_at: '2024-01-01',
          },
        ],
      });

      const presentations = presentGate3(manifest, 1);

      expect(presentations[0].trustBehavior).toBe('blocking');
    });

    it('trust 2 returns auto-advance trustBehavior', () => {
      const manifest = createMockManifest({
        artifacts: [
          {
            id: 'unit-1',
            stage: 'unit',
            type: 'unit-spec',
            path: 'aidlc-docs/construction/unit-1.md',
            contract_status: 'active',
            contract_version: 1,
            created_at: '2024-01-01',
            updated_at: '2024-01-01',
          },
        ],
      });

      const presentations = presentGate3(manifest, 2);

      expect(presentations[0].trustBehavior).toBe('auto-advance');
    });

    it('trust 3 returns auto-advance trustBehavior', () => {
      const manifest = createMockManifest({
        artifacts: [
          {
            id: 'unit-1',
            stage: 'unit',
            type: 'unit-spec',
            path: 'aidlc-docs/construction/unit-1.md',
            contract_status: 'active',
            contract_version: 1,
            created_at: '2024-01-01',
            updated_at: '2024-01-01',
          },
        ],
      });

      const presentations = presentGate3(manifest, 3);

      expect(presentations[0].trustBehavior).toBe('auto-advance');
    });

    it('Risk Tier 3 overrides trust level to always return blocking', () => {
      const manifest = createMockManifest({
        artifacts: [
          {
            id: 'unit-1',
            stage: 'unit',
            type: 'unit-spec',
            path: 'aidlc-docs/construction/unit-1.md',
            contract_status: 'active',
            contract_version: 1,
            created_at: '2024-01-01',
            updated_at: '2024-01-01',
          },
        ],
        risk_tier: {
          tier: 3,
          rationale: 'High risk',
          factors: {
            reversibility: 'difficult',
            blast_radius: 'system-wide',
            data_sensitivity: 'user-facing',
            compliance_impact: 'major',
          },
          override_reason: null,
        },
      });

      const presentations = presentGate3(manifest, 3);

      expect(presentations[0].trustBehavior).toBe('blocking');
    });

    it('returns empty array when no UNIT artifacts exist', () => {
      const manifest = createMockManifest({
        artifacts: [
          {
            id: 'bolt-1',
            stage: 'code-generation',
            type: 'bolt-spec',
            path: 'aidlc-docs/construction/bolt-1.md',
            contract_status: 'active',
            contract_version: 1,
            created_at: '2024-01-01',
            updated_at: '2024-01-01',
          },
        ],
      });

      const presentations = presentGate3(manifest, 2);

      expect(presentations).toHaveLength(0);
    });

    it('review content includes child BOLTs info', () => {
      const manifest = createMockManifest({
        artifacts: [
          {
            id: 'unit-1',
            stage: 'unit',
            type: 'unit-spec',
            path: 'aidlc-docs/construction/unit-1.md',
            contract_status: 'active',
            contract_version: 1,
            created_at: '2024-01-01',
            updated_at: '2024-01-01',
          },
          {
            id: 'bolt-1',
            stage: 'code-generation',
            type: 'bolt-spec',
            path: 'aidlc-docs/construction/bolt-1.md',
            contract_status: 'active',
            contract_version: 1,
            created_at: '2024-01-01',
            updated_at: '2024-01-01',
          },
          {
            id: 'bolt-2',
            stage: 'code-generation',
            type: 'bolt-spec',
            path: 'aidlc-docs/construction/bolt-2.md',
            contract_status: 'draft',
            contract_version: 1,
            created_at: '2024-01-01',
            updated_at: '2024-01-01',
          },
        ],
        links: [
          { source_id: 'unit-1', target_id: 'bolt-1', link_type: 'derives', created_at: '2024-01-01' },
          { source_id: 'unit-1', target_id: 'bolt-2', link_type: 'derives', created_at: '2024-01-01' },
        ],
      });

      const presentations = presentGate3(manifest, 2);

      expect(presentations[0].reviewContent).toContain('Child BOLTs:');
      expect(presentations[0].reviewContent).toContain('bolt-1');
      expect(presentations[0].reviewContent).toContain('bolt-2');
    });

    it('adds Momus review note for Risk Tier 3', () => {
      const manifest = createMockManifest({
        artifacts: [
          {
            id: 'unit-1',
            stage: 'unit',
            type: 'unit-spec',
            path: 'aidlc-docs/construction/unit-1.md',
            contract_status: 'active',
            contract_version: 1,
            created_at: '2024-01-01',
            updated_at: '2024-01-01',
          },
        ],
        risk_tier: {
          tier: 3,
          rationale: 'High risk',
          factors: {
            reversibility: 'difficult',
            blast_radius: 'system-wide',
            data_sensitivity: 'user-facing',
            compliance_impact: 'major',
          },
          override_reason: null,
        },
      });

      const presentations = presentGate3(manifest, 2);

      expect(presentations[0].reviewContent).toContain('Risk Tier 3 - Momus review mandatory');
    });
  });

  describe('presentGate4', () => {
    it('returns correct GatePresentation for a BOLT', () => {
      const manifest = createMockManifest({
        artifacts: [
          {
            id: 'bolt-1',
            stage: 'code-generation',
            type: 'bolt-spec',
            path: 'aidlc-docs/construction/bolt-1.md',
            contract_status: 'active',
            contract_version: 1,
            created_at: '2024-01-01',
            updated_at: '2024-01-01',
          },
        ],
      });

      const presentation = presentGate4(manifest, 'bolt-1', 2, 1);

      expect(presentation.gateNumber).toBe(4);
      expect(presentation.gateType).toBe('code-review');
      expect(presentation.artifactId).toBe('bolt-1');
      expect(presentation.summary).toBe('Code review for bolt-1');
      expect(presentation.reviewContent).toContain('BOLT Spec: aidlc-docs/construction/bolt-1.md');
      expect(presentation.trustLevel).toBe(2);
    });

    it('trust 0 returns blocking trustBehavior', () => {
      const manifest = createMockManifest({
        artifacts: [
          {
            id: 'bolt-1',
            stage: 'code-generation',
            type: 'bolt-spec',
            path: 'aidlc-docs/construction/bolt-1.md',
            contract_status: 'active',
            contract_version: 1,
            created_at: '2024-01-01',
            updated_at: '2024-01-01',
          },
        ],
      });

      const presentation = presentGate4(manifest, 'bolt-1', 0, 1);

      expect(presentation.trustBehavior).toBe('blocking');
      expect(presentation.reviewContent).toContain('Full code review required');
    });

    it('trust 1 returns blocking trustBehavior', () => {
      const manifest = createMockManifest({
        artifacts: [
          {
            id: 'bolt-1',
            stage: 'code-generation',
            type: 'bolt-spec',
            path: 'aidlc-docs/construction/bolt-1.md',
            contract_status: 'active',
            contract_version: 1,
            created_at: '2024-01-01',
            updated_at: '2024-01-01',
          },
        ],
      });

      const presentation = presentGate4(manifest, 'bolt-1', 1, 1);

      expect(presentation.trustBehavior).toBe('blocking');
      expect(presentation.reviewContent).toContain('Full code review required');
    });

    it('trust 2 returns summary-review trustBehavior', () => {
      const manifest = createMockManifest({
        artifacts: [
          {
            id: 'bolt-1',
            stage: 'code-generation',
            type: 'bolt-spec',
            path: 'aidlc-docs/construction/bolt-1.md',
            contract_status: 'active',
            contract_version: 1,
            created_at: '2024-01-01',
            updated_at: '2024-01-01',
          },
        ],
      });

      const presentation = presentGate4(manifest, 'bolt-1', 2, 1);

      expect(presentation.trustBehavior).toBe('summary-review');
      expect(presentation.reviewContent).toContain('Summary review - verify major changes only');
    });

    it('trust 3 returns notification-only trustBehavior', () => {
      const manifest = createMockManifest({
        artifacts: [
          {
            id: 'bolt-1',
            stage: 'code-generation',
            type: 'bolt-spec',
            path: 'aidlc-docs/construction/bolt-1.md',
            contract_status: 'active',
            contract_version: 1,
            created_at: '2024-01-01',
            updated_at: '2024-01-01',
          },
        ],
      });

      const presentation = presentGate4(manifest, 'bolt-1', 3, 1);

      expect(presentation.trustBehavior).toBe('notification-only');
      expect(presentation.reviewContent).toContain('Notification only - AI proceeds automatically');
    });

    it('Risk Tier 3 overrides trust level to always return blocking', () => {
      const manifest = createMockManifest({
        artifacts: [
          {
            id: 'bolt-1',
            stage: 'code-generation',
            type: 'bolt-spec',
            path: 'aidlc-docs/construction/bolt-1.md',
            contract_status: 'active',
            contract_version: 1,
            created_at: '2024-01-01',
            updated_at: '2024-01-01',
          },
        ],
      });

      const presentation = presentGate4(manifest, 'bolt-1', 3, 3);

      expect(presentation.trustBehavior).toBe('blocking');
    });

    it('handles missing bolt artifact gracefully', () => {
      const manifest = createMockManifest({
        artifacts: [],
      });

      expect(() => presentGate4(manifest, 'non-existent-bolt', 2, 1)).toThrow('BOLT artifact not found: non-existent-bolt');
    });

    it('adds Risk Tier 3 note when applicable', () => {
      const manifest = createMockManifest({
        artifacts: [
          {
            id: 'bolt-1',
            stage: 'code-generation',
            type: 'bolt-spec',
            path: 'aidlc-docs/construction/bolt-1.md',
            contract_status: 'active',
            contract_version: 1,
            created_at: '2024-01-01',
            updated_at: '2024-01-01',
          },
        ],
      });

      const presentation = presentGate4(manifest, 'bolt-1', 2, 3);

      expect(presentation.reviewContent).toContain('Risk Tier 3 - Developer review mandatory for every BOLT');
    });
  });

  describe('presentGate4Batch', () => {
    it('returns array with one presentation per bolt', () => {
      const manifest = createMockManifest({
        artifacts: [
          {
            id: 'bolt-1',
            stage: 'code-generation',
            type: 'bolt-spec',
            path: 'aidlc-docs/construction/bolt-1.md',
            contract_status: 'active',
            contract_version: 1,
            created_at: '2024-01-01',
            updated_at: '2024-01-01',
          },
          {
            id: 'bolt-2',
            stage: 'code-generation',
            type: 'bolt-spec',
            path: 'aidlc-docs/construction/bolt-2.md',
            contract_status: 'active',
            contract_version: 1,
            created_at: '2024-01-01',
            updated_at: '2024-01-01',
          },
        ],
      });

      const presentations = presentGate4Batch(manifest, ['bolt-1', 'bolt-2'], 2, 1);

      expect(presentations).toHaveLength(2);
      expect(presentations[0].artifactId).toBe('bolt-1');
      expect(presentations[1].artifactId).toBe('bolt-2');
    });

    it('groups by parent UNIT in summary', () => {
      const manifest = createMockManifest({
        artifacts: [
          {
            id: 'unit-1',
            stage: 'unit',
            type: 'unit-spec',
            path: 'aidlc-docs/construction/unit-1.md',
            contract_status: 'active',
            contract_version: 1,
            created_at: '2024-01-01',
            updated_at: '2024-01-01',
          },
          {
            id: 'bolt-1',
            stage: 'code-generation',
            type: 'bolt-spec',
            path: 'aidlc-docs/construction/bolt-1.md',
            contract_status: 'active',
            contract_version: 1,
            created_at: '2024-01-01',
            updated_at: '2024-01-01',
          },
        ],
        links: [
          { source_id: 'unit-1', target_id: 'bolt-1', link_type: 'derives', created_at: '2024-01-01' },
        ],
      });

      const presentations = presentGate4Batch(manifest, ['bolt-1'], 2, 1);

      expect(presentations[0].summary).toContain('part of unit-1');
    });

    it('trust 2+ gets summary view in reviewContent', () => {
      const manifest = createMockManifest({
        artifacts: [
          {
            id: 'bolt-1',
            stage: 'code-generation',
            type: 'bolt-spec',
            path: 'aidlc-docs/construction/bolt-1.md',
            contract_status: 'active',
            contract_version: 1,
            created_at: '2024-01-01',
            updated_at: '2024-01-01',
          },
        ],
      });

      const presentationsTrust2 = presentGate4Batch(manifest, ['bolt-1'], 2, 1);
      const presentationsTrust3 = presentGate4Batch(manifest, ['bolt-1'], 3, 1);

      expect(presentationsTrust2[0].reviewContent).toContain('[Summary View]');
      expect(presentationsTrust3[0].reviewContent).toContain('[Summary View]');
    });

    it('trust 0-1 does not add summary view', () => {
      const manifest = createMockManifest({
        artifacts: [
          {
            id: 'bolt-1',
            stage: 'code-generation',
            type: 'bolt-spec',
            path: 'aidlc-docs/construction/bolt-1.md',
            contract_status: 'active',
            contract_version: 1,
            created_at: '2024-01-01',
            updated_at: '2024-01-01',
          },
        ],
      });

      const presentationsTrust0 = presentGate4Batch(manifest, ['bolt-1'], 0, 1);
      const presentationsTrust1 = presentGate4Batch(manifest, ['bolt-1'], 1, 1);

      expect(presentationsTrust0[0].reviewContent).not.toContain('[Summary View]');
      expect(presentationsTrust1[0].reviewContent).not.toContain('[Summary View]');
    });
  });

  describe('presentGate5', () => {
    it('always returns blocking trustBehavior regardless of trust level', () => {
      const manifest = createMockManifest({
        artifacts: [],
      });

      const presentationTrust0 = presentGate5(manifest, 0);
      const presentationTrust1 = presentGate5(manifest, 1);
      const presentationTrust2 = presentGate5(manifest, 2);
      const presentationTrust3 = presentGate5(manifest, 3);

      expect(presentationTrust0.trustBehavior).toBe('blocking');
      expect(presentationTrust1.trustBehavior).toBe('blocking');
      expect(presentationTrust2.trustBehavior).toBe('blocking');
      expect(presentationTrust3.trustBehavior).toBe('blocking');
    });

    it('summary includes feature name', () => {
      const manifest = createMockManifest({
        feature_name: 'My Awesome Feature',
      });

      const presentation = presentGate5(manifest, 2);

      expect(presentation.summary).toContain('My Awesome Feature');
    });

    it('review content includes artifact counts and gate audit info', () => {
      const manifest = createMockManifest({
        artifacts: [
          {
            id: 'bolt-1',
            stage: 'code-generation',
            type: 'bolt-spec',
            path: 'aidlc-docs/construction/bolt-1.md',
            contract_status: 'active',
            contract_version: 1,
            created_at: '2024-01-01',
            updated_at: '2024-01-01',
          },
          {
            id: 'bolt-2',
            stage: 'code-generation',
            type: 'bolt-spec',
            path: 'aidlc-docs/construction/bolt-2.md',
            contract_status: 'active',
            contract_version: 1,
            created_at: '2024-01-01',
            updated_at: '2024-01-01',
          },
        ],
        gate_audit: [
          {
            phase: 'inception',
            timestamp: '2024-01-01',
            action: 'approved',
            actor: 'human',
            reason: null,
          },
          {
            phase: 'construction',
            timestamp: '2024-01-02',
            action: 'rejected',
            actor: 'human',
            reason: 'Needs revision',
          },
        ],
      });

      const presentation = presentGate5(manifest, 2);

      expect(presentation.reviewContent).toContain('Total Artifacts: 2');
      expect(presentation.reviewContent).toContain('Approvals: 1');
      expect(presentation.reviewContent).toContain('Rejections: 1');
    });

    it('review content lists all BOLT artifacts', () => {
      const manifest = createMockManifest({
        artifacts: [
          {
            id: 'bolt-1',
            stage: 'code-generation',
            type: 'bolt-spec',
            path: 'aidlc-docs/construction/bolt-1.md',
            contract_status: 'active',
            contract_version: 1,
            created_at: '2024-01-01',
            updated_at: '2024-01-01',
          },
          {
            id: 'bolt-2',
            stage: 'code-generation',
            type: 'bolt-spec',
            path: 'aidlc-docs/construction/bolt-2.md',
            contract_status: 'fulfilled',
            contract_version: 1,
            created_at: '2024-01-01',
            updated_at: '2024-01-01',
          },
        ],
      });

      const presentation = presentGate5(manifest, 2);

      expect(presentation.reviewContent).toContain('bolt-1: active');
      expect(presentation.reviewContent).toContain('bolt-2: fulfilled');
    });

    it('handles no BOLTs gracefully', () => {
      const manifest = createMockManifest({
        artifacts: [
          {
            id: 'unit-1',
            stage: 'unit',
            type: 'unit-spec',
            path: 'aidlc-docs/construction/unit-1.md',
            contract_status: 'active',
            contract_version: 1,
            created_at: '2024-01-01',
            updated_at: '2024-01-01',
          },
        ],
      });

      const presentation = presentGate5(manifest, 2);

      expect(presentation.reviewContent).toContain('No BOLTs found');
    });

    it('returns correct gate number and type', () => {
      const manifest = createMockManifest({});

      const presentation = presentGate5(manifest, 2);

      expect(presentation.gateNumber).toBe(5);
      expect(presentation.gateType).toBe('release-review');
    });
  });

  describe('Risk Tier 3 Behaviors', () => {
    it('Gate 3 always blocking at Risk Tier 3', () => {
      const manifest = createMockManifest({
        artifacts: [
          {
            id: 'unit-1',
            stage: 'unit',
            type: 'unit-spec',
            path: 'aidlc-docs/construction/unit-1.md',
            contract_status: 'active',
            contract_version: 1,
            created_at: '2024-01-01',
            updated_at: '2024-01-01',
          },
        ],
        risk_tier: {
          tier: 3,
          rationale: 'High risk',
          factors: {
            reversibility: 'difficult',
            blast_radius: 'system-wide',
            data_sensitivity: 'user-facing',
            compliance_impact: 'major',
          },
          override_reason: null,
        },
      });

      const presentations = presentGate3(manifest, 3);

      expect(presentations[0].trustBehavior).toBe('blocking');
    });

    it('dev reviews every BOLT (gate4 blocking at Risk Tier 3)', () => {
      const manifest = createMockManifest({
        artifacts: [
          {
            id: 'bolt-1',
            stage: 'code-generation',
            type: 'bolt-spec',
            path: 'aidlc-docs/construction/bolt-1.md',
            contract_status: 'active',
            contract_version: 1,
            created_at: '2024-01-01',
            updated_at: '2024-01-01',
          },
        ],
      });

      const presentation = presentGate4(manifest, 'bolt-1', 3, 3);

      expect(presentation.trustBehavior).toBe('blocking');
    });

    it('Gate 4 presents with blocking notification', () => {
      const manifest = createMockManifest({
        artifacts: [
          {
            id: 'bolt-1',
            stage: 'code-generation',
            type: 'bolt-spec',
            path: 'aidlc-docs/construction/bolt-1.md',
            contract_status: 'active',
            contract_version: 1,
            created_at: '2024-01-01',
            updated_at: '2024-01-01',
          },
        ],
      });

      const presentation = presentGate4(manifest, 'bolt-1', 2, 3);

      expect(presentation.trustBehavior).toBe('blocking');
      expect(presentation.reviewContent).toContain('Risk Tier 3');
    });

    it('Gate presentation includes Momus review mandatory note', () => {
      const manifestGate3 = createMockManifest({
        artifacts: [
          {
            id: 'unit-1',
            stage: 'unit',
            type: 'unit-spec',
            path: 'aidlc-docs/construction/unit-1.md',
            contract_status: 'active',
            contract_version: 1,
            created_at: '2024-01-01',
            updated_at: '2024-01-01',
          },
        ],
        risk_tier: {
          tier: 3,
          rationale: 'High risk',
          factors: {
            reversibility: 'difficult',
            blast_radius: 'system-wide',
            data_sensitivity: 'user-facing',
            compliance_impact: 'major',
          },
          override_reason: null,
        },
      });

      const gate3Presentations = presentGate3(manifestGate3, 2);

      expect(gate3Presentations[0].reviewContent).toContain('Momus review mandatory');
    });
  });
});
