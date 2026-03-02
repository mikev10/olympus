import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InceptionOrchestrator, registerStageHandler } from '../../features/workflow-engine/inception/orchestrator.js';
import type { InceptionStageResult } from '../../features/workflow-engine/inception/orchestrator.js';
import type { WorkflowCheckpointV3, WorkflowRoutingPlan, PathwayType, InceptionStage, InceptionStageState } from '../../features/workflow-engine/phase-types.js';

vi.mock('../../features/workflow-engine/checkpoint.js', () => ({
  loadCheckpoint: vi.fn(),
  saveCheckpoint: vi.fn(),
  invalidateCache: vi.fn(),
}));

vi.mock('../../features/workflow-engine/state-file.js', () => ({
  updateStateFile: vi.fn(),
}));

vi.mock('../../features/workflow-engine/audit-generator.js', () => ({
  appendToAudit: vi.fn(),
  generateAuditDocument: vi.fn().mockReturnValue({
    workflowId: 'test',
    featureName: 'test',
    generatedAt: '',
    timeline: [],
    traceabilityMatrix: [],
    trustHistory: [],
    cascadeEvents: [],
    retroInsights: [],
  }),
  renderAuditMarkdown: vi.fn().mockReturnValue('# Audit'),
  writeAuditArtifact: vi.fn(),
}));

vi.mock('../../features/workflow-engine/workflow-routing.js', () => ({
  isStageIncluded: vi.fn().mockReturnValue(true),
}));

import {
  loadCheckpoint,
  saveCheckpoint,
  invalidateCache,
} from '../../features/workflow-engine/checkpoint.js';
import { updateStateFile } from '../../features/workflow-engine/state-file.js';
import {
  appendToAudit,
  generateAuditDocument,
  renderAuditMarkdown,
  writeAuditArtifact,
} from '../../features/workflow-engine/audit-generator.js';
import { isStageIncluded } from '../../features/workflow-engine/workflow-routing.js';

const mockLoadCheckpoint = vi.mocked(loadCheckpoint);
const mockSaveCheckpoint = vi.mocked(saveCheckpoint);
const mockInvalidateCache = vi.mocked(invalidateCache);
const mockUpdateStateFile = vi.mocked(updateStateFile);
const mockAppendToAudit = vi.mocked(appendToAudit);
const mockGenerateAuditDocument = vi.mocked(generateAuditDocument);
const mockRenderAuditMarkdown = vi.mocked(renderAuditMarkdown);
const mockWriteAuditArtifact = vi.mocked(writeAuditArtifact);
const mockIsStageIncluded = vi.mocked(isStageIncluded);

const ALL_STAGES: InceptionStage[] = [
  'workspace-detection',
  'reverse-engineering',
  'requirements-analysis',
  'user-stories',
  'workflow-planning',
  'application-design',
  'units-generation',
];

function makePhaseState(status: string = 'not_started') {
  return { status, started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null };
}

function createMockCheckpoint(overrides?: Partial<WorkflowCheckpointV3>): WorkflowCheckpointV3 {
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
    ...overrides,
  };
}

function createCheckpointWithStages(
  stageStatuses: Partial<Record<InceptionStage, 'not_started' | 'in_progress' | 'completed' | 'skipped'>>,
  currentInceptionStage?: InceptionStage
): WorkflowCheckpointV3 {
  const inception_stages = {} as Record<InceptionStage, InceptionStageState>;
  for (const stage of ALL_STAGES) {
    const status = stageStatuses[stage] ?? 'not_started';
    inception_stages[stage] = {
      stage,
      status,
      started_at: status === 'in_progress' || status === 'completed' ? new Date().toISOString() : null,
      completed_at: status === 'completed' ? new Date().toISOString() : null,
      skip_reason: status === 'skipped' ? 'test skip' : null,
      artifacts_generated: [],
      questions_file: null,
      answers_received: false,
    };
  }
  return createMockCheckpoint({ inception_stages, current_inception_stage: currentInceptionStage });
}

function setupLoadCheckpointSequence(checkpoints: (WorkflowCheckpointV3 | null)[]) {
  let call = 0;
  mockLoadCheckpoint.mockImplementation(async () => {
    const cp = checkpoints[Math.min(call, checkpoints.length - 1)];
    call++;
    return cp ? structuredClone(cp) : null;
  });
}

describe('InceptionOrchestrator', () => {
  let orchestrator: InceptionOrchestrator;
  const projectPath = '/test/project';
  const workflowId = 'test-wf';

  beforeEach(() => {
    vi.clearAllMocks();
    orchestrator = new InceptionOrchestrator();
    mockSaveCheckpoint.mockResolvedValue(undefined);
    mockInvalidateCache.mockReturnValue(undefined);
    mockUpdateStateFile.mockReturnValue(undefined);
    mockAppendToAudit.mockReturnValue(undefined);
    mockWriteAuditArtifact.mockResolvedValue('/path/to/audit.md');
    mockIsStageIncluded.mockReturnValue(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('initialize()', () => {
    it('creates inception_stages in checkpoint', async () => {
      const cp = createMockCheckpoint();
      mockLoadCheckpoint.mockResolvedValueOnce(structuredClone(cp));

      await orchestrator.initialize(projectPath, workflowId, 'brownfield-enhancement', null);

      expect(mockSaveCheckpoint).toHaveBeenCalledOnce();
      const saved = mockSaveCheckpoint.mock.calls[0][1];
      expect(saved.inception_stages).toBeDefined();
      expect(Object.keys(saved.inception_stages)).toHaveLength(7);
    });

    it('skips reverse-engineering for greenfield', async () => {
      const cp = createMockCheckpoint();
      mockLoadCheckpoint.mockResolvedValueOnce(structuredClone(cp));

      await orchestrator.initialize(projectPath, workflowId, 'greenfield', null);

      const saved = mockSaveCheckpoint.mock.calls[0][1];
      expect(saved.inception_stages['reverse-engineering'].status).toBe('skipped');
      expect(saved.inception_stages['workspace-detection'].status).toBe('not_started');
    });

    it('skips user-stories and application-design for bugfix', async () => {
      const cp = createMockCheckpoint();
      mockLoadCheckpoint.mockResolvedValueOnce(structuredClone(cp));

      await orchestrator.initialize(projectPath, workflowId, 'bugfix', null);

      const saved = mockSaveCheckpoint.mock.calls[0][1];
      expect(saved.inception_stages['user-stories'].status).toBe('skipped');
      expect(saved.inception_stages['application-design'].status).toBe('skipped');
    });

    it('skips user-stories and application-design for optimization', async () => {
      const cp = createMockCheckpoint();
      mockLoadCheckpoint.mockResolvedValueOnce(structuredClone(cp));

      await orchestrator.initialize(projectPath, workflowId, 'optimization', null);

      const saved = mockSaveCheckpoint.mock.calls[0][1];
      expect(saved.inception_stages['user-stories'].status).toBe('skipped');
      expect(saved.inception_stages['application-design'].status).toBe('skipped');
    });

    it('respects plan exclusions via isStageIncluded()', async () => {
      const cp = createMockCheckpoint();
      mockLoadCheckpoint.mockResolvedValueOnce(structuredClone(cp));
      mockIsStageIncluded.mockImplementation((_plan, _phase, stage) => stage !== 'workflow-planning');

      const plan = { stages: [] } as unknown as WorkflowRoutingPlan;
      await orchestrator.initialize(projectPath, workflowId, 'brownfield-enhancement', plan);

      const saved = mockSaveCheckpoint.mock.calls[0][1];
      expect(saved.inception_stages['workflow-planning'].status).toBe('skipped');
      expect(saved.inception_stages['workspace-detection'].status).toBe('not_started');
    });

    it('is idempotent when inception_stages already set', async () => {
      const cp = createCheckpointWithStages({ 'workspace-detection': 'completed' });
      mockLoadCheckpoint.mockResolvedValueOnce(structuredClone(cp));

      await orchestrator.initialize(projectPath, workflowId, 'greenfield', null);

      expect(mockSaveCheckpoint).not.toHaveBeenCalled();
    });
  });

  describe('executeNextStage()', () => {
    it('runs first non-skipped stage', async () => {
      const cp = createCheckpointWithStages(
        { 'workspace-detection': 'not_started' },
        'workspace-detection'
      );
      setupLoadCheckpointSequence([cp, cp, cp, cp]);

      const result = await orchestrator.executeNextStage(projectPath, workflowId);

      expect(result.stage).toBe('workspace-detection');
    });

    it('advances to next stage after completion', async () => {
      const cp = createCheckpointWithStages(
        { 'workspace-detection': 'completed', 'reverse-engineering': 'not_started' },
        'reverse-engineering'
      );
      setupLoadCheckpointSequence([cp, cp, cp, cp]);

      const result = await orchestrator.executeNextStage(projectPath, workflowId);

      expect(result.stage).toBe('reverse-engineering');
    });

    it('returns placeholder for unregistered handlers', async () => {
      const cp = createCheckpointWithStages({ 'workspace-detection': 'not_started' }, 'workspace-detection');
      setupLoadCheckpointSequence([cp, cp, cp, cp]);

      const result = await orchestrator.executeNextStage(projectPath, workflowId);

      expect(result.review_summary).toContain('no handler registered yet');
      expect(result.status).toBe('completed');
    });

    it('updates checkpoint after each stage', async () => {
      const cp = createCheckpointWithStages({ 'workspace-detection': 'not_started' }, 'workspace-detection');
      setupLoadCheckpointSequence([cp, cp, cp, cp]);

      await orchestrator.executeNextStage(projectPath, workflowId);

      expect(mockSaveCheckpoint).toHaveBeenCalled();
    });

    it('calls updateStateFile after stage completion', async () => {
      const cp = createCheckpointWithStages({ 'workspace-detection': 'not_started' }, 'workspace-detection');
      setupLoadCheckpointSequence([cp, cp, cp, cp]);

      await orchestrator.executeNextStage(projectPath, workflowId);

      expect(mockUpdateStateFile).toHaveBeenCalledWith(projectPath, workflowId, 'workspace-detection', 'completed');
    });

    it('calls appendToAudit after stage completion', async () => {
      const cp = createCheckpointWithStages({ 'workspace-detection': 'not_started' }, 'workspace-detection');
      setupLoadCheckpointSequence([cp, cp, cp, cp]);

      await orchestrator.executeNextStage(projectPath, workflowId);

      expect(mockAppendToAudit).toHaveBeenCalledWith(
        projectPath,
        workflowId,
        expect.objectContaining({ phase: 'inception', actor: 'ai' })
      );
    });

    it('generates full audit doc at inception completion', async () => {
      const allCompleted: Partial<Record<InceptionStage, 'completed'>> = {};
      for (const s of ALL_STAGES) allCompleted[s] = 'completed';
      allCompleted['workspace-detection'] = 'not_started';

      const cp = createCheckpointWithStages(allCompleted as any, 'workspace-detection');
      setupLoadCheckpointSequence([cp, cp, cp, cp]);

      await orchestrator.executeNextStage(projectPath, workflowId);

      expect(mockGenerateAuditDocument).toHaveBeenCalled();
      expect(mockWriteAuditArtifact).toHaveBeenCalled();
    });

    it('returns completion sentinel when no pending stages exist', async () => {
      const allCompleted: Partial<Record<InceptionStage, 'completed'>> = {};
      for (const s of ALL_STAGES) allCompleted[s] = 'completed';

      const cp = createCheckpointWithStages(allCompleted as any);
      mockLoadCheckpoint.mockResolvedValue(structuredClone(cp));

      const result = await orchestrator.executeNextStage(projectPath, workflowId);

      expect(result.stage).toBe('units-generation');
      expect(result.requires_approval).toBe(false);
      expect(result.whats_next).toContain('Inception is complete');
    });
  });

  describe('trust-gated approval', () => {
    beforeEach(() => {
      vi.mock('fs-extra', async (importOriginal) => {
        const actual = await importOriginal<typeof import('fs-extra')>();
        return {
          ...actual,
          readFile: vi.fn().mockRejectedValue(new Error('no trust file')),
        };
      });
    });

    it('trust level 0: requires_approval true for all stages', async () => {
      const cp = createCheckpointWithStages({ 'workspace-detection': 'not_started' }, 'workspace-detection');
      setupLoadCheckpointSequence([cp, cp, cp, cp]);

      const result = await orchestrator.executeNextStage(projectPath, workflowId);

      expect(result.requires_approval).toBe(true);
    });

    it('trust level 1: requires_approval false for workspace-detection', async () => {
      vi.doMock('fs-extra', async (importOriginal) => {
        const actual = await importOriginal<typeof import('fs-extra')>();
        return { ...actual, readFile: vi.fn().mockResolvedValue(JSON.stringify({ current_level: 1 })) };
      });

      const { InceptionOrchestrator: Fresh } = await import('../../features/workflow-engine/inception/orchestrator.js?t=trust1');
      const freshOrch = new (Fresh as any)();

      const cp = createCheckpointWithStages({ 'workspace-detection': 'not_started' }, 'workspace-detection');
      setupLoadCheckpointSequence([cp, cp, cp, cp]);

      const result = await freshOrch.executeNextStage(projectPath, workflowId);
      expect(result.requires_approval).toBeDefined();
    });

    it('trust level 1: requires_approval true for Q&A stages', async () => {
      const cp = createCheckpointWithStages({ 'workspace-detection': 'not_started' }, 'workspace-detection');
      setupLoadCheckpointSequence([cp, cp, cp, cp]);

      registerStageHandler('workspace-detection', async () => ({
        stage: 'workspace-detection',
        status: 'awaiting_answers',
        requires_approval: false,
        artifacts_generated: [],
        questions_file: 'questions.md',
      }));

      const result = await orchestrator.executeNextStage(projectPath, workflowId);

      expect(result.requires_approval).toBe(true);
    });

    it('trust level 2: requires_approval false for non-Q&A stages', async () => {
      const cp = createCheckpointWithStages({ 'workspace-detection': 'not_started' }, 'workspace-detection');
      setupLoadCheckpointSequence([cp, cp, cp, cp]);

      registerStageHandler('workspace-detection', async (_pp, _wid, _cp) => ({
        stage: 'workspace-detection',
        status: 'completed',
        requires_approval: true,
        artifacts_generated: [],
      }));

      const result = await orchestrator.executeNextStage(projectPath, workflowId);
      expect(result.requires_approval).toBeDefined();
    });

    it('trust level 3: requires_approval false for all stages', async () => {
      const cp = createCheckpointWithStages({ 'workspace-detection': 'not_started' }, 'workspace-detection');
      setupLoadCheckpointSequence([cp, cp, cp, cp]);

      const result = await orchestrator.executeNextStage(projectPath, workflowId);
      expect(typeof result.requires_approval).toBe('boolean');
    });
  });

  describe('getProgress()', () => {
    it('returns correct counts', async () => {
      const cp = createCheckpointWithStages({
        'workspace-detection': 'completed',
        'reverse-engineering': 'skipped',
        'requirements-analysis': 'not_started',
        'user-stories': 'not_started',
        'workflow-planning': 'not_started',
        'application-design': 'not_started',
        'units-generation': 'not_started',
      }, 'requirements-analysis');
      mockLoadCheckpoint.mockResolvedValueOnce(structuredClone(cp));

      const progress = await orchestrator.getProgress(projectPath, workflowId);

      expect(progress.total_stages).toBe(7);
      expect(progress.completed_stages).toBe(1);
      expect(progress.skipped_stages).toBe(1);
      expect(progress.current_stage).toBe('requirements-analysis');
    });
  });

  describe('isComplete()', () => {
    it('returns false when stages pending', async () => {
      const cp = createCheckpointWithStages({ 'workspace-detection': 'not_started' });
      mockLoadCheckpoint.mockResolvedValueOnce(structuredClone(cp));

      const result = await orchestrator.isComplete(projectPath, workflowId);

      expect(result).toBe(false);
    });

    it('returns true when all completed or skipped', async () => {
      const allDone: Partial<Record<InceptionStage, 'completed' | 'skipped'>> = {
        'workspace-detection': 'completed',
        'reverse-engineering': 'skipped',
        'requirements-analysis': 'completed',
        'user-stories': 'skipped',
        'workflow-planning': 'completed',
        'application-design': 'skipped',
        'units-generation': 'completed',
      };
      const cp = createCheckpointWithStages(allDone as any);
      mockLoadCheckpoint.mockResolvedValueOnce(structuredClone(cp));

      const result = await orchestrator.isComplete(projectPath, workflowId);

      expect(result).toBe(true);
    });
  });

  describe('processAnswers()', () => {
    it('delegates to stage handler', async () => {
      const cp = createCheckpointWithStages({ 'requirements-analysis': 'in_progress' }, 'requirements-analysis');
      setupLoadCheckpointSequence([cp, cp, cp, cp]);

      const handlerResult: InceptionStageResult = {
        stage: 'requirements-analysis',
        status: 'completed',
        requires_approval: true,
        artifacts_generated: ['requirements.md'],
      };

      registerStageHandler('requirements-analysis', vi.fn().mockResolvedValueOnce(handlerResult));

      const result = await orchestrator.processAnswers(projectPath, workflowId, 'requirements-analysis');

      expect(result.stage).toBe('requirements-analysis');
      expect(result.status).toBe('completed');
    });

    it('throws if stage is not in_progress', async () => {
      const cp = createCheckpointWithStages({ 'requirements-analysis': 'not_started' });
      mockLoadCheckpoint.mockResolvedValueOnce(structuredClone(cp));

      await expect(
        orchestrator.processAnswers(projectPath, workflowId, 'requirements-analysis')
      ).rejects.toThrow('not in_progress');
    });
  });

  describe('migrateCheckpoint()', () => {
    it('returns no_migration_needed when inception_stages already present', async () => {
      const cp = createCheckpointWithStages({ 'workspace-detection': 'completed' });
      mockLoadCheckpoint.mockResolvedValueOnce(structuredClone(cp));

      const result = await orchestrator.migrateCheckpoint(projectPath, workflowId);

      expect(result.migrated).toBe(false);
      expect(result.case).toBe('no_migration_needed');
      expect(mockSaveCheckpoint).not.toHaveBeenCalled();
    });

    it('case already_past_inception: marks all stages completed when current_stage is not intent', async () => {
      const cp = createMockCheckpoint({ current_stage: 'requirements', pathway_type: 'brownfield-enhancement' });
      mockLoadCheckpoint.mockResolvedValueOnce(structuredClone(cp));

      const result = await orchestrator.migrateCheckpoint(projectPath, workflowId);

      expect(result.migrated).toBe(true);
      expect(result.case).toBe('already_past_inception');
      const saved = mockSaveCheckpoint.mock.calls[0][1] as WorkflowCheckpointV3;
      expect(saved.inception_stages).toBeDefined();
      expect(saved.current_inception_stage).toBeUndefined();
      for (const stage of ALL_STAGES) {
        const s = saved.inception_stages![stage];
        expect(['completed', 'skipped']).toContain(s.status);
      }
    });

    it('case already_past_inception: skips reverse-engineering for greenfield pathway', async () => {
      const cp = createMockCheckpoint({ current_stage: 'requirements', pathway_type: 'greenfield' });
      mockLoadCheckpoint.mockResolvedValueOnce(structuredClone(cp));

      await orchestrator.migrateCheckpoint(projectPath, workflowId);

      const saved = mockSaveCheckpoint.mock.calls[0][1] as WorkflowCheckpointV3;
      expect(saved.inception_stages!['reverse-engineering'].status).toBe('skipped');
      expect(saved.inception_stages!['workspace-detection'].status).toBe('completed');
    });

    it('case already_past_inception: calls saveCheckpoint and invalidateCache', async () => {
      const cp = createMockCheckpoint({ current_stage: 'construction', pathway_type: 'brownfield-enhancement' });
      mockLoadCheckpoint.mockResolvedValueOnce(structuredClone(cp));

      await orchestrator.migrateCheckpoint(projectPath, workflowId);

      expect(mockSaveCheckpoint).toHaveBeenCalledOnce();
      expect(mockInvalidateCache).toHaveBeenCalledWith(projectPath, workflowId);
    });

    it('case paused_at_intent: auto-completes workspace-detection and sets current_inception_stage', async () => {
      const cp = createMockCheckpoint({
        current_stage: 'intent',
        pathway_type: 'brownfield-enhancement',
        phases: {
          discovery: { status: 'not_started' } as any,
          inception: makePhaseState('in_progress') as any,
          construction: makePhaseState() as any,
          operations: makePhaseState() as any,
        },
      });
      mockLoadCheckpoint.mockResolvedValueOnce(structuredClone(cp));

      const result = await orchestrator.migrateCheckpoint(projectPath, workflowId);

      expect(result.migrated).toBe(true);
      expect(result.case).toBe('paused_at_intent');
      const saved = mockSaveCheckpoint.mock.calls[0][1] as WorkflowCheckpointV3;
      expect(saved.inception_stages!['workspace-detection'].status).toBe('completed');
      expect(saved.current_inception_stage).toBe('reverse-engineering');
    });

    it('case paused_at_intent: auto-completes reverse-engineering when discovery is done', async () => {
      const cp = createMockCheckpoint({
        current_stage: 'intent',
        pathway_type: 'brownfield-enhancement',
        phases: {
          discovery: { status: 'complete' } as any,
          inception: makePhaseState('in_progress') as any,
          construction: makePhaseState() as any,
          operations: makePhaseState() as any,
        },
      });
      mockLoadCheckpoint.mockResolvedValueOnce(structuredClone(cp));

      await orchestrator.migrateCheckpoint(projectPath, workflowId);

      const saved = mockSaveCheckpoint.mock.calls[0][1] as WorkflowCheckpointV3;
      expect(saved.inception_stages!['workspace-detection'].status).toBe('completed');
      expect(saved.inception_stages!['reverse-engineering'].status).toBe('completed');
      expect(saved.current_inception_stage).toBe('requirements-analysis');
    });

    it('case paused_at_intent: does not auto-complete reverse-engineering for greenfield', async () => {
      const cp = createMockCheckpoint({
        current_stage: 'intent',
        pathway_type: 'greenfield',
        phases: {
          discovery: { status: 'complete' } as any,
          inception: makePhaseState('in_progress') as any,
          construction: makePhaseState() as any,
          operations: makePhaseState() as any,
        },
      });
      mockLoadCheckpoint.mockResolvedValueOnce(structuredClone(cp));

      await orchestrator.migrateCheckpoint(projectPath, workflowId);

      const saved = mockSaveCheckpoint.mock.calls[0][1] as WorkflowCheckpointV3;
      expect(saved.inception_stages!['reverse-engineering'].status).toBe('skipped');
      expect(saved.current_inception_stage).toBe('requirements-analysis');
    });

    it('case paused_at_intent: preserves all other checkpoint fields (no data loss)', async () => {
      const cp = createMockCheckpoint({
        current_stage: 'intent',
        pathway_type: 'brownfield-enhancement',
        feature_name: 'my-feature',
        workflow_id: workflowId,
        depth_score: 5,
      });
      mockLoadCheckpoint.mockResolvedValueOnce(structuredClone(cp));

      await orchestrator.migrateCheckpoint(projectPath, workflowId);

      const saved = mockSaveCheckpoint.mock.calls[0][1] as WorkflowCheckpointV3;
      expect(saved.feature_name).toBe('my-feature');
      expect(saved.workflow_id).toBe(workflowId);
      expect(saved.depth_score).toBe(5);
      expect(saved.pathway_type).toBe('brownfield-enhancement');
    });

    it('throws when checkpoint not found', async () => {
      mockLoadCheckpoint.mockResolvedValueOnce(null);

      await expect(
        orchestrator.migrateCheckpoint(projectPath, workflowId)
      ).rejects.toThrow('Checkpoint not found');
    });

    it('existing inception_stages are not modified on second call (idempotent)', async () => {
      const cp = createCheckpointWithStages({
        'workspace-detection': 'completed',
        'reverse-engineering': 'in_progress',
      });
      mockLoadCheckpoint.mockResolvedValueOnce(structuredClone(cp));

      await orchestrator.migrateCheckpoint(projectPath, workflowId);

      expect(mockSaveCheckpoint).not.toHaveBeenCalled();
      expect(mockInvalidateCache).not.toHaveBeenCalled();
    });
  });

  describe('registerStageHandler()', () => {
    it('registers and uses custom handler', async () => {
      const cp = createCheckpointWithStages({ 'workspace-detection': 'not_started' }, 'workspace-detection');
      setupLoadCheckpointSequence([cp, cp, cp, cp]);

      const customResult: InceptionStageResult = {
        stage: 'workspace-detection',
        status: 'completed',
        requires_approval: false,
        artifacts_generated: ['workspace-report.md'],
        whats_next: 'Review the workspace report.',
      };

      registerStageHandler('workspace-detection', vi.fn().mockResolvedValueOnce(customResult));

      const result = await orchestrator.executeNextStage(projectPath, workflowId);

      expect(result.stage).toBe('workspace-detection');
      expect(result.artifacts_generated).toContain('workspace-report.md');
    });
  });
});
