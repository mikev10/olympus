import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs-extra';
import { detectResumableWorkflows } from '../../features/workflow-engine/resume-detector.js';

const testDir = path.join(process.cwd(), '.test-resume-detector');

// Mock the checkpoint and manifest modules
vi.mock('../../features/workflow-engine/checkpoint.js', () => ({
  loadCheckpoint: vi.fn(),
  listWorkflows: vi.fn(),
}));

vi.mock('../../features/workflow-engine/manifest.js', () => ({
  loadManifest: vi.fn(),
}));

vi.mock('../../features/workflow-engine/workflow-bridge.js', () => ({
  getWorkflowProgress: vi.fn(),
}));

import { loadCheckpoint, listWorkflows } from '../../features/workflow-engine/checkpoint.js';
import { loadManifest } from '../../features/workflow-engine/manifest.js';
import { getWorkflowProgress } from '../../features/workflow-engine/workflow-bridge.js';

describe('resume-detector', () => {
  beforeEach(async () => {
    // Create test directory
    await fs.ensureDir(testDir);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Clean up test directory
    if (await fs.pathExists(testDir)) {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  it('should detect v3 workflows in aidlc-docs/', async () => {
    const mockCheckpoint = {
      workflow_id: 'wf-001',
      feature_name: 'Test Feature',
      current_phase: 'construction' as const,
      current_stage: 'bolt' as const,
      status: 'in_progress' as const,
      updated_at: '2024-01-15T10:00:00Z',
      schema_version: '3.0.0' as const,
      phases: {},
      manifest_path: '',
      trust_state_path: '',
      created_at: '2024-01-15T09:00:00Z',
    };

    const mockManifest = {
      artifacts: [
        { id: 'b1', stage: 'bolt', contract_status: 'fulfilled' },
        { id: 'b2', stage: 'bolt', contract_status: 'active' },
        { id: 'b3', stage: 'bolt', contract_status: 'draft' },
      ],
    };

    vi.mocked(listWorkflows).mockResolvedValue(['wf-001']);
    vi.mocked(loadCheckpoint).mockResolvedValue(mockCheckpoint);
    vi.mocked(loadManifest).mockReturnValue(mockManifest as any);
    vi.mocked(getWorkflowProgress).mockReturnValue({ completed: 1, total: 3, percentage: 33 });

    const result = await detectResumableWorkflows(testDir);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      workflowId: 'wf-001',
      featureName: 'Test Feature',
      currentPhase: 'construction',
      currentStage: 'bolt',
      progress: { completed: 1, total: 3 },
      status: 'in_progress',
    });
  });

  it('should skip completed and archived workflows', async () => {
    const mockCheckpoint = {
      workflow_id: 'wf-001',
      feature_name: 'Test Feature',
      current_phase: 'operations' as const,
      current_stage: 'complete' as const,
      status: 'complete' as const,
      updated_at: '2024-01-15T10:00:00Z',
      schema_version: '3.0.0' as const,
      phases: {},
      manifest_path: '',
      trust_state_path: '',
      created_at: '2024-01-15T09:00:00Z',
    };

    vi.mocked(listWorkflows).mockResolvedValue(['wf-001']);
    vi.mocked(loadCheckpoint).mockResolvedValue(mockCheckpoint);

    const result = await detectResumableWorkflows(testDir);

    expect(result).toHaveLength(0);
  });

  it('should return empty array when no workflows found', async () => {
    vi.mocked(listWorkflows).mockResolvedValue([]);

    const result = await detectResumableWorkflows(testDir);

    expect(result).toHaveLength(0);
  });

  it('should handle errors gracefully', async () => {
    vi.mocked(listWorkflows).mockRejectedValue(new Error('Disk error'));

    const result = await detectResumableWorkflows(testDir);

    expect(result).toHaveLength(0);
  });

  it('should return correct progress info', async () => {
    const mockCheckpoint = {
      workflow_id: 'wf-001',
      feature_name: 'Test Feature',
      current_phase: 'construction' as const,
      current_stage: 'bolt' as const,
      status: 'in_progress' as const,
      updated_at: '2024-01-15T10:00:00Z',
      schema_version: '3.0.0' as const,
      phases: {},
      manifest_path: '',
      trust_state_path: '',
      created_at: '2024-01-15T09:00:00Z',
    };

    vi.mocked(listWorkflows).mockResolvedValue(['wf-001']);
    vi.mocked(loadCheckpoint).mockResolvedValue(mockCheckpoint);
    vi.mocked(loadManifest).mockReturnValue({ artifacts: [] } as any);
    vi.mocked(getWorkflowProgress).mockReturnValue({ completed: 5, total: 10, percentage: 50 });

    const result = await detectResumableWorkflows(testDir);

    expect(result[0].progress).toMatchObject({ completed: 5, total: 10 });
  });

  it('should detect awaiting_mode_selection state', async () => {
    const mockCheckpoint = {
      workflow_id: 'wf-001',
      feature_name: 'Test Feature',
      current_phase: 'inception' as const,
      current_stage: 'intent' as const,
      status: 'awaiting_mode_selection' as const,
      updated_at: '2024-01-15T10:00:00Z',
      schema_version: '3.0.0' as const,
      phases: {},
      manifest_path: '',
      trust_state_path: '',
      created_at: '2024-01-15T09:00:00Z',
    };

    vi.mocked(listWorkflows).mockResolvedValue(['wf-001']);
    vi.mocked(loadCheckpoint).mockResolvedValue(mockCheckpoint);
    vi.mocked(loadManifest).mockReturnValue({ artifacts: [] } as any);
    vi.mocked(getWorkflowProgress).mockReturnValue({ completed: 0, total: 0, percentage: 0 });

    const result = await detectResumableWorkflows(testDir);

    expect(result[0].status).toBe('awaiting_mode_selection');
  });

  it('should include interview_progress when present', async () => {
    const mockCheckpoint = {
      workflow_id: 'wf-001',
      feature_name: 'Test Feature',
      current_phase: 'inception' as const,
      current_stage: 'idea' as const,
      status: 'in_progress' as const,
      updated_at: '2024-01-15T10:00:00Z',
      schema_version: '3.0.0' as const,
      phases: {},
      manifest_path: '',
      trust_state_path: '',
      created_at: '2024-01-15T09:00:00Z',
      interview_progress: {
        stage: 'idea' as const,
        questions_asked: 5,
        draft_artifact_path: 'aidlc-docs/discovery/idea-draft.md',
      },
    };

    vi.mocked(listWorkflows).mockResolvedValue(['wf-001']);
    vi.mocked(loadCheckpoint).mockResolvedValue(mockCheckpoint);
    vi.mocked(loadManifest).mockReturnValue({ artifacts: [] } as any);
    vi.mocked(getWorkflowProgress).mockReturnValue({ completed: 0, total: 0, percentage: 0 });

    const result = await detectResumableWorkflows(testDir);

    expect(result[0].interviewProgress).toEqual({
      stage: 'idea',
      questions_asked: 5,
      draft_artifact_path: 'aidlc-docs/discovery/idea-draft.md',
    });
  });

  it('should handle missing manifest gracefully', async () => {
    const mockCheckpoint = {
      workflow_id: 'wf-001',
      feature_name: 'Test Feature',
      current_phase: 'construction' as const,
      current_stage: 'bolt' as const,
      status: 'in_progress' as const,
      updated_at: '2024-01-15T10:00:00Z',
      schema_version: '3.0.0' as const,
      phases: {},
      manifest_path: '',
      trust_state_path: '',
      created_at: '2024-01-15T09:00:00Z',
    };

    vi.mocked(listWorkflows).mockResolvedValue(['wf-001']);
    vi.mocked(loadCheckpoint).mockResolvedValue(mockCheckpoint);
    vi.mocked(loadManifest).mockReturnValue(null);

    const result = await detectResumableWorkflows(testDir);

    expect(result).toHaveLength(1);
    expect(result[0].progress).toEqual({ completed: 0, total: 0 });
  });
});
