import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WorkflowCheckpointV3, InceptionStage, InceptionStageState } from '../../features/workflow-engine/phase-types.js';

vi.mock('../../features/workflow-engine/discovery.js', () => ({
  detectBrownfield: vi.fn(),
}));

vi.mock('../../features/workflow-engine/workflow-routing.js', () => ({
  detectPathway: vi.fn(),
  isStageIncluded: vi.fn().mockReturnValue(true),
}));

vi.mock('../../features/workflow-engine/checkpoint.js', () => ({
  loadCheckpoint: vi.fn(),
  saveCheckpoint: vi.fn(),
  invalidateCache: vi.fn(),
}));

vi.mock('fs-extra', () => ({
  default: {
    pathExists: vi.fn(),
    readFile: vi.fn(),
  },
  pathExists: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock('../../features/workflow-engine/inception/orchestrator.js', () => ({
  registerStageHandler: vi.fn(),
}));

import { detectBrownfield } from '../../features/workflow-engine/discovery.js';
import { detectPathway } from '../../features/workflow-engine/workflow-routing.js';
import { loadCheckpoint, saveCheckpoint, invalidateCache } from '../../features/workflow-engine/checkpoint.js';
import * as fsExtra from 'fs-extra';
import { registerStageHandler } from '../../features/workflow-engine/inception/orchestrator.js';

const mockDetectBrownfield = vi.mocked(detectBrownfield);
const mockDetectPathway = vi.mocked(detectPathway);
const mockLoadCheckpoint = vi.mocked(loadCheckpoint);
const mockSaveCheckpoint = vi.mocked(saveCheckpoint);
const mockInvalidateCache = vi.mocked(invalidateCache);
const mockPathExists = vi.mocked(fsExtra.pathExists);
const mockReadFile = vi.mocked(fsExtra.readFile);
const mockRegisterStageHandler = vi.mocked(registerStageHandler);

function makeInceptionStageState(
  stage: InceptionStage,
  status: InceptionStageState['status'] = 'not_started'
): InceptionStageState {
  return {
    stage,
    status,
    started_at: status === 'in_progress' ? new Date().toISOString() : null,
    completed_at: null,
    skip_reason: null,
    artifacts_generated: [],
    questions_file: null,
    answers_received: false,
  };
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
      discovery: { status: 'complete', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
      inception: { status: 'in_progress', started_at: new Date().toISOString(), completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
      construction: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
      operations: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
    },
    manifest_path: 'manifest.json',
    trust_state_path: 'trust-state.json',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    inception_stages: {
      'workspace-detection': makeInceptionStageState('workspace-detection', 'in_progress'),
      'reverse-engineering': makeInceptionStageState('reverse-engineering'),
      'requirements-analysis': makeInceptionStageState('requirements-analysis'),
      'user-stories': makeInceptionStageState('user-stories'),
      'workflow-planning': makeInceptionStageState('workflow-planning'),
      'application-design': makeInceptionStageState('application-design'),
      'units-generation': makeInceptionStageState('units-generation'),
    },
    ...overrides,
  };
}

describe('workspace-detection stage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathExists.mockResolvedValue(false as never);
    mockSaveCheckpoint.mockResolvedValue(undefined);
    mockInvalidateCache.mockReturnValue(undefined);
  });

  describe('handler registration', () => {
    it('registers handler with orchestrator on module load', async () => {
      await import('../../features/workflow-engine/inception/stages/workspace-detection.js');
      expect(mockRegisterStageHandler).toHaveBeenCalledWith('workspace-detection', expect.any(Function));
    });
  });

  describe('greenfield detection', () => {
    it('detects greenfield project when no source files exist', async () => {
      mockDetectBrownfield.mockResolvedValue({ isBrownfield: false, sourceFileCount: 0 });
      const checkpoint = createMockCheckpoint();
      mockLoadCheckpoint.mockResolvedValue(createMockCheckpoint());

      const { executeWorkspaceDetection } = await import('../../features/workflow-engine/inception/stages/workspace-detection.js');
      const result = await executeWorkspaceDetection('/project', 'test-wf', checkpoint);

      expect(result.status).toBe('completed');
      expect(result.stage).toBe('workspace-detection');
      expect(result.review_summary).toContain('greenfield');
    });

    it('skips reverse-engineering for greenfield pathway', async () => {
      mockDetectBrownfield.mockResolvedValue({ isBrownfield: false, sourceFileCount: 0 });
      const checkpoint = createMockCheckpoint();
      const freshCheckpoint = createMockCheckpoint();
      mockLoadCheckpoint.mockResolvedValue(freshCheckpoint);

      const { executeWorkspaceDetection } = await import('../../features/workflow-engine/inception/stages/workspace-detection.js');
      await executeWorkspaceDetection('/project', 'test-wf', checkpoint);

      const saved = mockSaveCheckpoint.mock.calls[0]?.[1] as WorkflowCheckpointV3;
      expect(saved.inception_stages?.['reverse-engineering'].status).toBe('skipped');
      expect(saved.inception_stages?.['reverse-engineering'].skip_reason).toContain('Greenfield');
    });

    it('does not skip user-stories or application-design for greenfield', async () => {
      mockDetectBrownfield.mockResolvedValue({ isBrownfield: false, sourceFileCount: 0 });
      const checkpoint = createMockCheckpoint();
      const freshCheckpoint = createMockCheckpoint();
      mockLoadCheckpoint.mockResolvedValue(freshCheckpoint);

      const { executeWorkspaceDetection } = await import('../../features/workflow-engine/inception/stages/workspace-detection.js');
      await executeWorkspaceDetection('/project', 'test-wf', checkpoint);

      const saved = mockSaveCheckpoint.mock.calls[0]?.[1] as WorkflowCheckpointV3;
      expect(saved.inception_stages?.['user-stories'].status).toBe('not_started');
      expect(saved.inception_stages?.['application-design'].status).toBe('not_started');
    });
  });

  describe('brownfield detection', () => {
    it('detects brownfield-enhancement when 3+ source files exist', async () => {
      mockDetectBrownfield.mockResolvedValue({ isBrownfield: true, sourceFileCount: 42 });
      const checkpoint = createMockCheckpoint();
      mockLoadCheckpoint.mockResolvedValue(createMockCheckpoint());

      const { executeWorkspaceDetection } = await import('../../features/workflow-engine/inception/stages/workspace-detection.js');
      const result = await executeWorkspaceDetection('/project', 'test-wf', checkpoint);

      expect(result.review_summary).toContain('brownfield');
      expect(result.review_summary).toContain('brownfield-enhancement');

      const saved = mockSaveCheckpoint.mock.calls[0]?.[1] as WorkflowCheckpointV3;
      expect(saved.pathway_type).toBe('brownfield-enhancement');
    });

    it('does not skip reverse-engineering for brownfield-enhancement', async () => {
      mockDetectBrownfield.mockResolvedValue({ isBrownfield: true, sourceFileCount: 10 });
      const checkpoint = createMockCheckpoint();
      const freshCheckpoint = createMockCheckpoint();
      mockLoadCheckpoint.mockResolvedValue(freshCheckpoint);

      const { executeWorkspaceDetection } = await import('../../features/workflow-engine/inception/stages/workspace-detection.js');
      await executeWorkspaceDetection('/project', 'test-wf', checkpoint);

      const saved = mockSaveCheckpoint.mock.calls[0]?.[1] as WorkflowCheckpointV3;
      expect(saved.inception_stages?.['reverse-engineering'].status).toBe('not_started');
    });
  });

  describe('pathway detection with intent.md', () => {
    it('uses detectPathway when intent.md exists', async () => {
      mockDetectBrownfield.mockResolvedValue({ isBrownfield: true, sourceFileCount: 5 });
      mockPathExists.mockResolvedValue(true as never);
      mockReadFile.mockResolvedValue('fix the login bug' as never);
      mockDetectPathway.mockResolvedValue('bugfix');
      const checkpoint = createMockCheckpoint();
      mockLoadCheckpoint.mockResolvedValue(createMockCheckpoint());

      const { executeWorkspaceDetection } = await import('../../features/workflow-engine/inception/stages/workspace-detection.js');
      await executeWorkspaceDetection('/project', 'test-wf', checkpoint);

      expect(mockDetectPathway).toHaveBeenCalledWith('/project', 'fix the login bug');
      const saved = mockSaveCheckpoint.mock.calls[0]?.[1] as WorkflowCheckpointV3;
      expect(saved.pathway_type).toBe('bugfix');
    });

    it('falls back to brownfield check when intent.md read fails', async () => {
      mockDetectBrownfield.mockResolvedValue({ isBrownfield: true, sourceFileCount: 5 });
      mockPathExists.mockResolvedValue(true as never);
      mockReadFile.mockRejectedValue(new Error('read error'));
      const checkpoint = createMockCheckpoint();
      mockLoadCheckpoint.mockResolvedValue(createMockCheckpoint());

      const { executeWorkspaceDetection } = await import('../../features/workflow-engine/inception/stages/workspace-detection.js');
      const result = await executeWorkspaceDetection('/project', 'test-wf', checkpoint);

      expect(result.status).toBe('completed');
      const saved = mockSaveCheckpoint.mock.calls[0]?.[1] as WorkflowCheckpointV3;
      expect(saved.pathway_type).toBe('brownfield-enhancement');
    });
  });

  describe('existing pathway preservation', () => {
    it('preserves existing pathway_type and does not override it', async () => {
      mockDetectBrownfield.mockResolvedValue({ isBrownfield: false, sourceFileCount: 0 });
      const checkpoint = createMockCheckpoint({ pathway_type: 'brownfield-refactor' });
      mockLoadCheckpoint.mockResolvedValue(createMockCheckpoint({ pathway_type: 'brownfield-refactor' }));

      const { executeWorkspaceDetection } = await import('../../features/workflow-engine/inception/stages/workspace-detection.js');
      const result = await executeWorkspaceDetection('/project', 'test-wf', checkpoint);

      expect(mockDetectPathway).not.toHaveBeenCalled();
      expect(result.review_summary).toContain('brownfield-refactor');
      expect(result.review_summary).toContain('preserved from existing checkpoint');

      const saved = mockSaveCheckpoint.mock.calls[0]?.[1] as WorkflowCheckpointV3;
      expect(saved.pathway_type).toBe('brownfield-refactor');
    });
  });

  describe('bugfix pathway stage skipping', () => {
    it('skips user-stories and application-design for bugfix pathway', async () => {
      mockDetectBrownfield.mockResolvedValue({ isBrownfield: true, sourceFileCount: 5 });
      mockPathExists.mockResolvedValue(true as never);
      mockReadFile.mockResolvedValue('fix the crash' as never);
      mockDetectPathway.mockResolvedValue('bugfix');
      const checkpoint = createMockCheckpoint();
      const freshCheckpoint = createMockCheckpoint();
      mockLoadCheckpoint.mockResolvedValue(freshCheckpoint);

      const { executeWorkspaceDetection } = await import('../../features/workflow-engine/inception/stages/workspace-detection.js');
      await executeWorkspaceDetection('/project', 'test-wf', checkpoint);

      const saved = mockSaveCheckpoint.mock.calls[0]?.[1] as WorkflowCheckpointV3;
      expect(saved.inception_stages?.['user-stories'].status).toBe('skipped');
      expect(saved.inception_stages?.['user-stories'].skip_reason).toContain('bugfix');
      expect(saved.inception_stages?.['application-design'].status).toBe('skipped');
      expect(saved.inception_stages?.['application-design'].skip_reason).toContain('bugfix');
    });

    it('does not skip reverse-engineering for bugfix pathway', async () => {
      mockDetectBrownfield.mockResolvedValue({ isBrownfield: true, sourceFileCount: 5 });
      mockPathExists.mockResolvedValue(true as never);
      mockReadFile.mockResolvedValue('fix crash' as never);
      mockDetectPathway.mockResolvedValue('bugfix');
      const checkpoint = createMockCheckpoint();
      mockLoadCheckpoint.mockResolvedValue(createMockCheckpoint());

      const { executeWorkspaceDetection } = await import('../../features/workflow-engine/inception/stages/workspace-detection.js');
      await executeWorkspaceDetection('/project', 'test-wf', checkpoint);

      const saved = mockSaveCheckpoint.mock.calls[0]?.[1] as WorkflowCheckpointV3;
      expect(saved.inception_stages?.['reverse-engineering'].status).toBe('not_started');
    });
  });

  describe('optimization pathway stage skipping', () => {
    it('skips user-stories and application-design for optimization pathway', async () => {
      mockDetectBrownfield.mockResolvedValue({ isBrownfield: true, sourceFileCount: 5 });
      mockPathExists.mockResolvedValue(true as never);
      mockReadFile.mockResolvedValue('optimize performance' as never);
      mockDetectPathway.mockResolvedValue('optimization');
      const checkpoint = createMockCheckpoint();
      const freshCheckpoint = createMockCheckpoint();
      mockLoadCheckpoint.mockResolvedValue(freshCheckpoint);

      const { executeWorkspaceDetection } = await import('../../features/workflow-engine/inception/stages/workspace-detection.js');
      await executeWorkspaceDetection('/project', 'test-wf', checkpoint);

      const saved = mockSaveCheckpoint.mock.calls[0]?.[1] as WorkflowCheckpointV3;
      expect(saved.inception_stages?.['user-stories'].status).toBe('skipped');
      expect(saved.inception_stages?.['user-stories'].skip_reason).toContain('optimization');
      expect(saved.inception_stages?.['application-design'].status).toBe('skipped');
      expect(saved.inception_stages?.['application-design'].skip_reason).toContain('optimization');
    });
  });

  describe('result shape', () => {
    it('returns completed status with no artifacts', async () => {
      mockDetectBrownfield.mockResolvedValue({ isBrownfield: false, sourceFileCount: 0 });
      const checkpoint = createMockCheckpoint();
      mockLoadCheckpoint.mockResolvedValue(createMockCheckpoint());

      const { executeWorkspaceDetection } = await import('../../features/workflow-engine/inception/stages/workspace-detection.js');
      const result = await executeWorkspaceDetection('/project', 'test-wf', checkpoint);

      expect(result.status).toBe('completed');
      expect(result.stage).toBe('workspace-detection');
      expect(result.artifacts_generated).toEqual([]);
    });

    it('includes source file count and pathway in review_summary', async () => {
      mockDetectBrownfield.mockResolvedValue({ isBrownfield: true, sourceFileCount: 27 });
      const checkpoint = createMockCheckpoint();
      mockLoadCheckpoint.mockResolvedValue(createMockCheckpoint());

      const { executeWorkspaceDetection } = await import('../../features/workflow-engine/inception/stages/workspace-detection.js');
      const result = await executeWorkspaceDetection('/project', 'test-wf', checkpoint);

      expect(result.review_summary).toContain('27');
      expect(result.review_summary).toContain('brownfield');
    });

    it('includes whats_next describing skipped stages', async () => {
      mockDetectBrownfield.mockResolvedValue({ isBrownfield: false, sourceFileCount: 0 });
      const checkpoint = createMockCheckpoint();
      mockLoadCheckpoint.mockResolvedValue(createMockCheckpoint());

      const { executeWorkspaceDetection } = await import('../../features/workflow-engine/inception/stages/workspace-detection.js');
      const result = await executeWorkspaceDetection('/project', 'test-wf', checkpoint);

      expect(result.whats_next).toContain('reverse-engineering');
    });
  });
});
