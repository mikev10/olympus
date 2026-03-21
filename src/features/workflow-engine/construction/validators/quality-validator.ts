import fs from 'fs-extra';
import path from 'path';
import type { ValidatorResult, Finding } from '../../phase-types.js';
import type { ValidatorFn, ValidatorConfig } from './types.js';
import { applyAllowFailures } from './pipeline.js';
import {
  detectAntiPatterns,
  calculateNegativeCaseRatio,
} from './quality-patterns.js';

const NEGATIVE_CASE_THRESHOLD = 0.20;

async function readTestFiles(testDir: string): Promise<Array<{ filePath: string; content: string }>> {
  if (!await fs.pathExists(testDir)) {
    return [];
  }
  const entries = await fs.readdir(testDir);
  const testFiles = entries.filter(e => e.endsWith('.test.ts') || e.endsWith('.test.js') || e.endsWith('.spec.ts') || e.endsWith('.spec.js'));
  const results: Array<{ filePath: string; content: string }> = [];
  for (const file of testFiles) {
    const filePath = path.join(testDir, file);
    const content = await fs.readFile(filePath, 'utf-8');
    results.push({ filePath, content });
  }
  return results;
}

function countTotalTests(content: string): number {
  const matches = content.match(/(?:^|\n)\s*(?:it|test)\s*\(\s*['"`]/g);
  return matches ? matches.length : 0;
}

function buildQualityArtifact(
  findings: Finding[],
  validatedCount: number,
  totalCount: number,
  negativeRatio: number,
  negativeTotal: number,
  negativeCount: number
): string {
  const rejections = findings.filter(f => f.severity === 'error');
  const warnings = findings.filter(f => f.severity === 'warning');
  const rejectedCount = totalCount - validatedCount;

  const lines: string[] = [
    '# Quality Validation Report',
    '',
    '## Summary',
    '',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Total tests | ${totalCount} |`,
    `| Validated tests | ${validatedCount} |`,
    `| Rejected tests | ${rejectedCount} |`,
    `| Warnings | ${warnings.length} |`,
    '',
  ];

  if (rejections.length > 0) {
    lines.push('## Rejections', '');
    lines.push('| Test | File | Reason |');
    lines.push('|------|------|--------|');
    for (const f of rejections) {
      const testName = f.location?.testName ?? 'unknown';
      const file = f.location?.file ?? 'unknown';
      lines.push(`| ${testName} | ${file} | ${f.message} |`);
    }
    lines.push('');
  }

  if (warnings.length > 0) {
    lines.push('## Warnings', '');
    lines.push('| Test | File | Warning | Details |');
    lines.push('|------|------|---------|---------|');
    for (const f of warnings) {
      const testName = f.location?.testName ?? 'unknown';
      const file = f.location?.file ?? 'unknown';
      lines.push(`| ${testName} | ${file} | ${f.category} | ${f.message} |`);
    }
    lines.push('');
  }

  lines.push('## Negative Case Coverage', '');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total tests | ${negativeTotal} |`);
  lines.push(`| Negative tests | ${negativeCount} |`);
  lines.push(`| Ratio | ${(negativeRatio * 100).toFixed(1)}% |`);
  lines.push(`| Threshold | ${(NEGATIVE_CASE_THRESHOLD * 100).toFixed(1)}% |`);
  lines.push(`| Status | ${negativeRatio >= NEGATIVE_CASE_THRESHOLD ? 'PASS' : 'BELOW THRESHOLD'} |`);
  lines.push('');

  return lines.join('\n');
}

export function createQualityValidator(): ValidatorFn {
  return async (config: ValidatorConfig): Promise<ValidatorResult> => {
    const testDir = path.join(
      config.projectPath,
      'aidlc-docs',
      config.workflowId,
      'construction',
      config.unitId,
      'testing'
    );

    const artifactPath = path.join(testDir, 'quality-validation.md');

    const testFiles = await readTestFiles(testDir);

    if (testFiles.length === 0) {
      const emptyResult: ValidatorResult = {
        status: 'passed',
        findings: [],
        artifactPath,
      };
      await fs.ensureDir(path.dirname(artifactPath));
      await fs.writeFile(artifactPath, buildQualityArtifact([], 0, 0, 0, 0, 0), 'utf-8');
      if (config.allowFailures) return applyAllowFailures(emptyResult);
      return emptyResult;
    }

    const allFindings: Finding[] = [];
    let totalTests = 0;

    for (const { filePath, content } of testFiles) {
      const fileName = path.basename(filePath);
      const fileFindings = detectAntiPatterns(content, fileName, filePath);
      allFindings.push(...fileFindings);
      totalTests += countTotalTests(content);
    }

    const combinedContent = testFiles.map(f => f.content).join('\n');
    const { ratio, totalTests: negTotal, negativeTests: negCount } = calculateNegativeCaseRatio(combinedContent);

    const negativeFindings: Finding[] = [];
    if (negTotal > 0 && ratio < NEGATIVE_CASE_THRESHOLD) {
      negativeFindings.push({
        id: `negative-case-ratio:${config.unitId}`,
        severity: 'warning',
        category: 'negative-case-ratio',
        message: `Negative case ratio is ${(ratio * 100).toFixed(1)}% (${negCount}/${negTotal}), below the ${(NEGATIVE_CASE_THRESHOLD * 100).toFixed(1)}% threshold`,
      });
    }

    const findings = [...allFindings, ...negativeFindings];
    const rejections = findings.filter(f => f.severity === 'error');
    const warnings = findings.filter(f => f.severity === 'warning');
    const validatedCount = Math.max(0, totalTests - rejections.length);

    let status: ValidatorResult['status'];
    if (rejections.length > 0) {
      status = 'failed';
    } else if (warnings.length > 0) {
      status = 'warned';
    } else {
      status = 'passed';
    }

    await fs.ensureDir(path.dirname(artifactPath));
    await fs.writeFile(
      artifactPath,
      buildQualityArtifact(findings, validatedCount, totalTests, ratio, negTotal, negCount),
      'utf-8'
    );

    const result: ValidatorResult = { status, findings, artifactPath };
    if (config.allowFailures) return applyAllowFailures(result);
    return result;
  };
}
