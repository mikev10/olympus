/**
 * Regression Baseline Module
 *
 * Owns all I/O-touching regression logic: capturing a pre-unit baseline by running
 * the project's test suite, comparing results against a prior baseline, and writing
 * structured regression reports to disk.
 *
 * Pure in-memory functions (compareAgainstBaseline) deliberately contain no I/O so
 * they remain fast and testable without mocking.
 */

import fs from 'fs-extra';
import path from 'path';
import { execSync } from 'child_process';
import type { RegressionBaseline, RegressionReport, RegressionCategory } from '../phase-types.js';

export type { RegressionCategory };

interface TestResult {
  name: string;
  filePath: string;
  status: 'passed' | 'failed' | 'skipped';
  duration_ms: number;
}

/**
 * Structured diff produced by compareAgainstBaseline.
 * Contains newly introduced failures, newly fixed tests, and significant timing changes.
 */
export interface RegressionBaselineDiff {
  new_failures: Array<{ name: string; filePath: string }>;
  new_passes: Array<{ name: string; filePath: string }>;
  timing_changes: Array<{ name: string; before_ms: number; after_ms: number; delta_ms: number }>;
  computed_at: string;
}

/**
 * Run the project test suite and capture a baseline snapshot of all test results.
 *
 * Writes the result to `aidlc-docs/{workflowId}/construction/regression-baseline.json`.
 * A non-zero exit code from the test runner is treated as expected — the output is still
 * parsed and captured.
 *
 * @param projectPath - Absolute path to the project root.
 * @param workflowId  - AIDLC workflow identifier (used to build output path).
 * @param testCommand - Shell command to invoke the test suite (e.g. `npm test`).
 */
export async function captureBaseline(
  projectPath: string,
  workflowId: string,
  testCommand: string
): Promise<RegressionBaseline> {
  const constructionDir = path.join(projectPath, 'aidlc-docs', workflowId, 'construction');
  await fs.ensureDir(constructionDir);

  const framework = detectFramework(testCommand);

  let stdout = '';
  let stderr = '';

  try {
    const result = execSync(testCommand, {
      cwd: projectPath,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    stdout = result as unknown as string;
  } catch (err: unknown) {
    // execSync throws when exit code != 0; extract captured output from the error object
    const execError = err as { stdout?: string; stderr?: string };
    stdout = execError.stdout ?? '';
    stderr = execError.stderr ?? '';
  }

  const rawOutput = stdout || stderr;
  const tests = parseTestOutput(rawOutput, framework);

  const passed = tests.filter(t => t.status === 'passed').length;
  const failed = tests.filter(t => t.status === 'failed').length;
  const skipped = tests.filter(t => t.status === 'skipped').length;

  const baseline: RegressionBaseline = {
    tests: tests.map(t => ({
      name: t.name,
      filePath: t.filePath,
      status: t.status,
      duration_ms: t.duration_ms,
    })),
    captured_at: new Date().toISOString(),
    test_command: testCommand,
    framework,
    total: tests.length,
    passed,
    failed,
    skipped,
  };

  const baselinePath = path.join(constructionDir, 'regression-baseline.json');
  await fs.writeJson(baselinePath, baseline, { spaces: 2 });

  return baseline;
}

/**
 * Compare a prior baseline against a new set of test results to produce a structured diff.
 *
 * Pure in-memory — no I/O. Completes in <5 s for 1 000 tests via O(1) Map lookups.
 *
 * Classification rules:
 * - new_failures:    baseline was `passed` or `skipped`, current is `failed`
 * - new_passes:      baseline was `failed`, current is `passed`
 * - timing_changes:  both runs have the test and |delta| > 100 ms
 *
 * @param baseline       - Previously captured RegressionBaseline.
 * @param currentResults - Test results from the current run.
 */
export function compareAgainstBaseline(
  baseline: RegressionBaseline,
  currentResults: Array<{ name: string; filePath: string; status: 'passed' | 'failed' | 'skipped'; duration_ms: number }>
): RegressionBaselineDiff {
  // Build O(1) lookup map from baseline
  const baselineMap = new Map<string, (typeof baseline.tests)[number]>();
  for (const t of baseline.tests) {
    baselineMap.set(t.name, t);
  }

  const new_failures: RegressionBaselineDiff['new_failures'] = [];
  const new_passes: RegressionBaselineDiff['new_passes'] = [];
  const timing_changes: RegressionBaselineDiff['timing_changes'] = [];

  for (const current of currentResults) {
    const baselineEntry = baselineMap.get(current.name);

    if (!baselineEntry) {
      if (current.status === 'failed') {
        new_failures.push({ name: current.name, filePath: current.filePath });
      }
      continue;
    }

    if (
      (baselineEntry.status === 'passed' || baselineEntry.status === 'skipped') &&
      current.status === 'failed'
    ) {
      new_failures.push({ name: current.name, filePath: current.filePath });
    }

    if (baselineEntry.status === 'failed' && current.status === 'passed') {
      new_passes.push({ name: current.name, filePath: current.filePath });
    }

    const delta = Math.abs(current.duration_ms - baselineEntry.duration_ms);
    if (delta > 100) {
      timing_changes.push({
        name: current.name,
        before_ms: baselineEntry.duration_ms,
        after_ms: current.duration_ms,
        delta_ms: delta,
      });
    }
  }

  return {
    new_failures,
    new_passes,
    timing_changes,
    computed_at: new Date().toISOString(),
  };
}

/**
 * Write a human-readable regression report markdown file.
 *
 * Output path: `aidlc-docs/{workflowId}/construction/{unitId}/testing/regression-report.md`
 *
 * @param projectPath - Absolute path to the project root.
 * @param workflowId  - AIDLC workflow identifier.
 * @param unitId      - Unit identifier (e.g. `u-001-core-types`).
 * @param report      - The RegressionReport object to render.
 */
export async function writeRegressionReport(
  projectPath: string,
  workflowId: string,
  unitId: string,
  report: RegressionReport
): Promise<void> {
  const testingDir = path.join(
    projectPath,
    'aidlc-docs',
    workflowId,
    'construction',
    unitId,
    'testing'
  );
  await fs.ensureDir(testingDir);

  const reportPath = path.join(testingDir, 'regression-report.md');

  const failureRows = report.failures
    .map(f => `| ${f.test_name} | ${f.file_path} | ${f.category} | ${f.rationale} |`)
    .join('\n');

  const content = `# Regression Report

**Workflow ID**: ${report.workflow_id}
**Unit ID**: ${report.unit_id}
**Baseline Captured At**: ${report.baseline_captured_at}
**Compared At**: ${report.compared_at}

## Summary

| Metric | Count |
|---|---|
| Total Regressions | ${report.total_regressions} |
| Legitimate Regressions | ${report.legitimate_regressions} |

## Failures

| Test Name | File Path | Category | Rationale |
|---|---|---|---|
${failureRows || '| _No failures_ | | | |'}
`;

  await fs.writeFile(reportPath, content, 'utf-8');
}

function detectFramework(testCommand: string): string {
  if (testCommand.includes('vitest')) return 'vitest';
  if (testCommand.includes('jest')) return 'jest';
  return 'unknown';
}

/**
 * Parse raw test runner output into TestResult objects.
 *
 * Two strategies:
 * 1. JSON reporter path (vitest/jest `--json`): triggered when output contains `"numPassedTests"`.
 *    Parses `testResults[*].assertionResults`.
 * 2. Plain-text fallback: line-by-line scan for TAP-style and Unicode pass/fail markers.
 */
function parseTestOutput(output: string, _framework: string): TestResult[] {
  // Strategy 1: JSON reporter format — numPassedTests is the canonical sentinel field
  if (output.includes('"numPassedTests"')) {
    try {
      // JSON may be prefixed with non-JSON noise; start from first `{`
      const jsonStart = output.indexOf('{');
      if (jsonStart !== -1) {
        const parsed = JSON.parse(output.slice(jsonStart));
        const results: TestResult[] = [];

        if (Array.isArray(parsed.testResults)) {
          for (const suite of parsed.testResults) {
            const filePath: string = suite.testFilePath ?? suite.name ?? 'unknown';
            for (const assertion of (suite.assertionResults ?? [])) {
              results.push({
                name: assertion.fullName ?? assertion.title ?? 'unnamed',
                filePath,
                status: mapJsonStatus(assertion.status),
                duration_ms: assertion.duration ?? 0,
              });
            }
          }
        }

        if (results.length > 0) return results;
      }
    } catch {
      // JSON parse failed — fall through to plain-text parser
    }
  }

  // Strategy 2: plain-text line scanner
  return parsePlainTextOutput(output);
}

function mapJsonStatus(status: string): 'passed' | 'failed' | 'skipped' {
  if (status === 'passed') return 'passed';
  if (status === 'failed') return 'failed';
  return 'skipped';
}

/**
 * Plain-text fallback parser for TAP-like or human-readable test output.
 *
 * Pass markers:  ✓  √  ok N -
 * Fail markers:  ✗  ×  not ok N -
 * Duration:      (NNNms) or NNNms suffix
 * File context:  nearest preceding `FAIL src/...` or `PASS src/...` line
 */
function parsePlainTextOutput(output: string): TestResult[] {
  const lines = output.split('\n');
  const results: TestResult[] = [];
  let currentFilePath = 'unknown';

  for (const line of lines) {
    const trimmed = line.trim();

    // Update file context from suite headers like `FAIL src/foo.test.ts`
    const fileHeaderMatch = trimmed.match(/^(?:FAIL|PASS)\s+(src\S+)/);
    if (fileHeaderMatch) {
      currentFilePath = fileHeaderMatch[1];
      continue;
    }

    // Pass patterns: ✓ name (Nms)  |  ok N - name
    const passPatterns = [
      /^[✓√]\s+(.+?)(?:\s+\((\d+)ms\)|\s+(\d+)ms)?$/,
      /^ok\s+\d+\s+-\s+(.+?)(?:\s+#.*)?(?:\s+(\d+)ms)?$/,
    ];

    // Fail patterns: ✗ name (Nms)  |  not ok N - name
    const failPatterns = [
      /^[✗×]\s+(.+?)(?:\s+\((\d+)ms\)|\s+(\d+)ms)?$/,
      /^not ok\s+\d+\s+-\s+(.+?)(?:\s+#.*)?(?:\s+(\d+)ms)?$/,
    ];

    let matched = false;
    for (const pattern of passPatterns) {
      const m = trimmed.match(pattern);
      if (m) {
        results.push({ name: m[1].trim(), filePath: currentFilePath, status: 'passed', duration_ms: parseMs(m[2] ?? m[3]) });
        matched = true;
        break;
      }
    }

    if (!matched) {
      for (const pattern of failPatterns) {
        const m = trimmed.match(pattern);
        if (m) {
          results.push({ name: m[1].trim(), filePath: currentFilePath, status: 'failed', duration_ms: parseMs(m[2] ?? m[3]) });
          break;
        }
      }
    }
  }

  return results;
}

function parseMs(value: string | undefined): number {
  if (!value) return 0;
  const n = parseInt(value, 10);
  return isNaN(n) ? 0 : n;
}
