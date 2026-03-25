import * as fs from 'fs';
import * as path from 'path';
import type {
  QualityScorecardData,
  WorkflowCheckpointV3,
  ConstructionUnitProgress,
} from './phase-types.js';

export interface ScorecardOptions {
  projectPath: string;
  workflowId: string;
  featureName: string;
}

export function collectScorecardData(checkpoint: WorkflowCheckpointV3): QualityScorecardData {
  const units = checkpoint.construction_units
    ? (Object.values(checkpoint.construction_units) as ConstructionUnitProgress[])
    : [];

  let tests_total = 0;
  let tests_passed = 0;
  let tests_failed = 0;
  let coverage_sum = 0;
  let coverage_count = 0;
  let sec_critical = 0;
  let sec_warning = 0;
  let sec_info = 0;
  let regressions = 0;

  const units_completed = units.filter(u => u.code_generation_status === 'completed').length;

  for (const unit of units) {
    tests_total += unit.tests_total ?? 0;
    tests_passed += unit.tests_passed ?? 0;
    tests_failed += unit.tests_failed ?? 0;

    if (unit.coverage_percentage != null) {
      coverage_sum += unit.coverage_percentage;
      coverage_count++;
    }

    sec_critical += unit.security_findings_critical ?? 0;
    sec_warning += unit.security_findings_warning ?? 0;
    sec_info += unit.security_findings_info ?? 0;
    regressions += unit.regressions_count ?? 0;
  }

  // v1: gate_bypass_count requires manifest.gate_audit which is not available here
  const gate_bypass_count = 0;

  return {
    tests_total,
    tests_passed,
    tests_failed,
    coverage_percentage:
      coverage_count > 0 ? Math.round((coverage_sum / coverage_count) * 10) / 10 : null,
    security_findings: { critical: sec_critical, warning: sec_warning, info: sec_info },
    units_completed,
    units_total: units.length,
    regressions_count: regressions,
    gate_bypass_count,
    data_sources: determineDataSources(units),
  };
}

export function determineDataSources(
  units: ConstructionUnitProgress[]
): Record<string, 'connected' | 'pending'> {
  const hasTests = units.some(u => (u.tests_total ?? 0) > 0);
  const hasCoverage = units.some(u => u.coverage_percentage != null);
  const hasSecurity = units.some(u => u.security_scan_status === 'completed');
  const hasDocs = units.some(u => u.feature_doc_status === 'completed');
  const hasReadiness = units.some(u => u.recreation_readiness_score != null);

  return {
    tests: hasTests ? 'connected' : 'pending',
    coverage: hasCoverage ? 'connected' : 'pending',
    security: hasSecurity ? 'connected' : 'pending',
    documentation: hasDocs ? 'connected' : 'pending',
    recreation_readiness: hasReadiness ? 'connected' : 'pending',
  };
}

export function writeScorecardReport(data: QualityScorecardData, options: ScorecardOptions): string {
  const outputPath = path.join(
    options.projectPath,
    'aidlc-docs',
    options.workflowId,
    'quality-scorecard.md'
  );

  const frontmatter = [
    '---',
    `workflow: ${options.workflowId}`,
    `feature: "${options.featureName}"`,
    `generated_at: ${new Date().toISOString()}`,
    `tests_total: ${data.tests_total}`,
    `tests_passed: ${data.tests_passed}`,
    `tests_failed: ${data.tests_failed}`,
    `coverage_percentage: ${data.coverage_percentage ?? 'null'}`,
    `security_critical: ${data.security_findings.critical}`,
    `security_warning: ${data.security_findings.warning}`,
    `security_info: ${data.security_findings.info}`,
    `units_completed: ${data.units_completed}`,
    `units_total: ${data.units_total}`,
    `regressions_count: ${data.regressions_count}`,
    `gate_bypass_count: ${data.gate_bypass_count}`,
    '---',
    '',
  ].join('\n');

  const passRate =
    data.tests_total > 0 ? Math.round((data.tests_passed / data.tests_total) * 100) : 0;

  const body = [
    `# Quality Scorecard: ${options.featureName}`,
    '',
    '## Test Results',
    '',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Tests Total | ${data.tests_total} |`,
    `| Tests Passed | ${data.tests_passed} |`,
    `| Tests Failed | ${data.tests_failed} |`,
    `| Pass Rate | ${passRate}% |`,
    `| Coverage | ${data.coverage_percentage != null ? data.coverage_percentage + '%' : 'pending'} |`,
    `| Regressions | ${data.regressions_count} |`,
    '',
    '## Security',
    '',
    `| Severity | Count |`,
    `|----------|-------|`,
    `| Critical | ${data.security_findings.critical} |`,
    `| Warning | ${data.security_findings.warning} |`,
    `| Info | ${data.security_findings.info} |`,
    '',
    '## Unit Completion',
    '',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Units Completed | ${data.units_completed} |`,
    `| Units Total | ${data.units_total} |`,
    `| Gate Bypasses | ${data.gate_bypass_count} |`,
    '',
    '## Data Sources',
    '',
    `| Source | Status |`,
    `|--------|--------|`,
    ...Object.entries(data.data_sources).map(([k, v]) => `| ${k} | ${v} |`),
    '',
  ].join('\n');

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, frontmatter + body);
  return outputPath;
}

export function generateQualityScorecard(
  checkpoint: WorkflowCheckpointV3,
  options: ScorecardOptions
): {
  data: QualityScorecardData;
  reportPath: string;
} {
  const data = collectScorecardData(checkpoint);
  const reportPath = writeScorecardReport(data, options);
  return { data, reportPath };
}
