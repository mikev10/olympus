import { describe, it, expect } from 'vitest';
import {
  generateWorkflowReport,
  computePhaseProgress,
  formatPhaseProgressBar,
  buildArtifactTree,
  buildRiskSummary,
  buildGateSummary,
  buildTrustDisplay,
  buildAlignmentSummary,
  buildDepthDisplay,
  buildRiskTierDisplay,
} from '../../features/workflow-engine/status-reporter.js';
import type {
  ManifestSchema,
  ManifestArtifact,
  TrustState,
  AlignmentCheck,
  RiskEntry,
  GateAuditEntry,
  DepthAssessment,
  RiskTierClassification,
  PhaseState,
  WorkflowPhase,
} from '../../features/workflow-engine/phase-types.js';

// Test data helpers
function createTestPhaseState(overrides: Partial<PhaseState> = {}): PhaseState {
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

function createTestArtifact(overrides: Partial<ManifestArtifact> = {}): ManifestArtifact {
  return {
    id: 'test-artifact',
    type: 'requirements',
    phase: 'vision',
    stage: 'discover',
    path: '/test/path',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    validation_passed: null,
    write_complete: false,
    checksum: null,
    contract_status: 'draft',
    contract_version: 1,
    stale_reason: null,
    ...overrides,
  };
}

function createTestManifest(overrides: Partial<ManifestSchema> = {}): ManifestSchema {
  return {
    schema_version: '2.0.0',
    workflow_id: 'test-workflow',
    feature_name: 'Test Feature',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
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

function createTestTrustState(overrides: Partial<TrustState> = {}): TrustState {
  return {
    current_level: 0,
    total_transitions: 0,
    rejection_count: 0,
    rejection_rate: 0,
    incident_count: 0,
    last_level_change: null,
    level_history: [],
    ...overrides,
  };
}

function createTestRisk(overrides: Partial<RiskEntry> = {}): RiskEntry {
  return {
    id: 'risk-1',
    description: 'Test risk',
    likelihood: 'medium',
    impact: 'medium',
    mitigation: 'Test mitigation',
    status: 'open',
    owner: 'test-owner',
    ...overrides,
  };
}

function createTestGateEntry(overrides: Partial<GateAuditEntry> = {}): GateAuditEntry {
  return {
    phase: 'vision',
    timestamp: '2024-01-01T00:00:00Z',
    action: 'approved',
    actor: 'human',
    reason: null,
    ...overrides,
  };
}

function createTestAlignmentCheck(overrides: Partial<AlignmentCheck> = {}): AlignmentCheck {
  return {
    source_artifact_id: 'source-1',
    target_artifact_id: 'target-1',
    verification: {
      conformance_score: 85,
      coverage_percentage: 90,
      missing_items: [],
      passed: true,
    },
    validation: {
      alignment_score: 88,
      alignment_questions: [],
      passed: true,
    },
    alignment_passed: true,
    checked_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function createTestDepthAssessment(overrides: Partial<DepthAssessment> = {}): DepthAssessment {
  return {
    clarity: 3,
    complexity: 4,
    scope: 3,
    risk: 2,
    context: 3,
    preferences: 2,
    total_score: 17,
    recommended_depth: 'standard',
    skip_forge: false,
    risk_tier: {
      tier: 2,
      rationale: 'Moderate risk',
      factors: {
        reversibility: 'moderate',
        blast_radius: 'cross-cutting',
        data_sensitivity: 'internal',
        compliance_impact: 'minor',
      },
      override_reason: null,
    },
    ...overrides,
  };
}

function createTestRiskTier(overrides: Partial<RiskTierClassification> = {}): RiskTierClassification {
  return {
    tier: 2,
    rationale: 'Moderate risk task',
    factors: {
      reversibility: 'moderate',
      blast_radius: 'cross-cutting',
      data_sensitivity: 'internal',
      compliance_impact: 'minor',
    },
    override_reason: null,
    ...overrides,
  };
}

describe('computePhaseProgress', () => {
  it('returns 0% for phase with no artifacts and not_started status', () => {
    const manifest = createTestManifest({
      artifacts: [],
      phases: {
        vision: createTestPhaseState({ status: 'not_started' }),
        forge: createTestPhaseState({ status: 'not_started' }),
        summit: createTestPhaseState({ status: 'not_started' }),
      },
    });

    const progress = computePhaseProgress(manifest);

    expect(progress).toHaveLength(3);
    expect(progress[0]).toEqual({
      phase: 'vision',
      percentage: 0,
      status: 'not_started',
      artifactCount: 0,
    });
  });

  it('returns 100% for phase marked complete with 0 artifacts', () => {
    const manifest = createTestManifest({
      artifacts: [],
      phases: {
        vision: createTestPhaseState({ status: 'complete' }),
        forge: createTestPhaseState({ status: 'not_started' }),
        summit: createTestPhaseState({ status: 'not_started' }),
      },
    });

    const progress = computePhaseProgress(manifest);

    expect(progress[0]).toEqual({
      phase: 'vision',
      percentage: 100,
      status: 'complete',
      artifactCount: 0,
    });
  });

  it('returns 100% for phase with all active artifacts', () => {
    const manifest = createTestManifest({
      artifacts: [
        createTestArtifact({ id: 'a1', phase: 'vision', contract_status: 'active' }),
        createTestArtifact({ id: 'a2', phase: 'vision', contract_status: 'active' }),
      ],
      phases: {
        vision: createTestPhaseState({ status: 'in_progress' }),
        forge: createTestPhaseState(),
        summit: createTestPhaseState(),
      },
    });

    const progress = computePhaseProgress(manifest);

    expect(progress[0]).toEqual({
      phase: 'vision',
      percentage: 100,
      status: 'in_progress',
      artifactCount: 2,
    });
  });

  it('returns 100% for phase with all fulfilled artifacts', () => {
    const manifest = createTestManifest({
      artifacts: [
        createTestArtifact({ id: 'a1', phase: 'vision', contract_status: 'fulfilled' }),
        createTestArtifact({ id: 'a2', phase: 'vision', contract_status: 'fulfilled' }),
      ],
      phases: {
        vision: createTestPhaseState({ status: 'complete' }),
        forge: createTestPhaseState(),
        summit: createTestPhaseState(),
      },
    });

    const progress = computePhaseProgress(manifest);

    expect(progress[0]).toEqual({
      phase: 'vision',
      percentage: 100,
      status: 'complete',
      artifactCount: 2,
    });
  });

  it('returns partial percentage for phase with mix of draft/active artifacts', () => {
    const manifest = createTestManifest({
      artifacts: [
        createTestArtifact({ id: 'a1', phase: 'vision', contract_status: 'active' }),
        createTestArtifact({ id: 'a2', phase: 'vision', contract_status: 'draft' }),
        createTestArtifact({ id: 'a3', phase: 'vision', contract_status: 'draft' }),
        createTestArtifact({ id: 'a4', phase: 'vision', contract_status: 'draft' }),
      ],
      phases: {
        vision: createTestPhaseState({ status: 'in_progress' }),
        forge: createTestPhaseState(),
        summit: createTestPhaseState(),
      },
    });

    const progress = computePhaseProgress(manifest);

    expect(progress[0]).toEqual({
      phase: 'vision',
      percentage: 25, // 1/4 = 25%
      status: 'in_progress',
      artifactCount: 4,
    });
  });

  it('counts stale and violated artifacts correctly (not as completed)', () => {
    const manifest = createTestManifest({
      artifacts: [
        createTestArtifact({ id: 'a1', phase: 'vision', contract_status: 'active' }),
        createTestArtifact({ id: 'a2', phase: 'vision', contract_status: 'violated' }),
        createTestArtifact({ id: 'a3', phase: 'vision', contract_status: 'stale' }),
        createTestArtifact({ id: 'a4', phase: 'vision', contract_status: 'draft' }),
      ],
      phases: {
        vision: createTestPhaseState({ status: 'in_progress' }),
        forge: createTestPhaseState(),
        summit: createTestPhaseState(),
      },
    });

    const progress = computePhaseProgress(manifest);

    expect(progress[0]).toEqual({
      phase: 'vision',
      percentage: 25, // Only 'a1' is active, 1/4 = 25%
      status: 'in_progress',
      artifactCount: 4,
    });
  });

  it('computes progress for all three phases independently', () => {
    const manifest = createTestManifest({
      artifacts: [
        createTestArtifact({ id: 'v1', phase: 'vision', contract_status: 'active' }),
        createTestArtifact({ id: 'v2', phase: 'vision', contract_status: 'active' }),
        createTestArtifact({ id: 'f1', phase: 'forge', contract_status: 'active' }),
        createTestArtifact({ id: 'f2', phase: 'forge', contract_status: 'draft' }),
        createTestArtifact({ id: 's1', phase: 'summit', contract_status: 'draft' }),
      ],
      phases: {
        vision: createTestPhaseState({ status: 'complete' }),
        forge: createTestPhaseState({ status: 'in_progress' }),
        summit: createTestPhaseState({ status: 'not_started' }),
      },
    });

    const progress = computePhaseProgress(manifest);

    expect(progress).toHaveLength(3);
    expect(progress[0]).toEqual({
      phase: 'vision',
      percentage: 100,
      status: 'complete',
      artifactCount: 2,
    });
    expect(progress[1]).toEqual({
      phase: 'forge',
      percentage: 50,
      status: 'in_progress',
      artifactCount: 2,
    });
    expect(progress[2]).toEqual({
      phase: 'summit',
      percentage: 0,
      status: 'not_started',
      artifactCount: 1,
    });
  });
});

describe('formatPhaseProgressBar', () => {
  it('formats 0% with empty bar', () => {
    const entry = {
      phase: 'vision' as WorkflowPhase,
      percentage: 0,
      status: 'not_started',
      artifactCount: 0,
    };

    const result = formatPhaseProgressBar(entry);

    expect(result).toContain('[--------------------]');
    expect(result).toContain('  0%');
    expect(result).toContain('(not_started)');
    expect(result).toContain('0 artifacts');
  });

  it('formats 100% with full bar', () => {
    const entry = {
      phase: 'vision' as WorkflowPhase,
      percentage: 100,
      status: 'complete',
      artifactCount: 5,
    };

    const result = formatPhaseProgressBar(entry);

    expect(result).toContain('[====================]');
    expect(result).toContain('100%');
    expect(result).toContain('(complete)');
    expect(result).toContain('5 artifacts');
  });

  it('formats 50% with half bar', () => {
    const entry = {
      phase: 'forge' as WorkflowPhase,
      percentage: 50,
      status: 'in_progress',
      artifactCount: 10,
    };

    const result = formatPhaseProgressBar(entry);

    expect(result).toContain('[==========----------]');
    expect(result).toContain(' 50%');
    expect(result).toContain('(in_progress)');
    expect(result).toContain('10 artifacts');
  });

  it('capitalizes phase name', () => {
    const entry = {
      phase: 'vision' as WorkflowPhase,
      percentage: 0,
      status: 'not_started',
      artifactCount: 0,
    };

    const result = formatPhaseProgressBar(entry);

    expect(result).toContain('Vision  ');
  });

  it('pads phase name to 8 characters', () => {
    const visionEntry = {
      phase: 'vision' as WorkflowPhase,
      percentage: 0,
      status: 'not_started',
      artifactCount: 0,
    };
    const summitEntry = {
      phase: 'summit' as WorkflowPhase,
      percentage: 0,
      status: 'not_started',
      artifactCount: 0,
    };

    const visionResult = formatPhaseProgressBar(visionEntry);
    const summitResult = formatPhaseProgressBar(summitEntry);

    // Both should start with phase name padded to 8 chars
    expect(visionResult.substring(0, 8)).toBe('Vision  ');
    expect(summitResult.substring(0, 8)).toBe('Summit  ');
  });

  it('formats 25% correctly', () => {
    const entry = {
      phase: 'forge' as WorkflowPhase,
      percentage: 25,
      status: 'in_progress',
      artifactCount: 4,
    };

    const result = formatPhaseProgressBar(entry);

    expect(result).toContain('[=====---------------]');
    expect(result).toContain(' 25%');
  });

  it('formats 75% correctly', () => {
    const entry = {
      phase: 'summit' as WorkflowPhase,
      percentage: 75,
      status: 'in_progress',
      artifactCount: 8,
    };

    const result = formatPhaseProgressBar(entry);

    expect(result).toContain('[===============-----]');
    expect(result).toContain(' 75%');
  });
});

describe('buildArtifactTree', () => {
  it('returns empty string for manifest with no artifacts', () => {
    const manifest = createTestManifest({ artifacts: [] });

    const result = buildArtifactTree(manifest);

    expect(result).toBe('');
  });

  it('groups artifacts by phase', () => {
    const manifest = createTestManifest({
      artifacts: [
        createTestArtifact({ id: 'v1', phase: 'vision', stage: 'discover' }),
        createTestArtifact({ id: 'f1', phase: 'forge', stage: 'units' }),
      ],
    });

    const result = buildArtifactTree(manifest);

    expect(result).toContain('[Vision]');
    expect(result).toContain('[Forge]');
  });

  it('groups artifacts by stage within phase', () => {
    const manifest = createTestManifest({
      artifacts: [
        createTestArtifact({ id: 'v1', phase: 'vision', stage: 'discover' }),
        createTestArtifact({ id: 'v2', phase: 'vision', stage: 'assess' }),
        createTestArtifact({ id: 'v3', phase: 'vision', stage: 'discover' }),
      ],
    });

    const result = buildArtifactTree(manifest);

    expect(result).toContain('discover/');
    expect(result).toContain('assess/');
  });

  it('shows correct contract status icon for draft', () => {
    const manifest = createTestManifest({
      artifacts: [
        createTestArtifact({ id: 'a1', phase: 'vision', stage: 'discover', contract_status: 'draft' }),
      ],
    });

    const result = buildArtifactTree(manifest);

    expect(result).toContain('[o] a1');
  });

  it('shows correct contract status icon for active', () => {
    const manifest = createTestManifest({
      artifacts: [
        createTestArtifact({ id: 'a1', phase: 'vision', stage: 'discover', contract_status: 'active' }),
      ],
    });

    const result = buildArtifactTree(manifest);

    expect(result).toContain('[+] a1');
  });

  it('shows correct contract status icon for fulfilled', () => {
    const manifest = createTestManifest({
      artifacts: [
        createTestArtifact({ id: 'a1', phase: 'vision', stage: 'discover', contract_status: 'fulfilled' }),
      ],
    });

    const result = buildArtifactTree(manifest);

    expect(result).toContain('[++] a1');
  });

  it('shows correct contract status icon for violated', () => {
    const manifest = createTestManifest({
      artifacts: [
        createTestArtifact({ id: 'a1', phase: 'vision', stage: 'discover', contract_status: 'violated' }),
      ],
    });

    const result = buildArtifactTree(manifest);

    expect(result).toContain('[X] a1');
  });

  it('shows correct contract status icon for stale', () => {
    const manifest = createTestManifest({
      artifacts: [
        createTestArtifact({ id: 'a1', phase: 'vision', stage: 'discover', contract_status: 'stale' }),
      ],
    });

    const result = buildArtifactTree(manifest);

    expect(result).toContain('[!] a1');
  });

  it('shows validation mark v for passed', () => {
    const manifest = createTestManifest({
      artifacts: [
        createTestArtifact({ id: 'a1', phase: 'vision', stage: 'discover', validation_passed: true }),
      ],
    });

    const result = buildArtifactTree(manifest);

    expect(result).toContain('[v]');
  });

  it('shows validation mark x for failed', () => {
    const manifest = createTestManifest({
      artifacts: [
        createTestArtifact({ id: 'a1', phase: 'vision', stage: 'discover', validation_passed: false }),
      ],
    });

    const result = buildArtifactTree(manifest);

    expect(result).toContain('[x]');
  });

  it('shows validation mark - for null', () => {
    const manifest = createTestManifest({
      artifacts: [
        createTestArtifact({ id: 'a1', phase: 'vision', stage: 'discover', validation_passed: null }),
      ],
    });

    const result = buildArtifactTree(manifest);

    expect(result).toContain('[-]');
  });

  it('shows artifact type in parentheses', () => {
    const manifest = createTestManifest({
      artifacts: [
        createTestArtifact({ id: 'a1', phase: 'vision', stage: 'discover', type: 'requirements' }),
      ],
    });

    const result = buildArtifactTree(manifest);

    expect(result).toContain('(requirements)');
  });

  it('builds complete tree structure with hierarchy', () => {
    const manifest = createTestManifest({
      artifacts: [
        createTestArtifact({ id: 'v1', phase: 'vision', stage: 'discover', type: 'requirements', contract_status: 'active', validation_passed: true }),
        createTestArtifact({ id: 'v2', phase: 'vision', stage: 'assess', type: 'depth', contract_status: 'fulfilled', validation_passed: true }),
        createTestArtifact({ id: 'f1', phase: 'forge', stage: 'units', type: 'unit', contract_status: 'draft', validation_passed: null }),
      ],
    });

    const result = buildArtifactTree(manifest);

    expect(result).toContain('[Vision]');
    expect(result).toContain('  discover/');
    expect(result).toContain('    [+] v1 (requirements) [v]');
    expect(result).toContain('  assess/');
    expect(result).toContain('    [++] v2 (depth) [v]');
    expect(result).toContain('[Forge]');
    expect(result).toContain('  units/');
    expect(result).toContain('    [o] f1 (unit) [-]');
  });
});

describe('buildRiskSummary', () => {
  it('returns "No risks registered" for empty array', () => {
    const result = buildRiskSummary([]);

    expect(result).toBe('No risks registered');
  });

  it('shows counts by status', () => {
    const risks = [
      createTestRisk({ id: 'r1', status: 'open' }),
      createTestRisk({ id: 'r2', status: 'open' }),
      createTestRisk({ id: 'r3', status: 'mitigated' }),
      createTestRisk({ id: 'r4', status: 'accepted' }),
      createTestRisk({ id: 'r5', status: 'closed' }),
    ];

    const result = buildRiskSummary(risks);

    expect(result).toContain('Total: 5');
    expect(result).toContain('Open: 2');
    expect(result).toContain('Mitigated: 1');
    expect(result).toContain('Accepted: 1');
    expect(result).toContain('Closed: 1');
  });

  it('shows open risk details', () => {
    const risks = [
      createTestRisk({ id: 'r1', description: 'Critical bug', status: 'open', likelihood: 'high', impact: 'high' }),
    ];

    const result = buildRiskSummary(risks);

    expect(result).toContain('[OPEN] r1: Critical bug (high/high)');
  });

  it('does not show closed risks in detail section', () => {
    const risks = [
      createTestRisk({ id: 'r1', status: 'open', description: 'Open risk' }),
      createTestRisk({ id: 'r2', status: 'closed', description: 'Closed risk' }),
    ];

    const result = buildRiskSummary(risks);

    expect(result).toContain('Open risk');
    expect(result).not.toContain('Closed risk');
  });

  it('shows multiple open risks', () => {
    const risks = [
      createTestRisk({ id: 'r1', status: 'open', description: 'Risk 1', likelihood: 'low', impact: 'medium' }),
      createTestRisk({ id: 'r2', status: 'open', description: 'Risk 2', likelihood: 'medium', impact: 'high' }),
    ];

    const result = buildRiskSummary(risks);

    expect(result).toContain('[OPEN] r1: Risk 1 (low/medium)');
    expect(result).toContain('[OPEN] r2: Risk 2 (medium/high)');
  });
});

describe('buildGateSummary', () => {
  it('returns "No gate transitions recorded" for empty array', () => {
    const result = buildGateSummary([]);

    expect(result).toBe('No gate transitions recorded');
  });

  it('counts approved/rejected/bypassed gates', () => {
    const entries = [
      createTestGateEntry({ action: 'approved' }),
      createTestGateEntry({ action: 'approved' }),
      createTestGateEntry({ action: 'rejected' }),
      createTestGateEntry({ action: 'bypassed' }),
    ];

    const result = buildGateSummary(entries);

    expect(result).toContain('Total: 4');
    expect(result).toContain('Approved: 2');
    expect(result).toContain('Rejected: 1');
    expect(result).toContain('Bypassed: 1');
  });

  it('shows individual entries with phase and actor', () => {
    const entries = [
      createTestGateEntry({ phase: 'vision', action: 'approved', actor: 'human' }),
    ];

    const result = buildGateSummary(entries);

    expect(result).toContain('[APPROVED] Vision by human');
  });

  it('shows reason if provided', () => {
    const entries = [
      createTestGateEntry({ phase: 'forge', action: 'bypassed', actor: 'config', reason: 'Auto-approve enabled' }),
    ];

    const result = buildGateSummary(entries);

    expect(result).toContain('[BYPASSED] Forge by config: Auto-approve enabled');
  });

  it('does not show colon if no reason', () => {
    const entries = [
      createTestGateEntry({ phase: 'summit', action: 'approved', actor: 'trust', reason: null }),
    ];

    const result = buildGateSummary(entries);

    expect(result).toContain('[APPROVED] Summit by trust');
    expect(result).not.toContain('trust:');
  });

  it('capitalizes phase names', () => {
    const entries = [
      createTestGateEntry({ phase: 'vision', action: 'approved', actor: 'human' }),
      createTestGateEntry({ phase: 'forge', action: 'approved', actor: 'human' }),
      createTestGateEntry({ phase: 'summit', action: 'approved', actor: 'human' }),
    ];

    const result = buildGateSummary(entries);

    expect(result).toContain('Vision');
    expect(result).toContain('Forge');
    expect(result).toContain('Summit');
  });
});

describe('buildTrustDisplay', () => {
  it('returns "Trust: Not initialized" for null trustState', () => {
    const result = buildTrustDisplay(null);

    expect(result).toBe('Trust: Not initialized');
  });

  it('shows level 0 as Baseline', () => {
    const trustState = createTestTrustState({ current_level: 0 });

    const result = buildTrustDisplay(trustState);

    expect(result).toContain('Trust Level 0: Baseline');
  });

  it('shows level 1 as Earned', () => {
    const trustState = createTestTrustState({ current_level: 1 });

    const result = buildTrustDisplay(trustState);

    expect(result).toContain('Trust Level 1: Earned');
  });

  it('shows level 2 as Extended', () => {
    const trustState = createTestTrustState({ current_level: 2 });

    const result = buildTrustDisplay(trustState);

    expect(result).toContain('Trust Level 2: Extended');
  });

  it('shows level 3 as Trusted', () => {
    const trustState = createTestTrustState({ current_level: 3 });

    const result = buildTrustDisplay(trustState);

    expect(result).toContain('Trust Level 3: Trusted');
  });

  it('shows transition count', () => {
    const trustState = createTestTrustState({ total_transitions: 5 });

    const result = buildTrustDisplay(trustState);

    expect(result).toContain('Transitions: 5');
  });

  it('shows rejection count and rate', () => {
    const trustState = createTestTrustState({ rejection_count: 3, rejection_rate: 0.15 });

    const result = buildTrustDisplay(trustState);

    expect(result).toContain('Rejections: 3');
    expect(result).toContain('(15.0%)');
  });

  it('shows incident count', () => {
    const trustState = createTestTrustState({ incident_count: 2 });

    const result = buildTrustDisplay(trustState);

    expect(result).toContain('Incidents: 2');
  });

  it('formats complete trust display', () => {
    const trustState = createTestTrustState({
      current_level: 2,
      total_transitions: 10,
      rejection_count: 1,
      rejection_rate: 0.1,
      incident_count: 0,
    });

    const result = buildTrustDisplay(trustState);

    expect(result).toContain('Trust Level 2: Extended');
    expect(result).toContain('Transitions: 10');
    expect(result).toContain('Rejections: 1 (10.0%)');
    expect(result).toContain('Incidents: 0');
  });
});

describe('buildAlignmentSummary', () => {
  it('returns "No alignment checks recorded" for empty array', () => {
    const result = buildAlignmentSummary([]);

    expect(result).toBe('No alignment checks recorded');
  });

  it('shows passed/failed counts', () => {
    const checks = [
      createTestAlignmentCheck({ alignment_passed: true }),
      createTestAlignmentCheck({ alignment_passed: true }),
      createTestAlignmentCheck({ alignment_passed: false }),
    ];

    const result = buildAlignmentSummary(checks);

    expect(result).toContain('Total: 3');
    expect(result).toContain('Passed: 2');
    expect(result).toContain('Failed: 1');
  });

  it('shows individual check details for passed check', () => {
    const checks = [
      createTestAlignmentCheck({
        source_artifact_id: 'req-1',
        target_artifact_id: 'design-1',
        alignment_passed: true,
        verification: {
          conformance_score: 90,
          coverage_percentage: 95,
          missing_items: [],
          passed: true,
        },
        validation: {
          alignment_score: 88,
          alignment_questions: [],
          passed: true,
        },
      }),
    ];

    const result = buildAlignmentSummary(checks);

    expect(result).toContain('[PASS] req-1 -> design-1');
    expect(result).toContain('verification=90% [v]');
    expect(result).toContain('validation [v]');
  });

  it('shows individual check details for failed check', () => {
    const checks = [
      createTestAlignmentCheck({
        source_artifact_id: 'req-2',
        target_artifact_id: 'design-2',
        alignment_passed: false,
        verification: {
          conformance_score: 60,
          coverage_percentage: 70,
          missing_items: ['item1'],
          passed: false,
        },
        validation: {
          alignment_score: 55,
          alignment_questions: [],
          passed: false,
        },
      }),
    ];

    const result = buildAlignmentSummary(checks);

    expect(result).toContain('[FAIL] req-2 -> design-2');
    expect(result).toContain('verification=60% [x]');
    expect(result).toContain('validation [x]');
  });

  it('shows correct marks for mixed verification/validation results', () => {
    const checks = [
      createTestAlignmentCheck({
        source_artifact_id: 's1',
        target_artifact_id: 't1',
        alignment_passed: false,
        verification: {
          conformance_score: 85,
          coverage_percentage: 90,
          missing_items: [],
          passed: true,
        },
        validation: {
          alignment_score: 40,
          alignment_questions: [],
          passed: false,
        },
      }),
    ];

    const result = buildAlignmentSummary(checks);

    expect(result).toContain('verification=85% [v]');
    expect(result).toContain('validation [x]');
  });
});

describe('buildDepthDisplay', () => {
  it('returns "Depth: Not assessed" for null depth', () => {
    const result = buildDepthDisplay(null);

    expect(result).toBe('Depth: Not assessed');
  });

  it('shows depth label and score', () => {
    const depth = createTestDepthAssessment({
      recommended_depth: 'standard',
      total_score: 17,
    });

    const result = buildDepthDisplay(depth);

    expect(result).toContain('Depth: standard');
    expect(result).toContain('(score: 17/30)');
  });

  it('shows skip-forge flag when true', () => {
    const depth = createTestDepthAssessment({
      recommended_depth: 'minimal',
      total_score: 8,
      skip_forge: true,
    });

    const result = buildDepthDisplay(depth);

    expect(result).toContain('[skip-forge]');
  });

  it('does not show skip-forge flag when false', () => {
    const depth = createTestDepthAssessment({
      recommended_depth: 'standard',
      total_score: 17,
      skip_forge: false,
    });

    const result = buildDepthDisplay(depth);

    expect(result).not.toContain('[skip-forge]');
  });

  it('formats minimal depth correctly', () => {
    const depth = createTestDepthAssessment({
      recommended_depth: 'minimal',
      total_score: 9,
      skip_forge: false,
    });

    const result = buildDepthDisplay(depth);

    expect(result).toBe('Depth: minimal (score: 9/30)');
  });

  it('formats comprehensive depth correctly', () => {
    const depth = createTestDepthAssessment({
      recommended_depth: 'comprehensive',
      total_score: 25,
      skip_forge: false,
    });

    const result = buildDepthDisplay(depth);

    expect(result).toBe('Depth: comprehensive (score: 25/30)');
  });
});

describe('buildRiskTierDisplay', () => {
  it('returns "Risk Tier: Not classified" for null riskTier', () => {
    const result = buildRiskTierDisplay(null);

    expect(result).toBe('Risk Tier: Not classified');
  });

  it('shows tier number and rationale', () => {
    const riskTier = createTestRiskTier({
      tier: 2,
      rationale: 'Moderate complexity task',
    });

    const result = buildRiskTierDisplay(riskTier);

    expect(result).toContain('Risk Tier: 2');
    expect(result).toContain('(Moderate complexity task)');
  });

  it('formats tier 1 correctly', () => {
    const riskTier = createTestRiskTier({
      tier: 1,
      rationale: 'Low risk, easily reversible',
    });

    const result = buildRiskTierDisplay(riskTier);

    expect(result).toBe('Risk Tier: 1 (Low risk, easily reversible)');
  });

  it('formats tier 3 correctly', () => {
    const riskTier = createTestRiskTier({
      tier: 3,
      rationale: 'High risk, system-wide impact',
    });

    const result = buildRiskTierDisplay(riskTier);

    expect(result).toBe('Risk Tier: 3 (High risk, system-wide impact)');
  });
});

describe('generateWorkflowReport', () => {
  it('returns all report sections', () => {
    const manifest = createTestManifest({
      artifacts: [
        createTestArtifact({ id: 'a1', phase: 'vision', contract_status: 'active' }),
      ],
    });

    const report = generateWorkflowReport(manifest);

    expect(report).toHaveProperty('summary');
    expect(report).toHaveProperty('phaseProgress');
    expect(report).toHaveProperty('artifactTree');
    expect(report).toHaveProperty('riskSummary');
    expect(report).toHaveProperty('gateSummary');
    expect(report).toHaveProperty('trustDisplay');
    expect(report).toHaveProperty('alignmentSummary');
    expect(report).toHaveProperty('fullReport');
  });

  it('includes workflow metadata in fullReport', () => {
    const manifest = createTestManifest({
      workflow_id: 'wf-123',
      feature_name: 'My Feature',
    });

    const report = generateWorkflowReport(manifest);

    expect(report.fullReport).toContain('# Workflow Status: My Feature');
    expect(report.fullReport).toContain('ID: wf-123');
  });

  it('includes all sections in fullReport', () => {
    const manifest = createTestManifest({
      artifacts: [createTestArtifact()],
      risks: [createTestRisk()],
      gate_audit: [createTestGateEntry()],
      alignment_checks: [createTestAlignmentCheck()],
    });

    const report = generateWorkflowReport(manifest);

    expect(report.fullReport).toContain('## Phase Progress');
    expect(report.fullReport).toContain('## Artifacts');
    expect(report.fullReport).toContain('## Alignment');
    expect(report.fullReport).toContain('## Risk Summary');
    expect(report.fullReport).toContain('## Gate Audit');
  });

  it('handles manifest with no artifacts', () => {
    const manifest = createTestManifest({ artifacts: [] });

    const report = generateWorkflowReport(manifest);

    expect(report.phaseProgress).toHaveLength(3);
    expect(report.artifactTree).toBe('');
    expect(report.riskSummary).toBe('No risks registered');
    expect(report.gateSummary).toBe('No gate transitions recorded');
  });

  it('includes trust display when trustState is provided', () => {
    const manifest = createTestManifest();
    const trustState = createTestTrustState({ current_level: 2 });

    const report = generateWorkflowReport(manifest, trustState);

    expect(report.trustDisplay).toContain('Trust Level 2: Extended');
    expect(report.fullReport).toContain('Trust Level 2: Extended');
  });

  it('shows "Not initialized" for trust when trustState is null', () => {
    const manifest = createTestManifest();

    const report = generateWorkflowReport(manifest, null);

    expect(report.trustDisplay).toBe('Trust: Not initialized');
  });

  it('includes depth assessment when present', () => {
    const manifest = createTestManifest({
      depth_assessment: createTestDepthAssessment({
        recommended_depth: 'comprehensive',
        total_score: 25,
      }),
    });

    const report = generateWorkflowReport(manifest);

    expect(report.fullReport).toContain('Depth: comprehensive (score: 25/30)');
  });

  it('includes risk tier when present', () => {
    const manifest = createTestManifest({
      risk_tier: createTestRiskTier({
        tier: 3,
        rationale: 'System-wide changes',
      }),
    });

    const report = generateWorkflowReport(manifest);

    expect(report.fullReport).toContain('Risk Tier: 3');
    expect(report.fullReport).toContain('System-wide changes');
  });

  it('formats summary line correctly', () => {
    const manifest = createTestManifest({
      artifacts: [
        createTestArtifact({ id: 'a1', phase: 'vision', contract_status: 'active' }),
        createTestArtifact({ id: 'a2', phase: 'vision', contract_status: 'active' }),
        createTestArtifact({ id: 'a3', phase: 'forge', contract_status: 'draft' }),
      ],
      phases: {
        vision: createTestPhaseState({ status: 'complete' }),
        forge: createTestPhaseState({ status: 'in_progress' }),
        summit: createTestPhaseState({ status: 'not_started' }),
      },
    });

    const report = generateWorkflowReport(manifest);

    expect(report.summary).toContain('1/3 phases complete');
    expect(report.summary).toContain('3 artifacts total');
  });

  it('generates complete report with all features', () => {
    const manifest = createTestManifest({
      workflow_id: 'wf-complete',
      feature_name: 'Complete Feature',
      artifacts: [
        createTestArtifact({ id: 'v1', phase: 'vision', stage: 'discover', contract_status: 'active', validation_passed: true }),
        createTestArtifact({ id: 'f1', phase: 'forge', stage: 'units', contract_status: 'draft', validation_passed: null }),
      ],
      risks: [
        createTestRisk({ id: 'r1', status: 'open', description: 'Test risk' }),
      ],
      gate_audit: [
        createTestGateEntry({ phase: 'vision', action: 'approved', actor: 'human' }),
      ],
      alignment_checks: [
        createTestAlignmentCheck({ source_artifact_id: 'v1', target_artifact_id: 'f1', alignment_passed: true }),
      ],
      depth_assessment: createTestDepthAssessment({ recommended_depth: 'standard', total_score: 17 }),
      risk_tier: createTestRiskTier({ tier: 2, rationale: 'Moderate risk' }),
      phases: {
        vision: createTestPhaseState({ status: 'complete' }),
        forge: createTestPhaseState({ status: 'in_progress' }),
        summit: createTestPhaseState({ status: 'not_started' }),
      },
    });
    const trustState = createTestTrustState({ current_level: 1, total_transitions: 5 });

    const report = generateWorkflowReport(manifest, trustState);

    expect(report.fullReport).toContain('# Workflow Status: Complete Feature');
    expect(report.fullReport).toContain('ID: wf-complete');
    expect(report.fullReport).toContain('Vision');
    expect(report.fullReport).toContain('Forge');
    expect(report.fullReport).toContain('Summit');
    expect(report.fullReport).toContain('Depth: standard');
    expect(report.fullReport).toContain('Risk Tier: 2');
    expect(report.fullReport).toContain('Trust Level 1: Earned');
    expect(report.fullReport).toContain('[Vision]');
    expect(report.fullReport).toContain('[PASS] v1 -> f1');
    expect(report.fullReport).toContain('[OPEN] r1: Test risk');
    expect(report.fullReport).toContain('[APPROVED] Vision by human');
  });
});
