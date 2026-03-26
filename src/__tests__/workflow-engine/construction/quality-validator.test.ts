import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import {
  detectAntiPatterns,
  calculateNegativeCaseRatio,
} from '../../../features/workflow-engine/construction/validators/quality-patterns.js';
import { createQualityValidator } from '../../../features/workflow-engine/construction/validators/quality-validator.js';
import type { ValidatorConfig } from '../../../features/workflow-engine/construction/validators/types.js';

const testDir = path.join(process.cwd(), '.test-quality-validator');

function makeConfig(overrides: Partial<ValidatorConfig> = {}): ValidatorConfig {
  return {
    timeoutBudgetMs: 5000,
    allowFailures: false,
    workflowDepth: 2,
    unitId: 'UNIT-002',
    unitFiles: [],
    apiSurfaceFiles: [],
    projectPath: testDir,
    workflowId: 'wf-quality-test',
    ...overrides,
  };
}

async function writeTestFile(relPath: string, content: string): Promise<string> {
  const fullPath = path.join(testDir, relPath);
  await fs.ensureDir(path.dirname(fullPath));
  await fs.writeFile(fullPath, content, 'utf-8');
  return fullPath;
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

beforeEach(async () => {
  await fs.ensureDir(testDir);
});

afterEach(async () => {
  await fs.remove(testDir);
});

describe('detectAntiPatterns — tautological', () => {
  it('returns a finding with category tautological when mock return value is asserted against itself', () => {
    const content = `
it('tautological test', () => {
  service.getData.mockReturnValue(42);
  expect(service.getData()).toBe(42);
});
`;
    const findings = detectAntiPatterns(content, 'test.ts', '/path/test.ts');
    const tautological = findings.filter(f => f.category === 'tautological');
    expect(tautological.length).toBeGreaterThan(0);
    expect(tautological[0].severity).toBe('error');
  });

  it('returns no tautological finding when asserting against a computed value', () => {
    const content = `
it('good test', () => {
  const result = computeSomething(input);
  expect(result).toBe(expectedValue);
});
`;
    const findings = detectAntiPatterns(content, 'test.ts', '/path/test.ts');
    const tautological = findings.filter(f => f.category === 'tautological');
    expect(tautological).toHaveLength(0);
  });
});

describe('detectAntiPatterns — empty-body', () => {
  it('returns a finding with category empty-body when test has no assertions', () => {
    const content = `
it('does nothing', () => {
  const x = 1 + 1;
});
`;
    const findings = detectAntiPatterns(content, 'test.ts', '/path/test.ts');
    const emptyBody = findings.filter(f => f.category === 'empty-body');
    expect(emptyBody).toHaveLength(1);
    expect(emptyBody[0].severity).toBe('error');
  });

  it('returns no empty-body finding when test has an expect call', () => {
    const content = `
it('has assertion', () => {
  expect(1 + 1).toBe(2);
});
`;
    const findings = detectAntiPatterns(content, 'test.ts', '/path/test.ts');
    const emptyBody = findings.filter(f => f.category === 'empty-body');
    expect(emptyBody).toHaveLength(0);
  });
});

describe('detectAntiPatterns — trivially-true', () => {
  it('returns a finding with category trivially-true for expect(true).toBe(true)', () => {
    const content = `
it('trivial test', () => {
  expect(true).toBe(true);
});
`;
    const findings = detectAntiPatterns(content, 'test.ts', '/path/test.ts');
    const trivial = findings.filter(f => f.category === 'trivially-true');
    expect(trivial.length).toBeGreaterThan(0);
    expect(trivial[0].severity).toBe('error');
  });

  it('returns no trivially-true finding when variable is asserted against true', () => {
    const content = `
it('valid test', () => {
  const result = isValid(input);
  expect(result).toBe(true);
});
`;
    const findings = detectAntiPatterns(content, 'test.ts', '/path/test.ts');
    const trivial = findings.filter(f => f.category === 'trivially-true');
    expect(trivial).toHaveLength(0);
  });
});

describe('detectAntiPatterns — surface-assertion', () => {
  it('returns a warning finding when all assertions use toBeDefined', () => {
    const content = `
it('surface only', () => {
  expect(result).toBeDefined();
  expect(other).toBeDefined();
});
`;
    const findings = detectAntiPatterns(content, 'test.ts', '/path/test.ts');
    const surface = findings.filter(f => f.category === 'surface-assertion');
    expect(surface.length).toBeGreaterThan(0);
    expect(surface[0].severity).toBe('warning');
  });

  it('returns no surface-assertion warning when mix of toBeDefined and toBe is used', () => {
    const content = `
it('mixed assertions', () => {
  expect(result).toBeDefined();
  expect(result.value).toBe(42);
});
`;
    const findings = detectAntiPatterns(content, 'test.ts', '/path/test.ts');
    const surface = findings.filter(f => f.category === 'surface-assertion');
    expect(surface).toHaveLength(0);
  });
});

describe('detectAntiPatterns — excessive-mocking', () => {
  it('returns a warning finding with counts when mocks far exceed real calls', () => {
    const content = `
it('too many mocks', () => {
  const a = vi.fn();
  const b = vi.fn();
  const c = vi.fn();
  const d = vi.fn();
  const e = vi.fn();
  a.mockReturnValue(1);
  b.mockReturnValue(2);
  const result = doSomething();
  expect(result).toBe(3);
});
`;
    const findings = detectAntiPatterns(content, 'test.ts', '/path/test.ts');
    const excessive = findings.filter(f => f.category === 'excessive-mocking');
    expect(excessive.length).toBeGreaterThan(0);
    expect(excessive[0].severity).toBe('warning');
    expect(excessive[0].message).toMatch(/\d+ mocks/);
  });

  it('returns no excessive-mocking warning when real calls outnumber mocks', () => {
    const content = `
it('balanced test', () => {
  const a = vi.fn();
  const b = vi.fn();
  const r1 = doStep1();
  const r2 = doStep2(r1);
  const r3 = doStep3(r2);
  const r4 = doStep4(r3);
  const r5 = doStep5(r4);
  expect(r5).toBe('done');
});
`;
    const findings = detectAntiPatterns(content, 'test.ts', '/path/test.ts');
    const excessive = findings.filter(f => f.category === 'excessive-mocking');
    expect(excessive).toHaveLength(0);
  });
});

describe('detectAntiPatterns — snapshot-overuse', () => {
  it('returns a warning finding when test uses only toMatchSnapshot', () => {
    const content = `
it('snapshot only', () => {
  expect(component).toMatchSnapshot();
});
`;
    const findings = detectAntiPatterns(content, 'test.ts', '/path/test.ts');
    const snapshot = findings.filter(f => f.category === 'snapshot-overuse');
    expect(snapshot.length).toBeGreaterThan(0);
    expect(snapshot[0].severity).toBe('warning');
  });

  it('returns no snapshot-overuse warning when snapshot is paired with behavioral assertion', () => {
    const content = `
it('snapshot plus behavioral', () => {
  expect(component).toMatchSnapshot();
  expect(component.value).toBe(42);
});
`;
    const findings = detectAntiPatterns(content, 'test.ts', '/path/test.ts');
    const snapshot = findings.filter(f => f.category === 'snapshot-overuse');
    expect(snapshot).toHaveLength(0);
  });
});

describe('calculateNegativeCaseRatio', () => {
  it('returns ratio 0.10 when 1 of 10 tests is negative', () => {
    const tests = Array.from({ length: 9 }, (_, i) => `
it('happy path ${i}', () => {
  expect(result${i}).toBe(true);
});`).join('\n');

    const negative = `
it('throws on invalid input', () => {
  expect(() => fn(null)).toThrow();
});`;

    const result = calculateNegativeCaseRatio(tests + negative);
    expect(result.totalTests).toBe(10);
    expect(result.negativeTests).toBe(1);
    expect(result.ratio).toBeCloseTo(0.10, 5);
  });

  it('returns ratio 0.20 when exactly 2 of 10 tests are negative', () => {
    const tests = Array.from({ length: 8 }, (_, i) => `
it('happy path ${i}', () => {
  expect(result${i}).toBe(true);
});`).join('\n');

    const negatives = `
it('handles error case', () => {
  expect(() => fn(bad)).toThrow();
});
it('rejects unauthorized request', () => {
  expect(response.status).toBe(401);
});`;

    const result = calculateNegativeCaseRatio(tests + negatives);
    expect(result.totalTests).toBe(10);
    expect(result.negativeTests).toBe(2);
    expect(result.ratio).toBeCloseTo(0.20, 5);
  });

  it('returns ratio 0.50 when 5 of 10 tests are negative', () => {
    const positives = Array.from({ length: 5 }, (_, i) => `
it('happy path ${i}', () => {
  expect(result${i}).toBe(true);
});`).join('\n');

    const negatives = Array.from({ length: 5 }, (_, i) => `
it('error case ${i}', () => {
  expect(() => fn${i}(null)).toThrow();
});`).join('\n');

    const result = calculateNegativeCaseRatio(positives + negatives);
    expect(result.totalTests).toBe(10);
    expect(result.negativeTests).toBe(5);
    expect(result.ratio).toBeCloseTo(0.50, 5);
  });
});

describe('createQualityValidator — lifecycle', () => {
  it('overwrites the artifact on second run (result replacement)', async () => {
    const config = makeConfig();
    const dir = testingDir(config);
    await fs.ensureDir(dir);
    await fs.writeFile(
      path.join(dir, 'good.test.ts'),
      `it('passes', () => { expect(1).toBe(1); });`,
      'utf-8'
    );

    const validator = createQualityValidator();
    await validator(config);

    const artifactPath = path.join(dir, 'quality-validation.md');
    const first = await fs.readFile(artifactPath, 'utf-8');

    await fs.writeFile(
      path.join(dir, 'second.test.ts'),
      `it('also passes', () => { expect(2).toBe(2); });`,
      'utf-8'
    );
    await validator(config);
    const second = await fs.readFile(artifactPath, 'utf-8');

    expect(typeof first).toBe('string');
    expect(typeof second).toBe('string');
    expect(second).not.toBe(first);
  });

  it('downgrades all findings to info and returns passed when allowFailures is true', async () => {
    const config = makeConfig({ allowFailures: true });
    const dir = testingDir(config);
    await fs.ensureDir(dir);
    await fs.writeFile(
      path.join(dir, 'empty.test.ts'),
      `it('empty', () => { const x = 1; });\n`,
      'utf-8'
    );

    const validator = createQualityValidator();
    const result = await validator(config);

    expect(result.status).toBe('passed');
    for (const f of result.findings) {
      expect(f.severity).toBe('info');
    }
  });

  it('excludes rejected tests from validatedTestCount', async () => {
    const config = makeConfig();
    const dir = testingDir(config);
    await fs.ensureDir(dir);

    const tautological = Array.from({ length: 3 }, (_, i) => `
it('tautological ${i}', () => {
  mockFn.mockReturnValue(val${i});
  expect(mockFn()).toBe(val${i});
});`).join('\n');

    const valid = Array.from({ length: 7 }, (_, i) => `
it('valid test ${i}', () => {
  expect(compute(${i})).toBe(${i} * 2);
});`).join('\n');

    await fs.writeFile(path.join(dir, 'mixed.test.ts'), tautological + valid, 'utf-8');

    const validator = createQualityValidator();
    const result = await validator(config);

    const errors = result.findings.filter(f => f.severity === 'error');
    expect(errors.length).toBeGreaterThan(0);

    const artifact = await fs.readFile(result.artifactPath, 'utf-8');
    expect(artifact).toContain('Rejected tests');
  });

  it('returned ValidatorResult has status, findings, and artifactPath fields', async () => {
    const config = makeConfig();
    const dir = testingDir(config);
    await fs.ensureDir(dir);
    await fs.writeFile(
      path.join(dir, 'simple.test.ts'),
      `it('simple', () => { expect(true).toBe(true); });\n`,
      'utf-8'
    );

    const validator = createQualityValidator();
    const result = await validator(config);

    expect(result).toHaveProperty('status');
    expect(result).toHaveProperty('findings');
    expect(result).toHaveProperty('artifactPath');
    expect(Array.isArray(result.findings)).toBe(true);
    expect(typeof result.artifactPath).toBe('string');
  });

  it('returns passed with no findings when there are no test files', async () => {
    const config = makeConfig();

    const validator = createQualityValidator();
    const result = await validator(config);

    expect(result.status).toBe('passed');
    expect(result.findings).toHaveLength(0);
    expect(typeof result.artifactPath).toBe('string');
  });
});
