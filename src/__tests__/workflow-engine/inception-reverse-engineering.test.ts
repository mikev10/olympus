import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'path';

vi.mock('../../features/workflow-engine/discovery.js', () => ({
  detectBrownfield: vi.fn(),
  executeDiscoveryPhase: vi.fn(),
}));

vi.mock('../../features/workflow-engine/checkpoint.js', () => ({
  loadCheckpoint: vi.fn(),
  saveCheckpoint: vi.fn(),
  invalidateCache: vi.fn(),
}));

vi.mock('../../features/workflow-engine/inception/orchestrator.js', () => ({
  registerStageHandler: vi.fn(),
}));

import { executeDiscoveryPhase } from '../../features/workflow-engine/discovery.js';
import { registerStageHandler } from '../../features/workflow-engine/inception/orchestrator.js';
import { executeReverseEngineering } from '../../features/workflow-engine/inception/stages/reverse-engineering.js';
import type { WorkflowCheckpointV3, InceptionStageState, InceptionStage } from '../../features/workflow-engine/phase-types.js';

const registerCallsAtImport = vi.mocked(registerStageHandler).mock.calls.slice();

const mockExecuteDiscoveryPhase = vi.mocked(executeDiscoveryPhase);
const mockRegisterStageHandler = vi.mocked(registerStageHandler);

const ALL_STAGES: InceptionStage[] = [
  'workspace-detection',
  'reverse-engineering',
  'requirements-analysis',
  'user-stories',
  'workflow-planning',
  'application-design',
  'units-generation',
];

function makePhaseState(status = 'not_started') {
  return { status, started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null };
}

function makeInceptionStageState(stage: InceptionStage): InceptionStageState {
  return {
    stage,
    status: 'not_started',
    started_at: null,
    completed_at: null,
    skip_reason: null,
    artifacts_generated: [],
    questions_file: null,
    answers_received: false,
  };
}

function createMockCheckpoint(overrides?: Partial<WorkflowCheckpointV3>): WorkflowCheckpointV3 {
  const inception_stages = {} as Record<InceptionStage, InceptionStageState>;
  for (const stage of ALL_STAGES) {
    inception_stages[stage] = makeInceptionStageState(stage);
  }

  return {
    schema_version: '3.0.0',
    workflow_id: 'test-wf',
    feature_name: 'test feature',
    current_phase: 'inception',
    current_stage: 'intent',
    status: 'in_progress',
    phases: {
      discovery: makePhaseState('complete') as any,
      inception: makePhaseState('in_progress') as any,
      construction: makePhaseState() as any,
      operations: makePhaseState() as any,
    },
    manifest_path: 'manifest.json',
    trust_state_path: 'trust-state.json',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    pathway_type: 'brownfield-enhancement',
    inception_stages,
    ...overrides,
  };
}

const MOCK_DISCOVERY_RESULT = {
  completed: false,
  gateRequired: true,
  artifactsGenerated: [
    'analysis-plan.md',
    'current-state-analysis.md',
    'regression-baseline.md',
    'change-impact.md',
    'static-model.md',
    'dynamic-model.md',
    'workspace-scan.json',
  ],
  sourceFileCount: 42,
  brownfieldData: {
    scanResult: {} as any,
    keyFiles: ['src/index.ts', 'src/main.ts'],
    relevantFiles: ['src/auth.ts'],
    staticModelPrompt: 'prompt',
  },
};

describe('executeReverseEngineering', () => {
  const projectPath = '/test/project';
  const workflowId = 'test-wf';

  beforeEach(() => {
    vi.clearAllMocks();
    mockExecuteDiscoveryPhase.mockResolvedValue(MOCK_DISCOVERY_RESULT);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('skips for greenfield pathway', async () => {
    const checkpoint = createMockCheckpoint({ pathway_type: 'greenfield' });

    const result = await executeReverseEngineering(projectPath, workflowId, checkpoint);

    expect(result.status).toBe('skipped');
    expect(result.stage).toBe('reverse-engineering');
    expect(result.artifacts_generated).toHaveLength(0);
    expect(mockExecuteDiscoveryPhase).not.toHaveBeenCalled();
  });

  it('executes discovery phase for brownfield-enhancement', async () => {
    const checkpoint = createMockCheckpoint({ pathway_type: 'brownfield-enhancement' });

    const result = await executeReverseEngineering(projectPath, workflowId, checkpoint);

    expect(mockExecuteDiscoveryPhase).toHaveBeenCalledOnce();
    expect(result.status).toBe('review_required');
  });

  it('executes discovery phase for brownfield-refactor', async () => {
    const checkpoint = createMockCheckpoint({ pathway_type: 'brownfield-refactor' });

    const result = await executeReverseEngineering(projectPath, workflowId, checkpoint);

    expect(mockExecuteDiscoveryPhase).toHaveBeenCalledOnce();
    expect(result.status).toBe('review_required');
  });

  it('passes correct featureName and manifestPath to executeDiscoveryPhase', async () => {
    const checkpoint = createMockCheckpoint({
      pathway_type: 'brownfield-enhancement',
      feature_name: 'my cool feature',
      manifest_path: 'manifest.json',
      workflow_id: 'test-wf',
    });

    await executeReverseEngineering(projectPath, workflowId, checkpoint);

    expect(mockExecuteDiscoveryPhase).toHaveBeenCalledWith({
      projectPath,
      workflowId,
      featureName: 'my cool feature',
      manifestPath: join(projectPath, 'aidlc-docs', workflowId, 'manifest.json'),
    });
  });

  it('returns review_required status for brownfield', async () => {
    const checkpoint = createMockCheckpoint({ pathway_type: 'brownfield-enhancement' });

    const result = await executeReverseEngineering(projectPath, workflowId, checkpoint);

    expect(result.status).toBe('review_required');
    expect(result.requires_approval).toBe(true);
  });

  it('includes artifact list in review_summary', async () => {
    const checkpoint = createMockCheckpoint({ pathway_type: 'brownfield-enhancement' });

    const result = await executeReverseEngineering(projectPath, workflowId, checkpoint);

    expect(result.review_summary).toContain('analysis-plan.md');
    expect(result.review_summary).toContain('workspace-scan.json');
    expect(result.review_summary).toContain('7 artifacts');
  });

  it('includes source file count in review_summary', async () => {
    const checkpoint = createMockCheckpoint({ pathway_type: 'brownfield-enhancement' });

    const result = await executeReverseEngineering(projectPath, workflowId, checkpoint);

    expect(result.review_summary).toContain('42');
  });

  it('includes brownfield key files count when brownfieldData is available', async () => {
    const checkpoint = createMockCheckpoint({ pathway_type: 'brownfield-enhancement' });

    const result = await executeReverseEngineering(projectPath, workflowId, checkpoint);

    expect(result.review_summary).toContain('Key files identified: 2');
  });

  it('omits key files line when brownfieldData is absent', async () => {
    mockExecuteDiscoveryPhase.mockResolvedValueOnce({
      ...MOCK_DISCOVERY_RESULT,
      brownfieldData: undefined,
    });
    const checkpoint = createMockCheckpoint({ pathway_type: 'brownfield-enhancement' });

    const result = await executeReverseEngineering(projectPath, workflowId, checkpoint);

    expect(result.review_summary).not.toContain('Key files identified');
  });

  it('handles executeDiscoveryPhase errors gracefully', async () => {
    mockExecuteDiscoveryPhase.mockRejectedValueOnce(new Error('scan failed'));
    const checkpoint = createMockCheckpoint({ pathway_type: 'brownfield-enhancement' });

    const result = await executeReverseEngineering(projectPath, workflowId, checkpoint);

    expect(result.status).toBe('review_required');
    expect(result.artifacts_generated).toHaveLength(0);
    expect(result.review_summary).toContain('scan failed');
  });

  it('registers handler with orchestrator at module load', () => {
    const reverseEngineeringCall = registerCallsAtImport.find(
      ([stage]) => stage === 'reverse-engineering'
    );
    expect(reverseEngineeringCall).toBeDefined();
    expect(typeof reverseEngineeringCall?.[1]).toBe('function');
  });

  it('defaults missing pathway_type to greenfield and skips', async () => {
    const checkpoint = createMockCheckpoint({ pathway_type: undefined });

    const result = await executeReverseEngineering(projectPath, workflowId, checkpoint);

    expect(result.status).toBe('skipped');
    expect(mockExecuteDiscoveryPhase).not.toHaveBeenCalled();
  });

  it('propagates all artifactsGenerated in result', async () => {
    const checkpoint = createMockCheckpoint({ pathway_type: 'brownfield-enhancement' });

    const result = await executeReverseEngineering(projectPath, workflowId, checkpoint);

    expect(result.artifacts_generated).toEqual(MOCK_DISCOVERY_RESULT.artifactsGenerated);
  });

  it('includes WHAT\'S NEXT block in result', async () => {
    const checkpoint = createMockCheckpoint({ pathway_type: 'brownfield-enhancement' });

    const result = await executeReverseEngineering(projectPath, workflowId, checkpoint);

    expect(result.whats_next).toContain("WHAT'S NEXT");
    expect(result.whats_next).toContain('requirements analysis');
  });
});
