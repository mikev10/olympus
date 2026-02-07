import { describe, it, expect } from 'vitest';
import {
  recordPhaseStart,
  recordPhaseComplete,
  computeMetrics,
  exportToLearningSystem,
  computePhaseDuration,
  formatDuration,
} from '../../features/workflow-engine/metrics.js';
import type { ManifestSchema, PhaseState, GateAuditEntry, ManifestArtifact, DepthAssessment, RiskTierClassification } from '../../features/workflow-engine/phase-types.js';
import type { WorkflowContext } from '../../features/workflow-engine/learning-bridge.js';

// ============================================================================
// Test Helpers
// ============================================================================

function createTestPhaseState(overrides?: Partial<PhaseState>): PhaseState {
  return {
    status: 'not_started',
    started_at: null,
    completed_at: null,
    gate_result: null,
    gate_bypassed: false,
    bypass_reason: null,
    ...overrides,
  };
}

function createTestManifest(overrides?: Partial<ManifestSchema>): ManifestSchema {
  const now = new Date().toISOString();
  return {
    schema_version: '2.0.0',
    workflow_id: 'test-workflow',
    feature_name: 'Test Feature',
    created_at: now,
    updated_at: now,
    phases: {
      vision: createTestPhaseState(),
      forge: createTestPhaseState(),
      summit: createTestPhaseState(),
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

function createTestArtifact(overrides?: Partial<ManifestArtifact>): ManifestArtifact {
  const now = new Date().toISOString();
  return {
    id: 'artifact-1',
    type: 'design',
    phase: 'vision',
    stage: 'requirements',
    path: '/test/artifact.md',
    created_at: now,
    updated_at: now,
    validation_passed: null,
    write_complete: true,
    checksum: null,
    contract_status: 'active',
    contract_version: 1,
    stale_reason: null,
    ...overrides,
  };
}

function createTestContext(): WorkflowContext {
  return {
    workflowId: 'test-workflow',
    featureName: 'Test Feature',
    projectPath: '/test/project',
    sessionId: 'test-session',
    phase: 'vision',
  };
}

function createTestDepthAssessment(recommended: 'minimal' | 'standard' | 'comprehensive'): DepthAssessment {
  const riskTier: RiskTierClassification = {
    tier: 1,
    rationale: 'Test rationale',
    factors: {
      reversibility: 'easy',
      blast_radius: 'isolated',
      data_sensitivity: 'none',
      compliance_impact: 'none',
    },
    override_reason: null,
  };

  return {
    clarity: 8,
    complexity: 5,
    scope: 6,
    risk: 4,
    context: 7,
    preferences: 6,
    total_score: 36,
    recommended_depth: recommended,
    skip_forge: false,
    risk_tier: riskTier,
  };
}

// ============================================================================
// recordPhaseStart Tests
// ============================================================================

describe('recordPhaseStart', () => {
  it('sets status to in_progress', () => {
    const phaseState = createTestPhaseState();
    const result = recordPhaseStart(phaseState);
    expect(result.status).toBe('in_progress');
  });

  it('sets started_at to ISO string', () => {
    const phaseState = createTestPhaseState();
    const result = recordPhaseStart(phaseState);
    expect(result.started_at).toBeTruthy();
    expect(new Date(result.started_at!).toISOString()).toBe(result.started_at);
  });

  it('does not overwrite existing started_at', () => {
    const existingTime = '2024-01-01T00:00:00.000Z';
    const phaseState = createTestPhaseState({ started_at: existingTime });
    const result = recordPhaseStart(phaseState);
    expect(result.started_at).toBe(existingTime);
  });

  it('returns new object (immutable)', () => {
    const phaseState = createTestPhaseState();
    const result = recordPhaseStart(phaseState);
    expect(result).not.toBe(phaseState);
    expect(phaseState.status).toBe('not_started'); // Original unchanged
  });
});

// ============================================================================
// recordPhaseComplete Tests
// ============================================================================

describe('recordPhaseComplete', () => {
  it('sets status to complete', () => {
    const phaseState = createTestPhaseState({ status: 'in_progress' });
    const result = recordPhaseComplete(phaseState);
    expect(result.status).toBe('complete');
  });

  it('sets completed_at', () => {
    const phaseState = createTestPhaseState({ status: 'in_progress' });
    const result = recordPhaseComplete(phaseState);
    expect(result.completed_at).toBeTruthy();
    expect(new Date(result.completed_at!).toISOString()).toBe(result.completed_at);
  });

  it('returns new object (immutable)', () => {
    const phaseState = createTestPhaseState({ status: 'in_progress' });
    const result = recordPhaseComplete(phaseState);
    expect(result).not.toBe(phaseState);
    expect(phaseState.status).toBe('in_progress'); // Original unchanged
  });
});

// ============================================================================
// computePhaseDuration Tests
// ============================================================================

describe('computePhaseDuration', () => {
  it('returns ms between start and complete', () => {
    const started = new Date('2024-01-01T00:00:00.000Z').toISOString();
    const completed = new Date('2024-01-01T00:01:00.000Z').toISOString();
    const phaseState = createTestPhaseState({ started_at: started, completed_at: completed });
    const duration = computePhaseDuration(phaseState);
    expect(duration).toBe(60000); // 1 minute
  });

  it('returns null if no started_at', () => {
    const phaseState = createTestPhaseState({ completed_at: new Date().toISOString() });
    const duration = computePhaseDuration(phaseState);
    expect(duration).toBeNull();
  });

  it('returns null if no completed_at', () => {
    const phaseState = createTestPhaseState({ started_at: new Date().toISOString() });
    const duration = computePhaseDuration(phaseState);
    expect(duration).toBeNull();
  });

  it('returns null for invalid dates', () => {
    const phaseState = createTestPhaseState({ started_at: 'invalid', completed_at: 'invalid' });
    const duration = computePhaseDuration(phaseState);
    expect(duration).toBeNull();
  });

  it('returns 0 for same start/complete time', () => {
    const time = new Date().toISOString();
    const phaseState = createTestPhaseState({ started_at: time, completed_at: time });
    const duration = computePhaseDuration(phaseState);
    expect(duration).toBe(0);
  });

  it('handles timestamps correctly', () => {
    const started = new Date('2024-01-01T00:00:00.000Z').toISOString();
    const completed = new Date('2024-01-01T01:30:45.500Z').toISOString();
    const phaseState = createTestPhaseState({ started_at: started, completed_at: completed });
    const duration = computePhaseDuration(phaseState);
    expect(duration).toBe(5445500); // 1h 30m 45.5s
  });
});

// ============================================================================
// computeMetrics Tests
// ============================================================================

describe('computeMetrics', () => {
  it('computes phase durations from manifest phases', () => {
    const visionStart = new Date('2024-01-01T00:00:00.000Z').toISOString();
    const visionEnd = new Date('2024-01-01T00:10:00.000Z').toISOString();
    const forgeStart = new Date('2024-01-01T00:10:00.000Z').toISOString();
    const forgeEnd = new Date('2024-01-01T00:30:00.000Z').toISOString();

    const manifest = createTestManifest({
      phases: {
        vision: createTestPhaseState({ started_at: visionStart, completed_at: visionEnd }),
        forge: createTestPhaseState({ started_at: forgeStart, completed_at: forgeEnd }),
        summit: createTestPhaseState(),
      },
    });

    const metrics = computeMetrics(manifest);
    expect(metrics.vision_duration_ms).toBe(600000); // 10 minutes
    expect(metrics.forge_duration_ms).toBe(1200000); // 20 minutes
    expect(metrics.summit_duration_ms).toBeNull();
  });

  it('counts total artifacts', () => {
    const manifest = createTestManifest({
      artifacts: [
        createTestArtifact({ id: 'artifact-1' }),
        createTestArtifact({ id: 'artifact-2' }),
        createTestArtifact({ id: 'artifact-3' }),
      ],
    });

    const metrics = computeMetrics(manifest);
    expect(metrics.total_artifacts).toBe(3);
  });

  it('computes validation pass rate (passed/validated)', () => {
    const manifest = createTestManifest({
      artifacts: [
        createTestArtifact({ id: 'a1', validation_passed: true }),
        createTestArtifact({ id: 'a2', validation_passed: true }),
        createTestArtifact({ id: 'a3', validation_passed: false }),
        createTestArtifact({ id: 'a4', validation_passed: true }),
      ],
    });

    const metrics = computeMetrics(manifest);
    expect(metrics.validation_pass_rate).toBe(0.75); // 3 passed out of 4 validated
  });

  it('returns 0 validation_pass_rate when no validated artifacts', () => {
    const manifest = createTestManifest({
      artifacts: [
        createTestArtifact({ id: 'a1', validation_passed: null }),
        createTestArtifact({ id: 'a2', validation_passed: null }),
      ],
    });

    const metrics = computeMetrics(manifest);
    expect(metrics.validation_pass_rate).toBe(0);
  });

  it('counts gate bypasses', () => {
    const manifest = createTestManifest({
      gate_audit: [
        { phase: 'vision', timestamp: new Date().toISOString(), action: 'approved', actor: 'human', reason: null },
        { phase: 'forge', timestamp: new Date().toISOString(), action: 'bypassed', actor: 'flag', reason: 'testing' },
        { phase: 'summit', timestamp: new Date().toISOString(), action: 'bypassed', actor: 'trust', reason: 'trusted' },
      ],
    });

    const metrics = computeMetrics(manifest);
    expect(metrics.gate_bypass_count).toBe(2);
  });

  it('counts rework (rejections)', () => {
    const manifest = createTestManifest({
      gate_audit: [
        { phase: 'vision', timestamp: new Date().toISOString(), action: 'rejected', actor: 'human', reason: 'incomplete' },
        { phase: 'forge', timestamp: new Date().toISOString(), action: 'approved', actor: 'human', reason: null },
        { phase: 'summit', timestamp: new Date().toISOString(), action: 'rejected', actor: 'human', reason: 'failed validation' },
      ],
    });

    const metrics = computeMetrics(manifest);
    expect(metrics.rework_count).toBe(2);
  });

  it('returns null depth_assessment_accuracy when no depth assessment', () => {
    const manifest = createTestManifest({
      depth_assessment: null,
    });

    const metrics = computeMetrics(manifest);
    expect(metrics.depth_assessment_accuracy).toBeNull();
  });

  it('computes depth accuracy for minimal with low rework', () => {
    const manifest = createTestManifest({
      depth_assessment: createTestDepthAssessment('minimal'),
      gate_audit: [
        { phase: 'vision', timestamp: new Date().toISOString(), action: 'approved', actor: 'human', reason: null },
        { phase: 'forge', timestamp: new Date().toISOString(), action: 'approved', actor: 'human', reason: null },
        { phase: 'summit', timestamp: new Date().toISOString(), action: 'approved', actor: 'human', reason: null },
      ],
    });

    const metrics = computeMetrics(manifest);
    expect(metrics.depth_assessment_accuracy).toBe(1.0); // No rework, minimal was correct
  });

  it('computes depth accuracy for standard with some rework', () => {
    const manifest = createTestManifest({
      depth_assessment: createTestDepthAssessment('standard'),
      gate_audit: [
        { phase: 'vision', timestamp: new Date().toISOString(), action: 'rejected', actor: 'human', reason: 'incomplete' },
        { phase: 'forge', timestamp: new Date().toISOString(), action: 'approved', actor: 'human', reason: null },
        { phase: 'summit', timestamp: new Date().toISOString(), action: 'approved', actor: 'human', reason: null },
      ],
    });

    const metrics = computeMetrics(manifest);
    // Rework rate: 1/3 = 33.3%, standard threshold is 20%
    // accuracy = max(0, 1 - 0.333 * 0.8) = 1 - 0.266 = 0.734
    expect(metrics.depth_assessment_accuracy).toBeCloseTo(0.73, 1);
  });

  it('computes depth accuracy for comprehensive with high rework', () => {
    const manifest = createTestManifest({
      depth_assessment: createTestDepthAssessment('comprehensive'),
      gate_audit: [
        { phase: 'vision', timestamp: new Date().toISOString(), action: 'rejected', actor: 'human', reason: 'incomplete' },
        { phase: 'forge', timestamp: new Date().toISOString(), action: 'rejected', actor: 'human', reason: 'failed' },
        { phase: 'summit', timestamp: new Date().toISOString(), action: 'approved', actor: 'human', reason: null },
      ],
    });

    const metrics = computeMetrics(manifest);
    // Rework rate: 2/3 = 66.7%, comprehensive threshold is 30%
    // accuracy = max(0, 1 - 0.667 * 0.6) = 1 - 0.4 = 0.6
    expect(metrics.depth_assessment_accuracy).toBeCloseTo(0.6, 1);
  });
});

// ============================================================================
// exportToLearningSystem Tests
// ============================================================================

describe('exportToLearningSystem', () => {
  it('creates discoveries for completed phases', () => {
    const metrics = {
      vision_duration_ms: 600000,
      forge_duration_ms: 1200000,
      summit_duration_ms: 300000,
      total_artifacts: 5,
      validation_pass_rate: 1.0,
      gate_bypass_count: 0,
      rework_count: 0,
      depth_assessment_accuracy: 1.0,
    };
    const context = createTestContext();

    const discoveries = exportToLearningSystem(metrics, context);

    expect(discoveries.length).toBe(3); // One for each completed phase
    expect(discoveries[0].category).toBe('pattern'); // phase_complete maps to 'pattern'
    expect(discoveries[1].category).toBe('pattern');
    expect(discoveries[2].category).toBe('pattern');
  });

  it('creates no discovery for null duration phases', () => {
    const metrics = {
      vision_duration_ms: 600000,
      forge_duration_ms: null,
      summit_duration_ms: null,
      total_artifacts: 5,
      validation_pass_rate: 1.0,
      gate_bypass_count: 0,
      rework_count: 0,
      depth_assessment_accuracy: 1.0,
    };
    const context = createTestContext();

    const discoveries = exportToLearningSystem(metrics, context);

    expect(discoveries.length).toBe(1); // Only vision phase
  });

  it('creates gotcha discovery for high rework count (>2)', () => {
    const metrics = {
      vision_duration_ms: null,
      forge_duration_ms: null,
      summit_duration_ms: null,
      total_artifacts: 5,
      validation_pass_rate: 1.0,
      gate_bypass_count: 0,
      rework_count: 3,
      depth_assessment_accuracy: 1.0,
    };
    const context = createTestContext();

    const discoveries = exportToLearningSystem(metrics, context);

    expect(discoveries.length).toBe(1);
    expect(discoveries[0].category).toBe('gotcha');
    expect(discoveries[0].details).toContain('High rework count: 3 rejections');
  });

  it('creates insight for low validation pass rate (<0.8)', () => {
    const metrics = {
      vision_duration_ms: null,
      forge_duration_ms: null,
      summit_duration_ms: null,
      total_artifacts: 10,
      validation_pass_rate: 0.5,
      gate_bypass_count: 0,
      rework_count: 0,
      depth_assessment_accuracy: 1.0,
    };
    const context = createTestContext();

    const discoveries = exportToLearningSystem(metrics, context);

    expect(discoveries.length).toBe(1);
    expect(discoveries[0].category).toBe('technical_insight');
    expect(discoveries[0].details).toContain('Low validation pass rate: 50%');
  });

  it('returns empty array for perfect metrics', () => {
    const metrics = {
      vision_duration_ms: null,
      forge_duration_ms: null,
      summit_duration_ms: null,
      total_artifacts: 5,
      validation_pass_rate: 1.0,
      gate_bypass_count: 0,
      rework_count: 0,
      depth_assessment_accuracy: 1.0,
    };
    const context = createTestContext();

    const discoveries = exportToLearningSystem(metrics, context);

    expect(discoveries).toEqual([]);
  });

  it('each discovery has valid structure', () => {
    const metrics = {
      vision_duration_ms: 600000,
      forge_duration_ms: null,
      summit_duration_ms: null,
      total_artifacts: 5,
      validation_pass_rate: 1.0,
      gate_bypass_count: 0,
      rework_count: 3,
      depth_assessment_accuracy: 1.0,
    };
    const context = createTestContext();

    const discoveries = exportToLearningSystem(metrics, context);

    discoveries.forEach(discovery => {
      expect(discovery).toHaveProperty('id');
      expect(discovery).toHaveProperty('category');
      expect(discovery).toHaveProperty('summary');
      expect(discovery).toHaveProperty('details');
      expect(discovery).toHaveProperty('timestamp');
      expect(discovery).toHaveProperty('agent_name');
      expect(discovery).toHaveProperty('scope');
      expect(typeof discovery.id).toBe('string');
      expect(typeof discovery.category).toBe('string');
      expect(typeof discovery.summary).toBe('string');
      expect(typeof discovery.details).toBe('string');
      expect(typeof discovery.timestamp).toBe('string');
      expect(typeof discovery.agent_name).toBe('string');
    });
  });
});

// ============================================================================
// formatDuration Tests
// ============================================================================

describe('formatDuration', () => {
  it('formats milliseconds (< 1000) as "Xms"', () => {
    expect(formatDuration(0)).toBe('0ms');
    expect(formatDuration(500)).toBe('500ms');
    expect(formatDuration(999)).toBe('999ms');
  });

  it('formats seconds (< 60000) as "X.Xs"', () => {
    expect(formatDuration(1000)).toBe('1.0s');
    expect(formatDuration(5500)).toBe('5.5s');
    expect(formatDuration(59999)).toBe('60.0s');
  });

  it('formats minutes (< 3600000) as "X.Xm"', () => {
    expect(formatDuration(60000)).toBe('1.0m');
    expect(formatDuration(90000)).toBe('1.5m');
    expect(formatDuration(600000)).toBe('10.0m');
    expect(formatDuration(3599999)).toBe('60.0m');
  });

  it('formats hours (>= 3600000) as "X.Xh"', () => {
    expect(formatDuration(3600000)).toBe('1.0h');
    expect(formatDuration(5400000)).toBe('1.5h');
    expect(formatDuration(7200000)).toBe('2.0h');
    expect(formatDuration(36000000)).toBe('10.0h');
  });
});
