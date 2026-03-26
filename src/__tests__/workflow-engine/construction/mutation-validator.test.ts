import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import {
  identifyCriticalPaths,
  detectMutationPoints,
  checkTestCoverage,
  buildMutationArtifact,
  createMutationValidator,
} from '../../../features/workflow-engine/construction/validators/mutation-validator.js';
import type { MutationPoint } from '../../../features/workflow-engine/construction/validators/mutation-validator.js';
import type { ValidatorConfig } from '../../../features/workflow-engine/construction/validators/types.js';

const testDir = path.join(process.cwd(), '.test-mutation-validator');

function makeConfig(overrides: Partial<ValidatorConfig> = {}): ValidatorConfig {
  return {
    timeoutBudgetMs: 5000,
    allowFailures: false,
    workflowDepth: 2,
    unitId: 'UNIT-003',
    unitFiles: [],
    apiSurfaceFiles: [],
    projectPath: testDir,
    workflowId: 'wf-mutation-test',
    ...overrides,
  };
}

async function writeFile(relPath: string, content: string): Promise<string> {
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

describe('identifyCriticalPaths — file name matching', () => {
  it('identifies auth-service.ts as critical by file name', () => {
    const files = [
      { filePath: '/src/auth-service.ts', content: 'export function doStuff() {}' },
    ];
    const result = identifyCriticalPaths(files);
    expect(result).toContain('/src/auth-service.ts');
  });

  it('does not identify utils.ts as critical', () => {
    const files = [
      { filePath: '/src/utils.ts', content: 'export function formatDate() {}' },
    ];
    const result = identifyCriticalPaths(files);
    expect(result).toHaveLength(0);
  });

  it('identifies file by content keyword with word-boundary match', () => {
    const files = [
      { filePath: '/src/login.ts', content: 'function authenticate(user) { return true; }' },
    ];
    const result = identifyCriticalPaths(files);
    expect(result).toContain('/src/login.ts');
  });

  it('does not match document as a critical keyword', () => {
    const files = [
      { filePath: '/src/document-store.ts', content: 'export class DocumentStore {}' },
    ];
    const result = identifyCriticalPaths(files);
    expect(result).toHaveLength(0);
  });

  it('identifies multiple critical files when present', () => {
    const files = [
      { filePath: '/src/auth.ts', content: 'export function login() {}' },
      { filePath: '/src/utils.ts', content: 'export function noop() {}' },
      { filePath: '/src/payment.ts', content: 'export function charge() {}' },
    ];
    const result = identifyCriticalPaths(files);
    expect(result).toContain('/src/auth.ts');
    expect(result).toContain('/src/payment.ts');
    expect(result).not.toContain('/src/utils.ts');
  });
});

describe('detectMutationPoints — conditional negation', () => {
  it('detects === as a conditional-negation mutation point', () => {
    const content = 'if (user.role === "admin") { return true; }';
    const points = detectMutationPoints(content, 'auth.ts');
    expect(points.length).toBeGreaterThan(0);
    expect(points[0].faultType).toBe('conditional-negation');
    expect(points[0].mutated).toContain('!==');
  });

  it('detects if (isAuthenticated) as conditional negation point', () => {
    const content = 'if (isAuthenticated) {\n  grantAccess();\n}';
    const points = detectMutationPoints(content, 'auth.ts');
    const conditionalPoints = points.filter(p => p.faultType === 'conditional-negation');
    expect(conditionalPoints.length).toBeGreaterThan(0);
    expect(conditionalPoints[0].mutated).toContain('if (!');
  });
});

describe('detectMutationPoints — comparison boundary', () => {
  it('detects count > limit as a comparison-boundary mutation point', () => {
    const content = 'if (count > limit) { throw new Error(); }';
    const points = detectMutationPoints(content, 'validator.ts');
    const boundaryPoints = points.filter(p => p.faultType === 'comparison-boundary');
    expect(boundaryPoints.length).toBeGreaterThan(0);
  });

  it('does not detect arrow function => as a comparison operator', () => {
    const content = 'const fn = (x) => x + 1;';
    const points = detectMutationPoints(content, 'utils.ts');
    const boundaryPoints = points.filter(p => p.faultType === 'comparison-boundary');
    expect(boundaryPoints).toHaveLength(0);
  });
});

describe('detectMutationPoints — return value', () => {
  it('detects return true as a return-value mutation point', () => {
    const content = 'function isValid() { return true; }';
    const points = detectMutationPoints(content, 'validator.ts');
    const returnPoints = points.filter(p => p.faultType === 'return-value');
    expect(returnPoints.length).toBeGreaterThan(0);
    expect(returnPoints[0].mutated).toContain('return false');
  });

  it('detects return false as a return-value mutation point', () => {
    const content = 'function isExpired() { return false; }';
    const points = detectMutationPoints(content, 'session.ts');
    const returnPoints = points.filter(p => p.faultType === 'return-value');
    expect(returnPoints.length).toBeGreaterThan(0);
    expect(returnPoints[0].mutated).toContain('return true');
  });
});

describe('detectMutationPoints — cap at 10', () => {
  it('returns at most 10 points when 15 are detectable', () => {
    const lines = Array.from({ length: 15 }, (_, i) => `if (value${i} === expected${i}) { doThing${i}(); }`);
    const content = lines.join('\n');
    const points = detectMutationPoints(content, 'auth.ts');
    expect(points.length).toBeLessThanOrEqual(10);
  });
});

describe('checkTestCoverage', () => {
  it('marks mutation as caught when test references source file and has relevant assertion', () => {
    const point: MutationPoint = {
      filePath: '/src/auth-service.ts',
      line: 5,
      original: 'if (user === null) { return false; }',
      mutated: 'if (user !== null) { return false; }',
      faultType: 'conditional-negation',
      context: 'if (user === null) { return false; }',
    };
    const testFiles = [
      {
        filePath: '/tests/auth-service.test.ts',
        content: `
import { checkAuth } from '../auth-service';
it('returns false for null user', () => {
  expect(checkAuth(null)).toBe(false);
});
`,
      },
    ];
    const results = checkTestCoverage([point], testFiles);
    expect(results[0].caught).toBe(true);
  });

  it('marks mutation as uncaught when no test references the source file', () => {
    const point: MutationPoint = {
      filePath: '/src/payment-processor.ts',
      line: 12,
      original: 'if (amount > limit) { reject(); }',
      mutated: 'if (amount >= limit) { reject(); }',
      faultType: 'comparison-boundary',
      context: 'if (amount > limit) { reject(); }',
    };
    const testFiles = [
      {
        filePath: '/tests/unrelated.test.ts',
        content: `
it('unrelated test', () => {
  expect(1 + 1).toBe(2);
});
`,
      },
    ];
    const results = checkTestCoverage([point], testFiles);
    expect(results[0].caught).toBe(false);
  });
});

describe('createMutationValidator — no critical files', () => {
  it('returns status skipped when no critical-path files found', async () => {
    const sourceFile = await writeFile('src/utils.ts', 'export function noop() {}');
    const config = makeConfig({ unitFiles: [sourceFile] });

    const validator = createMutationValidator();
    const result = await validator(config);

    expect(result.status).toBe('skipped');
    expect(result.findings).toHaveLength(0);
  });
});

describe('createMutationValidator — all mutations caught', () => {
  it('returns status passed when all mutations have test coverage', async () => {
    const sourceContent = [
      'function checkPermission(user) {',
      '  if (user === null) {',
      '    return false;',
      '  }',
      '  return true;',
      '}',
    ].join('\n');

    const sourceFile = await writeFile('src/auth-service.ts', sourceContent);

    const testContent = `
import { checkPermission } from '../auth-service';
it('returns false for null user', () => {
  expect(checkPermission(null)).toBe(false);
});
it('returns true for valid user', () => {
  expect(checkPermission({ id: 1 })).toBe(true);
});
`;
    const dir = testingDir(makeConfig({ unitFiles: [sourceFile] }));
    await fs.ensureDir(dir);
    await fs.writeFile(path.join(dir, 'auth-service.test.ts'), testContent, 'utf-8');

    const config = makeConfig({ unitFiles: [sourceFile] });
    const validator = createMutationValidator();
    const result = await validator(config);

    expect(result.status).toBe('passed');
  });
});

describe('createMutationValidator — uncaught mutations', () => {
  it('returns status warned with findings when mutations have no test coverage', async () => {
    const sourceContent = [
      'function isAdmin(user) {',
      '  if (user.role === "admin") {',
      '    return true;',
      '  }',
      '  return false;',
      '}',
    ].join('\n');

    const sourceFile = await writeFile('src/auth-service.ts', sourceContent);
    const config = makeConfig({ unitFiles: [sourceFile] });

    const validator = createMutationValidator();
    const result = await validator(config);

    expect(result.status).toBe('warned');
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings[0].severity).toBe('warning');
  });
});

describe('createMutationValidator — allowFailures', () => {
  it('downgrades findings to info and returns passed when allowFailures is true', async () => {
    const sourceContent = 'function hasSession(token) { if (token === null) { return false; } return true; }';
    const sourceFile = await writeFile('src/session.ts', sourceContent);
    const config = makeConfig({ unitFiles: [sourceFile], allowFailures: true });

    const validator = createMutationValidator();
    const result = await validator(config);

    expect(result.status).toBe('passed');
    for (const f of result.findings) {
      expect(f.severity).toBe('info');
    }
  });
});

describe('createMutationValidator — ValidatorResult shape', () => {
  it('returned result has status, findings, and artifactPath fields', async () => {
    const sourceFile = await writeFile('src/utils.ts', 'export function noop() {}');
    const config = makeConfig({ unitFiles: [sourceFile] });

    const validator = createMutationValidator();
    const result = await validator(config);

    expect(result).toHaveProperty('status');
    expect(result).toHaveProperty('findings');
    expect(result).toHaveProperty('artifactPath');
    expect(Array.isArray(result.findings)).toBe(true);
    expect(typeof result.artifactPath).toBe('string');
  });
});

describe('buildMutationArtifact — no mutation score', () => {
  it('does not include percentage or score in output', () => {
    const results = [
      {
        point: {
          filePath: '/src/auth.ts',
          line: 3,
          original: 'if (x === 1)',
          mutated: 'if (x !== 1)',
          faultType: 'conditional-negation' as const,
          context: 'if (x === 1)',
        },
        caught: false,
      },
    ];
    const artifact = buildMutationArtifact(results, ['/src/auth.ts'], false);
    expect(artifact).not.toMatch(/\d+%/);
    expect(artifact).not.toMatch(/score/i);
    expect(artifact).not.toMatch(/mutation score/i);
  });

  it('produces a skipped report when skipped is true', () => {
    const artifact = buildMutationArtifact([], [], true);
    expect(artifact).toContain('Skipped');
    expect(artifact).not.toContain('Mutation Points');
  });
});
