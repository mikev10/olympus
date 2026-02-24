import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  detectPathway,
  generateLevel1Plan,
  writeLevel1PlanArtifact,
  loadLevel1Plan,
  isPhaseIncluded,
  isStageIncluded,
  LEVEL1_PLAN_FORMAT_INSTRUCTIONS,
} from '../../features/workflow-engine/level1-plan.js';
import { adjustDepthForPathway } from '../../features/workflow-engine/depth-assessment.js';
import type { DepthAssessment } from '../../features/workflow-engine/phase-types.js';
import type { PathwayType, Level1Plan } from '../../features/workflow-engine/phase-types.js';

vi.mock('../../features/workflow-engine/discovery.js', () => ({
  detectBrownfield: vi.fn(),
}));

vi.mock('../../features/workflow-engine/manifest.js', () => ({
  registerArtifact: vi.fn(),
}));

import { detectBrownfield } from '../../features/workflow-engine/discovery.js';
import { registerArtifact } from '../../features/workflow-engine/manifest.js';
const mockDetectBrownfield = vi.mocked(detectBrownfield);
const mockRegisterArtifact = vi.mocked(registerArtifact);

function mockDepthAssessment(overrides: Partial<DepthAssessment> = {}): DepthAssessment {
  return {
    clarity: 3,
    complexity: 3,
    scope: 3,
    risk: 3,
    context: 2,
    preferences: 1,
    total_score: 15,
    recommended_depth: 'standard',
    skip_units: false,
    risk_tier: {
      tier: 1,
      rationale: 'Low risk change.',
      factors: {
        reversibility: 'easy',
        blast_radius: 'isolated',
        data_sensitivity: 'none',
        compliance_impact: 'none',
      },
      override_reason: null,
    },
    ...overrides,
  };
}

async function buildPlan(
  pathwayType: PathwayType,
  depthOverrides: Partial<DepthAssessment> = {},
  sourceFileCount = 0,
  intentText = 'implement new feature',
): Promise<Level1Plan> {
  return generateLevel1Plan({
    projectPath: '/fake',
    workflowId: 'wf-test',
    intentText,
    depthAssessment: mockDepthAssessment(depthOverrides),
    pathwayType,
    sourceFileCount,
  });
}

describe('detectPathway', () => {
  it('returns greenfield when project is not brownfield', async () => {
    mockDetectBrownfield.mockResolvedValue({ isBrownfield: false, sourceFileCount: 0 });
    const result = await detectPathway('/some/path', 'build a brand new app');
    expect(result).toBe('greenfield');
  });

  it('returns brownfield-enhancement for "add feature" intent', async () => {
    mockDetectBrownfield.mockResolvedValue({ isBrownfield: true, sourceFileCount: 20 });
    const result = await detectPathway('/some/path', 'add a new feature');
    expect(result).toBe('brownfield-enhancement');
  });

  it('returns bugfix for "fix bug" intent', async () => {
    mockDetectBrownfield.mockResolvedValue({ isBrownfield: true, sourceFileCount: 20 });
    const result = await detectPathway('/some/path', 'fix the login bug');
    expect(result).toBe('bugfix');
  });

  it('returns brownfield-refactor for "refactor the auth module" intent', async () => {
    mockDetectBrownfield.mockResolvedValue({ isBrownfield: true, sourceFileCount: 20 });
    const result = await detectPathway('/some/path', 'refactor the auth module');
    expect(result).toBe('brownfield-refactor');
  });

  it('returns optimization for "optimize performance" intent', async () => {
    mockDetectBrownfield.mockResolvedValue({ isBrownfield: true, sourceFileCount: 20 });
    const result = await detectPathway('/some/path', 'optimize performance');
    expect(result).toBe('optimization');
  });

  it('defaults to brownfield-enhancement when no keywords match', async () => {
    mockDetectBrownfield.mockResolvedValue({ isBrownfield: true, sourceFileCount: 20 });
    const result = await detectPathway('/some/path', 'something completely unrelated');
    expect(result).toBe('brownfield-enhancement');
  });

  it('respects priority order — bugfix wins over brownfield-refactor for "fix and refactor"', async () => {
    mockDetectBrownfield.mockResolvedValue({ isBrownfield: true, sourceFileCount: 20 });
    // PATHWAY_KEYWORDS order: bugfix (priority 1), optimization (2), brownfield-refactor (3), brownfield-enhancement (4)
    const result = await detectPathway('/some/path', 'fix and refactor the module');
    expect(result).toBe('bugfix');
  });

  it('is case insensitive', async () => {
    mockDetectBrownfield.mockResolvedValue({ isBrownfield: true, sourceFileCount: 20 });
    const result = await detectPathway('/some/path', 'FIX the BUG');
    expect(result).toBe('bugfix');
  });

  it('handles multi-word keyword "improve latency" → optimization', async () => {
    mockDetectBrownfield.mockResolvedValue({ isBrownfield: true, sourceFileCount: 20 });
    const result = await detectPathway('/some/path', 'improve latency of the API');
    expect(result).toBe('optimization');
  });
});

describe('generateLevel1Plan', () => {
  describe('greenfield pathway', () => {
    it('excludes discovery, includes inception/construction/operations', async () => {
      const plan = await buildPlan('greenfield');
      expect(plan.phases.discovery.included).toBe(false);
      expect(plan.phases.inception.included).toBe(true);
      expect(plan.phases.construction.included).toBe(true);
      expect(plan.phases.operations.included).toBe(true);
    });
  });

  describe('bugfix pathway', () => {
    it('excludes discovery AND inception, includes construction and operations', async () => {
      const plan = await buildPlan('bugfix');
      expect(plan.phases.discovery.included).toBe(false);
      expect(plan.phases.inception.included).toBe(false);
      expect(plan.phases.construction.included).toBe(true);
      expect(plan.phases.operations.included).toBe(true);
    });

    it('construction stages are shallow (no unit-decomposition)', async () => {
      const plan = await buildPlan('bugfix');
      const constructionStages = plan.stages.filter((s) => s.phase === 'construction');
      const hasUnitDecomp = constructionStages.some((s) => s.stage === 'unit-decomposition');
      expect(hasUnitDecomp).toBe(false);
    });
  });

  describe('brownfield-enhancement pathway', () => {
    it('includes all 4 phases', async () => {
      const plan = await buildPlan('brownfield-enhancement');
      expect(plan.phases.discovery.included).toBe(true);
      expect(plan.phases.inception.included).toBe(true);
      expect(plan.phases.construction.included).toBe(true);
      expect(plan.phases.operations.included).toBe(true);
    });
  });

  describe('brownfield-refactor pathway', () => {
    it('includes all 4 phases', async () => {
      const plan = await buildPlan('brownfield-refactor');
      expect(plan.phases.discovery.included).toBe(true);
      expect(plan.phases.inception.included).toBe(true);
      expect(plan.phases.construction.included).toBe(true);
      expect(plan.phases.operations.included).toBe(true);
    });
  });

  describe('optimization pathway', () => {
    it('includes all 4 phases', async () => {
      const plan = await buildPlan('optimization');
      expect(plan.phases.discovery.included).toBe(true);
      expect(plan.phases.inception.included).toBe(true);
      expect(plan.phases.construction.included).toBe(true);
      expect(plan.phases.operations.included).toBe(true);
    });
  });

  describe('required plan fields', () => {
    it('plan has all required fields', async () => {
      const plan = await buildPlan('greenfield');
      expect(plan.pathway).toBe('greenfield');
      expect(plan.risk_assessment).toMatch(/^(LOW|MEDIUM|HIGH)$/);
      expect(typeof plan.risk_tier).toBe('number');
      expect(plan.phases).toBeDefined();
      expect(Array.isArray(plan.stages)).toBe(true);
      expect(typeof plan.estimated_bolts).toBe('number');
      expect(typeof plan.estimated_depth).toBe('string');
      expect(typeof plan.generated_at).toBe('string');
      expect(plan.approved_at).toBeNull();
      expect(plan.approved_by).toBeNull();
    });
  });

  describe('estimated_bolts calculation', () => {
    it('minimal depth → estimated_bolts = 1', async () => {
      const plan = await buildPlan(
        'greenfield',
        { total_score: 8, recommended_depth: 'minimal', skip_units: true },
        500,
      );
      expect(plan.estimated_bolts).toBe(1);
    });

    it('standard depth with 100 source files → estimated_bolts = 2', async () => {
      const plan = await buildPlan(
        'greenfield',
        { total_score: 15, recommended_depth: 'standard', skip_units: false },
        100,
      );
      expect(plan.estimated_bolts).toBe(2);
    });

    it('comprehensive depth with 50 source files → at least 2', async () => {
      const plan = await buildPlan(
        'brownfield-enhancement',
        { total_score: 25, recommended_depth: 'comprehensive', skip_units: false },
        50,
      );
      expect(plan.estimated_bolts).toBe(2);
    });

    it('comprehensive depth bolt count capped at 20', async () => {
      const plan = await buildPlan(
        'brownfield-enhancement',
        { total_score: 25, recommended_depth: 'comprehensive', skip_units: false },
        600,
      );
      expect(plan.estimated_bolts).toBe(20);
    });

    it('bugfix always produces 1 bolt regardless of depth', async () => {
      const plan = await buildPlan(
        'bugfix',
        { total_score: 25, recommended_depth: 'comprehensive', skip_units: false },
        600,
      );
      expect(plan.estimated_bolts).toBe(1);
    });
  });

  describe('risk_assessment mapping', () => {
    it('score <= 10 → LOW', async () => {
      const plan = await buildPlan('greenfield', { total_score: 8, recommended_depth: 'minimal', skip_units: true });
      expect(plan.risk_assessment).toBe('LOW');
    });

    it('score <= 20 → MEDIUM', async () => {
      const plan = await buildPlan('greenfield', { total_score: 15, recommended_depth: 'standard' });
      expect(plan.risk_assessment).toBe('MEDIUM');
    });

    it('score > 20 → HIGH', async () => {
      const plan = await buildPlan('greenfield', { total_score: 25, recommended_depth: 'comprehensive' });
      expect(plan.risk_assessment).toBe('HIGH');
    });

    it('score exactly 10 → LOW', async () => {
      const plan = await buildPlan('greenfield', { total_score: 10, recommended_depth: 'minimal', skip_units: true });
      expect(plan.risk_assessment).toBe('LOW');
    });

    it('score exactly 20 → MEDIUM', async () => {
      const plan = await buildPlan('greenfield', { total_score: 20, recommended_depth: 'standard' });
      expect(plan.risk_assessment).toBe('MEDIUM');
    });

    it('score exactly 21 → HIGH', async () => {
      const plan = await buildPlan('greenfield', { total_score: 21, recommended_depth: 'comprehensive' });
      expect(plan.risk_assessment).toBe('HIGH');
    });
  });

  describe('stage exclusion for minimal depth', () => {
    it('unit-decomposition is excluded when depth is minimal', async () => {
      const plan = await buildPlan(
        'brownfield-enhancement',
        { total_score: 8, recommended_depth: 'minimal', skip_units: true },
      );
      const unitDecomp = plan.stages.find(
        (s) => s.phase === 'construction' && s.stage === 'unit-decomposition',
      );
      expect(unitDecomp).toBeDefined();
      expect(unitDecomp!.included).toBe(false);
    });

    it('unit-decomposition is included when depth is standard', async () => {
      const plan = await buildPlan(
        'brownfield-enhancement',
        { total_score: 15, recommended_depth: 'standard' },
      );
      const unitDecomp = plan.stages.find(
        (s) => s.phase === 'construction' && s.stage === 'unit-decomposition',
      );
      expect(unitDecomp).toBeDefined();
      expect(unitDecomp!.included).toBe(true);
    });
  });
});

describe('writeLevel1PlanArtifact + loadLevel1Plan', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(process.cwd(), `.test-level1-plan-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('round-trip: write then load preserves pathway, risk_assessment, and phase inclusion', async () => {
    const plan = await buildPlan('brownfield-enhancement', { total_score: 15 });
    await writeLevel1PlanArtifact(tmpDir, 'wf-roundtrip', plan);

    const loaded = loadLevel1Plan(tmpDir, 'wf-roundtrip');
    expect(loaded).not.toBeNull();
    expect(loaded!.pathway).toBe('brownfield-enhancement');
    expect(loaded!.risk_assessment).toBe(plan.risk_assessment);
    expect(loaded!.phases.discovery.included).toBe(plan.phases.discovery.included);
    expect(loaded!.phases.inception.included).toBe(plan.phases.inception.included);
    expect(loaded!.phases.construction.included).toBe(plan.phases.construction.included);
    expect(loaded!.phases.operations.included).toBe(plan.phases.operations.included);
  });

  it('round-trip: loaded stage count matches original', async () => {
    const plan = await buildPlan('brownfield-refactor', { total_score: 15 });
    await writeLevel1PlanArtifact(tmpDir, 'wf-stages', plan);

    const loaded = loadLevel1Plan(tmpDir, 'wf-stages');
    expect(loaded).not.toBeNull();
    expect(loaded!.stages.length).toBe(plan.stages.length);
  });

  it('written markdown contains required section headers', async () => {
    const plan = await buildPlan('greenfield');
    await writeLevel1PlanArtifact(tmpDir, 'wf-md', plan);

    const filePath = path.join(tmpDir, 'aidlc-docs', 'wf-md', 'level1-plan.md');
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('# Level 1 Plan:');
    expect(content).toContain('## Phase Overview');
    expect(content).toContain('## Stage Details');
  });

  it('write creates file at expected path: aidlc-docs/{workflowId}/level1-plan.md', async () => {
    const plan = await buildPlan('greenfield');
    await writeLevel1PlanArtifact(tmpDir, 'wf-path-check', plan);

    const expectedPath = path.join(tmpDir, 'aidlc-docs', 'wf-path-check', 'level1-plan.md');
    expect(fs.existsSync(expectedPath)).toBe(true);
  });

  it('loadLevel1Plan returns null when file does not exist', () => {
    const result = loadLevel1Plan(tmpDir, 'nonexistent-workflow');
    expect(result).toBeNull();
  });

  it('load parses header values correctly', async () => {
    const plan = await buildPlan(
      'bugfix',
      { total_score: 8, recommended_depth: 'minimal', skip_units: true },
    );
    await writeLevel1PlanArtifact(tmpDir, 'wf-headers', plan);

    const loaded = loadLevel1Plan(tmpDir, 'wf-headers');
    expect(loaded).not.toBeNull();
    expect(loaded!.pathway).toBe('bugfix');
    expect(loaded!.risk_assessment).toBe('LOW');
    expect(loaded!.estimated_bolts).toBe(1);
    expect(loaded!.estimated_depth).toBe('minimal');
  });

  it('load preserves estimated_bolts for standard depth', async () => {
    const plan = await buildPlan(
      'greenfield',
      { total_score: 15, recommended_depth: 'standard' },
      100,
    );
    await writeLevel1PlanArtifact(tmpDir, 'wf-bolts', plan);

    const loaded = loadLevel1Plan(tmpDir, 'wf-bolts');
    expect(loaded).not.toBeNull();
    expect(loaded!.estimated_bolts).toBe(2);
  });

  it('approved_at is null when pending', async () => {
    const plan = await buildPlan('greenfield');
    await writeLevel1PlanArtifact(tmpDir, 'wf-approved', plan);

    const loaded = loadLevel1Plan(tmpDir, 'wf-approved');
    expect(loaded).not.toBeNull();
    expect(loaded!.approved_at).toBeNull();
  });

  it('calls registerArtifact with correct id, type, phase, stage, and path', async () => {
    mockRegisterArtifact.mockClear();
    const plan = await buildPlan('greenfield');
    const workflowId = 'wf-register';
    await writeLevel1PlanArtifact(tmpDir, workflowId, plan);

    expect(mockRegisterArtifact).toHaveBeenCalledOnce();
    const [calledManifestPath, calledArtifact] = mockRegisterArtifact.mock.calls[0];
    expect(calledManifestPath.replace(/\\/g, '/')).toContain(`aidlc-docs/${workflowId}/manifest.json`);
    expect(calledArtifact.id).toBe(`L1PLAN-${workflowId}`);
    expect(calledArtifact.type).toBe('LEVEL1_PLAN');
    expect(calledArtifact.phase).toBe('inception');
    expect(calledArtifact.stage).toBe('intent');
    expect(calledArtifact.path).toBe(`aidlc-docs/${workflowId}/level1-plan.md`);
    expect(calledArtifact.validation_passed).toBe(true);
    expect(calledArtifact.write_complete).toBe(true);
  });
});

describe('isPhaseIncluded', () => {
  it('returns true for an included phase', async () => {
    const plan = await buildPlan('brownfield-enhancement');
    expect(isPhaseIncluded(plan, 'discovery')).toBe(true);
  });

  it('returns false for an excluded phase', async () => {
    const plan = await buildPlan('greenfield');
    expect(isPhaseIncluded(plan, 'discovery')).toBe(false);
  });

  it('returns true for construction in all pathways', async () => {
    for (const pathway of ['greenfield', 'brownfield-enhancement', 'brownfield-refactor', 'bugfix', 'optimization'] as PathwayType[]) {
      const plan = await buildPlan(pathway);
      expect(isPhaseIncluded(plan, 'construction')).toBe(true);
    }
  });

  it('defaults to true when phase is not present in plan.phases (defensive)', () => {
    const emptyPlan: Level1Plan = {
      pathway: 'greenfield',
      risk_assessment: 'LOW',
      risk_tier: 1,
      phases: {} as Level1Plan['phases'],
      stages: [],
      estimated_bolts: 1,
      estimated_depth: 'minimal',
      generated_at: new Date().toISOString(),
      approved_at: null,
      approved_by: null,
    };
    expect(isPhaseIncluded(emptyPlan, 'discovery')).toBe(true);
  });
});

describe('isStageIncluded', () => {
  it('returns true for an included stage', async () => {
    const plan = await buildPlan('brownfield-enhancement', { total_score: 15, recommended_depth: 'standard' });
    expect(isStageIncluded(plan, 'construction', 'unit-decomposition')).toBe(true);
  });

  it('returns false for an excluded stage (unit-decomposition at minimal depth)', async () => {
    const plan = await buildPlan(
      'brownfield-enhancement',
      { total_score: 8, recommended_depth: 'minimal', skip_units: true },
    );
    expect(isStageIncluded(plan, 'construction', 'unit-decomposition')).toBe(false);
  });

  it('defaults to true when stage is not found in plan.stages', () => {
    const emptyPlan: Level1Plan = {
      pathway: 'greenfield',
      risk_assessment: 'LOW',
      risk_tier: 1,
      phases: {
        discovery: { included: false, rationale: '' },
        inception: { included: true, rationale: '' },
        construction: { included: true, rationale: '' },
        operations: { included: true, rationale: '' },
      },
      stages: [],
      estimated_bolts: 1,
      estimated_depth: 'minimal',
      generated_at: new Date().toISOString(),
      approved_at: null,
      approved_by: null,
    };
    expect(isStageIncluded(emptyPlan, 'construction', 'nonexistent-stage')).toBe(true);
  });

  it('returns true for bolt-execution in all included pathways', async () => {
    const plan = await buildPlan('brownfield-enhancement');
    expect(isStageIncluded(plan, 'construction', 'bolt-execution')).toBe(true);
  });
});

describe('adjustDepthForPathway', () => {
  it('bugfix forces minimal depth regardless of original depth', () => {
    const assessment = mockDepthAssessment({ total_score: 25, recommended_depth: 'comprehensive' });
    const adjusted = adjustDepthForPathway(assessment, 'bugfix');
    expect(adjusted.recommended_depth).toBe('minimal');
    expect(adjusted.total_score).toBeLessThanOrEqual(10);
  });

  it('bugfix caps total_score at 10', () => {
    const assessment = mockDepthAssessment({ total_score: 25, recommended_depth: 'comprehensive' });
    const adjusted = adjustDepthForPathway(assessment, 'bugfix');
    expect(adjusted.total_score).toBe(10);
  });

  it('bugfix keeps score unchanged if already at or below 10', () => {
    const assessment = mockDepthAssessment({ total_score: 7, recommended_depth: 'minimal', skip_units: true });
    const adjusted = adjustDepthForPathway(assessment, 'bugfix');
    expect(adjusted.total_score).toBe(7);
    expect(adjusted.recommended_depth).toBe('minimal');
  });

  it('optimization caps comprehensive → standard', () => {
    const assessment = mockDepthAssessment({ total_score: 25, recommended_depth: 'comprehensive' });
    const adjusted = adjustDepthForPathway(assessment, 'optimization');
    expect(adjusted.recommended_depth).toBe('standard');
  });

  it('optimization caps total_score at 20', () => {
    const assessment = mockDepthAssessment({ total_score: 25, recommended_depth: 'comprehensive' });
    const adjusted = adjustDepthForPathway(assessment, 'optimization');
    expect(adjusted.total_score).toBe(20);
  });

  it('optimization passes through standard depth unchanged', () => {
    const assessment = mockDepthAssessment({ total_score: 15, recommended_depth: 'standard' });
    const adjusted = adjustDepthForPathway(assessment, 'optimization');
    expect(adjusted.recommended_depth).toBe('standard');
    expect(adjusted.total_score).toBe(15);
  });

  it('optimization passes through minimal depth unchanged', () => {
    const assessment = mockDepthAssessment({ total_score: 8, recommended_depth: 'minimal', skip_units: true });
    const adjusted = adjustDepthForPathway(assessment, 'optimization');
    expect(adjusted.recommended_depth).toBe('minimal');
  });

  it('greenfield passes through without changes', () => {
    const assessment = mockDepthAssessment({ total_score: 25, recommended_depth: 'comprehensive' });
    const adjusted = adjustDepthForPathway(assessment, 'greenfield');
    expect(adjusted.recommended_depth).toBe('comprehensive');
    expect(adjusted.total_score).toBe(25);
  });

  it('brownfield-enhancement passes through without changes', () => {
    const assessment = mockDepthAssessment({ total_score: 25, recommended_depth: 'comprehensive' });
    const adjusted = adjustDepthForPathway(assessment, 'brownfield-enhancement');
    expect(adjusted.recommended_depth).toBe('comprehensive');
    expect(adjusted.total_score).toBe(25);
  });

  it('brownfield-refactor passes through without changes', () => {
    const assessment = mockDepthAssessment({ total_score: 25, recommended_depth: 'comprehensive' });
    const adjusted = adjustDepthForPathway(assessment, 'brownfield-refactor');
    expect(adjusted.recommended_depth).toBe('comprehensive');
    expect(adjusted.total_score).toBe(25);
  });

  it('does not mutate the original assessment', () => {
    const assessment = mockDepthAssessment({ total_score: 25, recommended_depth: 'comprehensive' });
    adjustDepthForPathway(assessment, 'bugfix');
    expect(assessment.total_score).toBe(25);
    expect(assessment.recommended_depth).toBe('comprehensive');
  });
});

describe('LEVEL1_PLAN_FORMAT_INSTRUCTIONS', () => {
  it('is a non-empty string', () => {
    expect(typeof LEVEL1_PLAN_FORMAT_INSTRUCTIONS).toBe('string');
    expect(LEVEL1_PLAN_FORMAT_INSTRUCTIONS.length).toBeGreaterThan(0);
  });

  it('contains "Phase Overview"', () => {
    expect(LEVEL1_PLAN_FORMAT_INSTRUCTIONS).toContain('Phase Overview');
  });

  it('contains "Stage Details"', () => {
    expect(LEVEL1_PLAN_FORMAT_INSTRUCTIONS).toContain('Stage Details');
  });

  it('contains valid pathway values', () => {
    expect(LEVEL1_PLAN_FORMAT_INSTRUCTIONS).toContain('greenfield');
    expect(LEVEL1_PLAN_FORMAT_INSTRUCTIONS).toContain('brownfield-enhancement');
    expect(LEVEL1_PLAN_FORMAT_INSTRUCTIONS).toContain('bugfix');
    expect(LEVEL1_PLAN_FORMAT_INSTRUCTIONS).toContain('optimization');
  });

  it('mentions Risk Assessment values', () => {
    expect(LEVEL1_PLAN_FORMAT_INSTRUCTIONS).toContain('LOW');
    expect(LEVEL1_PLAN_FORMAT_INSTRUCTIONS).toContain('MEDIUM');
    expect(LEVEL1_PLAN_FORMAT_INSTRUCTIONS).toContain('HIGH');
  });

  it('mentions Estimated Depth values', () => {
    expect(LEVEL1_PLAN_FORMAT_INSTRUCTIONS).toContain('minimal');
    expect(LEVEL1_PLAN_FORMAT_INSTRUCTIONS).toContain('standard');
    expect(LEVEL1_PLAN_FORMAT_INSTRUCTIONS).toContain('comprehensive');
  });
});

describe('Engine Integration (isPhaseIncluded / loadLevel1Plan boundary)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(process.cwd(), `.test-level1-plan-engine-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('plan that excludes discovery → isPhaseIncluded returns false for discovery', async () => {
    const plan = await buildPlan('greenfield');
    expect(isPhaseIncluded(plan, 'discovery')).toBe(false);
  });

  it('plan that excludes inception → isPhaseIncluded returns false for inception', async () => {
    const plan = await buildPlan('bugfix');
    expect(isPhaseIncluded(plan, 'inception')).toBe(false);
  });

  it('loadLevel1Plan returns null when no artifact exists (backward compat)', () => {
    const result = loadLevel1Plan(tmpDir, 'no-such-workflow');
    expect(result).toBeNull();
  });

  it('backward compat: null plan means no phase skipping (caller should handle null gracefully)', async () => {
    const result = loadLevel1Plan(tmpDir, 'no-such-workflow');
    expect(result).toBeNull();
    const shouldProceed = !result || isPhaseIncluded(result as unknown as Level1Plan, 'discovery');
    expect(shouldProceed).toBe(true);
  });

  it('persisted plan round-trip preserves phase exclusion after write/load', async () => {
    const plan = await buildPlan('bugfix');
    await writeLevel1PlanArtifact(tmpDir, 'wf-integration', plan);

    const loaded = loadLevel1Plan(tmpDir, 'wf-integration');
    expect(loaded).not.toBeNull();
    expect(isPhaseIncluded(loaded!, 'discovery')).toBe(false);
    expect(isPhaseIncluded(loaded!, 'inception')).toBe(false);
    expect(isPhaseIncluded(loaded!, 'construction')).toBe(true);
    expect(isPhaseIncluded(loaded!, 'operations')).toBe(true);
  });
});
