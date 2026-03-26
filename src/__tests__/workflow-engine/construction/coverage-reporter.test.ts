import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import {
  loadRiskKeywords,
  classifyByRiskTier,
  collectCoverageData,
  evaluateThresholds,
  getQualityLabel,
  buildCoverageArtifact,
  createCoverageValidator,
} from '../../../features/workflow-engine/construction/validators/coverage-reporter.js';
import type { ValidatorConfig } from '../../../features/workflow-engine/construction/validators/types.js';
import type { RiskKeywordConfig } from '../../../features/workflow-engine/construction/validators/types.js';

const testDir = path.join(process.cwd(), '.test-coverage-reporter');

const DEFAULT_KEYWORDS: RiskKeywordConfig = {
  critical: ['auth', 'payment', 'security', 'encrypt', 'token', 'credential', 'password', 'session', 'permission'],
  moderate: ['validate', 'transform', 'process', 'persist', 'database', 'query', 'transaction', 'migrate', 'cache'],
  low: ['log', 'format', 'display', 'util', 'helper', 'config', 'constant', 'mock', 'fixture'],
};

function makeConfig(overrides: Partial<ValidatorConfig> = {}): ValidatorConfig {
  return {
    timeoutBudgetMs: 5000,
    allowFailures: false,
    workflowDepth: 2,
    unitId: 'UNIT-006',
    unitFiles: [],
    apiSurfaceFiles: [],
    projectPath: testDir,
    workflowId: 'wf-coverage-test',
    ...overrides,
  };
}

beforeEach(async () => {
  await fs.ensureDir(testDir);
});

afterEach(async () => {
  await fs.remove(testDir);
});

describe('loadRiskKeywords — default keywords', () => {
  it('returns critical keywords including auth and payment', () => {
    const keywords = loadRiskKeywords(testDir);
    expect(keywords.critical).toContain('auth');
    expect(keywords.critical).toContain('payment');
  });

  it('returns moderate keywords including validate and database', () => {
    const keywords = loadRiskKeywords(testDir);
    expect(keywords.moderate).toContain('validate');
    expect(keywords.moderate).toContain('database');
  });

  it('returns low keywords including log and util', () => {
    const keywords = loadRiskKeywords(testDir);
    expect(keywords.low).toContain('log');
    expect(keywords.low).toContain('util');
  });
});

describe('loadRiskKeywords — project override merges with defaults', () => {
  it('replaces critical keywords when project config defines them', async () => {
    const olympusDir = path.join(testDir, '.olympus');
    await fs.ensureDir(olympusDir);
    await fs.writeJson(path.join(olympusDir, 'config.json'), {
      'risk-keywords': {
        critical: ['banking', 'fraud'],
      },
    });

    const keywords = loadRiskKeywords(testDir);
    expect(keywords.critical).toContain('banking');
    expect(keywords.critical).toContain('fraud');
    expect(keywords.moderate).toContain('validate');
  });

  it('uses defaults when project config has no risk-keywords key', async () => {
    const olympusDir = path.join(testDir, '.olympus');
    await fs.ensureDir(olympusDir);
    await fs.writeJson(path.join(olympusDir, 'config.json'), { someOtherKey: true });

    const keywords = loadRiskKeywords(testDir);
    expect(keywords.critical).toContain('auth');
  });
});

describe('classifyByRiskTier — file path matching', () => {
  it('classifies file with auth in path as critical', () => {
    const tier = classifyByRiskTier('/src/auth-service.ts', '', DEFAULT_KEYWORDS);
    expect(tier).toBe('critical');
  });

  it('classifies file with payment in path as critical', () => {
    const tier = classifyByRiskTier('/src/payment-handler.ts', '', DEFAULT_KEYWORDS);
    expect(tier).toBe('critical');
  });

  it('classifies file with validate in content as moderate', () => {
    const tier = classifyByRiskTier('/src/form-service.ts', 'function validate(input) {}', DEFAULT_KEYWORDS);
    expect(tier).toBe('moderate');
  });

  it('classifies file with no keywords as low', () => {
    const tier = classifyByRiskTier('/src/greeter.ts', 'function greet(name) { return name; }', DEFAULT_KEYWORDS);
    expect(tier).toBe('low');
  });

  it('word boundary: document does not match moderate keyword ment', () => {
    const tier = classifyByRiskTier('/src/document.ts', 'export const document = {}', DEFAULT_KEYWORDS);
    expect(tier).toBe('low');
  });

  it('critical takes precedence over moderate when both match', () => {
    const tier = classifyByRiskTier('/src/auth-validate.ts', 'validate auth tokens', DEFAULT_KEYWORDS);
    expect(tier).toBe('critical');
  });
});

describe('collectCoverageData — instrumentation', () => {
  it('reads coverage-summary.json and returns source instrumentation', async () => {
    const coverageDir = path.join(testDir, 'coverage');
    await fs.ensureDir(coverageDir);
    await fs.writeJson(path.join(coverageDir, 'coverage-summary.json'), {
      total: { lines: { pct: 80 }, branches: { pct: 75 }, functions: { pct: 85 } },
      '/src/foo.ts': { lines: { pct: 90 }, branches: { pct: 88 }, functions: { pct: 95 } },
    });

    const data = await collectCoverageData(testDir, []);
    expect(data.source).toBe('instrumentation');
    expect(data.files).toHaveLength(1);
    expect(data.files[0].filePath).toBe('/src/foo.ts');
    expect(data.files[0].lineCoverage).toBe(90);
  });

  it('excludes the total entry from file list', async () => {
    const coverageDir = path.join(testDir, 'coverage');
    await fs.ensureDir(coverageDir);
    await fs.writeJson(path.join(coverageDir, 'coverage-summary.json'), {
      total: { lines: { pct: 80 } },
      '/src/bar.ts': { lines: { pct: 70 } },
    });

    const data = await collectCoverageData(testDir, []);
    expect(data.files.every(f => f.filePath !== 'total')).toBe(true);
  });
});

describe('collectCoverageData — static analysis fallback', () => {
  it('falls back to static analysis when no coverage-summary.json exists', async () => {
    const sourceFile = path.join(testDir, 'src', 'widget.ts');
    await fs.ensureDir(path.dirname(sourceFile));
    await fs.writeFile(sourceFile, 'export const widget = 1;', 'utf-8');

    const data = await collectCoverageData(testDir, [sourceFile]);
    expect(data.source).toBe('static-analysis');
  });

  it('estimates 0% when no test file exists for a source file', async () => {
    const sourceFile = path.join(testDir, 'src', 'untested.ts');
    await fs.ensureDir(path.dirname(sourceFile));
    await fs.writeFile(sourceFile, 'export const x = 1;', 'utf-8');

    const data = await collectCoverageData(testDir, [sourceFile]);
    expect(data.files[0].lineCoverage).toBe(0);
  });

  it('estimates 100% when a sibling test file exists', async () => {
    const sourceFile = path.join(testDir, 'src', 'tested.ts');
    const testFile = path.join(testDir, 'src', 'tested.test.ts');
    await fs.ensureDir(path.dirname(sourceFile));
    await fs.writeFile(sourceFile, 'export const x = 1;', 'utf-8');
    await fs.writeFile(testFile, 'it("passes", () => {})', 'utf-8');

    const data = await collectCoverageData(testDir, [sourceFile]);
    expect(data.files[0].lineCoverage).toBe(100);
  });
});

describe('evaluateThresholds — met vs unmet', () => {
  it('marks critical as met when coverage exceeds threshold', () => {
    const results = evaluateThresholds({ critical: 85, moderate: 65, low: 45 }, 2);
    const critical = results.find(r => r.tier === 'critical')!;
    expect(critical.met).toBe(true);
  });

  it('marks critical as unmet when coverage is below threshold', () => {
    const results = evaluateThresholds({ critical: 70, moderate: 65, low: 45 }, 2);
    const critical = results.find(r => r.tier === 'critical')!;
    expect(critical.met).toBe(false);
  });

  it('assigns block enforcement when depth >= 3 and threshold unmet', () => {
    const results = evaluateThresholds({ critical: 70, moderate: 50, low: 30 }, 3);
    expect(results.every(r => r.enforcement === 'block')).toBe(true);
  });

  it('assigns warn enforcement when depth === 2 and threshold unmet', () => {
    const results = evaluateThresholds({ critical: 70, moderate: 50, low: 30 }, 2);
    expect(results.every(r => r.enforcement === 'warn')).toBe(true);
  });

  it('assigns info enforcement when depth <= 1 and threshold unmet', () => {
    const results = evaluateThresholds({ critical: 70, moderate: 50, low: 30 }, 1);
    expect(results.every(r => r.enforcement === 'info')).toBe(true);
  });

  it('assigns info enforcement for bugfix depth 0', () => {
    const results = evaluateThresholds({ critical: 70, moderate: 50, low: 30 }, 0);
    expect(results.every(r => r.enforcement === 'info')).toBe(true);
  });
});

describe('getQualityLabel', () => {
  it('returns Exemplary for 95%', () => {
    expect(getQualityLabel(95)).toBe('Exemplary');
  });

  it('returns Exemplary for exactly 90%', () => {
    expect(getQualityLabel(90)).toBe('Exemplary');
  });

  it('returns Commendable for 80%', () => {
    expect(getQualityLabel(80)).toBe('Commendable');
  });

  it('returns Commendable for exactly 75%', () => {
    expect(getQualityLabel(75)).toBe('Commendable');
  });

  it('returns Acceptable for 65%', () => {
    expect(getQualityLabel(65)).toBe('Acceptable');
  });

  it('returns Acceptable for exactly 60%', () => {
    expect(getQualityLabel(60)).toBe('Acceptable');
  });

  it('returns empty string for 50%', () => {
    expect(getQualityLabel(50)).toBe('');
  });

  it('returns empty string for 0%', () => {
    expect(getQualityLabel(0)).toBe('');
  });
});

describe('createCoverageValidator — status outcomes', () => {
  it('returns passed when all tiers meet thresholds', async () => {
    const config = makeConfig({ workflowDepth: 2 });
    const coverageDir = path.join(testDir, 'coverage');
    await fs.ensureDir(coverageDir);
    await fs.writeJson(path.join(coverageDir, 'coverage-summary.json'), {
      '/src/widget.ts': { lines: { pct: 95 }, branches: { pct: 90 }, functions: { pct: 100 } },
    });

    const validator = createCoverageValidator();
    const result = await validator(config);
    expect(result.status).toBe('passed');
  });

  it('returns failed when a blocking threshold is unmet at depth 3', async () => {
    const config = makeConfig({ workflowDepth: 3 });
    const coverageDir = path.join(testDir, 'coverage');
    await fs.ensureDir(coverageDir);
    await fs.writeJson(path.join(coverageDir, 'coverage-summary.json'), {
      '/src/auth-service.ts': { lines: { pct: 50 }, branches: { pct: 50 }, functions: { pct: 50 } },
    });

    const validator = createCoverageValidator();
    const result = await validator(config);
    expect(result.status).toBe('failed');
  });

  it('returns warned when a warning threshold is unmet at depth 2', async () => {
    const config = makeConfig({ workflowDepth: 2 });
    const coverageDir = path.join(testDir, 'coverage');
    await fs.ensureDir(coverageDir);
    await fs.writeJson(path.join(coverageDir, 'coverage-summary.json'), {
      '/src/auth-service.ts': { lines: { pct: 50 }, branches: { pct: 50 }, functions: { pct: 50 } },
    });

    const validator = createCoverageValidator();
    const result = await validator(config);
    expect(result.status).toBe('warned');
  });

  it('downgrades all findings to info and returns passed when allowFailures is true', async () => {
    const config = makeConfig({ workflowDepth: 3, allowFailures: true });
    const coverageDir = path.join(testDir, 'coverage');
    await fs.ensureDir(coverageDir);
    await fs.writeJson(path.join(coverageDir, 'coverage-summary.json'), {
      '/src/auth-service.ts': { lines: { pct: 10 }, branches: { pct: 10 }, functions: { pct: 10 } },
    });

    const validator = createCoverageValidator();
    const result = await validator(config);
    expect(result.status).toBe('passed');
    for (const f of result.findings) {
      expect(f.severity).toBe('info');
    }
  });

  it('returns ValidatorResult with status, findings, and artifactPath', async () => {
    const config = makeConfig();
    const validator = createCoverageValidator();
    const result = await validator(config);

    expect(result).toHaveProperty('status');
    expect(result).toHaveProperty('findings');
    expect(result).toHaveProperty('artifactPath');
    expect(Array.isArray(result.findings)).toBe(true);
    expect(typeof result.artifactPath).toBe('string');
  });

  it('writes coverage-report.md artifact to testing directory', async () => {
    const config = makeConfig();
    const validator = createCoverageValidator();
    const result = await validator(config);

    expect(result.artifactPath).toContain('coverage-report.md');
    expect(await fs.pathExists(result.artifactPath)).toBe(true);
  });
});

describe('buildCoverageArtifact — top 20 limit and source indicator', () => {
  it('limits uncovered files to 20 per tier', () => {
    const files = Array.from({ length: 25 }, (_, i) => ({
      filePath: `/src/log-util-${i}.ts`,
      lineCoverage: 0,
      branchCoverage: 0,
      functionCoverage: 0,
    }));

    const tierClassifications = new Map<string, string>(
      files.map(f => [f.filePath, 'low'])
    );

    const thresholdResults = [
      { tier: 'critical', coverage: 100, threshold: 80, met: true, enforcement: 'info' as const },
      { tier: 'moderate', coverage: 100, threshold: 60, met: true, enforcement: 'info' as const },
      { tier: 'low', coverage: 0, threshold: 40, met: false, enforcement: 'warn' as const },
    ];

    const artifact = buildCoverageArtifact(
      { source: 'static-analysis', files },
      { critical: 100, moderate: 100, low: 0 },
      thresholdResults,
      DEFAULT_KEYWORDS,
      '',
      tierClassifications
    );

    const tableRows = artifact.split('\n').filter(l => l.startsWith('| /src/log-util-'));
    expect(tableRows).toHaveLength(20);
    expect(artifact).toContain('Showing top 20 of 25 files');
  });

  it('notes source type as static-analysis in the report', () => {
    const tierClassifications = new Map<string, string>();
    const thresholdResults = [
      { tier: 'critical', coverage: 100, threshold: 80, met: true, enforcement: 'info' as const },
      { tier: 'moderate', coverage: 100, threshold: 60, met: true, enforcement: 'info' as const },
      { tier: 'low', coverage: 100, threshold: 40, met: true, enforcement: 'info' as const },
    ];

    const artifact = buildCoverageArtifact(
      { source: 'static-analysis', files: [] },
      { critical: 100, moderate: 100, low: 100 },
      thresholdResults,
      DEFAULT_KEYWORDS,
      'Exemplary',
      tierClassifications
    );

    expect(artifact).toContain('static-analysis');
  });

  it('notes source type as instrumentation in the report', () => {
    const tierClassifications = new Map<string, string>();
    const thresholdResults = [
      { tier: 'critical', coverage: 100, threshold: 80, met: true, enforcement: 'info' as const },
      { tier: 'moderate', coverage: 100, threshold: 60, met: true, enforcement: 'info' as const },
      { tier: 'low', coverage: 100, threshold: 40, met: true, enforcement: 'info' as const },
    ];

    const artifact = buildCoverageArtifact(
      { source: 'instrumentation', files: [] },
      { critical: 100, moderate: 100, low: 100 },
      thresholdResults,
      DEFAULT_KEYWORDS,
      'Commendable',
      tierClassifications
    );

    expect(artifact).toContain('instrumentation');
  });

  it('displays quality label in the summary when provided', () => {
    const tierClassifications = new Map<string, string>();
    const thresholdResults = [
      { tier: 'critical', coverage: 95, threshold: 80, met: true, enforcement: 'info' as const },
      { tier: 'moderate', coverage: 95, threshold: 60, met: true, enforcement: 'info' as const },
      { tier: 'low', coverage: 95, threshold: 40, met: true, enforcement: 'info' as const },
    ];

    const artifact = buildCoverageArtifact(
      { source: 'instrumentation', files: [] },
      { critical: 95, moderate: 95, low: 95 },
      thresholdResults,
      DEFAULT_KEYWORDS,
      'Exemplary',
      tierClassifications
    );

    expect(artifact).toContain('Exemplary');
  });
});
