import { describe, it, expect } from 'vitest';
import type {
  ValidatorStatus,
  ValidatorFindingSeverity,
  ValidatorResultStatus,
  Finding,
  ValidatorResult,
} from '../../../features/workflow-engine/phase-types.js';
import type {
  ValidatorName,
  ValidatorConfig,
  ValidatorRiskTier,
  RiskKeywordConfig,
  PipelineResult,
  ValidatorFn,
} from '../../../features/workflow-engine/construction/validators/types.js';

describe('ValidatorStatus type', () => {
  it('accepts all valid status values', () => {
    const statuses: ValidatorStatus[] = ['not_started', 'in_progress', 'completed', 'skipped'];
    expect(statuses).toHaveLength(4);
    expect(statuses).toContain('not_started');
    expect(statuses).toContain('in_progress');
    expect(statuses).toContain('completed');
    expect(statuses).toContain('skipped');
  });
});

describe('ValidatorFindingSeverity type', () => {
  it('accepts all valid severity values', () => {
    const severities: ValidatorFindingSeverity[] = ['error', 'warning', 'info'];
    expect(severities).toHaveLength(3);
    expect(severities).toContain('error');
    expect(severities).toContain('warning');
    expect(severities).toContain('info');
  });
});

describe('ValidatorResultStatus type', () => {
  it('accepts all valid result status values', () => {
    const statuses: ValidatorResultStatus[] = ['passed', 'warned', 'failed', 'skipped', 'timeout'];
    expect(statuses).toHaveLength(5);
    expect(statuses).toContain('passed');
    expect(statuses).toContain('warned');
    expect(statuses).toContain('failed');
    expect(statuses).toContain('skipped');
    expect(statuses).toContain('timeout');
  });
});

describe('Finding interface', () => {
  it('constructs a minimal finding with required fields', () => {
    const finding: Finding = {
      id: 'f-001',
      severity: 'error',
      category: 'runtime-error',
      message: 'Something went wrong',
    };
    expect(finding.id).toBe('f-001');
    expect(finding.severity).toBe('error');
    expect(finding.category).toBe('runtime-error');
    expect(finding.message).toBe('Something went wrong');
    expect(finding.location).toBeUndefined();
  });

  it('constructs a finding with an optional location including file and line', () => {
    const finding: Finding = {
      id: 'f-002',
      severity: 'warning',
      category: 'coverage',
      message: 'Line not covered',
      location: { file: 'src/foo.ts', line: 42 },
    };
    expect(finding.location?.file).toBe('src/foo.ts');
    expect(finding.location?.line).toBe(42);
    expect(finding.location?.testName).toBeUndefined();
  });

  it('constructs a finding with a testName location', () => {
    const finding: Finding = {
      id: 'f-003',
      severity: 'info',
      category: 'traceability',
      message: 'Story not linked',
      location: { file: 'src/bar.test.ts', testName: 'should do thing' },
    };
    expect(finding.location?.testName).toBe('should do thing');
  });

  it('supports all severity levels', () => {
    const severities: ValidatorFindingSeverity[] = ['error', 'warning', 'info'];
    for (const severity of severities) {
      const finding: Finding = { id: 'x', severity, category: 'test', message: 'msg' };
      expect(finding.severity).toBe(severity);
    }
  });
});

describe('ValidatorResult interface', () => {
  it('constructs a passing result with no findings', () => {
    const result: ValidatorResult = {
      status: 'passed',
      findings: [],
      artifactPath: 'aidlc-docs/test/quality.json',
    };
    expect(result.status).toBe('passed');
    expect(result.findings).toHaveLength(0);
    expect(result.artifactPath).toBe('aidlc-docs/test/quality.json');
  });

  it('constructs a failed result with findings', () => {
    const result: ValidatorResult = {
      status: 'failed',
      findings: [
        { id: 'e1', severity: 'error', category: 'quality', message: 'Test failed' },
      ],
      artifactPath: '',
    };
    expect(result.status).toBe('failed');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe('error');
  });

  it('supports timeout status', () => {
    const result: ValidatorResult = { status: 'timeout', findings: [], artifactPath: '' };
    expect(result.status).toBe('timeout');
  });
});

describe('ValidatorName type', () => {
  it('contains all five validator names', () => {
    const names: ValidatorName[] = ['quality', 'mutation', 'traceability', 'contract', 'coverage'];
    expect(names).toHaveLength(5);
    for (const n of ['quality', 'mutation', 'traceability', 'contract', 'coverage']) {
      expect(names).toContain(n);
    }
  });
});

describe('ValidatorConfig interface', () => {
  it('constructs a valid config', () => {
    const config: ValidatorConfig = {
      timeoutBudgetMs: 30000,
      allowFailures: false,
      workflowDepth: 3,
      unitId: 'u-001',
      unitFiles: ['src/auth.ts'],
      apiSurfaceFiles: ['src/api/routes.ts'],
      projectPath: '/tmp/project',
      workflowId: 'wf-001',
    };
    expect(config.timeoutBudgetMs).toBe(30000);
    expect(config.allowFailures).toBe(false);
    expect(config.unitFiles).toContain('src/auth.ts');
  });
});

describe('ValidatorRiskTier type', () => {
  it('accepts all three tier values', () => {
    const tiers: ValidatorRiskTier[] = ['critical', 'moderate', 'low'];
    expect(tiers).toHaveLength(3);
  });
});

describe('RiskKeywordConfig interface', () => {
  it('constructs a valid keyword config', () => {
    const config: RiskKeywordConfig = {
      critical: ['auth', 'payment'],
      moderate: ['validate', 'transform'],
      low: ['log', 'format'],
    };
    expect(config.critical).toContain('auth');
    expect(config.moderate).toContain('validate');
    expect(config.low).toContain('log');
  });
});

describe('PipelineResult interface', () => {
  it('constructs a result with ordered entries', () => {
    const r1: ValidatorResult = { status: 'passed', findings: [], artifactPath: 'a' };
    const r2: ValidatorResult = { status: 'failed', findings: [], artifactPath: 'b' };
    const pipeline: PipelineResult = {
      results: [
        { validator: 'quality', result: r1 },
        { validator: 'coverage', result: r2 },
      ],
    };
    expect(pipeline.results[0].validator).toBe('quality');
    expect(pipeline.results[1].validator).toBe('coverage');
  });
});

describe('ValidatorFn type', () => {
  it('is callable and returns a Promise<ValidatorResult>', async () => {
    const fn: ValidatorFn = async (_config) => ({
      status: 'passed',
      findings: [],
      artifactPath: '',
    });
    const result = await fn({
      timeoutBudgetMs: 5000,
      allowFailures: false,
      workflowDepth: 1,
      unitId: 'u-001',
      unitFiles: [],
      apiSurfaceFiles: [],
      projectPath: '/tmp',
      workflowId: 'wf-001',
    });
    expect(result.status).toBe('passed');
  });
});
