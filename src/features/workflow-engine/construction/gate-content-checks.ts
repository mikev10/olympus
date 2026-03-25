import * as fs from 'fs';
import * as path from 'path';
import type { ContentCheck, ConstructionUnitProgress, WorkflowCheckpointV3 } from '../phase-types.js';

/**
 * Wraps a check function so any thrown error returns a passing info check rather than
 * crashing gate evaluation. Required by the fail-open contract: no content check may block a gate.
 */
export function safeCheck(name: string, fn: () => ContentCheck): ContentCheck {
  try {
    return fn();
  } catch (e) {
    return {
      name,
      passed: true,
      severity: 'info',
      remediation: `Check error: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

function readFirstExisting(candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return fs.readFileSync(candidate, 'utf-8');
    }
  }
  return null;
}

export function checkUserStoriesHaveAcceptanceCriteria(workflowPath: string): ContentCheck {
  const name = 'user-stories-criteria';
  const content = readFirstExisting([
    path.join(workflowPath, 'inception', 'user-stories', 'stories.md'),
    path.join(workflowPath, 'inception', 'stories.md'),
  ]);

  if (content === null) {
    return { name, passed: true, severity: 'info', remediation: 'User stories stage was skipped — no stories.md artifact found.' };
  }

  // Matches "Acceptance Criteria" heading or Given/When/Then BDD patterns (multiline)
  const hasAcceptanceCriteria =
    /acceptance\s+criteria/i.test(content) ||
    /given\s+.+when\s+.+then/is.test(content) ||
    /\bGiven\b.+\bWhen\b/s.test(content);

  if (!hasAcceptanceCriteria) {
    return {
      name,
      passed: false,
      severity: 'warning',
      remediation: 'User stories are missing acceptance criteria. Add "Acceptance Criteria" sections or Given/When/Then scenarios to each story.',
    };
  }

  return { name, passed: true, severity: 'info' };
}

export function checkAppDesignHasConcreteTech(workflowPath: string): ContentCheck {
  const name = 'app-design-concrete';
  const content = readFirstExisting([
    path.join(workflowPath, 'inception', 'application-design', 'components.md'),
    path.join(workflowPath, 'inception', 'application-design.md'),
    path.join(workflowPath, 'inception', 'application-design', 'design.md'),
  ]);

  if (content === null) {
    return { name, passed: true, severity: 'info', remediation: 'Application design stage was skipped — no design artifact found.' };
  }

  if (/\b(TBD|TODO|placeholder|to be determined|to be decided|N\/A)\b/i.test(content)) {
    return {
      name,
      passed: false,
      severity: 'warning',
      remediation: 'Application design contains placeholder text (TBD/TODO/placeholder). Replace with concrete technology choices before proceeding to construction.',
    };
  }

  return { name, passed: true, severity: 'info' };
}

export function checkUnitsHaveDescriptions(workflowPath: string): ContentCheck {
  const name = 'units-have-descriptions';
  const content = readFirstExisting([
    path.join(workflowPath, 'inception', 'unit-of-work.md'),
    path.join(workflowPath, 'inception', 'units-generation', 'unit-of-work.md'),
  ]);

  if (content === null) {
    return { name, passed: true, severity: 'info', remediation: 'Units generation stage was skipped — no unit-of-work.md artifact found.' };
  }

  if (/^Scope\s*:\s*$/im.test(content) || /^Scope\s*:\s*(TBD|TODO|placeholder|N\/A)\s*$/im.test(content)) {
    return {
      name,
      passed: false,
      severity: 'error',
      remediation: 'One or more units have an empty or placeholder Scope field. All units must have a concrete scope description before construction begins.',
    };
  }

  return { name, passed: true, severity: 'info' };
}

export function runGate1ContentChecks(workflowPath: string): ContentCheck[] {
  return [
    safeCheck('user-stories-criteria', () => checkUserStoriesHaveAcceptanceCriteria(workflowPath)),
    safeCheck('app-design-concrete', () => checkAppDesignHasConcreteTech(workflowPath)),
    safeCheck('units-have-descriptions', () => checkUnitsHaveDescriptions(workflowPath)),
  ];
}

export function checkTestsExistAndPass(unitProgress: ConstructionUnitProgress): ContentCheck {
  const name = 'tests-pass';
  const tgStatus = unitProgress.test_generation_status;

  if (!tgStatus || tgStatus === 'skipped' || tgStatus === 'not_started') {
    return { name, passed: true, severity: 'info', remediation: 'Test generation was skipped or not started — no test results to evaluate.' };
  }

  const total = unitProgress.tests_total ?? 0;
  const failed = unitProgress.tests_failed ?? 0;

  if (total === 0) {
    return { name, passed: false, severity: 'warning', remediation: 'No tests found for this unit. Add tests before marking the unit complete.' };
  }

  if (failed > 0) {
    return { name, passed: false, severity: 'error', remediation: `${failed} test(s) are failing. All tests must pass before Gate 4 approval.` };
  }

  return { name, passed: true, severity: 'info' };
}

export function checkSecurityScanClean(unitProgress: ConstructionUnitProgress): ContentCheck {
  const name = 'security-clean';

  if (!unitProgress.security_scan_status || unitProgress.security_scan_status === 'not_started') {
    return { name, passed: true, severity: 'info', remediation: 'Security scanner not configured or not started.' };
  }

  if (unitProgress.security_scan_status === 'skipped') {
    return { name, passed: true, severity: 'info', remediation: 'Security scan was skipped.' };
  }

  const criticalCount = unitProgress.security_findings_critical ?? 0;
  const hasCritical = criticalCount > 0;

  return {
    name,
    passed: !hasCritical,
    severity: hasCritical ? 'error' : 'info',
    remediation: hasCritical
      ? `${criticalCount} critical security finding(s) must be resolved before Gate 4 approval.`
      : undefined,
  };
}

export function checkFeatureDocExists(unitProgress: ConstructionUnitProgress): ContentCheck {
  const name = 'feature-doc-exists';
  const docStatus = unitProgress.feature_doc_status;

  if (!docStatus || docStatus === 'not_started') {
    return { name, passed: false, severity: 'error', remediation: 'Feature documentation has not been generated. Feature docs are mandatory for unit completion (FR-DOC-003). Run the documentation generator before approving this unit.' };
  }

  if (docStatus === 'skipped' || docStatus === 'in_progress') {
    return { name, passed: true, severity: 'info', remediation: docStatus === 'in_progress' ? 'Feature documentation is still in progress.' : 'Feature documentation was skipped.' };
  }

  if (!unitProgress.feature_doc_path) {
    return { name, passed: false, severity: 'error', remediation: 'Feature documentation status is completed but no artifact path was recorded. Re-run the documentation generator.' };
  }

  return { name, passed: true, severity: 'info' };
}

export function checkArchitectureModelUpdated(unitProgress: ConstructionUnitProgress): ContentCheck {
  const name = 'architecture-model-updated';
  const status = unitProgress.architecture_model_status;

  if (!status || status === 'not_started') {
    return {
      name,
      passed: true,
      severity: 'warning',
      remediation: 'Architecture model has not been updated for this unit. Consider running the architecture model updater.',
    };
  }

  if (status === 'updated' || status === 'completed') {
    return { name, passed: true, severity: 'info' };
  }

  return {
    name,
    passed: true,
    severity: 'warning',
    remediation: `Architecture model status is "${status}". Verify the model reflects this unit's changes.`,
  };
}

export function runGate4ContentChecks(
  unitProgress: ConstructionUnitProgress,
  _workflowPath: string
): ContentCheck[] {
  return [
    safeCheck('tests-pass', () => checkTestsExistAndPass(unitProgress)),
    safeCheck('security-clean', () => checkSecurityScanClean(unitProgress)),
    safeCheck('feature-doc-exists', () => checkFeatureDocExists(unitProgress)),
    safeCheck('architecture-model-updated', () => checkArchitectureModelUpdated(unitProgress)),
  ];
}

export function checkAllUnitsComplete(checkpoint: WorkflowCheckpointV3): ContentCheck {
  const name = 'all-units-complete';
  const units = checkpoint.construction_units;

  if (!units || Object.keys(units).length === 0) {
    return { name, passed: true, severity: 'info', remediation: 'No construction units tracked in checkpoint.' };
  }

  const incomplete = Object.values(units).filter((u) => u.code_generation_status !== 'completed');

  if (incomplete.length > 0) {
    const ids = incomplete.map((u) => u.unitId).join(', ');
    return {
      name,
      passed: false,
      severity: 'error',
      remediation: `${incomplete.length} unit(s) have not completed code generation: ${ids}. All units must be completed before Gate 5.`,
    };
  }

  return { name, passed: true, severity: 'info' };
}

export function checkSmokeTestPassed(checkpoint: WorkflowCheckpointV3): ContentCheck {
  const name = 'smoke-test-passed';
  const smokeTest = checkpoint.smoke_test;

  if (!smokeTest || smokeTest.status === 'not_run') {
    return { name, passed: true, severity: 'warning', remediation: 'No smoke test result recorded. Run the smoke test build before proceeding to operations.' };
  }

  if (smokeTest.status === 'failed') {
    return {
      name,
      passed: false,
      severity: 'error',
      remediation: `Smoke test failed (${smokeTest.tests_failed} failure(s) of ${smokeTest.tests_total} total). Fix failing tests before Gate 5 approval.`,
    };
  }

  return { name, passed: true, severity: 'info' };
}

export function checkSecurityReportClean(checkpoint: WorkflowCheckpointV3): ContentCheck {
  const name = 'security-report-clean';
  const units = checkpoint.construction_units;

  if (!units || Object.keys(units).length === 0) {
    return { name, passed: true, severity: 'info', remediation: 'No construction units with security data found.' };
  }

  const unitsWithData = Object.values(units).filter((u) => u.security_scan_status === 'completed');

  if (unitsWithData.length === 0) {
    return { name, passed: true, severity: 'info', remediation: 'No units have completed security scans.' };
  }

  const totalCritical = unitsWithData.reduce((sum, u) => sum + (u.security_findings_critical ?? 0), 0);

  if (totalCritical > 0) {
    const affectedUnits = unitsWithData
      .filter((u) => (u.security_findings_critical ?? 0) > 0)
      .map((u) => u.unitId)
      .join(', ');
    return {
      name,
      passed: false,
      severity: 'error',
      remediation: `${totalCritical} critical security finding(s) across units: ${affectedUnits}. Resolve all critical findings before Gate 5 approval.`,
    };
  }

  return { name, passed: true, severity: 'info' };
}

export function checkTestReportExists(workflowPath: string): ContentCheck {
  const name = 'test-report-exists';
  const candidates = [
    path.join(workflowPath, 'construction', 'build-and-test', 'test-report.md'),
    path.join(workflowPath, 'construction', 'build-and-test', 'report.md'),
    path.join(workflowPath, 'construction', 'build-and-test', 'validation-report.md'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return { name, passed: true, severity: 'info' };
    }
  }

  return {
    name,
    passed: false,
    severity: 'warning',
    remediation: 'No test report found in build-and-test directory. Generate a test report before Gate 5 approval.',
  };
}

export function runGate5ContentChecks(
  checkpoint: WorkflowCheckpointV3,
  workflowPath: string
): ContentCheck[] {
  return [
    safeCheck('all-units-complete', () => checkAllUnitsComplete(checkpoint)),
    safeCheck('smoke-test-passed', () => checkSmokeTestPassed(checkpoint)),
    safeCheck('security-report-clean', () => checkSecurityReportClean(checkpoint)),
    safeCheck('test-report-exists', () => checkTestReportExists(workflowPath)),
  ];
}
