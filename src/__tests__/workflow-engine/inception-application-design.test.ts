import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs';
import * as fsExtra from 'fs-extra';
import { join } from 'path';
import * as os from 'os';

vi.mock('../../features/workflow-engine/application-design.js', () => ({
  buildApplicationDesignPrompt: vi.fn().mockReturnValue('mock prompt'),
  writeApplicationDesignArtifacts: vi.fn().mockImplementation(() =>
    Promise.resolve([
      '/tmp/components.md',
      '/tmp/component-methods.md',
      '/tmp/services.md',
      '/tmp/component-dependency.md',
    ])
  ),
}));

vi.mock('../../features/workflow-engine/checkpoint.js', () => ({
  loadCheckpoint: vi.fn(),
  saveCheckpoint: vi.fn(),
  invalidateCache: vi.fn(),
}));

vi.mock('../../features/workflow-engine/inception/orchestrator.js', () => ({
  registerStageHandler: vi.fn(),
}));

import {
  buildApplicationDesignPrompt,
  writeApplicationDesignArtifacts,
} from '../../features/workflow-engine/application-design.js';
import { registerStageHandler } from '../../features/workflow-engine/inception/orchestrator.js';
import { executeApplicationDesign } from '../../features/workflow-engine/inception/stages/application-design.js';
import type { WorkflowCheckpointV3, InceptionStage, InceptionStageState } from '../../features/workflow-engine/phase-types.js';

const mockBuildPrompt = vi.mocked(buildApplicationDesignPrompt);
const mockWriteArtifacts = vi.mocked(writeApplicationDesignArtifacts);
const mockRegisterStageHandler = vi.mocked(registerStageHandler);

const registrationCallsAtLoad = mockRegisterStageHandler.mock.calls.slice();

const ALL_STAGES: InceptionStage[] = [
  'workspace-detection',
  'reverse-engineering',
  'requirements-analysis',
  'user-stories',
  'workflow-planning',
  'application-design',
  'units-generation',
  'bolt-planning',
];

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
      discovery: { status: 'complete', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
      inception: { status: 'in_progress', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
      construction: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
      operations: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
    },
    manifest_path: 'manifest.json',
    trust_state_path: 'trust-state.json',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    pathway_type: 'greenfield',
    inception_stages,
    ...overrides,
  };
}

describe('executeApplicationDesign', () => {
  const projectPath = '/test/project';
  const workflowId = 'test-wf';

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mock('fs-extra', async () => {
      const actual = await vi.importActual<typeof import('fs-extra')>('fs-extra');
      return {
        ...actual,
        default: {
          ...actual,
          readFile: vi.fn().mockRejectedValue(new Error('not found')),
          ensureDir: vi.fn().mockResolvedValue(undefined),
          writeFile: vi.fn().mockResolvedValue(undefined),
        },
        readFile: vi.fn().mockRejectedValue(new Error('not found')),
        ensureDir: vi.fn().mockResolvedValue(undefined),
        writeFile: vi.fn().mockResolvedValue(undefined),
      };
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('pathway skipping', () => {
    it('skips for bugfix pathway', async () => {
      const checkpoint = createMockCheckpoint({ pathway_type: 'bugfix' });

      const result = await executeApplicationDesign(projectPath, workflowId, checkpoint);

      expect(result.status).toBe('skipped');
      expect(result.stage).toBe('application-design');
      expect(result.artifacts_generated).toHaveLength(0);
      expect(mockWriteArtifacts).not.toHaveBeenCalled();
    });

    it('skips for optimization pathway', async () => {
      const checkpoint = createMockCheckpoint({ pathway_type: 'optimization' });

      const result = await executeApplicationDesign(projectPath, workflowId, checkpoint);

      expect(result.status).toBe('skipped');
      expect(result.stage).toBe('application-design');
      expect(result.artifacts_generated).toHaveLength(0);
      expect(mockWriteArtifacts).not.toHaveBeenCalled();
    });

    it('includes pathway name in skip review_summary', async () => {
      const checkpoint = createMockCheckpoint({ pathway_type: 'bugfix' });

      const result = await executeApplicationDesign(projectPath, workflowId, checkpoint);

      expect(result.review_summary).toContain('bugfix');
    });

    it('defaults missing pathway_type to greenfield and executes', async () => {
      const checkpoint = createMockCheckpoint({ pathway_type: undefined });

      const result = await executeApplicationDesign(projectPath, workflowId, checkpoint);

      expect(result.status).toBe('review_required');
      expect(mockWriteArtifacts).toHaveBeenCalled();
    });
  });

  describe('executes for non-skipped pathways', () => {
    it('executes for greenfield pathway', async () => {
      const checkpoint = createMockCheckpoint({ pathway_type: 'greenfield' });

      const result = await executeApplicationDesign(projectPath, workflowId, checkpoint);

      expect(result.status).toBe('review_required');
      expect(result.stage).toBe('application-design');
    });

    it('executes for brownfield-enhancement pathway', async () => {
      const checkpoint = createMockCheckpoint({ pathway_type: 'brownfield-enhancement' });

      const result = await executeApplicationDesign(projectPath, workflowId, checkpoint);

      expect(result.status).toBe('review_required');
      expect(result.stage).toBe('application-design');
    });

    it('executes for brownfield-refactor pathway', async () => {
      const checkpoint = createMockCheckpoint({ pathway_type: 'brownfield-refactor' });

      const result = await executeApplicationDesign(projectPath, workflowId, checkpoint);

      expect(result.status).toBe('review_required');
    });
  });

  describe('prompt building', () => {
    it('calls buildApplicationDesignPrompt with intent, stories, and requirements', async () => {
      const checkpoint = createMockCheckpoint({ pathway_type: 'greenfield' });

      await executeApplicationDesign(projectPath, workflowId, checkpoint);

      expect(mockBuildPrompt).toHaveBeenCalledOnce();
      expect(mockBuildPrompt).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String)
      );
    });

    it('calls buildApplicationDesignPrompt even when context files are missing', async () => {
      const checkpoint = createMockCheckpoint({ pathway_type: 'greenfield' });

      const result = await executeApplicationDesign(projectPath, workflowId, checkpoint);

      expect(mockBuildPrompt).toHaveBeenCalledOnce();
      expect(result.status).toBe('review_required');
    });
  });

  describe('artifact writing', () => {
    it('calls writeApplicationDesignArtifacts with scaffold artifacts', async () => {
      const checkpoint = createMockCheckpoint({ pathway_type: 'greenfield' });

      await executeApplicationDesign(projectPath, workflowId, checkpoint);

      expect(mockWriteArtifacts).toHaveBeenCalledOnce();
      expect(mockWriteArtifacts).toHaveBeenCalledWith(
        projectPath,
        workflowId,
        { components: [], services: [], dependencies: [] }
      );
    });

    it('returns review_required status with all artifact paths', async () => {
      const checkpoint = createMockCheckpoint({ pathway_type: 'greenfield' });

      const result = await executeApplicationDesign(projectPath, workflowId, checkpoint);

      expect(result.status).toBe('review_required');
      expect(result.requires_approval).toBe(true);
      expect(result.artifacts_generated).toContain('/tmp/components.md');
      expect(result.artifacts_generated).toContain('/tmp/component-methods.md');
      expect(result.artifacts_generated).toContain('/tmp/services.md');
      expect(result.artifacts_generated).toContain('/tmp/component-dependency.md');
    });

    it('includes design-prompt.md in artifacts_generated', async () => {
      const checkpoint = createMockCheckpoint({ pathway_type: 'greenfield' });

      const result = await executeApplicationDesign(projectPath, workflowId, checkpoint);

      const promptArtifact = result.artifacts_generated.find(p => p.endsWith('design-prompt.md'));
      expect(promptArtifact).toBeDefined();
    });

    it('returns 5 total artifacts (4 design + 1 prompt)', async () => {
      const checkpoint = createMockCheckpoint({ pathway_type: 'greenfield' });

      const result = await executeApplicationDesign(projectPath, workflowId, checkpoint);

      expect(result.artifacts_generated).toHaveLength(5);
    });
  });

  describe('result shape', () => {
    it('includes REVIEW REQUIRED in review_summary', async () => {
      const checkpoint = createMockCheckpoint({ pathway_type: 'greenfield' });

      const result = await executeApplicationDesign(projectPath, workflowId, checkpoint);

      expect(result.review_summary).toContain('REVIEW REQUIRED');
    });

    it('includes artifact count in review_summary', async () => {
      const checkpoint = createMockCheckpoint({ pathway_type: 'greenfield' });

      const result = await executeApplicationDesign(projectPath, workflowId, checkpoint);

      expect(result.review_summary).toContain('5 artifacts');
    });

    it('includes WHAT\'S NEXT in whats_next', async () => {
      const checkpoint = createMockCheckpoint({ pathway_type: 'greenfield' });

      const result = await executeApplicationDesign(projectPath, workflowId, checkpoint);

      expect(result.whats_next).toContain("WHAT'S NEXT");
    });

    it('includes units generation mention in whats_next', async () => {
      const checkpoint = createMockCheckpoint({ pathway_type: 'greenfield' });

      const result = await executeApplicationDesign(projectPath, workflowId, checkpoint);

      expect(result.whats_next).toContain('units generation');
    });
  });

  describe('handler registration', () => {
    it('registers handler with orchestrator at module load', () => {
      const wasRegistered = registrationCallsAtLoad.some(
        ([stageName, handler]) =>
          stageName === 'application-design' && typeof handler === 'function'
      );
      expect(wasRegistered).toBe(true);
    });
  });
});

describe('application-design integration', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(os.tmpdir(), 'app-design-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes all 4 design artifacts plus design-prompt.md to real filesystem', async () => {
    const workflowId = 'test-wf-integration';
    const inceptionDir = join(tmpDir, 'aidlc-docs', workflowId, 'inception');
    const manifestPath = join(tmpDir, 'aidlc-docs', workflowId, 'manifest.json');

    mkdirSync(inceptionDir, { recursive: true });

    writeFileSync(join(inceptionDir, 'intent.md'), '# Intent\nBuild a todo app', 'utf-8');
    writeFileSync(join(inceptionDir, 'requirements.md'), '# Requirements\nR1: Create tasks', 'utf-8');
    writeFileSync(join(inceptionDir, 'stories.md'), '# Stories\nAs a user I can create tasks', 'utf-8');

    const manifest = {
      schema_version: '2.0.0',
      workflow_id: workflowId,
      feature_name: 'test',
      created_at: '',
      updated_at: '',
      phases: {},
      depth_assessment: null,
      artifacts: [],
      links: [],
      risks: [],
      gate_audit: [],
      metrics: null,
      alignment_checks: [],
      risk_tier: null,
    };
    writeFileSync(manifestPath, JSON.stringify(manifest), 'utf-8');

    vi.doUnmock('../../features/workflow-engine/application-design.js');
    vi.doUnmock('../../features/workflow-engine/inception/orchestrator.js');
    vi.doUnmock('fs-extra');
    vi.resetModules();

    const { executeApplicationDesign: executeReal } = await import(
      '../../features/workflow-engine/inception/stages/application-design.js'
    );

    const checkpoint = {
      schema_version: '3.0.0' as const,
      workflow_id: workflowId,
      feature_name: 'test',
      current_phase: 'inception' as const,
      current_stage: 'intent' as const,
      status: 'in_progress' as const,
      phases: {
        discovery: { status: 'complete' as const, started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
        inception: { status: 'in_progress' as const, started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
        construction: { status: 'not_started' as const, started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
        operations: { status: 'not_started' as const, started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
      },
      manifest_path: 'manifest.json',
      trust_state_path: 'trust-state.json',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      pathway_type: 'greenfield' as const,
    };

    const result = await executeReal(tmpDir, workflowId, checkpoint);

    expect(result.status).toBe('review_required');

    const designDir = join(inceptionDir, 'application-design');
    expect(existsSync(join(designDir, 'components.md'))).toBe(true);
    expect(existsSync(join(designDir, 'component-methods.md'))).toBe(true);
    expect(existsSync(join(designDir, 'services.md'))).toBe(true);
    expect(existsSync(join(designDir, 'component-dependency.md'))).toBe(true);
    expect(existsSync(join(designDir, 'design-prompt.md'))).toBe(true);

    const promptContent = readFileSync(join(designDir, 'design-prompt.md'), 'utf-8');
    expect(promptContent).toContain('todo app');
    expect(promptContent).toContain('Create tasks');
    expect(promptContent).toContain('create tasks');
  });
});
