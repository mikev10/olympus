import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  getRequiredSections,
  buildFeatureDocPrompt,
  writeFeatureDoc,
  generateFeatureDocScaffold,
  generateDocumentation,
} from '../../../features/workflow-engine/construction/documentation-generator.js';
import { ConstructionExecutor } from '../../../features/workflow-engine/construction/executor.js';

const TEST_DIR = path.join(process.cwd(), '.test-documentation-generator');

function makeOptions(overrides: Partial<Parameters<typeof generateDocumentation>[0]> = {}) {
  return {
    unitId: 'UNIT-001',
    workflowId: 'wf-test',
    projectPath: TEST_DIR,
    depth: 'standard' as const,
    pathway: 'brownfield-enhancement',
    ...overrides,
  };
}

afterEach(() => {
  fs.rmSync(TEST_DIR, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('getRequiredSections', () => {
  it('returns 9 sections for standard depth', () => {
    const sections = getRequiredSections('standard', 'brownfield-enhancement');
    expect(sections).toHaveLength(9);
    expect(sections[0]).toBe('Summary');
  });

  it('returns 9 sections for comprehensive depth', () => {
    const sections = getRequiredSections('comprehensive', 'brownfield-enhancement');
    expect(sections).toHaveLength(9);
  });

  it('returns 3 sections for minimal depth', () => {
    const sections = getRequiredSections('minimal', 'brownfield-enhancement');
    expect(sections).toHaveLength(3);
    expect(sections).toEqual(['Summary', 'Architecture Decisions', 'API Contracts']);
  });

  it('returns 1 section for bugfix pathway', () => {
    const sections = getRequiredSections('standard', 'bugfix');
    expect(sections).toHaveLength(1);
    expect(sections[0]).toBe('Summary');
  });

  it('returns 1 section for unknown/shallow depth', () => {
    const sections = getRequiredSections('shallow', 'brownfield-enhancement');
    expect(sections).toHaveLength(1);
    expect(sections[0]).toBe('Summary');
  });
});

describe('buildFeatureDocPrompt', () => {
  it('includes unit context in the prompt', () => {
    const prompt = buildFeatureDocPrompt(makeOptions({ unitId: 'u-auth' }));
    expect(prompt).toContain('u-auth');
    expect(prompt).toContain('wf-test');
  });

  it('includes required sections in the prompt', () => {
    const prompt = buildFeatureDocPrompt(makeOptions({ depth: 'minimal' }));
    expect(prompt).toContain('Summary');
    expect(prompt).toContain('Architecture Decisions');
    expect(prompt).toContain('API Contracts');
  });

  it('includes unit files when provided', () => {
    const prompt = buildFeatureDocPrompt(makeOptions({ unitFiles: ['src/foo.ts', 'src/bar.ts'] }));
    expect(prompt).toContain('src/foo.ts');
    expect(prompt).toContain('src/bar.ts');
  });

  it('shows no-files message when unitFiles is empty', () => {
    const prompt = buildFeatureDocPrompt(makeOptions({ unitFiles: [] }));
    expect(prompt).toContain('no unit files provided');
  });

  it('includes test results summary when provided', () => {
    const prompt = buildFeatureDocPrompt(
      makeOptions({ testResults: { total: 10, passed: 8, failed: 2 } })
    );
    expect(prompt).toContain('10 total');
    expect(prompt).toContain('8 passed');
    expect(prompt).toContain('2 failed');
  });
});

describe('writeFeatureDoc', () => {
  it('creates the file with YAML frontmatter', () => {
    const outputDir = path.join(TEST_DIR, 'unit-out');
    fs.mkdirSync(outputDir, { recursive: true });

    const filePath = writeFeatureDoc('# Content\n', {
      unitId: 'UNIT-001',
      workflowId: 'wf-test',
      depth: 'standard',
      pathway: 'brownfield-enhancement',
      sections: ['Summary', 'API Contracts'],
      outputDir,
    });

    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('unit: UNIT-001');
    expect(content).toContain('workflow: wf-test');
    expect(content).toContain('depth: standard');
    expect(content).toContain('pathway: brownfield-enhancement');
    expect(content).toContain('generated_at:');
    expect(content).toContain('sections: [Summary, API Contracts]');
    expect(content).toContain('recreation_readiness_score: null');
    expect(content).toContain('# Content');
  });

  it('creates documentation subdirectory automatically', () => {
    const outputDir = path.join(TEST_DIR, 'auto-dir-test');
    const filePath = writeFeatureDoc('', {
      unitId: 'UNIT-001',
      workflowId: 'wf-test',
      depth: 'minimal',
      pathway: 'bugfix',
      sections: ['Summary'],
      outputDir,
    });

    expect(filePath).toContain('documentation');
    expect(filePath).toContain('feature-doc.md');
  });
});

describe('generateFeatureDocScaffold', () => {
  it('creates scaffold with all required sections', () => {
    const scaffold = generateFeatureDocScaffold(makeOptions({ depth: 'standard' }));
    const requiredSections = [
      'Summary', 'Architecture Decisions', 'API Contracts',
      'Data Models', 'Configuration Changes', 'Dependencies',
      'Known Limitations', 'How to Test', 'Recreation Notes',
    ];
    for (const section of requiredSections) {
      expect(scaffold).toContain(`## ${section}`);
    }
  });

  it('includes unit id in title', () => {
    const scaffold = generateFeatureDocScaffold(makeOptions({ unitId: 'u-payments' }));
    expect(scaffold).toContain('u-payments');
  });

  it('includes test results section when testResults provided', () => {
    const scaffold = generateFeatureDocScaffold(
      makeOptions({ testResults: { total: 5, passed: 5, failed: 0 } })
    );
    expect(scaffold).toContain('## Test Results');
    expect(scaffold).toContain('Total: 5');
    expect(scaffold).toContain('Passed: 5');
    expect(scaffold).toContain('Failed: 0');
  });

  it('omits test results section when no testResults provided', () => {
    const scaffold = generateFeatureDocScaffold(makeOptions());
    expect(scaffold).not.toContain('## Test Results');
  });

  it('has only 1 section for bugfix pathway', () => {
    const scaffold = generateFeatureDocScaffold(makeOptions({ pathway: 'bugfix' }));
    const headings = scaffold.match(/^## /gm);
    expect(headings).toHaveLength(1);
  });
});

describe('generateDocumentation', () => {
  it('returns completed status and creates output file', () => {
    const result = generateDocumentation(makeOptions());
    expect(result.status).toBe('completed');
    expect(result.path).not.toBeNull();
    expect(fs.existsSync(result.path!)).toBe(true);
  });

  it('creates the output in the correct directory path', () => {
    const result = generateDocumentation(makeOptions());
    expect(result.path).toContain('aidlc-docs');
    expect(result.path).toContain('wf-test');
    expect(result.path).toContain('UNIT-001');
    expect(result.path).toContain('documentation');
    expect(result.path).toContain('feature-doc.md');
  });

  it('returns sections in result', () => {
    const result = generateDocumentation(makeOptions({ depth: 'minimal' }));
    expect(result.sections).toHaveLength(3);
  });

  it('section count varies correctly by depth', () => {
    const minimal = generateDocumentation(makeOptions({ depth: 'minimal' }));
    const standard = generateDocumentation(makeOptions({ depth: 'standard', unitId: 'UNIT-002' }));
    const comprehensive = generateDocumentation(makeOptions({ depth: 'comprehensive', unitId: 'UNIT-003' }));

    expect(minimal.sections).toHaveLength(3);
    expect(standard.sections).toHaveLength(9);
    expect(comprehensive.sections).toHaveLength(9);
  });

  it('returns failed status on write error', () => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
    const blockingFile = path.join(TEST_DIR, 'aidlc-docs');
    fs.writeFileSync(blockingFile, 'I am a file, not a directory');
    const result = generateDocumentation(makeOptions());
    expect(result.status).toBe('failed');
    expect(result.path).toBeNull();
    expect(result.error).toBeDefined();
  });

  it('YAML frontmatter includes all required fields', () => {
    const result = generateDocumentation(makeOptions());
    const content = fs.readFileSync(result.path!, 'utf-8');
    expect(content).toMatch(/^---\n/);
    expect(content).toContain('unit:');
    expect(content).toContain('workflow:');
    expect(content).toContain('depth:');
    expect(content).toContain('pathway:');
    expect(content).toContain('generated_at:');
    expect(content).toContain('sections:');
    expect(content).toContain('recreation_readiness_score: null');
  });
});

describe('ConstructionExecutor.executeDocumentationGeneration', () => {
  it('returns a completed featureDoc result', async () => {
    const executor = new ConstructionExecutor(TEST_DIR, 'wf-exec-test');
    const result = await executor.executeDocumentationGeneration('UNIT-001');
    expect(result.featureDoc.status).toBe('completed');
    expect(result.featureDoc.path).not.toBeNull();
    expect(result.featureDoc.sections.length).toBeGreaterThan(0);
  });

  it('uses projectPath and workflowId overrides', async () => {
    const executor = new ConstructionExecutor('/wrong/path', 'wrong-wf');
    const result = await executor.executeDocumentationGeneration('UNIT-001', {
      projectPath: TEST_DIR,
      workflowId: 'wf-override',
    });
    expect(result.featureDoc.status).toBe('completed');
    expect(result.featureDoc.path).toContain('wf-override');
  });

  it('updates checkpoint when unit progress exists', async () => {
    const { saveCheckpoint } = await import('../../../features/workflow-engine/checkpoint.js');

    const checkpoint: any = {
      schema_version: '3.0.0',
      workflow_id: 'wf-cp-test',
      feature_name: 'test',
      current_phase: 'construction',
      current_stage: 'code-generation',
      status: 'in_progress',
      phases: {},
      manifest_path: '',
      trust_state_path: '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      construction_units: {
        'u-cp': {
          unitId: 'u-cp',
          stages: {
            'functional-design': { status: 'not_started', artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
            'nfr-requirements': { status: 'not_started', artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
            'nfr-design': { status: 'not_started', artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
            'infrastructure-design': { status: 'not_started', artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
            'code-generation': { status: 'not_started', artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
            'test-generation': { status: 'not_started', artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
          },
          code_plan_path: null,
          code_generation_status: 'not_started',
          tests_total: 0,
          tests_passed: 0,
          tests_failed: 0,
          test_framework: 'unknown',
          test_generation_status: 'not_started',
          feature_doc_status: 'not_started',
          feature_doc_path: null,
        },
      },
    };

    await saveCheckpoint(TEST_DIR, checkpoint);

    const executor = new ConstructionExecutor(TEST_DIR, 'wf-cp-test');
    const result = await executor.executeDocumentationGeneration('u-cp');

    expect(result.featureDoc.status).toBe('completed');

    const { loadCheckpoint } = await import('../../../features/workflow-engine/checkpoint.js');
    const loaded = await loadCheckpoint(TEST_DIR, 'wf-cp-test');
    expect(loaded?.construction_units?.['u-cp']?.feature_doc_status).toBe('completed');
    expect(loaded?.construction_units?.['u-cp']?.feature_doc_path).not.toBeNull();
  });

  it('stores doc_generation_agent and doc_generation_prompt in checkpoint on success', async () => {
    const { saveCheckpoint } = await import('../../../features/workflow-engine/checkpoint.js');

    const checkpoint: any = {
      schema_version: '3.0.0',
      workflow_id: 'wf-dispatch-test',
      feature_name: 'test',
      current_phase: 'construction',
      current_stage: 'code-generation',
      status: 'in_progress',
      phases: {},
      manifest_path: '',
      trust_state_path: '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      construction_units: {
        'u-dispatch': {
          unitId: 'u-dispatch',
          stages: {
            'functional-design': { status: 'not_started', artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
            'nfr-requirements': { status: 'not_started', artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
            'nfr-design': { status: 'not_started', artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
            'infrastructure-design': { status: 'not_started', artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
            'code-generation': { status: 'not_started', artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
            'test-generation': { status: 'not_started', artifact_path: null, completed_at: null, failure_count: 0, last_error: null },
          },
          code_plan_path: null,
          code_generation_status: 'not_started',
          tests_total: 0,
          tests_passed: 0,
          tests_failed: 0,
          test_framework: 'unknown',
          test_generation_status: 'not_started',
          feature_doc_status: 'not_started',
          feature_doc_path: null,
        },
      },
    };

    await saveCheckpoint(TEST_DIR, checkpoint);

    const executor = new ConstructionExecutor(TEST_DIR, 'wf-dispatch-test');
    await executor.executeDocumentationGeneration('u-dispatch');

    const { loadCheckpoint } = await import('../../../features/workflow-engine/checkpoint.js');
    const loaded = await loadCheckpoint(TEST_DIR, 'wf-dispatch-test');
    const unit = loaded?.construction_units?.['u-dispatch'];
    expect(unit?.doc_generation_agent).toBeDefined();
    expect(typeof unit?.doc_generation_agent).toBe('string');
    expect(unit?.doc_generation_prompt).toBeDefined();
    expect(unit?.doc_generation_prompt).toContain('u-dispatch');
  });
});

describe('ConstructionExecutor.executeUnitCompletion', () => {
  it('returns testGeneration result', async () => {
    const executor = new ConstructionExecutor(TEST_DIR, 'wf-unit-completion');
    const result = await executor.executeUnitCompletion('UNIT-001', { allowFailures: true });
    expect(result.testGeneration).toBeDefined();
    expect(result.testGeneration.unitId).toBe('UNIT-001');
  });

  it('runs doc generation when test gen completes successfully', async () => {
    const executor = new ConstructionExecutor(TEST_DIR, 'wf-uc-doc');
    const result = await executor.executeUnitCompletion('UNIT-001', {
      allowFailures: true,
    });
    if (result.testGeneration.status === 'completed') {
      expect(result.documentation).toBeDefined();
      expect(result.documentation?.featureDoc.status).toBe('completed');
    }
  });

  it('skips doc gen when skipDocumentation is true', async () => {
    const executor = new ConstructionExecutor(TEST_DIR, 'wf-uc-skip');
    const result = await executor.executeUnitCompletion('UNIT-001', {
      allowFailures: true,
      skipDocumentation: true,
    });
    expect(result.documentation).toBeUndefined();
  });

  it('skips doc gen when test gen is blocked', async () => {
    const executor = new ConstructionExecutor(TEST_DIR, 'wf-uc-blocked');
    const result = await executor.executeUnitCompletion('u-blocked');
    if (result.testGeneration.status === 'blocked') {
      expect(result.documentation).toBeUndefined();
    }
  });
});
