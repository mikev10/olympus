import fs from 'fs-extra';
import path from 'path';
import type { ValidatorResult, Finding } from '../../phase-types.js';
import type { ValidatorFn, ValidatorConfig } from './types.js';
import { applyAllowFailures } from './pipeline.js';

const CRITICAL_KEYWORDS = [
  'auth', 'payment', 'security', 'encrypt', 'token',
  'credential', 'password', 'session', 'permission',
];

const MAX_MUTATION_POINTS = 10;

export interface MutationPoint {
  filePath: string;
  line: number;
  original: string;
  mutated: string;
  faultType: 'conditional-negation' | 'comparison-boundary' | 'return-value';
  context: string;
}

export interface MutationResult {
  point: MutationPoint;
  caught: boolean;
  testFile?: string;
  testName?: string;
}

export function identifyCriticalPaths(files: Array<{ filePath: string; content: string }>): string[] {
  const critical: string[] = [];

  for (const { filePath, content } of files) {
    const fileName = path.basename(filePath).toLowerCase();
    const hasCriticalName = CRITICAL_KEYWORDS.some(keyword =>
      new RegExp(`\\b${keyword}\\b`, 'i').test(fileName)
    );
    const hasCriticalContent = CRITICAL_KEYWORDS.some(keyword =>
      new RegExp(`\\b${keyword}`, 'i').test(content)
    );

    if (hasCriticalName || hasCriticalContent) {
      critical.push(filePath);
    }
  }

  return critical;
}

export function detectMutationPoints(content: string, filePath: string): MutationPoint[] {
  const lines = content.split('\n');
  const points: MutationPoint[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (points.length >= MAX_MUTATION_POINTS) break;

    const lineNum = i + 1;
    const trimmed = lines[i].trim();

    if (/===/.test(trimmed)) {
      points.push({ filePath, line: lineNum, original: trimmed, mutated: trimmed.replace(/===/, '!=='), faultType: 'conditional-negation', context: trimmed });
      continue;
    }

    if (/!==/.test(trimmed)) {
      points.push({ filePath, line: lineNum, original: trimmed, mutated: trimmed.replace(/!==/, '==='), faultType: 'conditional-negation', context: trimmed });
      continue;
    }

    if (/\breturn\s+true\b/.test(trimmed)) {
      points.push({ filePath, line: lineNum, original: trimmed, mutated: trimmed.replace(/\breturn\s+true\b/, 'return false'), faultType: 'return-value', context: trimmed });
      continue;
    }

    if (/\breturn\s+false\b/.test(trimmed)) {
      points.push({ filePath, line: lineNum, original: trimmed, mutated: trimmed.replace(/\breturn\s+false\b/, 'return true'), faultType: 'return-value', context: trimmed });
      continue;
    }

    if (/\breturn\s+null\b/.test(trimmed)) {
      points.push({ filePath, line: lineNum, original: trimmed, mutated: trimmed.replace(/\breturn\s+null\b/, 'return undefined'), faultType: 'return-value', context: trimmed });
      continue;
    }

    // lookbehind (?<!=) excludes the `=` in `=>`, so `>=` is detected but `=>` is not
    if (/(?<!=)>=/.test(trimmed)) {
      points.push({ filePath, line: lineNum, original: trimmed, mutated: trimmed.replace(/(?<!=)>=/, '>'), faultType: 'comparison-boundary', context: trimmed });
      continue;
    }

    if (/<=(?!=)/.test(trimmed) && !trimmed.includes('=>')) {
      points.push({ filePath, line: lineNum, original: trimmed, mutated: trimmed.replace(/<=(?!=)/, '<'), faultType: 'comparison-boundary', context: trimmed });
      continue;
    }

    if (/(?<![=!<>])>(?![>=])/.test(trimmed) && !/=>/.test(trimmed)) {
      points.push({ filePath, line: lineNum, original: trimmed, mutated: trimmed.replace(/(?<![=!<>])>(?![>=])/, '>='), faultType: 'comparison-boundary', context: trimmed });
      continue;
    }

    if (/(?<![=!<>])<(?![<=])/.test(trimmed) && !/=>/.test(trimmed)) {
      points.push({ filePath, line: lineNum, original: trimmed, mutated: trimmed.replace(/(?<![=!<>])<(?![<=])/, '<='), faultType: 'comparison-boundary', context: trimmed });
      continue;
    }

    if (/\bif\s*\(!/.test(trimmed)) {
      points.push({ filePath, line: lineNum, original: trimmed, mutated: trimmed.replace(/\bif\s*\(!/, 'if ('), faultType: 'conditional-negation', context: trimmed });
      continue;
    }

    if (/\bif\s*\((?!!)/.test(trimmed)) {
      points.push({ filePath, line: lineNum, original: trimmed, mutated: trimmed.replace(/\bif\s*\((?!!)/, 'if (!'), faultType: 'conditional-negation', context: trimmed });
      continue;
    }
  }

  return points.slice(0, MAX_MUTATION_POINTS);
}

export function checkTestCoverage(
  mutationPoints: MutationPoint[],
  testFiles: Array<{ filePath: string; content: string }>
): MutationResult[] {
  return mutationPoints.map(point => {
    const sourceFileName = path.basename(point.filePath, path.extname(point.filePath));

    for (const { filePath: testFilePath, content: testContent } of testFiles) {
      const referencesSource =
        testContent.includes(sourceFileName) ||
        testContent.includes(path.basename(point.filePath));

      if (!referencesSource) continue;

      if (hasAssertionForMutation(point, testContent)) {
        const testNameMatch = testContent.match(/(?:it|test)\s*\(\s*['"`]([^'"`]+)['"`]/);
        return {
          point,
          caught: true,
          testFile: testFilePath,
          testName: testNameMatch ? testNameMatch[1] : undefined,
        };
      }
    }

    return { point, caught: false };
  });
}

function hasAssertionForMutation(point: MutationPoint, testContent: string): boolean {
  if (!(/expect\s*\(/.test(testContent))) return false;

  if (point.faultType === 'conditional-negation') {
    return (
      /\b(false|null|undefined|throws?|rejects?|denied|unauthorized|forbidden|invalid)\b/i.test(testContent) ||
      /toBe\s*\(\s*false\s*\)/.test(testContent) ||
      /toBeFalsy/.test(testContent) ||
      /toThrow/.test(testContent) ||
      /toReject/.test(testContent) ||
      /status.*4\d\d/.test(testContent)
    );
  }

  if (point.faultType === 'comparison-boundary') {
    return (
      /\b(0|1|limit|max|min|boundary|threshold|exactly|equal)\b/i.test(testContent) ||
      /toBe\s*\(\s*\d+\s*\)/.test(testContent) ||
      /toEqual/.test(testContent)
    );
  }

  if (point.faultType === 'return-value') {
    return (
      /toBe\s*\(\s*(true|false|null|undefined)\s*\)/.test(testContent) ||
      /toBeTruthy/.test(testContent) ||
      /toBeFalsy/.test(testContent) ||
      /toBeNull/.test(testContent) ||
      /toBeUndefined/.test(testContent)
    );
  }

  return false;
}

export function buildMutationArtifact(
  results: MutationResult[],
  criticalFiles: string[],
  skipped: boolean
): string {
  const lines: string[] = ['# Mutation Validation Report', ''];

  if (skipped) {
    lines.push('## Status: Skipped', '');
    lines.push('No critical-path files were identified in this unit.');
    lines.push('Mutation spot-check requires files containing keywords: ' + CRITICAL_KEYWORDS.join(', ') + '.');
    lines.push('');
    return lines.join('\n');
  }

  const caughtCount = results.filter(r => r.caught).length;
  const uncaughtCount = results.filter(r => !r.caught).length;

  lines.push('## Summary', '');
  lines.push('| Metric | Value |');
  lines.push('|--------|-------|');
  lines.push(`| Critical files analyzed | ${criticalFiles.length} |`);
  lines.push(`| Mutation points identified | ${results.length} |`);
  lines.push(`| Caught by tests | ${caughtCount} |`);
  lines.push(`| Uncaught (no test) | ${uncaughtCount} |`);
  lines.push('');

  if (criticalFiles.length > 0) {
    lines.push('## Critical Files', '');
    for (const f of criticalFiles) {
      lines.push(`- \`${path.basename(f)}\``);
    }
    lines.push('');
  }

  if (results.length > 0) {
    lines.push('## Mutation Points', '');
    lines.push('| File | Line | Fault Type | Original | Mutated | Status | Test Reference |');
    lines.push('|------|------|------------|----------|---------|--------|----------------|');

    for (const r of results) {
      const status = r.caught ? 'CAUGHT' : 'UNCAUGHT';
      const testRef = r.caught
        ? (r.testName ? `\`${r.testName}\`` : path.basename(r.testFile ?? ''))
        : '—';
      const originalTrunc = r.point.original.length > 40 ? r.point.original.slice(0, 37) + '...' : r.point.original;
      const mutatedTrunc = r.point.mutated.length > 40 ? r.point.mutated.slice(0, 37) + '...' : r.point.mutated;

      lines.push(`| ${path.basename(r.point.filePath)} | ${r.point.line} | ${r.point.faultType} | ${originalTrunc} | ${mutatedTrunc} | ${status} | ${testRef} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

async function readSourceFiles(filePaths: string[]): Promise<Array<{ filePath: string; content: string }>> {
  const results: Array<{ filePath: string; content: string }> = [];
  for (const filePath of filePaths) {
    try {
      if (await fs.pathExists(filePath)) {
        const content = await fs.readFile(filePath, 'utf-8');
        results.push({ filePath, content });
      }
    } catch (_) {
    }
  }
  return results;
}

async function readTestFiles(testDir: string): Promise<Array<{ filePath: string; content: string }>> {
  if (!await fs.pathExists(testDir)) return [];
  const entries = await fs.readdir(testDir);
  const testFileNames = entries.filter(
    e => e.endsWith('.test.ts') || e.endsWith('.test.js') || e.endsWith('.spec.ts') || e.endsWith('.spec.js')
  );
  const results: Array<{ filePath: string; content: string }> = [];
  for (const file of testFileNames) {
    const filePath = path.join(testDir, file);
    const content = await fs.readFile(filePath, 'utf-8');
    results.push({ filePath, content });
  }
  return results;
}

export function createMutationValidator(): ValidatorFn {
  return async (config: ValidatorConfig): Promise<ValidatorResult> => {
    const testDir = path.join(
      config.projectPath, 'aidlc-docs', config.workflowId, 'construction', config.unitId, 'testing'
    );
    const artifactPath = path.join(testDir, 'mutation-validation.md');

    const sourceFiles = await readSourceFiles(config.unitFiles);
    const criticalFilePaths = identifyCriticalPaths(sourceFiles);

    if (criticalFilePaths.length === 0) {
      await fs.ensureDir(path.dirname(artifactPath));
      await fs.writeFile(artifactPath, buildMutationArtifact([], [], true), 'utf-8');
      const skippedResult: ValidatorResult = { status: 'skipped', findings: [], artifactPath };
      if (config.allowFailures) return applyAllowFailures(skippedResult);
      return skippedResult;
    }

    const allMutationPoints: MutationPoint[] = [];
    for (const sourceFile of sourceFiles) {
      if (!criticalFilePaths.includes(sourceFile.filePath)) continue;
      allMutationPoints.push(...detectMutationPoints(sourceFile.content, sourceFile.filePath));
      if (allMutationPoints.length >= MAX_MUTATION_POINTS) break;
    }
    const cappedPoints = allMutationPoints.slice(0, MAX_MUTATION_POINTS);

    const testFiles = await readTestFiles(testDir);
    const mutationResults = checkTestCoverage(cappedPoints, testFiles);

    const findings: Finding[] = [];
    for (const r of mutationResults) {
      if (!r.caught) {
        findings.push({
          id: `mutation-uncaught:${path.basename(r.point.filePath)}:${r.point.line}`,
          severity: 'warning',
          category: 'uncaught-mutation',
          message: `Uncaught ${r.point.faultType} mutation at ${path.basename(r.point.filePath)}:${r.point.line} — \`${r.point.original}\` → \`${r.point.mutated}\``,
          location: { file: r.point.filePath, line: r.point.line },
        });
      }
    }

    const status: ValidatorResult['status'] = findings.length === 0 ? 'passed' : 'warned';

    await fs.ensureDir(path.dirname(artifactPath));
    await fs.writeFile(artifactPath, buildMutationArtifact(mutationResults, criticalFilePaths, false), 'utf-8');

    const result: ValidatorResult = { status, findings, artifactPath };
    if (config.allowFailures) return applyAllowFailures(result);
    return result;
  };
}
