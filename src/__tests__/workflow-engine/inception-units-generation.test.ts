import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
  saveCheckpoint: vi.fn(),
  invalidateCache: vi.fn(),
}));

vi.mock('../../features/workflow-engine/inception/orchestrator.js', () => ({
  registerStageHandler: vi.fn(),
}));

import * as fsExtra from 'fs-extra';
import { join } from 'path';
import { registerStageHandler } from '../../features/workflow-engine/inception/orchestrator.js';
import {
  executeUnitsGeneration,
  generateUnitDefinitions,
  generateUnitDependencies,
  generateStoryMap,
  parseComponentNames,
  extractUnitIds,
  extractStoryIds,
  countUnits,
} from '../../features/workflow-engine/inception/stages/units-generation.js';
import type { WorkflowCheckpointV3, InceptionStage, InceptionStageState } from '../../features/workflow-engine/phase-types.js';

const mockFsEnsureDir = vi.mocked(fsExtra.ensureDir);
const mockFsReadFile = vi.mocked(fsExtra.readFile);
const mockFsWriteFile = vi.mocked(fsExtra.writeFile);
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
    depth_score: 18,
    inception_stages,
    ...overrides,
  };
}

const COMPONENTS_MD = `# Components

| Name | Type | Responsibility | Methods |
|------|------|----------------|---------|
| AuthService | service | Authentication | login(), logout() |
| UserStore | data | User data | getUser(), saveUser() |`;

const STORIES_MD = `# User Stories

## US-001: Core Feature Usage

**As a** Primary User
**I want to** use the core feature
**So that** I can accomplish my primary goal

## US-002: Error Handling

**As a** Primary User
**I want to** receive clear error messages
**So that** I can correct my input`;

const projectPath = '/test/project';
const workflowId = 'test-wf';

describe('executeUnitsGeneration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFsEnsureDir.mockResolvedValue(undefined);
    mockFsReadFile.mockRejectedValue(new Error('not found'));
    mockFsWriteFile.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('depth-based skipping', () => {
    it('skips for minimal depth (depth_score <= 12)', async () => {
      const checkpoint = createMockCheckpoint({ depth_score: 10 });

      const result = await executeUnitsGeneration(projectPath, workflowId, checkpoint);

      expect(result.status).toBe('skipped');
      expect(result.stage).toBe('units-generation');
      expect(result.artifacts_generated).toHaveLength(0);
      expect(mockFsWriteFile).not.toHaveBeenCalled();
    });

    it('skips when depth_score is exactly 12', async () => {
      const checkpoint = createMockCheckpoint({ depth_score: 12 });

      const result = await executeUnitsGeneration(projectPath, workflowId, checkpoint);

      expect(result.status).toBe('skipped');
    });

    it('includes minimal depth reason in review_summary when skipped', async () => {
      const checkpoint = createMockCheckpoint({ depth_score: 10 });

      const result = await executeUnitsGeneration(projectPath, workflowId, checkpoint);

      expect(result.review_summary).toContain('minimal depth');
    });

    it('executes for standard depth (depth_score 13–24)', async () => {
      const checkpoint = createMockCheckpoint({ depth_score: 18 });

      const result = await executeUnitsGeneration(projectPath, workflowId, checkpoint);

      expect(result.status).toBe('review_required');
      expect(result.stage).toBe('units-generation');
    });

    it('executes for comprehensive depth (depth_score > 24)', async () => {
      const checkpoint = createMockCheckpoint({ depth_score: 30 });

      const result = await executeUnitsGeneration(projectPath, workflowId, checkpoint);

      expect(result.status).toBe('review_required');
      expect(result.stage).toBe('units-generation');
    });

    it('defaults missing depth_score to 18 (standard) and executes', async () => {
      const checkpoint = createMockCheckpoint({ depth_score: undefined });

      const result = await executeUnitsGeneration(projectPath, workflowId, checkpoint);

      expect(result.status).toBe('review_required');
    });
  });

  describe('artifact file generation', () => {
    it('generates unit-of-work.md at the correct path', async () => {
      const checkpoint = createMockCheckpoint({ depth_score: 18 });

      await executeUnitsGeneration(projectPath, workflowId, checkpoint);

      const expectedPath = join(projectPath, 'aidlc-docs', workflowId, 'inception', 'units', 'unit-of-work.md');
      const writeCall = vi.mocked(mockFsWriteFile).mock.calls.find(
        ([path]) => path === expectedPath
      );
      expect(writeCall).toBeDefined();
    });

    it('generates unit-of-work-dependency.md at the correct path', async () => {
      const checkpoint = createMockCheckpoint({ depth_score: 18 });

      await executeUnitsGeneration(projectPath, workflowId, checkpoint);

      const expectedPath = join(projectPath, 'aidlc-docs', workflowId, 'inception', 'units', 'unit-of-work-dependency.md');
      const writeCall = vi.mocked(mockFsWriteFile).mock.calls.find(
        ([path]) => path === expectedPath
      );
      expect(writeCall).toBeDefined();
    });

    it('generates unit-of-work-story-map.md at the correct path', async () => {
      const checkpoint = createMockCheckpoint({ depth_score: 18 });

      await executeUnitsGeneration(projectPath, workflowId, checkpoint);

      const expectedPath = join(projectPath, 'aidlc-docs', workflowId, 'inception', 'units', 'unit-of-work-story-map.md');
      const writeCall = vi.mocked(mockFsWriteFile).mock.calls.find(
        ([path]) => path === expectedPath
      );
      expect(writeCall).toBeDefined();
    });

    it('returns all 3 artifact paths in artifacts_generated', async () => {
      const checkpoint = createMockCheckpoint({ depth_score: 18 });

      const result = await executeUnitsGeneration(projectPath, workflowId, checkpoint);

      expect(result.artifacts_generated).toHaveLength(3);
      expect(result.artifacts_generated.some(p => p.endsWith('unit-of-work.md'))).toBe(true);
      expect(result.artifacts_generated.some(p => p.endsWith('unit-of-work-dependency.md'))).toBe(true);
      expect(result.artifacts_generated.some(p => p.endsWith('unit-of-work-story-map.md'))).toBe(true);
    });
  });

  describe('result shape', () => {
    it('returns review_required status for standard depth', async () => {
      const checkpoint = createMockCheckpoint({ depth_score: 18 });

      const result = await executeUnitsGeneration(projectPath, workflowId, checkpoint);

      expect(result.status).toBe('review_required');
    });

    it('sets requires_approval to true', async () => {
      const checkpoint = createMockCheckpoint({ depth_score: 18 });

      const result = await executeUnitsGeneration(projectPath, workflowId, checkpoint);

      expect(result.requires_approval).toBe(true);
    });

    it('includes REVIEW REQUIRED in review_summary', async () => {
      const checkpoint = createMockCheckpoint({ depth_score: 18 });

      const result = await executeUnitsGeneration(projectPath, workflowId, checkpoint);

      expect(result.review_summary).toContain('REVIEW REQUIRED');
    });

    it('includes unit count in review_summary', async () => {
      const checkpoint = createMockCheckpoint({ depth_score: 18 });

      const result = await executeUnitsGeneration(projectPath, workflowId, checkpoint);

      // Default single unit when no components
      expect(result.review_summary).toContain('1 units defined');
    });

    it("includes WHAT'S NEXT in whats_next", async () => {
      const checkpoint = createMockCheckpoint({ depth_score: 18 });

      const result = await executeUnitsGeneration(projectPath, workflowId, checkpoint);

      expect(result.whats_next).toContain("WHAT'S NEXT");
    });

    it('includes construction phase mention in whats_next', async () => {
      const checkpoint = createMockCheckpoint({ depth_score: 18 });

      const result = await executeUnitsGeneration(projectPath, workflowId, checkpoint);

      expect(result.whats_next).toContain('construction phase');
    });
  });

  describe('reads context files', () => {
    it('attempts to read intent.md', async () => {
      const checkpoint = createMockCheckpoint({ depth_score: 18 });

      await executeUnitsGeneration(projectPath, workflowId, checkpoint);

      const intentPath = join(projectPath, 'aidlc-docs', workflowId, 'inception', 'intent.md');
      expect(mockFsReadFile).toHaveBeenCalledWith(intentPath, 'utf-8');
    });

    it('attempts to read requirements.md', async () => {
      const checkpoint = createMockCheckpoint({ depth_score: 18 });

      await executeUnitsGeneration(projectPath, workflowId, checkpoint);

      const reqPath = join(projectPath, 'aidlc-docs', workflowId, 'inception', 'requirements', 'requirements.md');
      expect(mockFsReadFile).toHaveBeenCalledWith(reqPath, 'utf-8');
    });

    it('attempts to read stories.md', async () => {
      const checkpoint = createMockCheckpoint({ depth_score: 18 });

      await executeUnitsGeneration(projectPath, workflowId, checkpoint);

      const storiesPath = join(projectPath, 'aidlc-docs', workflowId, 'inception', 'user-stories', 'stories.md');
      expect(mockFsReadFile).toHaveBeenCalledWith(storiesPath, 'utf-8');
    });

    it('attempts to read application-design/components.md', async () => {
      const checkpoint = createMockCheckpoint({ depth_score: 18 });

      await executeUnitsGeneration(projectPath, workflowId, checkpoint);

      const componentsPath = join(projectPath, 'aidlc-docs', workflowId, 'inception', 'application-design', 'components.md');
      expect(mockFsReadFile).toHaveBeenCalledWith(componentsPath, 'utf-8');
    });

    it('handles missing context files gracefully (no throw)', async () => {
      const checkpoint = createMockCheckpoint({ depth_score: 18 });
      mockFsReadFile.mockRejectedValue(new Error('ENOENT: no such file'));

      await expect(executeUnitsGeneration(projectPath, workflowId, checkpoint)).resolves.not.toThrow();
    });
  });

  describe('unit definitions derived from components', () => {
    it('creates units from application design components when available', async () => {
      const checkpoint = createMockCheckpoint({ depth_score: 18 });

      mockFsReadFile.mockImplementation((filePath: unknown) => {
        const p = filePath as string;
        if (p.endsWith('components.md')) {
          return Promise.resolve(COMPONENTS_MD) as any;
        }
        return Promise.reject(new Error('not found'));
      });

      const result = await executeUnitsGeneration(projectPath, workflowId, checkpoint);

      expect(result.review_summary).toContain('2 units defined');
    });

    it('creates default unit when no components available', async () => {
      const checkpoint = createMockCheckpoint({ depth_score: 18 });
      mockFsReadFile.mockRejectedValue(new Error('not found'));

      const result = await executeUnitsGeneration(projectPath, workflowId, checkpoint);

      expect(result.review_summary).toContain('1 units defined');
    });

    it('writes unit-of-work.md content containing UNIT- IDs', async () => {
      const checkpoint = createMockCheckpoint({ depth_score: 18 });
      mockFsReadFile.mockImplementation((filePath: unknown) => {
        const p = filePath as string;
        if (p.endsWith('components.md')) return Promise.resolve(COMPONENTS_MD) as any;
        return Promise.reject(new Error('not found'));
      });

      await executeUnitsGeneration(projectPath, workflowId, checkpoint);

      const unitWriteCall = mockFsWriteFile.mock.calls.find(
        ([path]) => (path as string).endsWith('unit-of-work.md')
      );
      expect(unitWriteCall).toBeDefined();
      const content = unitWriteCall![1] as string;
      expect(content).toContain('UNIT-001');
      expect(content).toContain('AuthService');
    });
  });

  describe('story mapping', () => {
    it('traces user stories to units in story map', async () => {
      const checkpoint = createMockCheckpoint({ depth_score: 18 });
      mockFsReadFile.mockImplementation((filePath: unknown) => {
        const p = filePath as string;
        if (p.endsWith('stories.md')) return Promise.resolve(STORIES_MD) as any;
        return Promise.reject(new Error('not found'));
      });

      await executeUnitsGeneration(projectPath, workflowId, checkpoint);

      const storyMapWriteCall = mockFsWriteFile.mock.calls.find(
        ([path]) => (path as string).endsWith('unit-of-work-story-map.md')
      );
      expect(storyMapWriteCall).toBeDefined();
      const content = storyMapWriteCall![1] as string;
      expect(content).toContain('US-001');
      expect(content).toContain('US-002');
    });
  });
});

describe('generateUnitDefinitions', () => {
  it('creates UNIT-001 default when no components content', () => {
    const result = generateUnitDefinitions('', '', '');
    expect(result).toContain('UNIT-001');
    expect(result).toContain('Core Implementation');
  });

  it('creates units from component table rows', () => {
    const result = generateUnitDefinitions('', '', COMPONENTS_MD);
    expect(result).toContain('UNIT-001');
    expect(result).toContain('AuthService');
    expect(result).toContain('UNIT-002');
    expect(result).toContain('UserStore');
  });

  it('pads unit IDs with leading zeros', () => {
    const result = generateUnitDefinitions('', '', COMPONENTS_MD);
    expect(result).toContain('UNIT-001');
    expect(result).toContain('UNIT-002');
  });

  it('includes scope, effort, dependencies, and status fields per unit', () => {
    const result = generateUnitDefinitions('', '', COMPONENTS_MD);
    expect(result).toContain('Scope');
    expect(result).toContain('Estimated Effort');
    expect(result).toContain('Dependencies');
    expect(result).toContain('Status');
  });

  it('includes Generated timestamp header', () => {
    const result = generateUnitDefinitions('', '', '');
    expect(result).toContain('Generated:');
  });
});

describe('generateUnitDependencies', () => {
  it('generates mermaid graph TD block', () => {
    const unitDefs = generateUnitDefinitions('', '', COMPONENTS_MD);
    const result = generateUnitDependencies(unitDefs);
    expect(result).toContain('```mermaid');
    expect(result).toContain('graph TD');
  });

  it('expresses DAG with --> for multi-unit dependency', () => {
    const unitDefs = generateUnitDefinitions('', '', COMPONENTS_MD);
    const result = generateUnitDependencies(unitDefs);
    expect(result).toContain('UNIT-001 --> UNIT-002');
  });

  it('generates dependency matrix table for multiple units', () => {
    const unitDefs = generateUnitDefinitions('', '', COMPONENTS_MD);
    const result = generateUnitDependencies(unitDefs);
    expect(result).toContain('| Unit | Depends On | Blocks |');
    expect(result).toContain('UNIT-001');
    expect(result).toContain('UNIT-002');
  });

  it('notes no inter-unit dependencies for single unit', () => {
    const unitDefs = generateUnitDefinitions('', '', '');
    const result = generateUnitDependencies(unitDefs);
    expect(result).toContain('No inter-unit dependencies');
  });

  it('renders single node in mermaid for single unit', () => {
    const unitDefs = generateUnitDefinitions('', '', '');
    const result = generateUnitDependencies(unitDefs);
    expect(result).toContain('UNIT-001');
  });
});

describe('generateStoryMap', () => {
  it('maps user stories to units in mapping table', () => {
    const unitDefs = generateUnitDefinitions('', '', COMPONENTS_MD);
    const result = generateStoryMap(unitDefs, STORIES_MD);
    expect(result).toContain('US-001');
    expect(result).toContain('UNIT-001');
  });

  it('includes traceability section', () => {
    const unitDefs = generateUnitDefinitions('', '', COMPONENTS_MD);
    const result = generateStoryMap(unitDefs, STORIES_MD);
    expect(result).toContain('Traceability');
    expect(result).toContain('Total stories');
  });

  it('shows no stories available when stories content is empty', () => {
    const unitDefs = generateUnitDefinitions('', '', '');
    const result = generateStoryMap(unitDefs, '');
    expect(result).toContain('No user stories available');
  });

  it('marks stories as Mapped when assigned to units', () => {
    const unitDefs = generateUnitDefinitions('', '', COMPONENTS_MD);
    const result = generateStoryMap(unitDefs, STORIES_MD);
    expect(result).toContain('Mapped');
  });
});

describe('parseComponentNames', () => {
  it('returns empty array for empty string', () => {
    expect(parseComponentNames('')).toEqual([]);
  });

  it('extracts component names from markdown table', () => {
    const names = parseComponentNames(COMPONENTS_MD);
    expect(names).toContain('AuthService');
    expect(names).toContain('UserStore');
  });

  it('returns names in order they appear in table', () => {
    const names = parseComponentNames(COMPONENTS_MD);
    expect(names[0]).toBe('AuthService');
    expect(names[1]).toBe('UserStore');
  });
});

describe('extractUnitIds', () => {
  it('extracts UNIT-NNN IDs from content', () => {
    const content = '## UNIT-001: Foo\n\n## UNIT-002: Bar\n';
    expect(extractUnitIds(content)).toEqual(['UNIT-001', 'UNIT-002']);
  });

  it('returns empty array when no UNIT- IDs found', () => {
    expect(extractUnitIds('no units here')).toEqual([]);
  });
});

describe('extractStoryIds', () => {
  it('extracts US-NNN IDs from stories content', () => {
    const ids = extractStoryIds(STORIES_MD);
    expect(ids).toContain('US-001');
    expect(ids).toContain('US-002');
  });

  it('returns empty array for empty content', () => {
    expect(extractStoryIds('')).toEqual([]);
  });
});

describe('countUnits', () => {
  it('returns 1 for default single-unit content', () => {
    const content = generateUnitDefinitions('', '', '');
    expect(countUnits(content)).toBe(1);
  });

  it('returns 2 for two-component content', () => {
    const content = generateUnitDefinitions('', '', COMPONENTS_MD);
    expect(countUnits(content)).toBe(2);
  });
});

describe('handler registration', () => {
  it('registers handler with orchestrator at module load', () => {
    const wasRegistered = registrationCallsAtLoad.some(
      ([stageName, handler]) =>
        stageName === 'units-generation' && typeof handler === 'function'
    );
    expect(wasRegistered).toBe(true);
  });
});
