import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  collectScorecardData,
  determineDataSources,
  writeScorecardReport,
  generateQualityScorecard,
} from '../../features/workflow-engine/quality-scorecard.js';
import type { WorkflowCheckpointV3, ConstructionUnitProgress } from '../../features/workflow-engine/phase-types.js';

function makeCheckpoint(units: Record<string, ConstructionUnitProgress> = {}): WorkflowCheckpointV3 {
  return {
    schema_version: '3.0.0',
    workflow_id: 'test-workflow',
    feature_name: 'Test Feature',
    current_phase: 'construction',
    current_stage: 'code-generation',
    status: 'in_progress',
    phases: {} as any,
    manifest_path: '',
    trust_state_path: '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    construction_units: units,
  };
}

function makeUnit(overrides: Partial<ConstructionUnitProgress> = {}): ConstructionUnitProgress {
  return {
    unitId: 'UNIT-001',
    stages: {} as any,
    code_plan_path: null,
    code_generation_status: 'completed',
    ...overrides,
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scorecard-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('collectScorecardData', () => {
  it('aggregates all fields from a fully populated checkpoint', () => {
    const checkpoint = makeCheckpoint({
      'UNIT-001': makeUnit({
        unitId: 'UNIT-001',
        tests_total: 100,
        tests_passed: 90,
        tests_failed: 10,
        coverage_percentage: 80,
        security_findings_critical: 1,
        security_findings_warning: 2,
        security_findings_info: 3,
        regressions_count: 1,
        code_generation_status: 'completed',
        security_scan_status: 'completed',
        feature_doc_status: 'completed',
        recreation_readiness_score: 85,
      }),
      'UNIT-002': makeUnit({
        unitId: 'UNIT-002',
        tests_total: 50,
        tests_passed: 50,
        tests_failed: 0,
        coverage_percentage: 90,
        security_findings_critical: 0,
        security_findings_warning: 1,
        security_findings_info: 0,
        regressions_count: 0,
        code_generation_status: 'completed',
      }),
    });

    const data = collectScorecardData(checkpoint);

    expect(data.tests_total).toBe(150);
    expect(data.tests_passed).toBe(140);
    expect(data.tests_failed).toBe(10);
    expect(data.coverage_percentage).toBe(85);
    expect(data.security_findings.critical).toBe(1);
    expect(data.security_findings.warning).toBe(3);
    expect(data.security_findings.info).toBe(3);
    expect(data.units_completed).toBe(2);
    expect(data.units_total).toBe(2);
    expect(data.regressions_count).toBe(1);
    expect(data.gate_bypass_count).toBe(0);
    expect(data.average_recreation_readiness_score).toBe(85);
  });

  it('returns all zeros and null when checkpoint has no units', () => {
    const checkpoint = makeCheckpoint({});

    const data = collectScorecardData(checkpoint);

    expect(data.tests_total).toBe(0);
    expect(data.tests_passed).toBe(0);
    expect(data.tests_failed).toBe(0);
    expect(data.coverage_percentage).toBeNull();
    expect(data.security_findings.critical).toBe(0);
    expect(data.security_findings.warning).toBe(0);
    expect(data.security_findings.info).toBe(0);
    expect(data.units_completed).toBe(0);
    expect(data.units_total).toBe(0);
    expect(data.regressions_count).toBe(0);
    expect(data.gate_bypass_count).toBe(0);
    expect(data.phases_completed).toBe(0);
    expect(data.validation_pass_rate).toBe(0);
    expect(data.rework_count).toBe(0);
    expect(data.regressions_fixed).toBe(0);
    expect(data.average_recreation_readiness_score).toBeNull();
  });

  it('returns all zeros and null when construction_units is undefined', () => {
    const checkpoint = makeCheckpoint();
    delete (checkpoint as any).construction_units;

    const data = collectScorecardData(checkpoint);

    expect(data.tests_total).toBe(0);
    expect(data.coverage_percentage).toBeNull();
    expect(data.units_total).toBe(0);
  });

  it('handles partial data — some units missing optional fields', () => {
    const checkpoint = makeCheckpoint({
      'UNIT-001': makeUnit({
        unitId: 'UNIT-001',
        tests_total: 40,
        tests_passed: 35,
        tests_failed: 5,
        security_findings_critical: 2,
        code_generation_status: 'completed',
      }),
      'UNIT-002': makeUnit({
        unitId: 'UNIT-002',
        code_generation_status: 'generating',
      }),
    });

    const data = collectScorecardData(checkpoint);

    expect(data.tests_total).toBe(40);
    expect(data.tests_passed).toBe(35);
    expect(data.tests_failed).toBe(5);
    expect(data.coverage_percentage).toBeNull();
    expect(data.security_findings.critical).toBe(2);
    expect(data.security_findings.warning).toBe(0);
    expect(data.units_completed).toBe(1);
    expect(data.units_total).toBe(2);
  });

  it('averages coverage only across units that have coverage data', () => {
    const checkpoint = makeCheckpoint({
      'UNIT-001': makeUnit({ unitId: 'UNIT-001', coverage_percentage: 60 }),
      'UNIT-002': makeUnit({ unitId: 'UNIT-002', coverage_percentage: 80 }),
      'UNIT-003': makeUnit({ unitId: 'UNIT-003' }),
    });

    const data = collectScorecardData(checkpoint);

    expect(data.coverage_percentage).toBe(70);
  });

  it('rounds coverage average to one decimal place', () => {
    const checkpoint = makeCheckpoint({
      'UNIT-001': makeUnit({ unitId: 'UNIT-001', coverage_percentage: 66.666 }),
      'UNIT-002': makeUnit({ unitId: 'UNIT-002', coverage_percentage: 77.777 }),
    });

    const data = collectScorecardData(checkpoint);

    expect(data.coverage_percentage).toBe(72.2);
  });

  it('counts phases_completed from checkpoint phases', () => {
    const checkpoint = makeCheckpoint({
      'UNIT-001': makeUnit({ unitId: 'UNIT-001' }),
    });
    checkpoint.phases = {
      discovery: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
      inception: { status: 'completed', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
      construction: { status: 'in_progress', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
      operations: { status: 'not_started', started_at: null, completed_at: null, gate_result: null, gate_bypassed: false, bypass_reason: null },
    } as any;

    const data = collectScorecardData(checkpoint);

    expect(data.phases_completed).toBe(2);
  });

  it('computes regressions_fixed when regressions exist but tests pass', () => {
    const checkpoint = makeCheckpoint({
      'UNIT-001': makeUnit({ unitId: 'UNIT-001', regressions_count: 3, tests_failed: 0, tests_total: 10 }),
      'UNIT-002': makeUnit({ unitId: 'UNIT-002', regressions_count: 1, tests_failed: 2, tests_total: 5 }),
    });

    const data = collectScorecardData(checkpoint);

    expect(data.regressions_fixed).toBe(3);
  });

  it('computes average_recreation_readiness_score across units', () => {
    const checkpoint = makeCheckpoint({
      'UNIT-001': makeUnit({ unitId: 'UNIT-001', recreation_readiness_score: 80 }),
      'UNIT-002': makeUnit({ unitId: 'UNIT-002', recreation_readiness_score: 90 }),
      'UNIT-003': makeUnit({ unitId: 'UNIT-003' }),
    });

    const data = collectScorecardData(checkpoint);

    expect(data.average_recreation_readiness_score).toBe(85);
  });

  it('returns null average_recreation_readiness_score when no units have scores', () => {
    const checkpoint = makeCheckpoint({
      'UNIT-001': makeUnit({ unitId: 'UNIT-001' }),
    });

    const data = collectScorecardData(checkpoint);

    expect(data.average_recreation_readiness_score).toBeNull();
  });

  it('returns default time_per_phase when no metrics exist', () => {
    const checkpoint = makeCheckpoint({});

    const data = collectScorecardData(checkpoint);

    expect(data.time_per_phase).toEqual({ inception_ms: 0, construction_ms: 0, operations_ms: 0 });
  });
});

describe('determineDataSources', () => {
  it('marks all sources connected when all data is present', () => {
    const units: ConstructionUnitProgress[] = [
      makeUnit({
        tests_total: 10,
        coverage_percentage: 80,
        security_scan_status: 'completed',
        feature_doc_status: 'completed',
        recreation_readiness_score: 90,
      }),
    ];

    const sources = determineDataSources(units);

    expect(sources.tests).toBe('connected');
    expect(sources.coverage).toBe('connected');
    expect(sources.security).toBe('connected');
    expect(sources.documentation).toBe('connected');
    expect(sources.recreation_readiness).toBe('connected');
  });

  it('marks all sources pending when no data is present', () => {
    const units: ConstructionUnitProgress[] = [makeUnit()];

    const sources = determineDataSources(units);

    expect(sources.tests).toBe('pending');
    expect(sources.coverage).toBe('pending');
    expect(sources.security).toBe('pending');
    expect(sources.documentation).toBe('pending');
    expect(sources.recreation_readiness).toBe('pending');
  });

  it('marks sources pending when empty unit list', () => {
    const sources = determineDataSources([]);

    expect(sources.tests).toBe('pending');
    expect(sources.coverage).toBe('pending');
    expect(sources.security).toBe('pending');
    expect(sources.documentation).toBe('pending');
    expect(sources.recreation_readiness).toBe('pending');
  });

  it('marks only connected sources where at least one unit has data', () => {
    const units: ConstructionUnitProgress[] = [
      makeUnit({ tests_total: 5 }),
      makeUnit({ coverage_percentage: 75 }),
    ];

    const sources = determineDataSources(units);

    expect(sources.tests).toBe('connected');
    expect(sources.coverage).toBe('connected');
    expect(sources.security).toBe('pending');
    expect(sources.documentation).toBe('pending');
    expect(sources.recreation_readiness).toBe('pending');
  });
});

describe('writeScorecardReport', () => {
  const baseData = {
    tests_total: 100,
    tests_passed: 95,
    tests_failed: 5,
    coverage_percentage: 87.5,
    security_findings: { critical: 0, warning: 2, info: 4 },
    units_completed: 3,
    units_total: 3,
    regressions_count: 0,
    gate_bypass_count: 0,
    data_sources: { tests: 'connected' as const, coverage: 'connected' as const },
  };

  it('writes the file to the correct path under aidlc-docs', () => {
    const options = { projectPath: tmpDir, workflowId: 'wf-123', featureName: 'My Feature' };

    const outputPath = writeScorecardReport(baseData, options);

    expect(outputPath).toBe(path.join(tmpDir, 'aidlc-docs', 'wf-123', 'quality-scorecard.md'));
    expect(fs.existsSync(outputPath)).toBe(true);
  });

  it('generates valid YAML frontmatter', () => {
    const options = { projectPath: tmpDir, workflowId: 'wf-123', featureName: 'My Feature' };

    const outputPath = writeScorecardReport(baseData, options);
    const content = fs.readFileSync(outputPath, 'utf-8');

    expect(content).toContain('---\n');
    expect(content).toContain('workflow: wf-123');
    expect(content).toContain('feature: "My Feature"');
    expect(content).toContain('tests_total: 100');
    expect(content).toContain('tests_passed: 95');
    expect(content).toContain('tests_failed: 5');
    expect(content).toContain('coverage_percentage: 87.5');
    expect(content).toContain('security_critical: 0');
    expect(content).toContain('security_warning: 2');
    expect(content).toContain('security_info: 4');
    expect(content).toContain('units_completed: 3');
    expect(content).toContain('units_total: 3');
    expect(content).toContain('regressions_count: 0');
    expect(content).toContain('gate_bypass_count: 0');
    expect(content).toContain('generated_at:');
  });

  it('generates markdown body with all four sections', () => {
    const options = { projectPath: tmpDir, workflowId: 'wf-123', featureName: 'My Feature' };

    const outputPath = writeScorecardReport(baseData, options);
    const content = fs.readFileSync(outputPath, 'utf-8');

    expect(content).toContain('# Quality Scorecard: My Feature');
    expect(content).toContain('## Test Results');
    expect(content).toContain('## Security');
    expect(content).toContain('## Unit Completion');
    expect(content).toContain('## Methodology Metrics');
    expect(content).toContain('## Recreation Readiness');
    expect(content).toContain('## Data Sources');
  });

  it('includes new metrics in frontmatter', () => {
    const extendedData = {
      ...baseData,
      phases_completed: 2,
      validation_pass_rate: 95,
      rework_count: 1,
      regressions_fixed: 3,
      average_recreation_readiness_score: 82.5,
    };
    const options = { projectPath: tmpDir, workflowId: 'wf-fm', featureName: 'FM Test' };

    const outputPath = writeScorecardReport(extendedData, options);
    const content = fs.readFileSync(outputPath, 'utf-8');

    expect(content).toContain('phases_completed: 2');
    expect(content).toContain('validation_pass_rate: 95');
    expect(content).toContain('rework_count: 1');
    expect(content).toContain('regressions_fixed: 3');
    expect(content).toContain('average_recreation_readiness_score: 82.5');
  });

  it('shows pending for recreation readiness when score is null', () => {
    const extendedData = {
      ...baseData,
      average_recreation_readiness_score: null,
    };
    const options = { projectPath: tmpDir, workflowId: 'wf-rr-null', featureName: 'RR Null' };

    const outputPath = writeScorecardReport(extendedData, options);
    const content = fs.readFileSync(outputPath, 'utf-8');

    expect(content).toContain('| Average Score | pending |');
    expect(content).toContain('average_recreation_readiness_score: null');
  });

  it('calculates pass rate correctly in the table', () => {
    const options = { projectPath: tmpDir, workflowId: 'wf-pass', featureName: 'Rate Test' };

    const outputPath = writeScorecardReport(baseData, options);
    const content = fs.readFileSync(outputPath, 'utf-8');

    expect(content).toContain('| Pass Rate | 95% |');
  });

  it('shows pending when coverage_percentage is null', () => {
    const dataWithNullCoverage = { ...baseData, coverage_percentage: null };
    const options = { projectPath: tmpDir, workflowId: 'wf-nocov', featureName: 'No Coverage' };

    const outputPath = writeScorecardReport(dataWithNullCoverage, options);
    const content = fs.readFileSync(outputPath, 'utf-8');

    expect(content).toContain('coverage_percentage: null');
    expect(content).toContain('| Coverage | pending |');
  });

  it('shows 0% pass rate when tests_total is zero', () => {
    const noTestData = { ...baseData, tests_total: 0, tests_passed: 0, tests_failed: 0 };
    const options = { projectPath: tmpDir, workflowId: 'wf-notest', featureName: 'No Tests' };

    const outputPath = writeScorecardReport(noTestData, options);
    const content = fs.readFileSync(outputPath, 'utf-8');

    expect(content).toContain('| Pass Rate | 0% |');
  });

  it('renders data sources table rows', () => {
    const options = { projectPath: tmpDir, workflowId: 'wf-src', featureName: 'Sources' };

    const outputPath = writeScorecardReport(baseData, options);
    const content = fs.readFileSync(outputPath, 'utf-8');

    expect(content).toContain('| tests | connected |');
    expect(content).toContain('| coverage | connected |');
  });

  it('creates intermediate directories if they do not exist', () => {
    const deepPath = path.join(tmpDir, 'deep', 'nested');
    const options = { projectPath: deepPath, workflowId: 'wf-deep', featureName: 'Deep' };

    expect(() => writeScorecardReport(baseData, options)).not.toThrow();
    expect(fs.existsSync(path.join(deepPath, 'aidlc-docs', 'wf-deep', 'quality-scorecard.md'))).toBe(true);
  });
});

describe('generateQualityScorecard', () => {
  it('returns data and reportPath for a fully populated checkpoint', () => {
    const checkpoint = makeCheckpoint({
      'UNIT-001': makeUnit({
        unitId: 'UNIT-001',
        tests_total: 50,
        tests_passed: 48,
        tests_failed: 2,
        coverage_percentage: 76,
        code_generation_status: 'completed',
      }),
    });
    const options = {
      projectPath: tmpDir,
      workflowId: 'wf-full',
      featureName: 'Full Flow Feature',
    };

    const result = generateQualityScorecard(checkpoint, options);

    expect(result.data.tests_total).toBe(50);
    expect(result.data.tests_passed).toBe(48);
    expect(result.data.coverage_percentage).toBe(76);
    expect(result.data.units_completed).toBe(1);
    expect(result.reportPath).toBe(
      path.join(tmpDir, 'aidlc-docs', 'wf-full', 'quality-scorecard.md')
    );
    expect(fs.existsSync(result.reportPath)).toBe(true);
  });

  it('returns zero-value data and writes file for empty checkpoint', () => {
    const checkpoint = makeCheckpoint({});
    const options = {
      projectPath: tmpDir,
      workflowId: 'wf-empty',
      featureName: 'Empty Workflow',
    };

    const result = generateQualityScorecard(checkpoint, options);

    expect(result.data.tests_total).toBe(0);
    expect(result.data.coverage_percentage).toBeNull();
    expect(fs.existsSync(result.reportPath)).toBe(true);
  });
});
