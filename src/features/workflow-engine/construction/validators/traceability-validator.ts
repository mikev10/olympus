import fs from 'fs-extra';
import path from 'path';
import type { ValidatorResult, Finding } from '../../phase-types.js';
import type { ValidatorFn, ValidatorConfig } from './types.js';
import { applyAllowFailures } from './pipeline.js';

export interface Criterion {
  id: string;
  text: string;
  source: string;
}

export interface TraceabilitySource {
  type: 'user-stories' | 'requirements' | 'unit-spec';
  criteria: Criterion[];
}

export interface TraceabilityMapping {
  criterion: Criterion;
  tests: Array<{ file: string; testName: string }>;
  status: 'Covered' | 'Gap' | 'Not Testable';
  notTestableReason?: string;
}

const NOT_TESTABLE_PHRASES = [
  'deployment',
  'infrastructure',
  'manual review',
  'visual inspection',
  'ui style',
  'not testable',
];

function isNotTestable(text: string): boolean {
  const lower = text.toLowerCase();
  return NOT_TESTABLE_PHRASES.some(phrase => lower.includes(phrase));
}

function notTestableReason(text: string): string {
  const lower = text.toLowerCase();
  for (const phrase of NOT_TESTABLE_PHRASES) {
    if (lower.includes(phrase)) {
      return `Criterion contains "${phrase}" — inherently untestable`;
    }
  }
  return 'Inherently untestable';
}

function parseUserStories(content: string): Criterion[] {
  const criteria: Criterion[] = [];
  const seen = new Set<string>();
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/\b(AC-\d{3}\.\d+)\b/);
    if (!match) continue;

    const id = match[1];
    if (seen.has(id)) continue;
    seen.add(id);

    const textParts: string[] = [];
    const lineClean = line.replace(/\*+/g, '').replace(/^[-*]\s*/, '').trim();
    textParts.push(lineClean);

    for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
      const nextLine = lines[j].trim();
      if (/^(Given|When|Then|And|But)\b/i.test(nextLine)) {
        textParts.push(nextLine);
      } else if (nextLine === '' && j > i + 1) {
        break;
      } else if (/^\*\*(AC-|FR-)/.test(nextLine) || /^#+\s/.test(nextLine)) {
        break;
      }
    }

    criteria.push({ id, text: textParts.join(' ').trim(), source: 'stories.md' });
  }

  if (criteria.length === 0) {
    let counter = 1;
    const storyPattern = /###\s+(.+)/g;
    let sm: RegExpExecArray | null;
    while ((sm = storyPattern.exec(content)) !== null) {
      criteria.push({ id: `AC-001.${counter}`, text: sm[1].trim(), source: 'stories.md' });
      counter++;
    }
  }

  return criteria;
}

function parseRequirements(content: string): Criterion[] {
  const criteria: Criterion[] = [];
  const seen = new Set<string>();

  for (const line of content.split('\n')) {
    const match = line.match(/\b(FR-\d{3}\.\d+)\b/);
    if (!match) continue;

    const id = match[1];
    if (seen.has(id)) continue;
    seen.add(id);

    const rest = line.replace(/\*+/g, '').replace(/^[-*]\s*/, '').trim();
    const text = rest.replace(id, '').replace(/^[:\s-]+/, '').trim() || id;

    criteria.push({ id, text, source: 'requirements.md' });
  }

  return criteria;
}

function parseUnitSpec(content: string, unitId: string): Criterion[] {
  const frCriteria = parseRequirements(content);
  if (frCriteria.length > 0) {
    return frCriteria.map(c => ({ ...c, source: 'spec.md' }));
  }

  const criteria: Criterion[] = [];
  let counter = 1;
  for (const line of content.split('\n')) {
    const headingMatch = line.match(/^#{2,4}\s+(.+)/);
    if (headingMatch) {
      const text = headingMatch[1].trim();
      if (text.length > 3) {
        criteria.push({ id: `SPEC-${unitId.toUpperCase()}.${counter}`, text, source: 'spec.md' });
        counter++;
      }
    }
  }

  return criteria;
}

export async function loadTraceabilitySources(
  config: ValidatorConfig
): Promise<TraceabilitySource | null> {
  const basePath = path.join(config.projectPath, 'aidlc-docs', config.workflowId, 'inception');

  const storiesPath = path.join(basePath, 'user-stories', 'stories.md');
  if (await fs.pathExists(storiesPath)) {
    const content = await fs.readFile(storiesPath, 'utf-8');
    const criteria = parseUserStories(content);
    if (criteria.length > 0) {
      return { type: 'user-stories', criteria };
    }
  }

  const requirementsPath = path.join(basePath, 'requirements', 'requirements.md');
  if (await fs.pathExists(requirementsPath)) {
    const content = await fs.readFile(requirementsPath, 'utf-8');
    const criteria = parseRequirements(content);
    if (criteria.length > 0) {
      return { type: 'requirements', criteria };
    }
  }

  const specPath = path.join(
    config.projectPath,
    'aidlc-docs',
    config.workflowId,
    'construction',
    config.unitId,
    'spec.md'
  );
  if (await fs.pathExists(specPath)) {
    const content = await fs.readFile(specPath, 'utf-8');
    const criteria = parseUnitSpec(content, config.unitId);
    if (criteria.length > 0) {
      return { type: 'unit-spec', criteria };
    }
  }

  return null;
}

export function mapTestsToCriteria(
  criteria: Criterion[],
  testFiles: Array<{ filePath: string; content: string }>
): TraceabilityMapping[] {
  return criteria.map(criterion => {
    if (isNotTestable(criterion.text)) {
      return {
        criterion,
        tests: [],
        status: 'Not Testable',
        notTestableReason: notTestableReason(criterion.text),
      };
    }

    const matchingTests: Array<{ file: string; testName: string }> = [];
    const idLower = criterion.id.toLowerCase();
    const keywords = criterion.text
      .toLowerCase()
      .split(/\W+/)
      .filter(w => w.length > 4);

    for (const { filePath, content } of testFiles) {
      const fileName = path.basename(filePath);
      const contentLower = content.toLowerCase();

      const fileReferencesId = contentLower.includes(idLower);
      const fileReferencesKeyword =
        keywords.length > 0 && keywords.some(kw => contentLower.includes(kw));

      if (!fileReferencesId && !fileReferencesKeyword) {
        continue;
      }

      for (const line of content.split('\n')) {
        const testMatch = line.match(/(?:^|\s)(?:it|test)\s*\(\s*['"`]([^'"`]+)['"`]/);
        if (!testMatch) continue;

        const testName = testMatch[1];
        const testNameLower = testName.toLowerCase();
        const testReferencesId = testNameLower.includes(idLower);
        const testReferencesKeyword = keywords.some(kw => testNameLower.includes(kw));

        if (testReferencesId || testReferencesKeyword || fileReferencesId) {
          const alreadyAdded = matchingTests.some(
            t => t.file === fileName && t.testName === testName
          );
          if (!alreadyAdded) {
            matchingTests.push({ file: fileName, testName });
          }
        }
      }
    }

    const status: TraceabilityMapping['status'] = matchingTests.length > 0 ? 'Covered' : 'Gap';
    return { criterion, tests: matchingTests, status };
  });
}

export function buildTraceabilityArtifact(
  mappings: TraceabilityMapping[],
  sourceType: string
): string {
  const sourceLabel =
    sourceType === 'user-stories'
      ? 'User Stories (Gherkin AC)'
      : sourceType === 'requirements'
      ? 'Requirements (FR sub-requirements)'
      : 'Unit Spec';

  const covered = mappings.filter(m => m.status === 'Covered').length;
  const gaps = mappings.filter(m => m.status === 'Gap').length;
  const notTestable = mappings.filter(m => m.status === 'Not Testable').length;
  const total = mappings.length;

  const lines: string[] = [
    '# Requirement-Test Traceability Map',
    '',
    `**Source**: ${sourceLabel}`,
    '',
    '## Summary',
    '',
    '| Metric | Value |',
    '|--------|-------|',
    `| Total criteria | ${total} |`,
    `| Covered | ${covered} |`,
    `| Gaps | ${gaps} |`,
    `| Not Testable | ${notTestable} |`,
    '',
    '## Traceability Table',
    '',
    '| Requirement/Criterion | Test(s) | Status |',
    '|-----------------------|---------|--------|',
  ];

  for (const mapping of mappings) {
    const criterionText = mapping.criterion.text;
    const truncated = criterionText.length > 60 ? criterionText.slice(0, 60) + '...' : criterionText;
    const criterionCell = `${mapping.criterion.id}: ${truncated}`;
    let testsCell: string;
    if (mapping.status === 'Not Testable') {
      testsCell = `— (${mapping.notTestableReason ?? 'Not Testable'})`;
    } else if (mapping.tests.length === 0) {
      testsCell = '—';
    } else {
      testsCell = mapping.tests.map(t => `${t.file}: ${t.testName}`).join('<br>');
    }
    lines.push(`| ${criterionCell} | ${testsCell} | ${mapping.status} |`);
  }

  lines.push('');
  return lines.join('\n');
}

async function readTestFiles(
  testDir: string
): Promise<Array<{ filePath: string; content: string }>> {
  if (!(await fs.pathExists(testDir))) {
    return [];
  }
  const entries = await fs.readdir(testDir);
  const testFiles = entries.filter(
    e =>
      e.endsWith('.test.ts') ||
      e.endsWith('.test.js') ||
      e.endsWith('.spec.ts') ||
      e.endsWith('.spec.js')
  );
  const results: Array<{ filePath: string; content: string }> = [];
  for (const file of testFiles) {
    const filePath = path.join(testDir, file);
    const content = await fs.readFile(filePath, 'utf-8');
    results.push({ filePath, content });
  }
  return results;
}

export function createTraceabilityValidator(): ValidatorFn {
  return async (config: ValidatorConfig): Promise<ValidatorResult> => {
    const testDir = path.join(
      config.projectPath,
      'aidlc-docs',
      config.workflowId,
      'construction',
      config.unitId,
      'testing'
    );

    const artifactPath = path.join(testDir, 'requirement-test-map.md');

    const source = await loadTraceabilitySources(config);

    if (source === null) {
      const skippedResult: ValidatorResult = {
        status: 'skipped',
        findings: [
          {
            id: `traceability:no-source:${config.unitId}`,
            severity: 'info',
            category: 'no-traceability-source',
            message:
              'No traceability source found (user stories, requirements, or unit spec). Traceability skipped.',
          },
        ],
        artifactPath,
      };
      if (config.allowFailures) return applyAllowFailures(skippedResult);
      return skippedResult;
    }

    let { criteria } = source;

    if (config.workflowDepth === 0) {
      const bugfixKeywords = ['reproduce', 'fix', 'verify'];
      criteria = criteria.filter(c => {
        const lower = c.text.toLowerCase();
        return bugfixKeywords.some(k => lower.includes(k));
      });
    }

    const testFiles = await readTestFiles(testDir);
    const mappings = mapTestsToCriteria(criteria, testFiles);
    const gaps = mappings.filter(m => m.status === 'Gap');
    const findings: Finding[] = [];

    for (const gap of gaps) {
      const severity = config.workflowDepth >= 2 ? ('error' as const) : ('warning' as const);
      findings.push({
        id: `traceability:gap:${gap.criterion.id}`,
        severity,
        category: 'traceability-gap',
        message: `No test covers criterion ${gap.criterion.id}: "${gap.criterion.text.slice(0, 80)}"`,
      });
    }

    let status: ValidatorResult['status'];
    if (gaps.length === 0) {
      status = 'passed';
    } else if (config.workflowDepth >= 2) {
      status = 'failed';
    } else if (config.workflowDepth === 1) {
      status = 'warned';
    } else {
      status = 'warned';
    }

    await fs.ensureDir(path.dirname(artifactPath));
    await fs.writeFile(artifactPath, buildTraceabilityArtifact(mappings, source.type), 'utf-8');

    const result: ValidatorResult = { status, findings, artifactPath };
    if (config.allowFailures) return applyAllowFailures(result);
    return result;
  };
}
