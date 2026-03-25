import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import type { ConstructionUnitProgress, WorkflowCheckpointV3 } from '../../../features/workflow-engine/phase-types.js';
import {
  safeCheck,
  checkUserStoriesHaveAcceptanceCriteria,
  checkAppDesignHasConcreteTech,
  checkUnitsHaveDescriptions,
  runGate1ContentChecks,
  checkTestsExistAndPass,
  checkSecurityScanClean,
  checkFeatureDocExists,
  checkArchitectureModelUpdated,
  runGate4ContentChecks,
  checkAllUnitsComplete,
  checkSmokeTestPassed,
  checkSecurityReportClean,
  checkTestReportExists,
  runGate5ContentChecks,
} from '../../../features/workflow-engine/construction/gate-content-checks.js';

const TEST_DIR = path.join(process.cwd(), '.test-gate-content-checks');

function makeUnit(overrides: Partial<ConstructionUnitProgress> = {}): ConstructionUnitProgress {
  return {
    unitId: 'U-001',
    stages: {
      'functional-design': { status: 'completed', artifact_path: null, completed_at: null },
      'nfr-requirements': { status: 'skipped', artifact_path: null, completed_at: null },
      'nfr-design': { status: 'skipped', artifact_path: null, completed_at: null },
      'infrastructure-design': { status: 'skipped', artifact_path: null, completed_at: null },
      'code-generation': { status: 'completed', artifact_path: null, completed_at: null },
      'test-generation': { status: 'completed', artifact_path: null, completed_at: null },
    },
    code_plan_path: null,
    code_generation_status: 'completed',
    ...overrides,
  };
}

function makeCheckpoint(overrides: Partial<WorkflowCheckpointV3> = {}): WorkflowCheckpointV3 {
  return {
    schema_version: '3.0.0',
    workflow_id: 'test-wf',
    feature_name: 'test-feature',
    current_phase: 'construction',
    current_stage: 'code-generation',
    status: 'in_progress',
    phases: {} as any,
    manifest_path: '',
    trust_state_path: '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(async () => {
  await fs.ensureDir(TEST_DIR);
});

afterEach(async () => {
  await fs.remove(TEST_DIR);
});

describe('safeCheck', () => {
  it('returns function result when no error is thrown', () => {
    const result = safeCheck('my-check', () => ({
      name: 'my-check',
      passed: true,
      severity: 'info',
    }));
    expect(result.passed).toBe(true);
    expect(result.name).toBe('my-check');
  });

  it('returns passed:true with severity info when function throws', () => {
    const result = safeCheck('failing-check', () => {
      throw new Error('boom');
    });
    expect(result.passed).toBe(true);
    expect(result.severity).toBe('info');
    expect(result.remediation).toContain('boom');
  });

  it('uses the provided name in the error result', () => {
    const result = safeCheck('error-name', () => {
      throw new Error('test error');
    });
    expect(result.name).toBe('error-name');
  });
});

describe('checkUserStoriesHaveAcceptanceCriteria', () => {
  it('returns passed:true with info severity when stories.md is missing (skipped stage)', () => {
    const result = checkUserStoriesHaveAcceptanceCriteria(TEST_DIR);
    expect(result.passed).toBe(true);
    expect(result.severity).toBe('info');
    expect(result.name).toBe('user-stories-criteria');
  });

  it('passes when stories.md contains "Acceptance Criteria" heading', async () => {
    const storiesDir = path.join(TEST_DIR, 'inception', 'user-stories');
    await fs.ensureDir(storiesDir);
    await fs.writeFile(
      path.join(storiesDir, 'stories.md'),
      '# US-001\nAs a user...\n\n## Acceptance Criteria\n- User can log in'
    );
    const result = checkUserStoriesHaveAcceptanceCriteria(TEST_DIR);
    expect(result.passed).toBe(true);
    expect(result.severity).toBe('info');
  });

  it('passes when stories.md contains Given/When/Then BDD pattern', async () => {
    const storiesDir = path.join(TEST_DIR, 'inception', 'user-stories');
    await fs.ensureDir(storiesDir);
    await fs.writeFile(
      path.join(storiesDir, 'stories.md'),
      '# US-001\nGiven a user is on the login page\nWhen they enter valid credentials\nThen they are redirected to the dashboard'
    );
    const result = checkUserStoriesHaveAcceptanceCriteria(TEST_DIR);
    expect(result.passed).toBe(true);
  });

  it('fails when stories exist but have no acceptance criteria', async () => {
    const storiesDir = path.join(TEST_DIR, 'inception', 'user-stories');
    await fs.ensureDir(storiesDir);
    await fs.writeFile(
      path.join(storiesDir, 'stories.md'),
      '# US-001\nAs a user I want to log in so that I can access my account.\n\nNo criteria here.'
    );
    const result = checkUserStoriesHaveAcceptanceCriteria(TEST_DIR);
    expect(result.passed).toBe(false);
    expect(result.severity).toBe('warning');
  });

  it('finds file at alternate inception/stories.md path', async () => {
    const inceptionDir = path.join(TEST_DIR, 'inception');
    await fs.ensureDir(inceptionDir);
    await fs.writeFile(
      path.join(inceptionDir, 'stories.md'),
      '## Acceptance Criteria\n- Item 1'
    );
    const result = checkUserStoriesHaveAcceptanceCriteria(TEST_DIR);
    expect(result.passed).toBe(true);
  });
});

describe('checkAppDesignHasConcreteTech', () => {
  it('returns passed:true with info when no design artifact found', () => {
    const result = checkAppDesignHasConcreteTech(TEST_DIR);
    expect(result.passed).toBe(true);
    expect(result.severity).toBe('info');
    expect(result.name).toBe('app-design-concrete');
  });

  it('passes when components.md references concrete technology', async () => {
    const designDir = path.join(TEST_DIR, 'inception', 'application-design');
    await fs.ensureDir(designDir);
    await fs.writeFile(
      path.join(designDir, 'components.md'),
      '# Tech Stack\nFrontend: React 18 with TypeScript\nBackend: Node.js with Express\nDatabase: PostgreSQL'
    );
    const result = checkAppDesignHasConcreteTech(TEST_DIR);
    expect(result.passed).toBe(true);
  });

  it('fails when components.md contains "TBD"', async () => {
    const designDir = path.join(TEST_DIR, 'inception', 'application-design');
    await fs.ensureDir(designDir);
    await fs.writeFile(
      path.join(designDir, 'components.md'),
      '# Tech Stack\nFrontend: TBD\nBackend: Node.js'
    );
    const result = checkAppDesignHasConcreteTech(TEST_DIR);
    expect(result.passed).toBe(false);
    expect(result.severity).toBe('warning');
  });

  it('fails when design contains "placeholder"', async () => {
    const designDir = path.join(TEST_DIR, 'inception', 'application-design');
    await fs.ensureDir(designDir);
    await fs.writeFile(
      path.join(designDir, 'components.md'),
      '# Architecture\nUse placeholder service for now'
    );
    const result = checkAppDesignHasConcreteTech(TEST_DIR);
    expect(result.passed).toBe(false);
  });

  it('fails when design contains "TODO"', async () => {
    const designDir = path.join(TEST_DIR, 'inception', 'application-design');
    await fs.ensureDir(designDir);
    await fs.writeFile(
      path.join(designDir, 'components.md'),
      '# Architecture\nDatabase: TODO decide later'
    );
    const result = checkAppDesignHasConcreteTech(TEST_DIR);
    expect(result.passed).toBe(false);
  });
});

describe('checkUnitsHaveDescriptions', () => {
  it('returns passed:true with info when no unit-of-work.md found', () => {
    const result = checkUnitsHaveDescriptions(TEST_DIR);
    expect(result.passed).toBe(true);
    expect(result.severity).toBe('info');
    expect(result.name).toBe('units-have-descriptions');
  });

  it('passes when unit-of-work.md has units with concrete scope', async () => {
    const inceptionDir = path.join(TEST_DIR, 'inception');
    await fs.ensureDir(inceptionDir);
    await fs.writeFile(
      path.join(inceptionDir, 'unit-of-work.md'),
      '# Units\n\n## U-001: Auth\nScope: Implement JWT-based authentication with refresh tokens'
    );
    const result = checkUnitsHaveDescriptions(TEST_DIR);
    expect(result.passed).toBe(true);
  });

  it('fails when scope field is empty', async () => {
    const inceptionDir = path.join(TEST_DIR, 'inception');
    await fs.ensureDir(inceptionDir);
    await fs.writeFile(
      path.join(inceptionDir, 'unit-of-work.md'),
      '# Units\n\n## U-001: Auth\nScope:\n'
    );
    const result = checkUnitsHaveDescriptions(TEST_DIR);
    expect(result.passed).toBe(false);
    expect(result.severity).toBe('error');
  });

  it('fails when scope is TBD', async () => {
    const inceptionDir = path.join(TEST_DIR, 'inception');
    await fs.ensureDir(inceptionDir);
    await fs.writeFile(
      path.join(inceptionDir, 'unit-of-work.md'),
      '# Units\n\n## U-001: Auth\nScope: TBD\n'
    );
    const result = checkUnitsHaveDescriptions(TEST_DIR);
    expect(result.passed).toBe(false);
  });

  it('finds file at alternate units-generation path', async () => {
    const unitsDir = path.join(TEST_DIR, 'inception', 'units-generation');
    await fs.ensureDir(unitsDir);
    await fs.writeFile(
      path.join(unitsDir, 'unit-of-work.md'),
      '# Units\n\n## U-001\nScope: Build the core API layer'
    );
    const result = checkUnitsHaveDescriptions(TEST_DIR);
    expect(result.passed).toBe(true);
  });
});

describe('runGate1ContentChecks', () => {
  it('returns array of 3 checks', () => {
    const results = runGate1ContentChecks(TEST_DIR);
    expect(results).toHaveLength(3);
  });

  it('all checks have valid ContentCheck shape', () => {
    const results = runGate1ContentChecks(TEST_DIR);
    for (const check of results) {
      expect(check).toHaveProperty('name');
      expect(check).toHaveProperty('passed');
      expect(check).toHaveProperty('severity');
      expect(['error', 'warning', 'info']).toContain(check.severity);
      expect(typeof check.passed).toBe('boolean');
    }
  });

  it('check names match expected identifiers', () => {
    const results = runGate1ContentChecks(TEST_DIR);
    const names = results.map((r) => r.name);
    expect(names).toContain('user-stories-criteria');
    expect(names).toContain('app-design-concrete');
    expect(names).toContain('units-have-descriptions');
  });
});

describe('checkTestsExistAndPass', () => {
  it('passes with info when test_generation_status is undefined', () => {
    const unit = makeUnit();
    const result = checkTestsExistAndPass(unit);
    expect(result.passed).toBe(true);
    expect(result.severity).toBe('info');
    expect(result.name).toBe('tests-pass');
  });

  it('passes with info when test_generation_status is not_started', () => {
    const unit = makeUnit({ test_generation_status: 'not_started' });
    const result = checkTestsExistAndPass(unit);
    expect(result.passed).toBe(true);
    expect(result.severity).toBe('info');
  });

  it('passes with info when test_generation_status is skipped', () => {
    const unit = makeUnit({ test_generation_status: 'skipped' });
    const result = checkTestsExistAndPass(unit);
    expect(result.passed).toBe(true);
  });

  it('fails with warning when tests_total is 0', () => {
    const unit = makeUnit({
      test_generation_status: 'completed',
      tests_total: 0,
      tests_failed: 0,
    });
    const result = checkTestsExistAndPass(unit);
    expect(result.passed).toBe(false);
    expect(result.severity).toBe('warning');
  });

  it('fails with error when tests_failed > 0', () => {
    const unit = makeUnit({
      test_generation_status: 'completed',
      tests_total: 10,
      tests_failed: 2,
    });
    const result = checkTestsExistAndPass(unit);
    expect(result.passed).toBe(false);
    expect(result.severity).toBe('error');
    expect(result.remediation).toContain('2');
  });

  it('passes when tests_total > 0 and tests_failed === 0', () => {
    const unit = makeUnit({
      test_generation_status: 'completed',
      tests_total: 15,
      tests_failed: 0,
    });
    const result = checkTestsExistAndPass(unit);
    expect(result.passed).toBe(true);
    expect(result.severity).toBe('info');
  });
});

describe('checkSecurityScanClean (null-safe)', () => {
  it('passes when security_scan_status is undefined', () => {
    const unit = makeUnit();
    const result = checkSecurityScanClean(unit);
    expect(result.passed).toBe(true);
    expect(result.name).toBe('security-clean');
  });

  it('passes when security_scan_status is not_started', () => {
    const unit = makeUnit({ security_scan_status: 'not_started' });
    const result = checkSecurityScanClean(unit);
    expect(result.passed).toBe(true);
  });

  it('passes when security_scan_status is skipped', () => {
    const unit = makeUnit({ security_scan_status: 'skipped' });
    const result = checkSecurityScanClean(unit);
    expect(result.passed).toBe(true);
  });

  it('passes when completed and critical findings === 0', () => {
    const unit = makeUnit({
      security_scan_status: 'completed',
      security_findings_critical: 0,
    });
    const result = checkSecurityScanClean(unit);
    expect(result.passed).toBe(true);
    expect(result.severity).toBe('info');
  });

  it('fails when completed and critical findings > 0', () => {
    const unit = makeUnit({
      security_scan_status: 'completed',
      security_findings_critical: 3,
    });
    const result = checkSecurityScanClean(unit);
    expect(result.passed).toBe(false);
    expect(result.severity).toBe('error');
    expect(result.remediation).toContain('3');
  });
});

describe('checkFeatureDocExists', () => {
  it('returns passed:false with error when feature_doc_status is undefined', () => {
    const unit = makeUnit();
    const result = checkFeatureDocExists(unit);
    expect(result.passed).toBe(false);
    expect(result.severity).toBe('error');
    expect(result.name).toBe('feature-doc-exists');
  });

  it('fails with error when feature_doc_status is not_started', () => {
    const unit = makeUnit({ feature_doc_status: 'not_started' });
    const result = checkFeatureDocExists(unit);
    expect(result.passed).toBe(false);
    expect(result.severity).toBe('error');
    expect(result.remediation).toContain('FR-DOC-003');
  });

  it('passes with info when feature_doc_status is skipped', () => {
    const unit = makeUnit({ feature_doc_status: 'skipped' });
    const result = checkFeatureDocExists(unit);
    expect(result.passed).toBe(true);
    expect(result.severity).toBe('info');
  });

  it('passes when feature_doc_status is completed and path exists', () => {
    const unit = makeUnit({
      feature_doc_status: 'completed',
      feature_doc_path: '/some/path/feature.md',
    });
    const result = checkFeatureDocExists(unit);
    expect(result.passed).toBe(true);
    expect(result.severity).toBe('info');
  });

  it('fails with error when completed but no path recorded', () => {
    const unit = makeUnit({
      feature_doc_status: 'completed',
      feature_doc_path: null,
    });
    const result = checkFeatureDocExists(unit);
    expect(result.passed).toBe(false);
    expect(result.severity).toBe('error');
  });
});

describe('runGate4ContentChecks', () => {
  it('returns array of 4 checks', () => {
    const unit = makeUnit();
    const results = runGate4ContentChecks(unit, TEST_DIR);
    expect(results).toHaveLength(4);
  });

  it('all checks have valid ContentCheck shape', () => {
    const unit = makeUnit();
    const results = runGate4ContentChecks(unit, TEST_DIR);
    for (const check of results) {
      expect(check).toHaveProperty('name');
      expect(check).toHaveProperty('passed');
      expect(check).toHaveProperty('severity');
      expect(['error', 'warning', 'info']).toContain(check.severity);
    }
  });

  it('check names match expected identifiers', () => {
    const unit = makeUnit();
    const results = runGate4ContentChecks(unit, TEST_DIR);
    const names = results.map((r) => r.name);
    expect(names).toContain('tests-pass');
    expect(names).toContain('security-clean');
    expect(names).toContain('feature-doc-exists');
    expect(names).toContain('architecture-model-updated');
  });
});

describe('checkArchitectureModelUpdated', () => {
  it('returns passed:true with warning when architecture_model_status is undefined', () => {
    const unit = makeUnit();
    const result = checkArchitectureModelUpdated(unit);
    expect(result.passed).toBe(true);
    expect(result.severity).toBe('warning');
    expect(result.name).toBe('architecture-model-updated');
  });

  it('returns passed:true with warning when status is not_started', () => {
    const unit = makeUnit({ architecture_model_status: 'not_started' });
    const result = checkArchitectureModelUpdated(unit);
    expect(result.passed).toBe(true);
    expect(result.severity).toBe('warning');
  });

  it('returns passed:true with info when status is updated', () => {
    const unit = makeUnit({ architecture_model_status: 'updated' });
    const result = checkArchitectureModelUpdated(unit);
    expect(result.passed).toBe(true);
    expect(result.severity).toBe('info');
  });

  it('returns passed:true with info when status is completed', () => {
    const unit = makeUnit({ architecture_model_status: 'completed' });
    const result = checkArchitectureModelUpdated(unit);
    expect(result.passed).toBe(true);
    expect(result.severity).toBe('info');
  });

  it('returns passed:true with warning for unknown status', () => {
    const unit = makeUnit({ architecture_model_status: 'failed' });
    const result = checkArchitectureModelUpdated(unit);
    expect(result.passed).toBe(true);
    expect(result.severity).toBe('warning');
    expect(result.remediation).toContain('failed');
  });
});

describe('checkAllUnitsComplete', () => {
  it('passes when no construction_units in checkpoint', () => {
    const checkpoint = makeCheckpoint();
    const result = checkAllUnitsComplete(checkpoint);
    expect(result.passed).toBe(true);
    expect(result.severity).toBe('info');
    expect(result.name).toBe('all-units-complete');
  });

  it('passes when all units have code_generation_status completed', () => {
    const checkpoint = makeCheckpoint({
      construction_units: {
        'U-001': makeUnit({ unitId: 'U-001', code_generation_status: 'completed' }),
        'U-002': makeUnit({ unitId: 'U-002', code_generation_status: 'completed' }),
      },
    });
    const result = checkAllUnitsComplete(checkpoint);
    expect(result.passed).toBe(true);
  });

  it('fails when any unit is not completed', () => {
    const checkpoint = makeCheckpoint({
      construction_units: {
        'U-001': makeUnit({ unitId: 'U-001', code_generation_status: 'completed' }),
        'U-002': makeUnit({ unitId: 'U-002', code_generation_status: 'generating' }),
      },
    });
    const result = checkAllUnitsComplete(checkpoint);
    expect(result.passed).toBe(false);
    expect(result.severity).toBe('error');
    expect(result.remediation).toContain('U-002');
  });
});

describe('checkSmokeTestPassed', () => {
  it('passes with warning when smoke_test is undefined', () => {
    const checkpoint = makeCheckpoint();
    const result = checkSmokeTestPassed(checkpoint);
    expect(result.passed).toBe(true);
    expect(result.severity).toBe('warning');
    expect(result.name).toBe('smoke-test-passed');
  });

  it('passes with warning when smoke_test.status is not_run', () => {
    const checkpoint = makeCheckpoint({
      smoke_test: {
        status: 'not_run',
        tests_total: 0,
        tests_failed: 0,
        duration_ms: 0,
        reportPath: null,
      },
    });
    const result = checkSmokeTestPassed(checkpoint);
    expect(result.passed).toBe(true);
    expect(result.severity).toBe('warning');
  });

  it('passes when smoke test passed', () => {
    const checkpoint = makeCheckpoint({
      smoke_test: {
        status: 'passed',
        tests_total: 50,
        tests_failed: 0,
        duration_ms: 5000,
        reportPath: '/some/report.md',
      },
    });
    const result = checkSmokeTestPassed(checkpoint);
    expect(result.passed).toBe(true);
    expect(result.severity).toBe('info');
  });

  it('fails with error when smoke test failed', () => {
    const checkpoint = makeCheckpoint({
      smoke_test: {
        status: 'failed',
        tests_total: 50,
        tests_failed: 3,
        duration_ms: 5000,
        reportPath: null,
      },
    });
    const result = checkSmokeTestPassed(checkpoint);
    expect(result.passed).toBe(false);
    expect(result.severity).toBe('error');
    expect(result.remediation).toContain('3');
  });
});

describe('checkSecurityReportClean', () => {
  it('passes with info when no construction_units', () => {
    const checkpoint = makeCheckpoint();
    const result = checkSecurityReportClean(checkpoint);
    expect(result.passed).toBe(true);
    expect(result.severity).toBe('info');
    expect(result.name).toBe('security-report-clean');
  });

  it('passes with info when no units have completed security scans', () => {
    const checkpoint = makeCheckpoint({
      construction_units: {
        'U-001': makeUnit({ unitId: 'U-001', security_scan_status: 'not_started' }),
      },
    });
    const result = checkSecurityReportClean(checkpoint);
    expect(result.passed).toBe(true);
    expect(result.severity).toBe('info');
  });

  it('passes when all completed scans have zero critical findings', () => {
    const checkpoint = makeCheckpoint({
      construction_units: {
        'U-001': makeUnit({
          unitId: 'U-001',
          security_scan_status: 'completed',
          security_findings_critical: 0,
        }),
        'U-002': makeUnit({
          unitId: 'U-002',
          security_scan_status: 'completed',
          security_findings_critical: 0,
        }),
      },
    });
    const result = checkSecurityReportClean(checkpoint);
    expect(result.passed).toBe(true);
  });

  it('fails when any unit has critical findings > 0', () => {
    const checkpoint = makeCheckpoint({
      construction_units: {
        'U-001': makeUnit({
          unitId: 'U-001',
          security_scan_status: 'completed',
          security_findings_critical: 2,
        }),
        'U-002': makeUnit({
          unitId: 'U-002',
          security_scan_status: 'completed',
          security_findings_critical: 0,
        }),
      },
    });
    const result = checkSecurityReportClean(checkpoint);
    expect(result.passed).toBe(false);
    expect(result.severity).toBe('error');
    expect(result.remediation).toContain('U-001');
  });
});

describe('checkTestReportExists', () => {
  it('fails with warning when no report file exists', () => {
    const result = checkTestReportExists(TEST_DIR);
    expect(result.passed).toBe(false);
    expect(result.severity).toBe('warning');
    expect(result.name).toBe('test-report-exists');
  });

  it('passes when test-report.md exists', async () => {
    const reportDir = path.join(TEST_DIR, 'construction', 'build-and-test');
    await fs.ensureDir(reportDir);
    await fs.writeFile(path.join(reportDir, 'test-report.md'), '# Test Report\nAll passing.');
    const result = checkTestReportExists(TEST_DIR);
    expect(result.passed).toBe(true);
    expect(result.severity).toBe('info');
  });

  it('passes when report.md exists', async () => {
    const reportDir = path.join(TEST_DIR, 'construction', 'build-and-test');
    await fs.ensureDir(reportDir);
    await fs.writeFile(path.join(reportDir, 'report.md'), '# Report');
    const result = checkTestReportExists(TEST_DIR);
    expect(result.passed).toBe(true);
  });

  it('passes when validation-report.md exists', async () => {
    const reportDir = path.join(TEST_DIR, 'construction', 'build-and-test');
    await fs.ensureDir(reportDir);
    await fs.writeFile(path.join(reportDir, 'validation-report.md'), '# Validation Report');
    const result = checkTestReportExists(TEST_DIR);
    expect(result.passed).toBe(true);
  });
});

describe('runGate5ContentChecks', () => {
  it('returns array of 4 checks', () => {
    const checkpoint = makeCheckpoint();
    const results = runGate5ContentChecks(checkpoint, TEST_DIR);
    expect(results).toHaveLength(4);
  });

  it('all checks have valid ContentCheck shape', () => {
    const checkpoint = makeCheckpoint();
    const results = runGate5ContentChecks(checkpoint, TEST_DIR);
    for (const check of results) {
      expect(check).toHaveProperty('name');
      expect(check).toHaveProperty('passed');
      expect(check).toHaveProperty('severity');
      expect(['error', 'warning', 'info']).toContain(check.severity);
      expect(typeof check.passed).toBe('boolean');
    }
  });

  it('check names match expected identifiers', () => {
    const checkpoint = makeCheckpoint();
    const results = runGate5ContentChecks(checkpoint, TEST_DIR);
    const names = results.map((r) => r.name);
    expect(names).toContain('all-units-complete');
    expect(names).toContain('smoke-test-passed');
    expect(names).toContain('security-report-clean');
    expect(names).toContain('test-report-exists');
  });

  it('all checks return passed:true for a perfect checkpoint with report', async () => {
    const reportDir = path.join(TEST_DIR, 'construction', 'build-and-test');
    await fs.ensureDir(reportDir);
    await fs.writeFile(path.join(reportDir, 'test-report.md'), '# Test Report');

    const checkpoint = makeCheckpoint({
      construction_units: {
        'U-001': makeUnit({
          unitId: 'U-001',
          code_generation_status: 'completed',
          security_scan_status: 'completed',
          security_findings_critical: 0,
        }),
      },
      smoke_test: {
        status: 'passed',
        tests_total: 20,
        tests_failed: 0,
        duration_ms: 3000,
        reportPath: null,
      },
    });

    const results = runGate5ContentChecks(checkpoint, TEST_DIR);
    for (const check of results) {
      expect(check.passed).toBe(true);
    }
  });
});
