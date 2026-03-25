import * as fs from 'fs';
import * as path from 'path';
import { runImpactScan, type ImpactScanResult } from './impact-scanner.js';
import { detectSignificantDecisions, generateADR } from './adr-generator.js';
import { evaluateRecreationReadiness } from './recreation-readiness.js';
import type { RecreationReadinessResult } from '../phase-types.js';

export interface FeatureDocOptions {
  unitId: string;
  workflowId: string;
  projectPath: string;
  depth: 'minimal' | 'standard' | 'comprehensive';
  pathway: string;
  unitFiles?: string[];
  intentPath?: string;
  requirementsPath?: string;
  testResults?: { total: number; passed: number; failed: number };
}

export interface FeatureDocResult {
  status: 'completed' | 'failed' | 'skipped';
  path: string | null;
  sections: string[];
  error?: string;
}

export interface DocumentationGenerationResult {
  featureDoc: FeatureDocResult;
  impactScan?: { status: string; path: string | null };
  adrCount?: number;
  recreationReadiness?: RecreationReadinessResult;
}

/**
 * Returns the required sections for a given depth level and pathway.
 */
export function getRequiredSections(depth: string, pathway: string): string[] {
  if (pathway === 'bugfix') return ['Summary'];

  switch (depth) {
    case 'minimal':
      return ['Summary', 'Architecture Decisions', 'API Contracts'];
    case 'standard':
    case 'comprehensive':
      return [
        'Summary',
        'Architecture Decisions',
        'API Contracts',
        'Data Models',
        'Configuration Changes',
        'Dependencies',
        'Known Limitations',
        'How to Test',
        'Recreation Notes',
      ];
    default:
      // SHALLOW depth
      return ['Summary'];
  }
}

export function buildFeatureDocPrompt(options: FeatureDocOptions): string {
  const sections = getRequiredSections(options.depth, options.pathway);

  const filesList =
    options.unitFiles && options.unitFiles.length > 0
      ? options.unitFiles.map(f => `  - ${f}`).join('\n')
      : '  (no unit files provided)';

  const testSummary = options.testResults
    ? `Tests: ${options.testResults.total} total, ${options.testResults.passed} passed, ${options.testResults.failed} failed`
    : 'No test results available';

  return `Generate feature documentation for unit "${options.unitId}" in workflow "${options.workflowId}".

## Context
- Depth: ${options.depth}
- Pathway: ${options.pathway}
- Unit files:
${filesList}
- Test results: ${testSummary}

## Required Sections
Generate substantive content for each of the following sections:
${sections.map((s, i) => `${i + 1}. ${s}`).join('\n')}

For each section provide detailed, accurate content based on the unit's implementation.
Do not use placeholder text — write real documentation.`;
}

export function writeFeatureDoc(
  content: string,
  options: {
    unitId: string;
    workflowId: string;
    depth: string;
    pathway: string;
    sections: string[];
    outputDir: string;
  }
): string {
  const docDir = path.join(options.outputDir, 'documentation');
  fs.mkdirSync(docDir, { recursive: true });

  const frontmatter = [
    '---',
    `unit: ${options.unitId}`,
    `workflow: ${options.workflowId}`,
    `depth: ${options.depth}`,
    `pathway: ${options.pathway}`,
    `generated_at: ${new Date().toISOString()}`,
    `sections: [${options.sections.join(', ')}]`,
    `recreation_readiness_score: null`,
    '---',
    '',
  ].join('\n');

  const outputPath = path.join(docDir, 'feature-doc.md');
  fs.writeFileSync(outputPath, frontmatter + content);
  return outputPath;
}

export function generateFeatureDocScaffold(options: FeatureDocOptions): string {
  const sections = getRequiredSections(options.depth, options.pathway);
  let content = `# Feature Documentation: ${options.unitId}\n\n`;

  for (const section of sections) {
    content += `## ${section}\n\n`;
    content += `<!-- TODO: Fill in ${section.toLowerCase()} content -->\n\n`;
  }

  if (options.testResults) {
    content += `## Test Results\n\n`;
    content += `- Total: ${options.testResults.total}\n`;
    content += `- Passed: ${options.testResults.passed}\n`;
    content += `- Failed: ${options.testResults.failed}\n\n`;
  }

  return content;
}

export function runPostDocGeneration(options: {
  projectPath: string;
  workflowId: string;
  unitId: string;
  modifiedFiles: string[];
}): { impactScan: ImpactScanResult; adrCount: number } {
  const impactScan = runImpactScan({ ...options });

  const decisions = detectSignificantDecisions(options.modifiedFiles, options.projectPath);
  let adrCount = 0;
  for (const decision of decisions) {
    generateADR({
      workflowId: options.workflowId,
      unitId: options.unitId,
      projectPath: options.projectPath,
      ...decision,
    });
    adrCount++;
  }

  return { impactScan, adrCount };
}

export function generateDocumentation(options: FeatureDocOptions): FeatureDocResult {
  try {
    const sections = getRequiredSections(options.depth, options.pathway);
    const content = generateFeatureDocScaffold(options);

    const outputDir = path.join(
      options.projectPath,
      'aidlc-docs',
      options.workflowId,
      'construction',
      options.unitId
    );

    const docPath = writeFeatureDoc(content, {
      unitId: options.unitId,
      workflowId: options.workflowId,
      depth: options.depth,
      pathway: options.pathway,
      sections,
      outputDir,
    });

    return { status: 'completed', path: docPath, sections };
  } catch (error) {
    return {
      status: 'failed',
      path: null,
      sections: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function generateDocumentationWithReadiness(options: FeatureDocOptions): DocumentationGenerationResult {
  const featureDoc = generateDocumentation(options);

  if (featureDoc.status !== 'completed' || featureDoc.path === null) {
    return { featureDoc };
  }

  const recreationReadiness = evaluateRecreationReadiness({
    featureDocPath: featureDoc.path,
    projectPath: options.projectPath,
    depth: options.depth,
    pathway: options.pathway,
  });

  appendRecreationReadinessFooter(featureDoc.path, recreationReadiness);

  return { featureDoc, recreationReadiness };
}

export function appendRecreationReadinessFooter(docPath: string, result: RecreationReadinessResult): void {
  try {
    const existing = fs.readFileSync(docPath, 'utf-8');
    const footer = [
      '',
      '---',
      '',
      '## Recreation Readiness',
      '',
      `**Overall Score**: ${result.overall_score}/5 (${result.passed ? 'PASSED' : 'FAILED'}) [mode: ${result.mode}]`,
      '',
      '| Dimension | Score |',
      '|-----------|-------|',
      `| Requirements Coverage | ${result.dimensions.requirements_coverage}/5 |`,
      `| Data Model Completeness | ${result.dimensions.data_model_completeness}/5 |`,
      `| Implementation Guidance | ${result.dimensions.implementation_guidance}/5 |`,
      `| Test Coverage Documentation | ${result.dimensions.test_coverage_documentation}/5 |`,
      `| Bootstrap Capability | ${result.dimensions.bootstrap_capability}/5 |`,
    ];

    if (result.remediation && result.remediation.length > 0) {
      footer.push('', '### Remediation Guidance', '');
      for (const item of result.remediation) {
        footer.push(`- ${item}`);
      }
    }

    footer.push('');
    fs.writeFileSync(docPath, existing + footer.join('\n'));
  } catch {
    // Non-fatal: scoring succeeded even if footer write fails
  }
}
