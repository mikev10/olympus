import * as fs from 'fs-extra';
import { join, dirname } from 'path';

/**
 * Data structure for BOLT validation results that will be recorded in the validation report.
 */
export interface BoltValidationData {
  /** Unique BOLT identifier (e.g., 'BOLT-001') */
  boltId: string;
  /** Human-readable BOLT title or description */
  boltTitle: string;
  /** Commands executed during BOLT implementation */
  commandsExecuted: Array<{ command: string; exitCode: number; result: string }>;
  /** Test suite results */
  testResults: Array<{ suite: string; pass: number; fail: number; skip: number }>;
  /** Files changed during BOLT implementation */
  filesChanged: Array<{ path: string; action: 'created' | 'modified' | 'deleted' }>;
  /** How the gate was approved: 'human' or 'auto-approved' */
  gateApprovedBy: string;
  /** Dual validation conformance scores */
  dualValidation: {
    /** Conformance to parent unit requirements (0-100) */
    parentConformance: number;
    /** Conformance to root intent requirements (0-100) */
    rootConformance: number;
  };
  /** Risk tier assigned to this BOLT (1-5) */
  riskTier: number;
  /** Optional CI/CD pipeline check results */
  ciCheckResults?: Array<{ name: string; passed: boolean; details: string }>;
}

/**
 * Generates or appends a BOLT validation section to a unit's validation report.
 *
 * This function creates a validation report if it doesn't exist, or appends a new
 * BOLT section to an existing report. Each BOLT's validation evidence is recorded
 * including commands executed, test results, files changed, and gate approval details.
 *
 * @param reportPath - Full path to the validation-report.md file
 * @param unitId - Unit identifier (e.g., 'UNIT-001')
 * @param boltData - Validation data for the BOLT being recorded
 *
 * @example
 * ```typescript
 * generateValidationReport(
 *   '/path/to/aidlc-docs/construction/UNIT-001/validation-report.md',
 *   'UNIT-001',
 *   {
 *     boltId: 'BOLT-001',
 *     boltTitle: 'Implement user authentication',
 *     commandsExecuted: [{ command: 'npm test', exitCode: 0, result: 'passed' }],
 *     testResults: [{ suite: 'auth', pass: 15, fail: 0, skip: 0 }],
 *     filesChanged: [{ path: 'src/auth.ts', action: 'created' }],
 *     gateApprovedBy: 'human',
 *     dualValidation: { parentConformance: 95, rootConformance: 92 },
 *     riskTier: 2
 *   }
 * );
 * ```
 */
export function generateValidationReport(
  reportPath: string,
  unitId: string,
  boltData: BoltValidationData
): void {
  // Ensure the directory exists
  fs.ensureDirSync(dirname(reportPath));

  // Read existing content or create header
  let existingContent = '';
  if (fs.existsSync(reportPath)) {
    existingContent = fs.readFileSync(reportPath, 'utf-8');
  } else {
    existingContent = `# Validation Report: ${unitId}\n\n`;
  }

  // Build commands section
  const commandsSection = boltData.commandsExecuted.length > 0
    ? boltData.commandsExecuted.map(c => `- \`${c.command}\` -> exit ${c.exitCode} (${c.result})`).join('\n')
    : '- No commands recorded';

  // Build test results table
  const testHeader = '| Suite | Pass | Fail | Skip |\n|-------|------|------|------|';
  const testRows = boltData.testResults.length > 0
    ? boltData.testResults.map(t => `| ${t.suite} | ${t.pass} | ${t.fail} | ${t.skip} |`).join('\n')
    : '| - | - | - | - |';

  // Build files changed section
  const filesSection = boltData.filesChanged.length > 0
    ? boltData.filesChanged.map(f => `- ${f.path} (${f.action})`).join('\n')
    : '- No files recorded';

  // Build optional CI check results section
  const ciSection = boltData.ciCheckResults && boltData.ciCheckResults.length > 0
    ? `\n### CI Check Results\n${boltData.ciCheckResults.map(c => `- ${c.name}: ${c.passed ? 'PASS' : 'FAIL'} - ${c.details}`).join('\n')}`
    : '';

  // Assemble the BOLT section
  const boltSection = `## ${boltData.boltId}: ${boltData.boltTitle}
### Commands Executed
${commandsSection}

### Test Results
${testHeader}
${testRows}

### Files Changed
${filesSection}

### Evidence
- Gate 4 approved by: ${boltData.gateApprovedBy}
- Dual validation: ${boltData.dualValidation.parentConformance}% conformance (parent), ${boltData.dualValidation.rootConformance}% conformance (root)
- Risk tier: ${boltData.riskTier}${ciSection}

---

`;

  // Append to existing content and write
  const fullContent = existingContent + boltSection;
  fs.writeFileSync(reportPath, fullContent, 'utf-8');
}

/**
 * Reads the content of an existing validation report.
 *
 * @param reportPath - Full path to the validation-report.md file
 * @returns The report content as a string, or null if the file doesn't exist
 *
 * @example
 * ```typescript
 * const content = readValidationReport('/path/to/validation-report.md');
 * if (content) {
 *   console.log('Report exists:', content);
 * }
 * ```
 */
export function readValidationReport(reportPath: string): string | null {
  try {
    if (!fs.existsSync(reportPath)) return null;
    return fs.readFileSync(reportPath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Constructs the path to a unit's validation report file.
 *
 * @param projectPath - Root path of the project
 * @param unitId - Unit identifier (e.g., 'UNIT-001')
 * @returns Full path to the validation report file
 *
 * @example
 * ```typescript
 * const reportPath = getValidationReportPath('/project/root', 'my-workflow', 'UNIT-001');
 * // Returns: '/project/root/aidlc-docs/my-workflow/construction/UNIT-001/validation-report.md'
 * ```
 */
export function getValidationReportPath(
  projectPath: string,
  workflowId: string,
  unitId: string
): string {
  return join(projectPath, 'aidlc-docs', workflowId, 'construction', unitId, 'validation-report.md');
}
