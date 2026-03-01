import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs-extra';
import * as path from 'path';
import { generateStateFile, updateStateFile, STATE_FILE_RULES } from '../../features/workflow-engine/state-file.js';
import type { WorkflowCheckpointV3, PhaseState, InceptionStageState } from '../../features/workflow-engine/phase-types.js';

const defaultPhaseState: PhaseState = {
  status: 'not_started',
  started_at: null,
  completed_at: null,
  gate_result: null,
  gate_bypassed: false,
  bypass_reason: null,
};

function makeCheckpoint(overrides: Partial<WorkflowCheckpointV3> = {}): WorkflowCheckpointV3 {
  return {
    schema_version: '3.0.0',
    workflow_id: 'wf-test-001',
    feature_name: 'My Feature',
    current_phase: 'inception',
    current_stage: 'intent',
    status: 'in_progress',
    phases: {
      discovery: { ...defaultPhaseState },
      inception: { ...defaultPhaseState, status: 'in_progress' },
      construction: { ...defaultPhaseState },
      operations: { ...defaultPhaseState },
    },
    manifest_path: 'aidlc-docs/wf-test-001/manifest.json',
    trust_state_path: 'aidlc-docs/wf-test-001/trust.json',
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('generateStateFile', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(process.cwd(), `.test-state-file-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns the expected file path', () => {
    const checkpoint = makeCheckpoint();
    const result = generateStateFile(tmpDir, 'wf-abc', checkpoint);
    const expected = path.join(tmpDir, 'aidlc-docs', 'wf-abc', 'aidlc-state.md');
    expect(result).toBe(expected);
  });

  it('creates the file on disk at the returned path', () => {
    const checkpoint = makeCheckpoint();
    const filePath = generateStateFile(tmpDir, 'wf-create', checkpoint);
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('written content contains the feature name', () => {
    const checkpoint = makeCheckpoint({ feature_name: 'Super Widget' });
    const filePath = generateStateFile(tmpDir, 'wf-name', checkpoint);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('Super Widget');
  });

  it('written content contains the workflow ID', () => {
    const checkpoint = makeCheckpoint();
    const filePath = generateStateFile(tmpDir, 'wf-id-check', checkpoint);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('wf-id-check');
  });

  it('written content contains the current phase', () => {
    const checkpoint = makeCheckpoint({ current_phase: 'construction' });
    const filePath = generateStateFile(tmpDir, 'wf-phase', checkpoint);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('construction');
  });

  it('written content contains the current stage', () => {
    const checkpoint = makeCheckpoint({ current_stage: 'bolt' });
    const filePath = generateStateFile(tmpDir, 'wf-stage', checkpoint);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('bolt');
  });

  it('written content includes pathway_type when set', () => {
    const checkpoint = makeCheckpoint({ pathway_type: 'greenfield' });
    const filePath = generateStateFile(tmpDir, 'wf-pathway', checkpoint);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('greenfield');
  });

  it('written content shows "unknown" pathway when pathway_type is not set', () => {
    const checkpoint = makeCheckpoint();
    delete (checkpoint as any).pathway_type;
    const filePath = generateStateFile(tmpDir, 'wf-no-pathway', checkpoint);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('unknown');
  });

  it('written content includes "## Phase Progress" section', () => {
    const checkpoint = makeCheckpoint();
    const filePath = generateStateFile(tmpDir, 'wf-section', checkpoint);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('## Phase Progress');
  });

  it('written content includes "## Code Location" section', () => {
    const checkpoint = makeCheckpoint();
    const filePath = generateStateFile(tmpDir, 'wf-code-loc', checkpoint);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('## Code Location');
  });

  it('written content contains NEVER warning about aidlc-docs', () => {
    const checkpoint = makeCheckpoint();
    const filePath = generateStateFile(tmpDir, 'wf-warning', checkpoint);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('NEVER in aidlc-docs/');
  });

  it('written content has "**Last Updated**:" field', () => {
    const checkpoint = makeCheckpoint();
    const filePath = generateStateFile(tmpDir, 'wf-updated', checkpoint);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('**Last Updated**:');
  });

  it('creates intermediate directories that do not exist', () => {
    const checkpoint = makeCheckpoint();
    const nestedTmp = path.join(tmpDir, 'sub', 'dir');
    const filePath = generateStateFile(nestedTmp, 'wf-mkdir', checkpoint);
    expect(fs.existsSync(filePath)).toBe(true);
  });
});

describe('buildPhaseProgress (via generateStateFile)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(process.cwd(), `.test-phase-progress-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('marks current_phase as "in progress" with empty checkbox', () => {
    const checkpoint = makeCheckpoint({ current_phase: 'inception' });
    const filePath = generateStateFile(tmpDir, 'wf-inprog', checkpoint);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('- [ ] Inception (in progress)');
  });

  it('marks completed phases with [x] and completed_at timestamp', () => {
    const checkpoint = makeCheckpoint({
      phases: {
        discovery: {
          ...defaultPhaseState,
          status: 'complete',
          completed_at: '2024-06-01T10:00:00.000Z',
        },
        inception: { ...defaultPhaseState, status: 'in_progress' },
        construction: { ...defaultPhaseState },
        operations: { ...defaultPhaseState },
      },
    });
    const filePath = generateStateFile(tmpDir, 'wf-completed', checkpoint);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('- [x] Discovery (completed 2024-06-01T10:00:00.000Z)');
  });

  it('renders not-started phases without a suffix', () => {
    const checkpoint = makeCheckpoint({ current_phase: 'inception' });
    const filePath = generateStateFile(tmpDir, 'wf-notsuffix', checkpoint);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toMatch(/- \[ \] Construction\s*\n/);
    expect(content).toMatch(/- \[ \] Operations\s*\n?/);
  });

  it('renders all four phases in output', () => {
    const checkpoint = makeCheckpoint();
    const filePath = generateStateFile(tmpDir, 'wf-allphases', checkpoint);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('Discovery');
    expect(content).toContain('Inception');
    expect(content).toContain('Construction');
    expect(content).toContain('Operations');
  });

  it('all phases complete: all show [x]', () => {
    const checkpoint = makeCheckpoint({
      current_phase: 'operations',
      phases: {
        discovery: { ...defaultPhaseState, status: 'complete', completed_at: '2024-01-01T00:00:00.000Z' },
        inception: { ...defaultPhaseState, status: 'complete', completed_at: '2024-01-02T00:00:00.000Z' },
        construction: { ...defaultPhaseState, status: 'complete', completed_at: '2024-01-03T00:00:00.000Z' },
        operations: { ...defaultPhaseState, status: 'complete', completed_at: '2024-01-04T00:00:00.000Z' },
      },
    });
    const filePath = generateStateFile(tmpDir, 'wf-allcomplete', checkpoint);
    const content = fs.readFileSync(filePath, 'utf-8');
    const matches = content.match(/- \[x\]/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(4);
  });

  it('no phases complete: none show [x]', () => {
    const checkpoint = makeCheckpoint({ current_phase: 'discovery' });
    const filePath = generateStateFile(tmpDir, 'wf-nonecomplete', checkpoint);
    const content = fs.readFileSync(filePath, 'utf-8');
    const checkedMatches = content.match(/- \[x\]/g) ?? [];
    expect(checkedMatches.length).toBe(0);
  });

  it('phase labels are capitalized (e.g. "Discovery", not "discovery")', () => {
    const checkpoint = makeCheckpoint();
    const filePath = generateStateFile(tmpDir, 'wf-capitalized', checkpoint);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('- [ ] Discovery');
    expect(content).toContain('- [ ] Inception');
  });
});

describe('updateStateFile', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(process.cwd(), `.test-update-state-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeInitialStateFile(workflowId: string, extraLines = ''): string {
    const dir = path.join(tmpDir, 'aidlc-docs', workflowId);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, 'aidlc-state.md');
    const content = `# AIDLC Workflow State
**Last Updated**: 2024-01-01T00:00:00.000Z

## Phase Progress
- [ ] Discovery
- [ ] Inception (in progress)
- [ ] Construction
- [ ] Operations
${extraLines}
`;
    fs.writeFileSync(filePath, content, 'utf-8');
    return filePath;
  }

  it('marks a stage as completed: checkbox becomes [x] and adds timestamp', () => {
    const filePath = writeInitialStateFile('wf-upd-complete');
    updateStateFile(tmpDir, 'wf-upd-complete', 'Inception', 'completed');
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('[x] Inception');
    expect(content).not.toContain('(in progress)');
  });

  it('marks a stage as in_progress: checkbox becomes [ ] and adds ← CURRENT', () => {
    const filePath = writeInitialStateFile('wf-upd-inprog');
    updateStateFile(tmpDir, 'wf-upd-inprog', 'Construction', 'in_progress');
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('[ ] Construction ← CURRENT');
  });

  it('marks a stage as skipped: checkbox becomes [-] and adds (skipped)', () => {
    const filePath = writeInitialStateFile('wf-upd-skipped');
    updateStateFile(tmpDir, 'wf-upd-skipped', 'Discovery', 'skipped');
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('[-] Discovery (skipped)');
  });

  it('updates the **Last Updated** timestamp', () => {
    const filePath = writeInitialStateFile('wf-upd-timestamp');
    const before = '2024-01-01T00:00:00.000Z';
    updateStateFile(tmpDir, 'wf-upd-timestamp', 'Inception', 'completed');
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).not.toContain(before);
    expect(content).toContain('**Last Updated**:');
  });

  it('does not throw when file does not exist (silent error handling)', () => {
    expect(() => {
      updateStateFile(tmpDir, 'wf-nonexistent', 'Inception', 'completed');
    }).not.toThrow();
  });

  it('completed status removes existing (in progress) suffix', () => {
    const filePath = writeInitialStateFile('wf-upd-strip');
    updateStateFile(tmpDir, 'wf-upd-strip', 'Inception', 'completed');
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).not.toContain('(in progress)');
  });

  it('in_progress status strips existing suffix before adding ← CURRENT', () => {
    const dir = path.join(tmpDir, 'aidlc-docs', 'wf-upd-strip2');
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, 'aidlc-state.md');
    fs.writeFileSync(
      filePath,
      `# AIDLC Workflow State\n**Last Updated**: 2024-01-01T00:00:00.000Z\n\n- [ ] Construction (in progress)\n`,
      'utf-8',
    );
    updateStateFile(tmpDir, 'wf-upd-strip2', 'Construction', 'in_progress');
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('Construction ← CURRENT');
    expect(content.match(/← CURRENT/g)?.length).toBe(1);
  });
});

describe('Integration: generateStateFile round-trip', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(process.cwd(), `.test-state-integration-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('file written by generateStateFile is readable and has expected structure', () => {
    const checkpoint = makeCheckpoint({
      feature_name: 'Integration Feature',
      pathway_type: 'brownfield-enhancement',
      current_phase: 'construction',
      current_stage: 'bolt',
    });

    const filePath = generateStateFile(tmpDir, 'wf-integration', checkpoint);
    const content = fs.readFileSync(filePath, 'utf-8');

    expect(content).toContain('# AIDLC Workflow State');
    expect(content).toContain('Integration Feature');
    expect(content).toContain('wf-integration');
    expect(content).toContain('brownfield-enhancement');
    expect(content).toContain('## Phase Progress');
    expect(content).toContain('## Code Location');
  });

  it('generate then update: update modifies the generated file correctly', () => {
    const checkpoint = makeCheckpoint({ current_phase: 'discovery' });
    const filePath = generateStateFile(tmpDir, 'wf-gen-then-upd', checkpoint);
    updateStateFile(tmpDir, 'wf-gen-then-upd', 'Discovery', 'completed');
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('[x] Discovery');
  });

  it('generate creates file in aidlc-docs/{workflowId}/ directory structure', () => {
    const checkpoint = makeCheckpoint();
    generateStateFile(tmpDir, 'wf-dir-structure', checkpoint);

    const expectedDir = path.join(tmpDir, 'aidlc-docs', 'wf-dir-structure');
    expect(fs.existsSync(expectedDir)).toBe(true);
    expect(fs.statSync(expectedDir).isDirectory()).toBe(true);
  });
});

describe('buildPhaseProgress inception sub-stages', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(process.cwd(), `.test-inception-stages-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeInceptionStageState(overrides: Partial<InceptionStageState> = {}): InceptionStageState {
    return {
      stage: 'workspace-detection',
      status: 'not_started',
      started_at: null,
      completed_at: null,
      skip_reason: null,
      artifacts_generated: [],
      questions_file: null,
      answers_received: false,
      ...overrides,
    };
  }

  it('renders inception sub-stages when inception_stages is populated', () => {
    const checkpoint = makeCheckpoint({
      current_phase: 'inception',
      inception_stages: {
        'workspace-detection': makeInceptionStageState({ stage: 'workspace-detection', status: 'completed', completed_at: '2026-02-28T10:00:00.000Z' }),
        'reverse-engineering': makeInceptionStageState({ stage: 'reverse-engineering', status: 'completed', completed_at: '2026-02-28T11:00:00.000Z' }),
        'requirements-analysis': makeInceptionStageState({ stage: 'requirements-analysis', status: 'in_progress' }),
        'user-stories': makeInceptionStageState({ stage: 'user-stories', status: 'not_started' }),
        'workflow-planning': makeInceptionStageState({ stage: 'workflow-planning', status: 'not_started' }),
        'application-design': makeInceptionStageState({ stage: 'application-design', status: 'skipped', skip_reason: 'greenfield' }),
        'units-generation': makeInceptionStageState({ stage: 'units-generation', status: 'not_started' }),
      },
      current_inception_stage: 'requirements-analysis',
    });
    const filePath = generateStateFile(tmpDir, 'wf-substages', checkpoint);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('  - [x] Workspace Detection (completed 2026-02-28T10:00:00.000Z)');
    expect(content).toContain('  - [x] Reverse Engineering (completed 2026-02-28T11:00:00.000Z)');
    expect(content).toContain('  - [ ] Requirements Analysis <- CURRENT');
    expect(content).toContain('  - [ ] User Stories');
    expect(content).toContain('  - [ ] Workflow Planning');
    expect(content).toContain('  - [ ] Application Design (skipped -- greenfield)');
    expect(content).toContain('  - [ ] Units Generation');
  });

  it('does not render inception sub-stages when inception_stages is undefined', () => {
    const checkpoint = makeCheckpoint({ current_phase: 'inception' });
    const filePath = generateStateFile(tmpDir, 'wf-no-substages', checkpoint);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('- [ ] Inception (in progress)');
    expect(content).not.toContain('  - ');
  });

  it('sub-stages appear indented under inception line', () => {
    const checkpoint = makeCheckpoint({
      current_phase: 'inception',
      inception_stages: {
        'workspace-detection': makeInceptionStageState({ stage: 'workspace-detection', status: 'completed', completed_at: '2026-02-28T10:00:00.000Z' }),
        'reverse-engineering': makeInceptionStageState({ stage: 'reverse-engineering' }),
        'requirements-analysis': makeInceptionStageState({ stage: 'requirements-analysis' }),
        'user-stories': makeInceptionStageState({ stage: 'user-stories' }),
        'workflow-planning': makeInceptionStageState({ stage: 'workflow-planning' }),
        'application-design': makeInceptionStageState({ stage: 'application-design' }),
        'units-generation': makeInceptionStageState({ stage: 'units-generation' }),
      },
      current_inception_stage: 'workspace-detection',
    });
    const filePath = generateStateFile(tmpDir, 'wf-indent', checkpoint);
    const content = fs.readFileSync(filePath, 'utf-8');
    const inceptionIdx = content.indexOf('- [ ] Inception');
    const subStageIdx = content.indexOf('  - [x] Workspace Detection');
    expect(inceptionIdx).toBeGreaterThan(-1);
    expect(subStageIdx).toBeGreaterThan(inceptionIdx);
  });

  it('skipped stages show (skipped -- reason) suffix', () => {
    const checkpoint = makeCheckpoint({
      current_phase: 'inception',
      inception_stages: {
        'workspace-detection': makeInceptionStageState({ stage: 'workspace-detection' }),
        'reverse-engineering': makeInceptionStageState({ stage: 'reverse-engineering' }),
        'requirements-analysis': makeInceptionStageState({ stage: 'requirements-analysis' }),
        'user-stories': makeInceptionStageState({ stage: 'user-stories' }),
        'workflow-planning': makeInceptionStageState({ stage: 'workflow-planning' }),
        'application-design': makeInceptionStageState({ stage: 'application-design', status: 'skipped', skip_reason: 'brownfield' }),
        'units-generation': makeInceptionStageState({ stage: 'units-generation', status: 'skipped', skip_reason: 'no units needed' }),
      },
    });
    const filePath = generateStateFile(tmpDir, 'wf-skipped', checkpoint);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('(skipped -- brownfield)');
    expect(content).toContain('(skipped -- no units needed)');
  });

  it('skipped stage with null skip_reason shows (skipped) without dash', () => {
    const checkpoint = makeCheckpoint({
      current_phase: 'inception',
      inception_stages: {
        'workspace-detection': makeInceptionStageState({ stage: 'workspace-detection' }),
        'reverse-engineering': makeInceptionStageState({ stage: 'reverse-engineering' }),
        'requirements-analysis': makeInceptionStageState({ stage: 'requirements-analysis' }),
        'user-stories': makeInceptionStageState({ stage: 'user-stories' }),
        'workflow-planning': makeInceptionStageState({ stage: 'workflow-planning' }),
        'application-design': makeInceptionStageState({ stage: 'application-design', status: 'skipped', skip_reason: null }),
        'units-generation': makeInceptionStageState({ stage: 'units-generation' }),
      },
    });
    const filePath = generateStateFile(tmpDir, 'wf-skipped-noreason', checkpoint);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('  - [ ] Application Design (skipped)');
  });

  it('current inception stage marker only appears once', () => {
    const checkpoint = makeCheckpoint({
      current_phase: 'inception',
      inception_stages: {
        'workspace-detection': makeInceptionStageState({ stage: 'workspace-detection', status: 'completed', completed_at: '2026-02-28T10:00:00.000Z' }),
        'reverse-engineering': makeInceptionStageState({ stage: 'reverse-engineering', status: 'in_progress' }),
        'requirements-analysis': makeInceptionStageState({ stage: 'requirements-analysis' }),
        'user-stories': makeInceptionStageState({ stage: 'user-stories' }),
        'workflow-planning': makeInceptionStageState({ stage: 'workflow-planning' }),
        'application-design': makeInceptionStageState({ stage: 'application-design' }),
        'units-generation': makeInceptionStageState({ stage: 'units-generation' }),
      },
      current_inception_stage: 'reverse-engineering',
    });
    const filePath = generateStateFile(tmpDir, 'wf-current-once', checkpoint);
    const content = fs.readFileSync(filePath, 'utf-8');
    const matches = content.match(/<- CURRENT/g) ?? [];
    expect(matches.length).toBe(1);
    expect(content).toContain('  - [ ] Reverse Engineering <- CURRENT');
  });

  it('stage names are converted to Title Case', () => {
    const checkpoint = makeCheckpoint({
      current_phase: 'inception',
      inception_stages: {
        'workspace-detection': makeInceptionStageState({ stage: 'workspace-detection' }),
        'reverse-engineering': makeInceptionStageState({ stage: 'reverse-engineering' }),
        'requirements-analysis': makeInceptionStageState({ stage: 'requirements-analysis' }),
        'user-stories': makeInceptionStageState({ stage: 'user-stories' }),
        'workflow-planning': makeInceptionStageState({ stage: 'workflow-planning' }),
        'application-design': makeInceptionStageState({ stage: 'application-design' }),
        'units-generation': makeInceptionStageState({ stage: 'units-generation' }),
      },
    });
    const filePath = generateStateFile(tmpDir, 'wf-titlecase', checkpoint);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('Workspace Detection');
    expect(content).toContain('Reverse Engineering');
    expect(content).toContain('Requirements Analysis');
    expect(content).toContain('User Stories');
    expect(content).toContain('Workflow Planning');
    expect(content).toContain('Application Design');
    expect(content).toContain('Units Generation');
  });

  it('other phases are not affected when inception_stages is populated', () => {
    const checkpoint = makeCheckpoint({
      current_phase: 'inception',
      phases: {
        discovery: { ...defaultPhaseState, status: 'complete', completed_at: '2026-02-27T09:00:00.000Z' },
        inception: { ...defaultPhaseState, status: 'in_progress' },
        construction: { ...defaultPhaseState },
        operations: { ...defaultPhaseState },
      },
      inception_stages: {
        'workspace-detection': makeInceptionStageState({ stage: 'workspace-detection', status: 'completed', completed_at: '2026-02-28T10:00:00.000Z' }),
        'reverse-engineering': makeInceptionStageState({ stage: 'reverse-engineering' }),
        'requirements-analysis': makeInceptionStageState({ stage: 'requirements-analysis' }),
        'user-stories': makeInceptionStageState({ stage: 'user-stories' }),
        'workflow-planning': makeInceptionStageState({ stage: 'workflow-planning' }),
        'application-design': makeInceptionStageState({ stage: 'application-design' }),
        'units-generation': makeInceptionStageState({ stage: 'units-generation' }),
      },
    });
    const filePath = generateStateFile(tmpDir, 'wf-other-phases', checkpoint);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('- [x] Discovery (completed 2026-02-27T09:00:00.000Z)');
    expect(content).toContain('- [ ] Inception (in progress)');
    expect(content).toContain('- [ ] Construction');
    expect(content).toContain('- [ ] Operations');
  });
});

describe('STATE_FILE_RULES', () => {
  it('is a non-empty string', () => {
    expect(typeof STATE_FILE_RULES).toBe('string');
    expect(STATE_FILE_RULES.length).toBeGreaterThan(0);
  });

  it('contains the "State File Tracking Rules" heading', () => {
    expect(STATE_FILE_RULES).toContain('State File Tracking Rules');
  });

  it('mentions aidlc-state.md', () => {
    expect(STATE_FILE_RULES).toContain('aidlc-state.md');
  });
});
