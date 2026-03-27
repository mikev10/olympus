import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import * as os from 'os';

vi.mock('fs-extra', async () => {
  const actual = await vi.importActual<typeof import('fs-extra')>('fs-extra');
  return {
    ...actual,
    default: {
      ...actual,
      ensureDir: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockRejectedValue(new Error('not found')),
      writeFile: vi.fn().mockResolvedValue(undefined),
      pathExists: vi.fn().mockResolvedValue(false),
    },
    ensureDir: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockRejectedValue(new Error('not found')),
    writeFile: vi.fn().mockResolvedValue(undefined),
    pathExists: vi.fn().mockResolvedValue(false),
  };
});

vi.mock('../../features/workflow-engine/checkpoint.js', () => ({
  loadCheckpoint: vi.fn(),
}));

vi.mock('../../features/workflow-engine/inception/orchestrator.js', () => ({
  registerStageHandler: vi.fn(),
}));

import * as fsExtra from 'fs-extra';
import { registerStageHandler } from '../../features/workflow-engine/inception/orchestrator.js';
import {
  executeUserStories,
  generateUserStoriesPlan,
  generatePersonas,
  generateStories,
  countStories,
} from '../../features/workflow-engine/inception/stages/user-stories.js';
import type { WorkflowCheckpointV3, InceptionStage, InceptionStageState } from '../../features/workflow-engine/phase-types.js';

const mockFsEnsureDir = vi.mocked(fsExtra.ensureDir);
const mockFsReadFile = vi.mocked(fsExtra.readFile);
const mockFsWriteFile = vi.mocked(fsExtra.writeFile);
const mockFsPathExists = vi.mocked(fsExtra.pathExists);
const mockRegisterStageHandler = vi.mocked(registerStageHandler);

const registrationCallsAtLoad = mockRegisterStageHandler.mock.calls.slice();

const ALL_STAGES: InceptionStage[] = [
  'workspace-detection',
  'reverse-engineering',
  'requirements-analysis',
  'workflow-planning',
  'units-generation',
  'user-stories',
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

describe('executeUserStories', () => {
  const projectPath = '/test/project';
  const workflowId = 'test-wf';

  beforeEach(() => {
    vi.clearAllMocks();
    mockFsEnsureDir.mockResolvedValue(undefined);
    mockFsReadFile.mockRejectedValue(new Error('not found'));
    mockFsWriteFile.mockResolvedValue(undefined);
    mockFsPathExists.mockResolvedValue(false);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('pathway skipping', () => {
    it('skips for bugfix pathway', async () => {
      const checkpoint = createMockCheckpoint({ pathway_type: 'bugfix' });

      const result = await executeUserStories(projectPath, workflowId, checkpoint);

      expect(result.status).toBe('skipped');
      expect(result.stage).toBe('user-stories');
      expect(result.artifacts_generated).toHaveLength(0);
    });

    it('skips for optimization pathway', async () => {
      const checkpoint = createMockCheckpoint({ pathway_type: 'optimization' });

      const result = await executeUserStories(projectPath, workflowId, checkpoint);

      expect(result.status).toBe('skipped');
      expect(result.stage).toBe('user-stories');
      expect(result.artifacts_generated).toHaveLength(0);
    });

    it('includes pathway name in skip review_summary for bugfix', async () => {
      const checkpoint = createMockCheckpoint({ pathway_type: 'bugfix' });

      const result = await executeUserStories(projectPath, workflowId, checkpoint);

      expect(result.review_summary).toContain('bugfix');
    });

    it('includes pathway name in skip review_summary for optimization', async () => {
      const checkpoint = createMockCheckpoint({ pathway_type: 'optimization' });

      const result = await executeUserStories(projectPath, workflowId, checkpoint);

      expect(result.review_summary).toContain('optimization');
    });
  });

  describe('pathway execution', () => {
    it('executes for greenfield pathway', async () => {
      const checkpoint = createMockCheckpoint({ pathway_type: 'greenfield' });

      const result = await executeUserStories(projectPath, workflowId, checkpoint);

      expect(result.status).toBe('review_required');
      expect(result.stage).toBe('user-stories');
    });

    it('executes for brownfield-enhancement pathway', async () => {
      const checkpoint = createMockCheckpoint({ pathway_type: 'brownfield-enhancement' });

      const result = await executeUserStories(projectPath, workflowId, checkpoint);

      expect(result.status).toBe('review_required');
      expect(result.stage).toBe('user-stories');
    });

    it('defaults missing pathway_type to greenfield and executes', async () => {
      const checkpoint = createMockCheckpoint({ pathway_type: undefined });

      const result = await executeUserStories(projectPath, workflowId, checkpoint);

      expect(result.status).toBe('review_required');
    });
  });

  describe('Part 1: plan generation', () => {
    it('returns review_required when no plan exists', async () => {
      mockFsPathExists.mockResolvedValue(false);
      const checkpoint = createMockCheckpoint({ pathway_type: 'greenfield' });

      const result = await executeUserStories(projectPath, workflowId, checkpoint);

      expect(result.status).toBe('review_required');
      expect(result.requires_approval).toBe(true);
    });

    it('writes plan file to correct path', async () => {
      mockFsPathExists.mockResolvedValue(false);
      const checkpoint = createMockCheckpoint({ pathway_type: 'greenfield' });

      await executeUserStories(projectPath, workflowId, checkpoint);

      const expectedPlanPath = join(projectPath, 'aidlc-docs', workflowId, 'inception', 'user-stories-plan.md');
      expect(mockFsWriteFile).toHaveBeenCalledWith(expectedPlanPath, expect.any(String), 'utf-8');
    });

    it('includes plan path in artifacts_generated', async () => {
      mockFsPathExists.mockResolvedValue(false);
      const checkpoint = createMockCheckpoint({ pathway_type: 'greenfield' });

      const result = await executeUserStories(projectPath, workflowId, checkpoint);

      const expectedPlanPath = join(projectPath, 'aidlc-docs', workflowId, 'inception', 'user-stories-plan.md');
      expect(result.artifacts_generated).toContain(expectedPlanPath);
    });

    it('includes REVIEW REQUIRED in review_summary', async () => {
      mockFsPathExists.mockResolvedValue(false);
      const checkpoint = createMockCheckpoint({ pathway_type: 'greenfield' });

      const result = await executeUserStories(projectPath, workflowId, checkpoint);

      expect(result.review_summary).toContain('REVIEW REQUIRED');
    });

    it('includes WHAT\'S NEXT in whats_next', async () => {
      mockFsPathExists.mockResolvedValue(false);
      const checkpoint = createMockCheckpoint({ pathway_type: 'greenfield' });

      const result = await executeUserStories(projectPath, workflowId, checkpoint);

      expect(result.whats_next).toContain("WHAT'S NEXT");
    });
  });

  describe('Part 2: personas and stories generation', () => {
    beforeEach(() => {
      mockFsPathExists.mockImplementation(async (filePath: string) => {
        if (typeof filePath === 'string' && filePath.endsWith('user-stories-plan.md')) return true;
        return false;
      });
    });

    it('returns completed status when plan exists but stories do not', async () => {
      const checkpoint = createMockCheckpoint({ pathway_type: 'greenfield' });

      const result = await executeUserStories(projectPath, workflowId, checkpoint);

      expect(result.status).toBe('completed');
    });

    it('writes personas.md to correct path', async () => {
      const checkpoint = createMockCheckpoint({ pathway_type: 'greenfield' });

      await executeUserStories(projectPath, workflowId, checkpoint);

      const expectedPersonasPath = join(projectPath, 'aidlc-docs', workflowId, 'inception', 'user-stories', 'personas.md');
      expect(mockFsWriteFile).toHaveBeenCalledWith(expectedPersonasPath, expect.any(String), 'utf-8');
    });

    it('writes stories.md to correct path', async () => {
      const checkpoint = createMockCheckpoint({ pathway_type: 'greenfield' });

      await executeUserStories(projectPath, workflowId, checkpoint);

      const expectedStoriesPath = join(projectPath, 'aidlc-docs', workflowId, 'inception', 'user-stories', 'stories.md');
      expect(mockFsWriteFile).toHaveBeenCalledWith(expectedStoriesPath, expect.any(String), 'utf-8');
    });

    it('includes both personas.md and stories.md in artifacts_generated', async () => {
      const checkpoint = createMockCheckpoint({ pathway_type: 'greenfield' });

      const result = await executeUserStories(projectPath, workflowId, checkpoint);

      const expectedPersonasPath = join(projectPath, 'aidlc-docs', workflowId, 'inception', 'user-stories', 'personas.md');
      const expectedStoriesPath = join(projectPath, 'aidlc-docs', workflowId, 'inception', 'user-stories', 'stories.md');
      expect(result.artifacts_generated).toContain(expectedPersonasPath);
      expect(result.artifacts_generated).toContain(expectedStoriesPath);
    });

    it('stories content includes Given/When/Then format', async () => {
      const checkpoint = createMockCheckpoint({ pathway_type: 'greenfield' });

      await executeUserStories(projectPath, workflowId, checkpoint);

      const storiesWriteCall = mockFsWriteFile.mock.calls.find(
        ([path]) => typeof path === 'string' && path.endsWith('stories.md')
      );
      expect(storiesWriteCall).toBeDefined();
      const storiesContent = storiesWriteCall![1] as string;
      expect(storiesContent).toContain('Given');
      expect(storiesContent).toContain('When');
      expect(storiesContent).toContain('Then');
    });

    it('review_summary mentions user stories count', async () => {
      const checkpoint = createMockCheckpoint({ pathway_type: 'greenfield' });

      const result = await executeUserStories(projectPath, workflowId, checkpoint);

      expect(result.review_summary).toMatch(/\d+ user stor/);
    });
  });

  describe('idempotency', () => {
    it('returns completed when stories already exist', async () => {
      mockFsPathExists.mockResolvedValue(true);
      const checkpoint = createMockCheckpoint({ pathway_type: 'greenfield' });

      const result = await executeUserStories(projectPath, workflowId, checkpoint);

      expect(result.status).toBe('completed');
    });

    it('does not write files when stories already exist', async () => {
      mockFsPathExists.mockResolvedValue(true);
      const checkpoint = createMockCheckpoint({ pathway_type: 'greenfield' });

      await executeUserStories(projectPath, workflowId, checkpoint);

      expect(mockFsWriteFile).not.toHaveBeenCalled();
    });

    it('review_summary indicates already generated when idempotent', async () => {
      mockFsPathExists.mockResolvedValue(true);
      const checkpoint = createMockCheckpoint({ pathway_type: 'greenfield' });

      const result = await executeUserStories(projectPath, workflowId, checkpoint);

      expect(result.review_summary).toContain('already generated');
    });
  });

  describe('context file handling', () => {
    it('reads intent.md and requirements.md from inception dir', async () => {
      mockFsPathExists.mockResolvedValue(false);
      mockFsReadFile.mockResolvedValue('some content' as never);
      const checkpoint = createMockCheckpoint({ pathway_type: 'greenfield' });

      await executeUserStories(projectPath, workflowId, checkpoint);

      const intentPath = join(projectPath, 'aidlc-docs', workflowId, 'inception', 'intent.md');
      const requirementsPath = join(projectPath, 'aidlc-docs', workflowId, 'inception', 'requirements', 'requirements.md');
      expect(mockFsReadFile).toHaveBeenCalledWith(intentPath, 'utf-8');
      expect(mockFsReadFile).toHaveBeenCalledWith(requirementsPath, 'utf-8');
    });

    it('handles missing context files gracefully', async () => {
      mockFsPathExists.mockResolvedValue(false);
      mockFsReadFile.mockRejectedValue(new Error('ENOENT'));
      const checkpoint = createMockCheckpoint({ pathway_type: 'greenfield' });

      await expect(executeUserStories(projectPath, workflowId, checkpoint)).resolves.not.toThrow();
    });

    it('still produces plan even when context files are missing', async () => {
      mockFsPathExists.mockResolvedValue(false);
      mockFsReadFile.mockRejectedValue(new Error('ENOENT'));
      const checkpoint = createMockCheckpoint({ pathway_type: 'greenfield' });

      const result = await executeUserStories(projectPath, workflowId, checkpoint);

      expect(result.status).toBe('review_required');
      expect(mockFsWriteFile).toHaveBeenCalled();
    });
  });

  describe('handler registration', () => {
    it('registers handler with orchestrator at module load', () => {
      const wasRegistered = registrationCallsAtLoad.some(
        ([stageName, handler]) =>
          stageName === 'user-stories' && typeof handler === 'function'
      );
      expect(wasRegistered).toBe(true);
    });
  });
});

describe('generateUserStoriesPlan', () => {
  it('includes plan header', () => {
    const result = generateUserStoriesPlan('', '');
    expect(result).toContain('# User Stories Plan');
  });

  it('marks intent as Available when provided', () => {
    const result = generateUserStoriesPlan('some intent', '');
    expect(result).toContain('Intent: Available');
  });

  it('marks intent as Not available when empty', () => {
    const result = generateUserStoriesPlan('', '');
    expect(result).toContain('Intent: Not available');
  });

  it('marks requirements as Available when provided', () => {
    const result = generateUserStoriesPlan('', 'some requirements');
    expect(result).toContain('Requirements: Available');
  });

  it('includes End User persona hint when context mentions user', () => {
    const result = generateUserStoriesPlan('user workflow', '');
    expect(result).toContain('End User');
  });

  it('includes Administrator persona hint when context mentions admin', () => {
    const result = generateUserStoriesPlan('admin panel', '');
    expect(result).toContain('Administrator');
  });

  it('includes Developer persona hint when context mentions developer', () => {
    const result = generateUserStoriesPlan('developer api', '');
    expect(result).toContain('Developer');
  });

  it('falls back to Primary User hint when no persona keywords found', () => {
    const result = generateUserStoriesPlan('', '');
    expect(result).toContain('Primary User');
  });

  it('includes Given/When/Then approach step', () => {
    const result = generateUserStoriesPlan('', '');
    expect(result).toContain('Given/When/Then');
  });
});

describe('generatePersonas', () => {
  it('always includes Primary User section', () => {
    const result = generatePersonas('', '');
    expect(result).toContain('## Primary User');
  });

  it('includes Administrator section when context mentions admin', () => {
    const result = generatePersonas('admin interface', '');
    expect(result).toContain('## Administrator');
  });

  it('does not include Administrator section when context has no admin mention', () => {
    const result = generatePersonas('user workflow', '');
    expect(result).not.toContain('## Administrator');
  });

  it('includes Developer section when context mentions api', () => {
    const result = generatePersonas('rest api integration', '');
    expect(result).toContain('## Developer');
  });

  it('includes Developer section when context mentions developer', () => {
    const result = generatePersonas('developer portal', '');
    expect(result).toContain('## Developer');
  });

  it('does not include Developer section when context has no developer mention', () => {
    const result = generatePersonas('user interface', '');
    expect(result).not.toContain('## Developer');
  });

  it('includes personas header', () => {
    const result = generatePersonas('', '');
    expect(result).toContain('# User Personas');
  });
});

describe('generateStories', () => {
  it('always includes US-001 core feature story', () => {
    const result = generateStories('', '');
    expect(result).toContain('## US-001');
  });

  it('uses Given/When/Then format', () => {
    const result = generateStories('', '');
    expect(result).toContain('Given');
    expect(result).toContain('When');
    expect(result).toContain('Then');
  });

  it('includes error handling story when context mentions error', () => {
    const result = generateStories('error handling required', '');
    expect(result).toContain('## US-002');
    expect(result).toContain('Error Handling');
  });

  it('includes error handling story when context mentions validation', () => {
    const result = generateStories('', 'input validation');
    expect(result).toContain('Error Handling');
  });

  it('does not include error story when no error/validation mention', () => {
    const result = generateStories('', '');
    expect(result).not.toContain('Error Handling');
  });

  it('includes performance story when context mentions performance', () => {
    const result = generateStories('performance requirements', '');
    expect(result).toContain('Performance');
  });

  it('includes performance story when context mentions scalab', () => {
    const result = generateStories('', 'scalable architecture');
    expect(result).toContain('Performance');
  });

  it('uses gherkin code block format', () => {
    const result = generateStories('', '');
    expect(result).toContain('```gherkin');
  });

  it('includes stories header', () => {
    const result = generateStories('', '');
    expect(result).toContain('# User Stories');
  });
});

describe('countStories', () => {
  it('counts zero stories in empty content', () => {
    expect(countStories('')).toBe(0);
  });

  it('counts one story', () => {
    expect(countStories('## US-001: Something')).toBe(1);
  });

  it('counts multiple stories', () => {
    expect(countStories('## US-001: A\n## US-002: B\n## US-003: C')).toBe(3);
  });

  it('does not count non-story headings', () => {
    expect(countStories('## Introduction\n## US-001: Story\n## Summary')).toBe(1);
  });
});

describe('user-stories integration', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(os.tmpdir(), 'user-stories-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes plan to real filesystem on first call (Part 1)', async () => {
    const workflowId = 'test-wf-integration';
    const inceptionDir = join(tmpDir, 'aidlc-docs', workflowId, 'inception');
    mkdirSync(inceptionDir, { recursive: true });
    mkdirSync(join(inceptionDir, 'requirements'), { recursive: true });
    writeFileSync(join(inceptionDir, 'intent.md'), '# Intent\nBuild a user portal', 'utf-8');
    writeFileSync(join(inceptionDir, 'requirements', 'requirements.md'), '# Requirements\nUser authentication and admin dashboard', 'utf-8');

    vi.doUnmock('fs-extra');
    vi.doUnmock('../../features/workflow-engine/inception/orchestrator.js');
    vi.doUnmock('../../features/workflow-engine/checkpoint.js');
    vi.resetModules();

    const { executeUserStories: executeReal } = await import(
      '../../features/workflow-engine/inception/stages/user-stories.js'
    );

    const checkpoint = createMockCheckpoint({ pathway_type: 'greenfield', workflow_id: workflowId });
    const result = await executeReal(tmpDir, workflowId, checkpoint);

    expect(result.status).toBe('review_required');
    expect(existsSync(join(inceptionDir, 'user-stories-plan.md'))).toBe(true);
    expect(existsSync(join(inceptionDir, 'user-stories', 'stories.md'))).toBe(false);
  });

  it('writes personas.md and stories.md on second call (Part 2)', async () => {
    const workflowId = 'test-wf-integration-p2';
    const inceptionDir = join(tmpDir, 'aidlc-docs', workflowId, 'inception');
    mkdirSync(inceptionDir, { recursive: true });
    mkdirSync(join(inceptionDir, 'requirements'), { recursive: true });
    writeFileSync(join(inceptionDir, 'intent.md'), '# Intent\nBuild a user portal', 'utf-8');
    writeFileSync(join(inceptionDir, 'requirements', 'requirements.md'), '# Requirements\nUser authentication', 'utf-8');
    writeFileSync(join(inceptionDir, 'user-stories-plan.md'), '# Plan\nApproved plan', 'utf-8');

    vi.doUnmock('fs-extra');
    vi.doUnmock('../../features/workflow-engine/inception/orchestrator.js');
    vi.doUnmock('../../features/workflow-engine/checkpoint.js');
    vi.resetModules();

    const { executeUserStories: executeReal } = await import(
      '../../features/workflow-engine/inception/stages/user-stories.js'
    );

    const checkpoint = createMockCheckpoint({ pathway_type: 'greenfield', workflow_id: workflowId });
    const result = await executeReal(tmpDir, workflowId, checkpoint);

    expect(result.status).toBe('completed');
    expect(existsSync(join(inceptionDir, 'user-stories', 'personas.md'))).toBe(true);
    expect(existsSync(join(inceptionDir, 'user-stories', 'stories.md'))).toBe(true);
  });

  it('personas.md contains Given/When/Then stories content in stories.md', async () => {
    const workflowId = 'test-wf-integration-p2b';
    const inceptionDir = join(tmpDir, 'aidlc-docs', workflowId, 'inception');
    mkdirSync(inceptionDir, { recursive: true });
    writeFileSync(join(inceptionDir, 'user-stories-plan.md'), '# Plan', 'utf-8');

    vi.doUnmock('fs-extra');
    vi.doUnmock('../../features/workflow-engine/inception/orchestrator.js');
    vi.doUnmock('../../features/workflow-engine/checkpoint.js');
    vi.resetModules();

    const { executeUserStories: executeReal } = await import(
      '../../features/workflow-engine/inception/stages/user-stories.js'
    );

    const checkpoint = createMockCheckpoint({ pathway_type: 'greenfield', workflow_id: workflowId });
    await executeReal(tmpDir, workflowId, checkpoint);

    const { readFileSync } = await import('fs');
    const storiesContent = readFileSync(join(inceptionDir, 'user-stories', 'stories.md'), 'utf-8');
    expect(storiesContent).toContain('Given');
    expect(storiesContent).toContain('When');
    expect(storiesContent).toContain('Then');
  });
});
