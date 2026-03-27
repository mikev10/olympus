import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  detectPathway,
  generateWorkflowRouting,
  writeWorkflowRoutingArtifact,
  loadWorkflowRouting,
  isPhaseIncluded,
  isStageIncluded,
  WORKFLOW_ROUTING_FORMAT_INSTRUCTIONS,
  buildPathwayAnnouncement,
  applyPathwayOverride,
  recordPathwayOverride,
  getPathwayDisplayName,
  PATHWAY_DISPLAY_NAMES,
} from '../../features/workflow-engine/workflow-routing.js';
import { adjustDepthForPathway } from '../../features/workflow-engine/depth-assessment.js';
import type { DepthAssessment } from '../../features/workflow-engine/phase-types.js';
import type { PathwayType, WorkflowRoutingPlan, WorkflowCheckpointV3, WorkflowPhase } from '../../features/workflow-engine/phase-types.js';

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
): Promise<WorkflowRoutingPlan> {
  return generateWorkflowRouting({
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

describe('generateWorkflowRouting', () => {
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

describe('writeWorkflowRoutingArtifact + loadWorkflowRouting', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(process.cwd(), `.test-workflow-routing-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('round-trip: write then load preserves pathway, risk_assessment, and phase inclusion', async () => {
    const plan = await buildPlan('brownfield-enhancement', { total_score: 15 });
    await writeWorkflowRoutingArtifact(tmpDir, 'wf-roundtrip', plan);

    const loaded = loadWorkflowRouting(tmpDir, 'wf-roundtrip');
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
    await writeWorkflowRoutingArtifact(tmpDir, 'wf-stages', plan);

    const loaded = loadWorkflowRouting(tmpDir, 'wf-stages');
    expect(loaded).not.toBeNull();
    expect(loaded!.stages.length).toBe(plan.stages.length);
  });

  it('written markdown contains required section headers', async () => {
    const plan = await buildPlan('greenfield');
    await writeWorkflowRoutingArtifact(tmpDir, 'wf-md', plan);

    const filePath = path.join(tmpDir, 'aidlc-docs', 'wf-md', 'inception', 'plans', 'workflow-routing.md');
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('# Workflow Routing:');
    expect(content).toContain('## Phase Overview');
    expect(content).toContain('## Stage Details');
  });

  it('write creates file at expected path: aidlc-docs/{workflowId}/inception/plans/workflow-routing.md', async () => {
    const plan = await buildPlan('greenfield');
    await writeWorkflowRoutingArtifact(tmpDir, 'wf-path-check', plan);

    const expectedPath = path.join(tmpDir, 'aidlc-docs', 'wf-path-check', 'inception', 'plans', 'workflow-routing.md');
    expect(fs.existsSync(expectedPath)).toBe(true);
  });

  it('loadWorkflowRouting returns null when file does not exist', () => {
    const result = loadWorkflowRouting(tmpDir, 'nonexistent-workflow');
    expect(result).toBeNull();
  });

  it('load parses header values correctly', async () => {
    const plan = await buildPlan(
      'bugfix',
      { total_score: 8, recommended_depth: 'minimal', skip_units: true },
    );
    await writeWorkflowRoutingArtifact(tmpDir, 'wf-headers', plan);

    const loaded = loadWorkflowRouting(tmpDir, 'wf-headers');
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
    await writeWorkflowRoutingArtifact(tmpDir, 'wf-bolts', plan);

    const loaded = loadWorkflowRouting(tmpDir, 'wf-bolts');
    expect(loaded).not.toBeNull();
    expect(loaded!.estimated_bolts).toBe(2);
  });

  it('approved_at is null when pending', async () => {
    const plan = await buildPlan('greenfield');
    await writeWorkflowRoutingArtifact(tmpDir, 'wf-approved', plan);

    const loaded = loadWorkflowRouting(tmpDir, 'wf-approved');
    expect(loaded).not.toBeNull();
    expect(loaded!.approved_at).toBeNull();
  });

  it('calls registerArtifact with correct id, type, phase, stage, and path', async () => {
    mockRegisterArtifact.mockClear();
    const plan = await buildPlan('greenfield');
    const workflowId = 'wf-register';
    await writeWorkflowRoutingArtifact(tmpDir, workflowId, plan);

    expect(mockRegisterArtifact).toHaveBeenCalledOnce();
    const [calledManifestPath, calledArtifact] = mockRegisterArtifact.mock.calls[0];
    expect(calledManifestPath.replace(/\\/g, '/')).toContain(`aidlc-docs/${workflowId}/manifest.json`);
    expect(calledArtifact.id).toBe(`WORKFLOW-ROUTING-${workflowId}`);
    expect(calledArtifact.type).toBe('WORKFLOW_ROUTING');
    expect(calledArtifact.phase).toBe('inception');
    expect(calledArtifact.stage).toBe('intent');
    expect(calledArtifact.path).toBe(`aidlc-docs/${workflowId}/inception/plans/workflow-routing.md`);
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
    const emptyPlan: WorkflowRoutingPlan = {
      pathway: 'greenfield',
      risk_assessment: 'LOW',
      risk_tier: 1,
      phases: {} as WorkflowRoutingPlan['phases'],
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
    const emptyPlan: WorkflowRoutingPlan = {
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

describe('inception sub-stages', () => {
  it('inception phase contains all 8 sub-stages for greenfield', async () => {
    const plan = await buildPlan('greenfield');
    const inceptionStages = plan.stages.filter((s) => s.phase === 'inception');
    const stageNames = inceptionStages.map((s) => s.stage);
    expect(stageNames).toEqual([
      'workspace-detection',
      'reverse-engineering',
      'requirements-analysis',
      'user-stories',
      'workflow-planning',
      'application-design',
      'units-generation',
      'bolt-planning',
    ]);
  });

  it('workspace-detection is the first inception stage', async () => {
    const plan = await buildPlan('greenfield');
    const inceptionStages = plan.stages.filter((s) => s.phase === 'inception');
    expect(inceptionStages[0].stage).toBe('workspace-detection');
  });

  it('bolt-planning is the last inception stage', async () => {
    const plan = await buildPlan('greenfield');
    const inceptionStages = plan.stages.filter((s) => s.phase === 'inception');
    expect(inceptionStages[inceptionStages.length - 1].stage).toBe('bolt-planning');
  });

  it('getStageRationale: workspace-detection has correct rationale', async () => {
    const plan = await buildPlan('greenfield');
    const stage = plan.stages.find((s) => s.phase === 'inception' && s.stage === 'workspace-detection');
    expect(stage?.rationale).toBe('Auto-detect greenfield/brownfield and determine pathway type');
  });

  it('getStageRationale: reverse-engineering has correct rationale', async () => {
    const plan = await buildPlan('brownfield-enhancement');
    const stage = plan.stages.find((s) => s.phase === 'inception' && s.stage === 'reverse-engineering');
    expect(stage?.rationale).toBe('Reverse-engineer existing codebase architecture (brownfield only)');
  });

  it('getStageRationale: requirements-analysis has correct rationale', async () => {
    const plan = await buildPlan('greenfield');
    const stage = plan.stages.find((s) => s.phase === 'inception' && s.stage === 'requirements-analysis');
    expect(stage?.rationale).toBe('Structured Q&A to capture functional and non-functional requirements');
  });

  it('getStageRationale: user-stories has correct rationale', async () => {
    const plan = await buildPlan('greenfield');
    const stage = plan.stages.find((s) => s.phase === 'inception' && s.stage === 'user-stories');
    expect(stage?.rationale).toBe('Generate user personas and stories with Given/When/Then acceptance criteria');
  });

  it('getStageRationale: workflow-planning has correct rationale', async () => {
    const plan = await buildPlan('greenfield');
    const stage = plan.stages.find((s) => s.phase === 'inception' && s.stage === 'workflow-planning');
    expect(stage?.rationale).toBe('Generate execution plan with Mermaid visualization and live checkboxes');
  });

  it('getStageRationale: application-design has correct rationale', async () => {
    const plan = await buildPlan('greenfield');
    const stage = plan.stages.find((s) => s.phase === 'inception' && s.stage === 'application-design');
    expect(stage?.rationale).toBe('High-level component identification, service boundaries, and dependencies');
  });

  it('getStageRationale: units-generation has correct rationale', async () => {
    const plan = await buildPlan('greenfield');
    const stage = plan.stages.find((s) => s.phase === 'inception' && s.stage === 'units-generation');
    expect(stage?.rationale).toBe('Define units of work with inter-unit dependencies and story mapping');
  });

  it('reverse-engineering is excluded for greenfield', async () => {
    const plan = await buildPlan('greenfield');
    const stage = plan.stages.find((s) => s.phase === 'inception' && s.stage === 'reverse-engineering');
    expect(stage).toBeDefined();
    expect(stage!.included).toBe(false);
  });

  it('reverse-engineering is included for brownfield-enhancement', async () => {
    const plan = await buildPlan('brownfield-enhancement');
    const stage = plan.stages.find((s) => s.phase === 'inception' && s.stage === 'reverse-engineering');
    expect(stage).toBeDefined();
    expect(stage!.included).toBe(true);
  });

  it('bugfix skips inception phase entirely so no inception stages are generated', async () => {
    const plan = await buildPlan('bugfix');
    const inceptionStages = plan.stages.filter((s) => s.phase === 'inception');
    expect(inceptionStages).toHaveLength(0);
  });

  it('user-stories is excluded for optimization', async () => {
    const plan = await buildPlan('optimization');
    const stage = plan.stages.find((s) => s.phase === 'inception' && s.stage === 'user-stories');
    expect(stage).toBeDefined();
    expect(stage!.included).toBe(false);
  });

  it('application-design is excluded for optimization', async () => {
    const plan = await buildPlan('optimization');
    const stage = plan.stages.find((s) => s.phase === 'inception' && s.stage === 'application-design');
    expect(stage).toBeDefined();
    expect(stage!.included).toBe(false);
  });

  it('units-generation is excluded for minimal depth', async () => {
    const plan = await buildPlan('greenfield', { recommended_depth: 'minimal', total_score: 8, skip_units: true });
    const stage = plan.stages.find((s) => s.phase === 'inception' && s.stage === 'units-generation');
    expect(stage).toBeDefined();
    expect(stage!.included).toBe(false);
  });

  it('all inception stages included for standard brownfield-enhancement', async () => {
    const plan = await buildPlan('brownfield-enhancement', { recommended_depth: 'standard' });
    const inceptionStages = plan.stages.filter((s) => s.phase === 'inception');
    expect(inceptionStages).toHaveLength(8);
    for (const stage of inceptionStages) {
      expect(stage.included).toBe(true);
    }
  });

  it('backward compat: legacy rationale keys still resolve (inception:intent)', async () => {
    const plan = await buildPlan('brownfield-enhancement');
    expect(isStageIncluded(plan, 'inception', 'intent')).toBe(true);
  });

  it('backward compat: legacy rationale keys still resolve (inception:depth-assessment)', async () => {
    const plan = await buildPlan('brownfield-enhancement');
    expect(isStageIncluded(plan, 'inception', 'depth-assessment')).toBe(true);
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

describe('WORKFLOW_ROUTING_FORMAT_INSTRUCTIONS', () => {
  it('is a non-empty string', () => {
    expect(typeof WORKFLOW_ROUTING_FORMAT_INSTRUCTIONS).toBe('string');
    expect(WORKFLOW_ROUTING_FORMAT_INSTRUCTIONS.length).toBeGreaterThan(0);
  });

  it('contains "Phase Overview"', () => {
    expect(WORKFLOW_ROUTING_FORMAT_INSTRUCTIONS).toContain('Phase Overview');
  });

  it('contains "Stage Details"', () => {
    expect(WORKFLOW_ROUTING_FORMAT_INSTRUCTIONS).toContain('Stage Details');
  });

  it('contains valid pathway values', () => {
    expect(WORKFLOW_ROUTING_FORMAT_INSTRUCTIONS).toContain('greenfield');
    expect(WORKFLOW_ROUTING_FORMAT_INSTRUCTIONS).toContain('brownfield-enhancement');
    expect(WORKFLOW_ROUTING_FORMAT_INSTRUCTIONS).toContain('bugfix');
    expect(WORKFLOW_ROUTING_FORMAT_INSTRUCTIONS).toContain('optimization');
  });

  it('mentions Risk Assessment values', () => {
    expect(WORKFLOW_ROUTING_FORMAT_INSTRUCTIONS).toContain('LOW');
    expect(WORKFLOW_ROUTING_FORMAT_INSTRUCTIONS).toContain('MEDIUM');
    expect(WORKFLOW_ROUTING_FORMAT_INSTRUCTIONS).toContain('HIGH');
  });

  it('mentions Estimated Depth values', () => {
    expect(WORKFLOW_ROUTING_FORMAT_INSTRUCTIONS).toContain('minimal');
    expect(WORKFLOW_ROUTING_FORMAT_INSTRUCTIONS).toContain('standard');
    expect(WORKFLOW_ROUTING_FORMAT_INSTRUCTIONS).toContain('comprehensive');
  });
});

describe('Engine Integration (isPhaseIncluded / loadWorkflowRouting boundary)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(process.cwd(), `.test-workflow-routing-engine-${Date.now()}`);
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

  it('loadWorkflowRouting returns null when no artifact exists (backward compat)', () => {
    const result = loadWorkflowRouting(tmpDir, 'no-such-workflow');
    expect(result).toBeNull();
  });

  it('backward compat: null plan means no phase skipping (caller should handle null gracefully)', async () => {
    const result = loadWorkflowRouting(tmpDir, 'no-such-workflow');
    expect(result).toBeNull();
    const shouldProceed = !result || isPhaseIncluded(result as unknown as WorkflowRoutingPlan, 'discovery');
    expect(shouldProceed).toBe(true);
  });

  it('persisted plan round-trip preserves phase exclusion after write/load', async () => {
    const plan = await buildPlan('bugfix');
    await writeWorkflowRoutingArtifact(tmpDir, 'wf-integration', plan);

    const loaded = loadWorkflowRouting(tmpDir, 'wf-integration');
    expect(loaded).not.toBeNull();
    expect(isPhaseIncluded(loaded!, 'discovery')).toBe(false);
    expect(isPhaseIncluded(loaded!, 'inception')).toBe(false);
    expect(isPhaseIncluded(loaded!, 'construction')).toBe(true);
    expect(isPhaseIncluded(loaded!, 'operations')).toBe(true);
  });
});

describe('getPathwayDisplayName', () => {
  it('returns "Greenfield" for greenfield', () => {
    expect(getPathwayDisplayName('greenfield')).toBe('Greenfield');
  });

  it('returns "Enhancement" for brownfield-enhancement', () => {
    expect(getPathwayDisplayName('brownfield-enhancement')).toBe('Enhancement');
  });

  it('returns "Refactor" for brownfield-refactor', () => {
    expect(getPathwayDisplayName('brownfield-refactor')).toBe('Refactor');
  });

  it('returns "Bug Fix" for bugfix', () => {
    expect(getPathwayDisplayName('bugfix')).toBe('Bug Fix');
  });

  it('returns "Optimization" for optimization', () => {
    expect(getPathwayDisplayName('optimization')).toBe('Optimization');
  });

  it('all 5 pathway types have display names in PATHWAY_DISPLAY_NAMES', () => {
    const pathways: PathwayType[] = ['greenfield', 'brownfield-enhancement', 'brownfield-refactor', 'bugfix', 'optimization'];
    for (const pathway of pathways) {
      expect(PATHWAY_DISPLAY_NAMES[pathway]).toBeDefined();
      expect(PATHWAY_DISPLAY_NAMES[pathway].length).toBeGreaterThan(0);
    }
  });
});

describe('buildPathwayAnnouncement', () => {
  it('returns correct structure for bugfix pathway', () => {
    const announcement = buildPathwayAnnouncement('bugfix', 8, 42);
    expect(announcement.detectedPathway).toBe('bugfix');
    expect(announcement.displayName).toBe('Bug Fix');
    expect(announcement.depthScore).toBe(8);
    expect(announcement.sourceFileCount).toBe(42);
    expect(typeof announcement.rationale).toBe('string');
    expect(announcement.rationale.length).toBeGreaterThan(0);
  });

  it('includes displayName field for all 5 pathway types', () => {
    const pathways: PathwayType[] = ['greenfield', 'brownfield-enhancement', 'brownfield-refactor', 'bugfix', 'optimization'];
    const expectedDisplayNames: Record<PathwayType, string> = {
      greenfield: 'Greenfield',
      'brownfield-enhancement': 'Enhancement',
      'brownfield-refactor': 'Refactor',
      bugfix: 'Bug Fix',
      optimization: 'Optimization',
    };
    for (const pathway of pathways) {
      const ann = buildPathwayAnnouncement(pathway, 10, 10);
      expect(ann.displayName).toBe(expectedDisplayNames[pathway]);
    }
  });

  it('rationale for bugfix mentions expected keywords', () => {
    const announcement = buildPathwayAnnouncement('bugfix', 8, 0);
    expect(announcement.rationale).toContain('bugfix');
  });

  it('rationale for greenfield mentions greenfield', () => {
    const announcement = buildPathwayAnnouncement('greenfield', 5, 0);
    expect(announcement.rationale).toContain('greenfield');
  });

  it('rationale for optimization mentions optimization', () => {
    const announcement = buildPathwayAnnouncement('optimization', 15, 30);
    expect(announcement.rationale).toContain('optimization');
  });

  it('rationale for brownfield-refactor mentions brownfield-refactor', () => {
    const announcement = buildPathwayAnnouncement('brownfield-refactor', 20, 100);
    expect(announcement.rationale).toContain('brownfield-refactor');
  });

  it('rationale for brownfield-enhancement mentions brownfield-enhancement or default', () => {
    const announcement = buildPathwayAnnouncement('brownfield-enhancement', 15, 50);
    expect(announcement.rationale.length).toBeGreaterThan(0);
  });

  it('all 5 pathway types produce non-empty rationale', () => {
    const pathways: PathwayType[] = ['greenfield', 'bugfix', 'optimization', 'brownfield-refactor', 'brownfield-enhancement'];
    for (const pathway of pathways) {
      const ann = buildPathwayAnnouncement(pathway, 10, 10);
      expect(ann.rationale.length).toBeGreaterThan(0);
    }
  });

  it('depthScore and sourceFileCount are preserved exactly', () => {
    const announcement = buildPathwayAnnouncement('brownfield-enhancement', 17, 99);
    expect(announcement.depthScore).toBe(17);
    expect(announcement.sourceFileCount).toBe(99);
  });
});

describe('applyPathwayOverride', () => {
  function baseAnnouncement(): ReturnType<typeof buildPathwayAnnouncement> {
    return buildPathwayAnnouncement('brownfield-enhancement', 15, 50);
  }

  it('empty override returns same pathway and depthScore', () => {
    const original = baseAnnouncement();
    const result = applyPathwayOverride(original, {});
    expect(result.detectedPathway).toBe('brownfield-enhancement');
    expect(result.displayName).toBe('Enhancement');
    expect(result.depthScore).toBe(15);
    expect(result.sourceFileCount).toBe(50);
  });

  it('empty override does NOT append override marker to rationale', () => {
    const original = baseAnnouncement();
    const result = applyPathwayOverride(original, {});
    expect(result.rationale).not.toContain('overridden by user');
  });

  it('pathway-only override changes detectedPathway', () => {
    const original = baseAnnouncement();
    const result = applyPathwayOverride(original, { pathwayType: 'bugfix' });
    expect(result.detectedPathway).toBe('bugfix');
    expect(result.displayName).toBe('Bug Fix');
    expect(result.depthScore).toBe(15);
  });

  it('pathway-only override appends override marker to rationale', () => {
    const original = baseAnnouncement();
    const result = applyPathwayOverride(original, { pathwayType: 'bugfix' });
    expect(result.rationale).toContain('overridden by user');
    expect(result.rationale).toContain('bugfix');
  });

  it('depth-only override changes depthScore', () => {
    const original = baseAnnouncement();
    const result = applyPathwayOverride(original, { depthScore: 25 });
    expect(result.detectedPathway).toBe('brownfield-enhancement');
    expect(result.depthScore).toBe(25);
  });

  it('depth-only override appends override marker to rationale', () => {
    const original = baseAnnouncement();
    const result = applyPathwayOverride(original, { depthScore: 25 });
    expect(result.rationale).toContain('overridden by user');
    expect(result.rationale).toContain('25');
  });

  it('both pathway and depth overridden', () => {
    const original = baseAnnouncement();
    const result = applyPathwayOverride(original, { pathwayType: 'greenfield', depthScore: 5 });
    expect(result.detectedPathway).toBe('greenfield');
    expect(result.displayName).toBe('Greenfield');
    expect(result.depthScore).toBe(5);
    expect(result.rationale).toContain('overridden by user');
  });

  it('sourceFileCount is always preserved from original', () => {
    const original = baseAnnouncement();
    const result = applyPathwayOverride(original, { pathwayType: 'bugfix', depthScore: 7 });
    expect(result.sourceFileCount).toBe(50);
  });

  it('does not mutate the original announcement', () => {
    const original = baseAnnouncement();
    const originalPathway = original.detectedPathway;
    const originalDepth = original.depthScore;
    applyPathwayOverride(original, { pathwayType: 'bugfix', depthScore: 5 });
    expect(original.detectedPathway).toBe(originalPathway);
    expect(original.depthScore).toBe(originalDepth);
  });
});

function makeMinimalCheckpoint(overrides: Partial<WorkflowCheckpointV3> = {}): WorkflowCheckpointV3 {
  return {
    schema_version: '3.0.0',
    workflow_id: 'wf-test',
    feature_name: 'Test Feature',
    current_phase: 'inception' as WorkflowPhase,
    current_stage: 'intent',
    status: 'in_progress',
    phases: {
      discovery: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
      inception: { status: 'in_progress', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
      construction: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
      operations: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
    },
    manifest_path: '',
    trust_state_path: '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    pathway_type: 'brownfield-enhancement',
    depth_score: 15,
    ...overrides,
  };
}

describe('recordPathwayOverride', () => {
  it('sets original_pathway_type from detected announcement', () => {
    const checkpoint = makeMinimalCheckpoint();
    const detected = buildPathwayAnnouncement('brownfield-enhancement', 15, 50);
    const result = recordPathwayOverride(checkpoint, detected, { pathwayType: 'bugfix' });
    expect(result.original_pathway_type).toBe('brownfield-enhancement');
  });

  it('sets original_depth_score from detected announcement', () => {
    const checkpoint = makeMinimalCheckpoint();
    const detected = buildPathwayAnnouncement('brownfield-enhancement', 15, 50);
    const result = recordPathwayOverride(checkpoint, detected, { pathwayType: 'bugfix' });
    expect(result.original_depth_score).toBe(15);
  });

  it('sets pathway_override to user-specified pathway', () => {
    const checkpoint = makeMinimalCheckpoint();
    const detected = buildPathwayAnnouncement('brownfield-enhancement', 15, 50);
    const result = recordPathwayOverride(checkpoint, detected, { pathwayType: 'bugfix' });
    expect(result.pathway_override).toBe('bugfix');
  });

  it('sets depth_override to user-specified depth', () => {
    const checkpoint = makeMinimalCheckpoint();
    const detected = buildPathwayAnnouncement('brownfield-enhancement', 15, 50);
    const result = recordPathwayOverride(checkpoint, detected, { depthScore: 25 });
    expect(result.depth_override).toBe(25);
  });

  it('updates pathway_type to effective (overridden) value', () => {
    const checkpoint = makeMinimalCheckpoint();
    const detected = buildPathwayAnnouncement('brownfield-enhancement', 15, 50);
    const result = recordPathwayOverride(checkpoint, detected, { pathwayType: 'optimization' });
    expect(result.pathway_type).toBe('optimization');
  });

  it('updates depth_score to effective (overridden) value', () => {
    const checkpoint = makeMinimalCheckpoint();
    const detected = buildPathwayAnnouncement('brownfield-enhancement', 15, 50);
    const result = recordPathwayOverride(checkpoint, detected, { depthScore: 22 });
    expect(result.depth_score).toBe(22);
  });

  it('no pathway override keeps original pathway as effective pathway_type', () => {
    const checkpoint = makeMinimalCheckpoint();
    const detected = buildPathwayAnnouncement('brownfield-refactor', 18, 80);
    const result = recordPathwayOverride(checkpoint, detected, { depthScore: 20 });
    expect(result.pathway_type).toBe('brownfield-refactor');
  });

  it('no depth override keeps original depthScore as effective depth_score', () => {
    const checkpoint = makeMinimalCheckpoint();
    const detected = buildPathwayAnnouncement('brownfield-refactor', 18, 80);
    const result = recordPathwayOverride(checkpoint, detected, { pathwayType: 'optimization' });
    expect(result.depth_score).toBe(18);
  });

  it('returns a partial object (only the fields to merge)', () => {
    const checkpoint = makeMinimalCheckpoint();
    const detected = buildPathwayAnnouncement('brownfield-enhancement', 15, 50);
    const result = recordPathwayOverride(checkpoint, detected, { pathwayType: 'bugfix', depthScore: 5 });
    expect(result).toHaveProperty('original_pathway_type');
    expect(result).toHaveProperty('original_depth_score');
    expect(result).toHaveProperty('pathway_override');
    expect(result).toHaveProperty('depth_override');
    expect(result).toHaveProperty('pathway_type');
    expect(result).toHaveProperty('depth_score');
  });
});

describe('WorkflowCheckpointV3 override fields', () => {
  it('checkpoint accepts original_pathway_type field', () => {
    const checkpoint = makeMinimalCheckpoint({ original_pathway_type: 'brownfield-enhancement' });
    expect(checkpoint.original_pathway_type).toBe('brownfield-enhancement');
  });

  it('checkpoint accepts original_depth_score field', () => {
    const checkpoint = makeMinimalCheckpoint({ original_depth_score: 15 });
    expect(checkpoint.original_depth_score).toBe(15);
  });

  it('checkpoint accepts pathway_override field', () => {
    const checkpoint = makeMinimalCheckpoint({ pathway_override: 'bugfix' });
    expect(checkpoint.pathway_override).toBe('bugfix');
  });

  it('checkpoint accepts depth_override field', () => {
    const checkpoint = makeMinimalCheckpoint({ depth_override: 8 });
    expect(checkpoint.depth_override).toBe(8);
  });

  it('all override fields are optional — checkpoint without them is valid', () => {
    const checkpoint = makeMinimalCheckpoint();
    expect(checkpoint.original_pathway_type).toBeUndefined();
    expect(checkpoint.original_depth_score).toBeUndefined();
    expect(checkpoint.pathway_override).toBeUndefined();
    expect(checkpoint.depth_override).toBeUndefined();
  });
});
