import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  evaluateRecreationReadiness,
  scoreRequirementsCoverage,
  scoreDataModelCompleteness,
  scoreImplementationGuidance,
  scoreTestCoverageDocumentation,
  scoreBootstrapCapability,
  generateRemediationGuidance,
  loadRecreationReadinessConfig,
} from '../../../features/workflow-engine/construction/recreation-readiness.js';

const testDir = path.join(process.cwd(), '.test-recreation-readiness');

function writeDoc(name: string, content: string): string {
  const p = path.join(testDir, name);
  fs.writeFileSync(p, content, 'utf-8');
  return p;
}

function writeConfig(mode: 'advisory' | 'blocking'): void {
  const configDir = path.join(testDir, '.olympus');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, 'config.json'),
    JSON.stringify({ recreation_readiness_mode: mode }),
    'utf-8'
  );
}

const RICH_DOC = `---
unit: u-001
workflow: wf-001
---

# Feature Documentation: u-001

## Summary

This unit implements the recreation readiness scoring system.
It satisfies FR-DOC-006, US-007, and the acceptance criteria for documentation quality gates.
See aidlc-docs/requirements.md for traceability.

- Evaluates 5 dimensions
- Returns deterministic scores
- Supports advisory and blocking modes

## Architecture Decisions

We chose a heuristic approach because deterministic scoring avoids AI non-determinism.
Instead of ML, we use regex-based signal detection. This trade-off keeps CI fast.
The decision to default to advisory mode lets teams adopt incrementally.

\`\`\`typescript
export function evaluateRecreationReadiness(options: RecreationReadinessOptions): RecreationReadinessResult {
  return evaluateDimensions(options);
}
\`\`\`

## API Contracts

The public surface uses \`RecreationReadinessOptions\` and \`RecreationReadinessResult\` types
defined in phase-types.ts.

\`\`\`typescript
interface RecreationReadinessOptions {
  featureDocPath: string;
  projectPath: string;
  depth: string;
  pathway: string;
}
\`\`\`

## Data Models

| Field | Type | Description |
|-------|------|-------------|
| overall_score | number | Average of 5 dimension scores |
| passed | boolean | True if score >= 4.0 or mode is advisory |
| mode | string | advisory or blocking |

\`\`\`typescript
interface RecreationReadinessResult {
  overall_score: number;
  passed: boolean;
  mode: 'advisory' | 'blocking';
  dimensions: Record<string, number>;
}
\`\`\`

Entity relationships stored in models/scoring.ts and schemas/readiness-schema.ts.

## Configuration Changes

recreation_readiness_mode can be set in .olympus/config.json.
Prerequisite: .olympus directory must exist.
Required: Node.js >= 20.

## Dependencies

- fs (Node built-in)
- path (Node built-in)
- phase-types (internal)

## Known Limitations

known limitation: regex-based scoring may produce false positives on templated content.
Depends on consistent markdown section headers.

## How to Test

1. Run \`npm test\` or \`npx vitest run src/__tests__/workflow-engine/construction/recreation-readiness.test.ts\`
2. Verify all dimension scorers return values 0-5
3. Check that blocking mode with score < 4.0 returns passed=false

\`\`\`bash
$ npx vitest run src/__tests__/workflow-engine/construction/recreation-readiness.test.ts
\`\`\`

Test files live at src/__tests__/workflow-engine/construction/recreation-readiness.test.ts
and src/__tests__/workflow-engine/construction/recreation-readiness.spec.ts.

## Recreation Notes

1. Install dependencies: npm install
2. Configure environment: copy .env.example to .env
3. Run: npm run build
`;

const SPARSE_DOC = `# Feature Documentation: u-001

Just a brief summary with very little content and no structure.
`;

describe('scoreRequirementsCoverage', () => {
  it('returns 5 for rich content with all signals', () => {
    const score = scoreRequirementsCoverage(RICH_DOC);
    expect(score).toBe(5);
  });

  it('returns 1 for minimal non-empty content with no signals', () => {
    const score = scoreRequirementsCoverage('hello world');
    expect(score).toBe(1);
  });

  it('returns 0 for empty string', () => {
    const score = scoreRequirementsCoverage('');
    expect(score).toBe(0);
  });

  it('is deterministic', () => {
    expect(scoreRequirementsCoverage(RICH_DOC)).toBe(scoreRequirementsCoverage(RICH_DOC));
  });
});

describe('scoreDataModelCompleteness', () => {
  it('returns 5 for rich content with data models section, types, table, code', () => {
    const score = scoreDataModelCompleteness(RICH_DOC);
    expect(score).toBe(5);
  });

  it('returns 0 for empty string', () => {
    expect(scoreDataModelCompleteness('')).toBe(0);
  });

  it('returns low score for sparse doc', () => {
    expect(scoreDataModelCompleteness(SPARSE_DOC)).toBeLessThanOrEqual(2);
  });

  it('is deterministic', () => {
    expect(scoreDataModelCompleteness(RICH_DOC)).toBe(scoreDataModelCompleteness(RICH_DOC));
  });
});

describe('scoreImplementationGuidance', () => {
  it('returns 5 for rich content with architecture decisions, api contracts, code', () => {
    const score = scoreImplementationGuidance(RICH_DOC);
    expect(score).toBe(5);
  });

  it('returns 0 for empty string', () => {
    expect(scoreImplementationGuidance('')).toBe(0);
  });

  it('returns low score for sparse doc', () => {
    expect(scoreImplementationGuidance(SPARSE_DOC)).toBeLessThanOrEqual(2);
  });

  it('is deterministic', () => {
    expect(scoreImplementationGuidance(RICH_DOC)).toBe(scoreImplementationGuidance(RICH_DOC));
  });
});

describe('scoreTestCoverageDocumentation', () => {
  it('returns 5 for rich content with how-to-test, vitest, test file refs, numbered steps', () => {
    const score = scoreTestCoverageDocumentation(RICH_DOC);
    expect(score).toBe(5);
  });

  it('returns 0 for empty string', () => {
    expect(scoreTestCoverageDocumentation('')).toBe(0);
  });

  it('returns low score for sparse doc', () => {
    expect(scoreTestCoverageDocumentation(SPARSE_DOC)).toBeLessThanOrEqual(2);
  });

  it('is deterministic', () => {
    expect(scoreTestCoverageDocumentation(RICH_DOC)).toBe(scoreTestCoverageDocumentation(RICH_DOC));
  });
});

describe('scoreBootstrapCapability', () => {
  it('returns 5 for rich content with recreation notes, npm, bash, dependencies, known sections', () => {
    const score = scoreBootstrapCapability(RICH_DOC);
    expect(score).toBe(5);
  });

  it('returns 0 for empty string', () => {
    expect(scoreBootstrapCapability('')).toBe(0);
  });

  it('returns low score for sparse doc', () => {
    expect(scoreBootstrapCapability(SPARSE_DOC)).toBeLessThanOrEqual(2);
  });

  it('is deterministic', () => {
    expect(scoreBootstrapCapability(RICH_DOC)).toBe(scoreBootstrapCapability(RICH_DOC));
  });
});

describe('generateRemediationGuidance', () => {
  it('generates guidance for all dimensions scoring <= 3', () => {
    const dims = {
      requirements_coverage: 2,
      data_model_completeness: 1,
      implementation_guidance: 3,
      test_coverage_documentation: 0,
      bootstrap_capability: 3,
    };
    const guidance = generateRemediationGuidance(dims);
    expect(guidance).toHaveLength(5);
    expect(guidance[0]).toContain('Requirements Coverage scored 2/5');
    expect(guidance[1]).toContain('Data Model Completeness scored 1/5');
    expect(guidance[2]).toContain('Implementation Guidance scored 3/5');
    expect(guidance[3]).toContain('Test Coverage Documentation scored 0/5');
    expect(guidance[4]).toContain('Bootstrap Capability scored 3/5');
  });

  it('generates no guidance when all dimensions score > 3', () => {
    const dims = {
      requirements_coverage: 4,
      data_model_completeness: 5,
      implementation_guidance: 4,
      test_coverage_documentation: 5,
      bootstrap_capability: 4,
    };
    const guidance = generateRemediationGuidance(dims);
    expect(guidance).toHaveLength(0);
  });

  it('generates partial guidance for mixed scores', () => {
    const dims = {
      requirements_coverage: 5,
      data_model_completeness: 2,
      implementation_guidance: 5,
      test_coverage_documentation: 1,
      bootstrap_capability: 5,
    };
    const guidance = generateRemediationGuidance(dims);
    expect(guidance).toHaveLength(2);
    expect(guidance[0]).toContain('Data Model Completeness scored 2/5');
    expect(guidance[1]).toContain('Test Coverage Documentation scored 1/5');
  });
});

describe('loadRecreationReadinessConfig', () => {
  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
    const configDir = path.join(testDir, '.olympus');
    if (fs.existsSync(configDir)) {
      fs.rmSync(configDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('returns advisory when config file does not exist', () => {
    expect(loadRecreationReadinessConfig(testDir)).toBe('advisory');
  });

  it('returns blocking when config sets blocking mode', () => {
    writeConfig('blocking');
    expect(loadRecreationReadinessConfig(testDir)).toBe('blocking');
  });

  it('returns advisory when config sets advisory mode explicitly', () => {
    writeConfig('advisory');
    expect(loadRecreationReadinessConfig(testDir)).toBe('advisory');
  });

  it('returns advisory when config file is malformed JSON', () => {
    const configDir = path.join(testDir, '.olympus');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'config.json'), '{ invalid json }');
    expect(loadRecreationReadinessConfig(testDir)).toBe('advisory');
  });

  it('returns advisory when config has no recreation_readiness_mode field', () => {
    const configDir = path.join(testDir, '.olympus');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({ other_field: true }));
    expect(loadRecreationReadinessConfig(testDir)).toBe('advisory');
  });
});

describe('evaluateRecreationReadiness', () => {
  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
    const configDir = path.join(testDir, '.olympus');
    if (fs.existsSync(configDir)) {
      fs.rmSync(configDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('skips and returns all zeros with passed=true for bugfix pathway', () => {
    const docPath = writeDoc('feature-doc.md', RICH_DOC);
    const result = evaluateRecreationReadiness({
      featureDocPath: docPath,
      projectPath: testDir,
      depth: 'standard',
      pathway: 'bugfix',
    });
    expect(result.passed).toBe(true);
    expect(result.overall_score).toBe(0);
    expect(result.dimensions.requirements_coverage).toBe(0);
    expect(result.dimensions.data_model_completeness).toBe(0);
    expect(result.dimensions.implementation_guidance).toBe(0);
    expect(result.dimensions.test_coverage_documentation).toBe(0);
    expect(result.dimensions.bootstrap_capability).toBe(0);
  });

  it('minimal depth scores only requirements_coverage and implementation_guidance for rich doc', () => {
    const docPath = writeDoc('feature-doc.md', RICH_DOC);
    const result = evaluateRecreationReadiness({
      featureDocPath: docPath,
      projectPath: testDir,
      depth: 'minimal',
      pathway: 'greenfield',
    });
    expect(result.passed).toBe(true);
    expect(result.dimensions.requirements_coverage).toBeGreaterThan(0);
    expect(result.dimensions.implementation_guidance).toBeGreaterThan(0);
    expect(result.dimensions.data_model_completeness).toBe(0);
    expect(result.dimensions.test_coverage_documentation).toBe(0);
    expect(result.dimensions.bootstrap_capability).toBe(0);
    expect(result.overall_score).toBeGreaterThan(0);
  });

  it('minimal depth uses 3.5 threshold — passes in blocking mode when average >= 3.5', () => {
    writeConfig('blocking');
    const docPath = writeDoc('feature-doc.md', RICH_DOC);
    const result = evaluateRecreationReadiness({
      featureDocPath: docPath,
      projectPath: testDir,
      depth: 'minimal',
      pathway: 'greenfield',
    });
    const expectedAvg = (result.dimensions.requirements_coverage + result.dimensions.implementation_guidance) / 2;
    expect(expectedAvg).toBeGreaterThanOrEqual(3.5);
    expect(result.passed).toBe(true);
    expect(result.mode).toBe('blocking');
  });

  it('minimal depth fails in blocking mode when average < 3.5', () => {
    writeConfig('blocking');
    const docPath = writeDoc('feature-doc.md', SPARSE_DOC);
    const result = evaluateRecreationReadiness({
      featureDocPath: docPath,
      projectPath: testDir,
      depth: 'minimal',
      pathway: 'greenfield',
    });
    expect(result.overall_score).toBeLessThan(3.5);
    expect(result.passed).toBe(false);
    expect(result.mode).toBe('blocking');
    expect(result.remediation).toBeDefined();
  });

  it('minimal depth passes in advisory mode even when scores are low', () => {
    const docPath = writeDoc('feature-doc.md', SPARSE_DOC);
    const result = evaluateRecreationReadiness({
      featureDocPath: docPath,
      projectPath: testDir,
      depth: 'minimal',
      pathway: 'greenfield',
    });
    expect(result.passed).toBe(true);
    expect(result.mode).toBe('advisory');
  });

  it('minimal depth returns failed with remediation when feature doc cannot be read', () => {
    const result = evaluateRecreationReadiness({
      featureDocPath: path.join(testDir, 'nonexistent.md'),
      projectPath: testDir,
      depth: 'minimal',
      pathway: 'greenfield',
    });
    expect(result.passed).toBe(false);
    expect(result.overall_score).toBe(0);
    expect(result.remediation).toBeDefined();
    expect(result.remediation![0]).toContain('could not be read');
  });

  it('minimal depth overall_score is average of 2 dimensions rounded to 1 decimal', () => {
    const docPath = writeDoc('feature-doc.md', RICH_DOC);
    const result = evaluateRecreationReadiness({
      featureDocPath: docPath,
      projectPath: testDir,
      depth: 'minimal',
      pathway: 'greenfield',
    });
    const expected = Math.round(((result.dimensions.requirements_coverage + result.dimensions.implementation_guidance) / 2) * 10) / 10;
    expect(result.overall_score).toBe(expected);
  });

  it('returns high scores and passed=true for rich doc in advisory mode', () => {
    const docPath = writeDoc('feature-doc.md', RICH_DOC);
    const result = evaluateRecreationReadiness({
      featureDocPath: docPath,
      projectPath: testDir,
      depth: 'standard',
      pathway: 'greenfield',
    });
    expect(result.overall_score).toBeGreaterThanOrEqual(4.0);
    expect(result.passed).toBe(true);
    expect(result.mode).toBe('advisory');
    expect(result.remediation).toBeUndefined();
  });

  it('returns low scores but passed=true for sparse doc in advisory mode', () => {
    const docPath = writeDoc('feature-doc.md', SPARSE_DOC);
    const result = evaluateRecreationReadiness({
      featureDocPath: docPath,
      projectPath: testDir,
      depth: 'standard',
      pathway: 'greenfield',
    });
    expect(result.overall_score).toBeLessThan(4.0);
    expect(result.passed).toBe(true);
    expect(result.mode).toBe('advisory');
    expect(result.remediation).toBeDefined();
    expect(result.remediation!.length).toBeGreaterThan(0);
  });

  it('returns passed=false for sparse doc in blocking mode', () => {
    writeConfig('blocking');
    const docPath = writeDoc('feature-doc.md', SPARSE_DOC);
    const result = evaluateRecreationReadiness({
      featureDocPath: docPath,
      projectPath: testDir,
      depth: 'standard',
      pathway: 'greenfield',
    });
    expect(result.overall_score).toBeLessThan(4.0);
    expect(result.passed).toBe(false);
    expect(result.mode).toBe('blocking');
    expect(result.remediation).toBeDefined();
  });

  it('returns passed=true for rich doc in blocking mode when score >= 4.0', () => {
    writeConfig('blocking');
    const docPath = writeDoc('feature-doc.md', RICH_DOC);
    const result = evaluateRecreationReadiness({
      featureDocPath: docPath,
      projectPath: testDir,
      depth: 'standard',
      pathway: 'greenfield',
    });
    expect(result.overall_score).toBeGreaterThanOrEqual(4.0);
    expect(result.passed).toBe(true);
    expect(result.mode).toBe('blocking');
  });

  it('returns passed=false with remediation when feature doc cannot be read', () => {
    const result = evaluateRecreationReadiness({
      featureDocPath: path.join(testDir, 'nonexistent.md'),
      projectPath: testDir,
      depth: 'standard',
      pathway: 'greenfield',
    });
    expect(result.passed).toBe(false);
    expect(result.overall_score).toBe(0);
    expect(result.remediation).toBeDefined();
    expect(result.remediation![0]).toContain('could not be read');
  });

  it('is deterministic: same input produces same output twice', () => {
    const docPath = writeDoc('feature-doc.md', RICH_DOC);
    const opts = { featureDocPath: docPath, projectPath: testDir, depth: 'standard', pathway: 'greenfield' };
    const first = evaluateRecreationReadiness(opts);
    const second = evaluateRecreationReadiness(opts);
    expect(first.overall_score).toBe(second.overall_score);
    expect(first.passed).toBe(second.passed);
    expect(first.dimensions).toEqual(second.dimensions);
  });

  it('scores each dimension between 0 and 5', () => {
    const docPath = writeDoc('feature-doc.md', RICH_DOC);
    const result = evaluateRecreationReadiness({
      featureDocPath: docPath,
      projectPath: testDir,
      depth: 'standard',
      pathway: 'greenfield',
    });
    for (const score of Object.values(result.dimensions)) {
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(5);
    }
  });

  it('overall_score is rounded to one decimal place', () => {
    const docPath = writeDoc('feature-doc.md', RICH_DOC);
    const result = evaluateRecreationReadiness({
      featureDocPath: docPath,
      projectPath: testDir,
      depth: 'standard',
      pathway: 'greenfield',
    });
    const rounded = Math.round(result.overall_score * 10) / 10;
    expect(result.overall_score).toBe(rounded);
  });

  it('override=true returns passed=true for sparse doc in blocking mode', () => {
    writeConfig('blocking');
    const docPath = writeDoc('feature-doc.md', SPARSE_DOC);
    const result = evaluateRecreationReadiness({
      featureDocPath: docPath,
      projectPath: testDir,
      depth: 'standard',
      pathway: 'greenfield',
      override: true,
    });
    expect(result.passed).toBe(true);
    expect(result.overall_score).toBe(0);
    expect(result.mode).toBe('blocking');
    expect(result.remediation).toBeUndefined();
  });

  it('override=true with rationale includes rationale in remediation', () => {
    const docPath = writeDoc('feature-doc.md', SPARSE_DOC);
    const result = evaluateRecreationReadiness({
      featureDocPath: docPath,
      projectPath: testDir,
      depth: 'standard',
      pathway: 'greenfield',
      override: true,
      overrideRationale: 'approved by tech lead on 2026-03-24',
    });
    expect(result.passed).toBe(true);
    expect(result.remediation).toBeDefined();
    expect(result.remediation![0]).toContain('approved by tech lead on 2026-03-24');
  });

  it('override=true bypasses scoring even for nonexistent feature doc', () => {
    const result = evaluateRecreationReadiness({
      featureDocPath: path.join(testDir, 'nonexistent.md'),
      projectPath: testDir,
      depth: 'standard',
      pathway: 'greenfield',
      override: true,
    });
    expect(result.passed).toBe(true);
    expect(result.overall_score).toBe(0);
  });

  it('override=false behaves identically to omitting the field', () => {
    const docPath = writeDoc('feature-doc.md', SPARSE_DOC);
    const withFalse = evaluateRecreationReadiness({
      featureDocPath: docPath,
      projectPath: testDir,
      depth: 'standard',
      pathway: 'greenfield',
      override: false,
    });
    const withOmitted = evaluateRecreationReadiness({
      featureDocPath: docPath,
      projectPath: testDir,
      depth: 'standard',
      pathway: 'greenfield',
    });
    expect(withFalse.passed).toBe(withOmitted.passed);
    expect(withFalse.overall_score).toBe(withOmitted.overall_score);
    expect(withFalse.dimensions).toEqual(withOmitted.dimensions);
  });
});
