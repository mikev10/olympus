import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import {
  loadTraceabilitySources,
  mapTestsToCriteria,
  buildTraceabilityArtifact,
  createTraceabilityValidator,
} from '../../../features/workflow-engine/construction/validators/traceability-validator.js';
import type { ValidatorConfig } from '../../../features/workflow-engine/construction/validators/types.js';
import type { Criterion } from '../../../features/workflow-engine/construction/validators/traceability-validator.js';

const testDir = path.join(process.cwd(), '.test-traceability');

function makeConfig(overrides: Partial<ValidatorConfig> = {}): ValidatorConfig {
  return {
    timeoutBudgetMs: 5000,
    allowFailures: false,
    workflowDepth: 2,
    unitId: 'u-004',
    unitFiles: [],
    apiSurfaceFiles: [],
    projectPath: testDir,
    workflowId: 'wf-trace-test',
    ...overrides,
  };
}

async function writeFile(relPath: string, content: string): Promise<void> {
  const fullPath = path.join(testDir, relPath);
  await fs.ensureDir(path.dirname(fullPath));
  await fs.writeFile(fullPath, content, 'utf-8');
}

function testingDir(config: ValidatorConfig): string {
  return path.join(
    config.projectPath,
    'aidlc-docs',
    config.workflowId,
    'construction',
    config.unitId,
    'testing'
  );
}

function inceptionDir(config: ValidatorConfig): string {
  return path.join(config.projectPath, 'aidlc-docs', config.workflowId, 'inception');
}

beforeEach(async () => {
  await fs.ensureDir(testDir);
});

afterEach(async () => {
  await fs.remove(testDir);
});

describe('loadTraceabilitySources — cascading source resolution', () => {
  it('loads from stories.md when user stories exist and type is user-stories', async () => {
    const config = makeConfig();
    const storiesContent = `
## Story S-007

**AC-007.1** Given a valid workflow When criteria are loaded Then they should be parsed
**AC-007.2** Given test files When mapping runs Then coverage is computed
`;
    await writeFile(
      `aidlc-docs/${config.workflowId}/inception/user-stories/stories.md`,
      storiesContent
    );

    const source = await loadTraceabilitySources(config);

    expect(source).not.toBeNull();
    expect(source!.type).toBe('user-stories');
    expect(source!.criteria.length).toBeGreaterThan(0);
    const ids = source!.criteria.map(c => c.id);
    expect(ids).toContain('AC-007.1');
    expect(ids).toContain('AC-007.2');
  });

  it('falls back to requirements.md when stories absent and type is requirements', async () => {
    const config = makeConfig();
    const requirementsContent = `
## Functional Requirements

- **FR-003.1**: The system shall load user stories from inception artifacts
- **FR-003.2**: The system shall fall back to requirements when stories are absent
- **FR-003.3**: The system shall produce a traceability map
`;
    await writeFile(
      `aidlc-docs/${config.workflowId}/inception/requirements/requirements.md`,
      requirementsContent
    );

    const source = await loadTraceabilitySources(config);

    expect(source).not.toBeNull();
    expect(source!.type).toBe('requirements');
    const ids = source!.criteria.map(c => c.id);
    expect(ids).toContain('FR-003.1');
    expect(ids).toContain('FR-003.2');
    expect(ids).toContain('FR-003.3');
  });

  it('falls back to unit spec when neither stories nor requirements exist and type is unit-spec', async () => {
    const config = makeConfig();
    const specContent = `
## Specification

### Load Criteria
### Map to Tests
### Write Artifact
`;
    await writeFile(
      `aidlc-docs/${config.workflowId}/construction/${config.unitId}/spec.md`,
      specContent
    );

    const source = await loadTraceabilitySources(config);

    expect(source).not.toBeNull();
    expect(source!.type).toBe('unit-spec');
    expect(source!.criteria.length).toBeGreaterThan(0);
  });

  it('returns null when no source exists', async () => {
    const config = makeConfig();

    const source = await loadTraceabilitySources(config);

    expect(source).toBeNull();
  });

  it('prefers stories.md over requirements.md when both exist', async () => {
    const config = makeConfig();
    await writeFile(
      `aidlc-docs/${config.workflowId}/inception/user-stories/stories.md`,
      '**AC-007.1** Given x When y Then z'
    );
    await writeFile(
      `aidlc-docs/${config.workflowId}/inception/requirements/requirements.md`,
      '- **FR-001.1**: some requirement'
    );

    const source = await loadTraceabilitySources(config);

    expect(source!.type).toBe('user-stories');
  });
});

describe('mapTestsToCriteria — criterion coverage', () => {
  it('marks criterion as Covered when test file references the criterion ID', () => {
    const criteria: Criterion[] = [
      { id: 'AC-007.1', text: 'load criteria from stories', source: 'stories.md' },
    ];
    const testFiles = [
      {
        filePath: '/path/traceability.test.ts',
        content: `
it('ac-007.1 criteria are loaded from stories', () => {
  expect(source.type).toBe('user-stories');
});
`,
      },
    ];

    const mappings = mapTestsToCriteria(criteria, testFiles);

    expect(mappings).toHaveLength(1);
    expect(mappings[0].status).toBe('Covered');
    expect(mappings[0].tests.length).toBeGreaterThan(0);
  });

  it('marks criterion as Gap when no test references it', () => {
    const criteria: Criterion[] = [
      { id: 'AC-007.3', text: 'write artifact to disk', source: 'stories.md' },
    ];
    const testFiles = [
      {
        filePath: '/path/other.test.ts',
        content: `
it('does something unrelated', () => {
  expect(1).toBe(1);
});
`,
      },
    ];

    const mappings = mapTestsToCriteria(criteria, testFiles);

    expect(mappings[0].status).toBe('Gap');
    expect(mappings[0].tests).toHaveLength(0);
  });

  it('marks criterion as Not Testable when text contains "deployment"', () => {
    const criteria: Criterion[] = [
      { id: 'AC-007.5', text: 'deployment to production must succeed', source: 'stories.md' },
    ];

    const mappings = mapTestsToCriteria(criteria, []);

    expect(mappings[0].status).toBe('Not Testable');
    expect(mappings[0].notTestableReason).toContain('deployment');
  });

  it('marks criterion as Not Testable when text contains "infrastructure"', () => {
    const criteria: Criterion[] = [
      { id: 'AC-008.1', text: 'infrastructure must be provisioned', source: 'stories.md' },
    ];

    const mappings = mapTestsToCriteria(criteria, []);

    expect(mappings[0].status).toBe('Not Testable');
  });

  it('marks criterion as Not Testable when text contains "manual review"', () => {
    const criteria: Criterion[] = [
      { id: 'AC-008.2', text: 'requires manual review before release', source: 'stories.md' },
    ];

    const mappings = mapTestsToCriteria(criteria, []);

    expect(mappings[0].status).toBe('Not Testable');
  });

  it('returns empty tests array for Not Testable criteria', () => {
    const criteria: Criterion[] = [
      { id: 'AC-007.5', text: 'visual inspection of UI output', source: 'stories.md' },
    ];

    const mappings = mapTestsToCriteria(criteria, []);

    expect(mappings[0].tests).toHaveLength(0);
  });

  it('handles multiple criteria with mixed coverage', () => {
    const criteria: Criterion[] = [
      { id: 'FR-003.1', text: 'load traceability source', source: 'requirements.md' },
      { id: 'FR-003.2', text: 'map tests to criteria', source: 'requirements.md' },
    ];
    const testFiles = [
      {
        filePath: '/path/trace.test.ts',
        content: `
it('fr-003.1 loads source correctly', () => {
  expect(source).not.toBeNull();
});
`,
      },
    ];

    const mappings = mapTestsToCriteria(criteria, testFiles);

    expect(mappings[0].status).toBe('Covered');
    expect(mappings[1].status).toBe('Gap');
  });
});

describe('createTraceabilityValidator — depth-sensitive gap handling', () => {
  it('returns failed at standard depth (2) when gaps exist', async () => {
    const config = makeConfig({ workflowDepth: 2 });
    const dir = inceptionDir(config);
    await writeFile(
      `aidlc-docs/${config.workflowId}/inception/requirements/requirements.md`,
      '- **FR-003.1**: load traceability sources\n- **FR-003.2**: map tests to criteria\n'
    );

    const validator = createTraceabilityValidator();
    const result = await validator(config);

    expect(result.status).toBe('failed');
    expect(result.findings.some(f => f.severity === 'error')).toBe(true);
  });

  it('returns warned at minimal depth (1) when gaps exist', async () => {
    const config = makeConfig({ workflowDepth: 1 });
    await writeFile(
      `aidlc-docs/${config.workflowId}/inception/requirements/requirements.md`,
      '- **FR-003.1**: load sources\n- **FR-003.2**: map criteria\n'
    );

    const validator = createTraceabilityValidator();
    const result = await validator(config);

    expect(result.status).toBe('warned');
    expect(result.findings.some(f => f.severity === 'warning')).toBe(true);
  });

  it('at bugfix depth (0) only maps criteria containing reproduce/fix/verify keywords', async () => {
    const config = makeConfig({ workflowDepth: 0 });
    await writeFile(
      `aidlc-docs/${config.workflowId}/inception/requirements/requirements.md`,
      '- **FR-003.1**: reproduce the bug scenario\n- **FR-003.2**: unrelated feature requirement\n'
    );

    const validator = createTraceabilityValidator();
    const result = await validator(config);

    const artifact = await fs.readFile(result.artifactPath, 'utf-8');
    expect(artifact).toContain('FR-003.1');
    expect(artifact).not.toContain('FR-003.2');
  });
});

describe('createTraceabilityValidator — skipped when no source', () => {
  it('returns skipped with info finding when no source exists', async () => {
    const config = makeConfig();

    const validator = createTraceabilityValidator();
    const result = await validator(config);

    expect(result.status).toBe('skipped');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe('info');
    expect(result.findings[0].message).toContain('No traceability source found');
  });
});

describe('createTraceabilityValidator — all criteria covered', () => {
  it('returns passed when all criteria have matching tests', async () => {
    const config = makeConfig({ workflowDepth: 2 });
    await writeFile(
      `aidlc-docs/${config.workflowId}/inception/requirements/requirements.md`,
      '- **FR-003.1**: load sources\n'
    );
    const dir = testingDir(config);
    await writeFile(
      `aidlc-docs/${config.workflowId}/construction/${config.unitId}/testing/trace.test.ts`,
      `it('fr-003.1 loads sources correctly', () => { expect(source).not.toBeNull(); });\n`
    );

    const validator = createTraceabilityValidator();
    const result = await validator(config);

    expect(result.status).toBe('passed');
    expect(result.findings.filter(f => f.category === 'traceability-gap')).toHaveLength(0);
  });
});

describe('createTraceabilityValidator — allowFailures', () => {
  it('downgrades gap findings to info and returns passed when allowFailures is true', async () => {
    const config = makeConfig({ allowFailures: true, workflowDepth: 2 });
    await writeFile(
      `aidlc-docs/${config.workflowId}/inception/requirements/requirements.md`,
      '- **FR-003.1**: load sources\n- **FR-003.2**: map criteria\n'
    );

    const validator = createTraceabilityValidator();
    const result = await validator(config);

    expect(result.status).toBe('passed');
    for (const f of result.findings) {
      expect(f.severity).toBe('info');
    }
  });
});

describe('createTraceabilityValidator — ValidatorResult shape', () => {
  it('returned result has status, findings, and artifactPath fields', async () => {
    const config = makeConfig();

    const validator = createTraceabilityValidator();
    const result = await validator(config);

    expect(result).toHaveProperty('status');
    expect(result).toHaveProperty('findings');
    expect(result).toHaveProperty('artifactPath');
    expect(Array.isArray(result.findings)).toBe(true);
    expect(typeof result.artifactPath).toBe('string');
  });
});

describe('buildTraceabilityArtifact — artifact output', () => {
  it('table has correct columns: Requirement/Criterion | Test(s) | Status', () => {
    const criteria: Criterion[] = [
      { id: 'FR-003.1', text: 'load sources', source: 'requirements.md' },
    ];
    const mappings = mapTestsToCriteria(criteria, []);
    const artifact = buildTraceabilityArtifact(mappings, 'requirements');

    expect(artifact).toContain('| Requirement/Criterion | Test(s) | Status |');
    expect(artifact).toContain('FR-003.1');
    expect(artifact).toContain('Gap');
  });

  it('notes the source type in the header for user-stories', () => {
    const mappings = mapTestsToCriteria(
      [{ id: 'AC-007.1', text: 'load criteria', source: 'stories.md' }],
      []
    );
    const artifact = buildTraceabilityArtifact(mappings, 'user-stories');

    expect(artifact).toContain('User Stories (Gherkin AC)');
  });

  it('notes the source type in the header for requirements', () => {
    const mappings = mapTestsToCriteria(
      [{ id: 'FR-003.1', text: 'load sources', source: 'requirements.md' }],
      []
    );
    const artifact = buildTraceabilityArtifact(mappings, 'requirements');

    expect(artifact).toContain('Requirements (FR sub-requirements)');
  });

  it('notes the source type in the header for unit-spec', () => {
    const mappings = mapTestsToCriteria(
      [{ id: 'SPEC-U004.1', text: 'load spec criteria', source: 'spec.md' }],
      []
    );
    const artifact = buildTraceabilityArtifact(mappings, 'unit-spec');

    expect(artifact).toContain('Unit Spec');
  });

  it('shows covered test file and name in the table', () => {
    const criteria: Criterion[] = [
      { id: 'FR-003.1', text: 'load traceability sources', source: 'requirements.md' },
    ];
    const testFiles = [
      {
        filePath: '/path/trace.test.ts',
        content: `it('fr-003.1 loads sources', () => { expect(source).not.toBeNull(); });\n`,
      },
    ];
    const mappings = mapTestsToCriteria(criteria, testFiles);
    const artifact = buildTraceabilityArtifact(mappings, 'requirements');

    expect(artifact).toContain('Covered');
    expect(artifact).toContain('trace.test.ts');
  });

  it('shows em dash for gap criteria with no tests', () => {
    const criteria: Criterion[] = [
      { id: 'FR-003.2', text: 'map tests to criteria', source: 'requirements.md' },
    ];
    const mappings = mapTestsToCriteria(criteria, []);
    const artifact = buildTraceabilityArtifact(mappings, 'requirements');

    expect(artifact).toContain('—');
    expect(artifact).toContain('Gap');
  });

  it('includes summary section with correct counts', () => {
    const criteria: Criterion[] = [
      { id: 'FR-003.1', text: 'load sources', source: 'requirements.md' },
      { id: 'FR-003.2', text: 'deploy to infrastructure', source: 'requirements.md' },
    ];
    const testFiles = [
      {
        filePath: '/path/trace.test.ts',
        content: `it('fr-003.1 loads sources', () => { expect(source).not.toBeNull(); });\n`,
      },
    ];
    const mappings = mapTestsToCriteria(criteria, testFiles);
    const artifact = buildTraceabilityArtifact(mappings, 'requirements');

    expect(artifact).toContain('Total criteria');
    expect(artifact).toContain('Covered');
    expect(artifact).toContain('Gaps');
    expect(artifact).toContain('Not Testable');
  });
});
