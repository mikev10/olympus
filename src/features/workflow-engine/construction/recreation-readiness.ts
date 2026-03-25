import * as fs from 'fs';
import * as path from 'path';
import type { RecreationReadinessResult } from '../phase-types.js';

export interface RecreationReadinessOptions {
  featureDocPath: string;
  projectPath: string;
  depth: string;
  pathway: string;
  override?: boolean;
  overrideRationale?: string;
}

export function scoreRequirementsCoverage(featureDocContent: string): number {
  let score = 0;
  // Section exists check: look for "## Summary" or requirements-related content
  if (featureDocContent.length > 0) score++;
  // Has >100 words
  if (featureDocContent.split(/\s+/).length > 100) score++;
  // Contains requirement references (FR-NNN, US-NNN, acceptance criteria keywords)
  if (/(?:FR-|US-|acceptance|requirement|criteria)/i.test(featureDocContent)) score++;
  // Cross-references other artifacts (file paths, links)
  if (/(?:aidlc-docs|\.md|\.ts|\.js|intent|requirements)/i.test(featureDocContent)) score++;
  // Structured content (lists, headers)
  if (/(?:^[-*]\s|^#{1,3}\s|^\d+\.\s)/m.test(featureDocContent)) score++;
  return Math.min(score, 5);
}

export function scoreDataModelCompleteness(featureDocContent: string): number {
  let score = 0;
  // Check for "Data Models" section
  if (/## Data Models/i.test(featureDocContent)) score++;
  // Has >50 words in data model section or overall entity/schema references
  if (/(?:interface|type|schema|entity|model|table|field|column|relation)/i.test(featureDocContent)) score++;
  // Contains code examples with types
  if (/```[\s\S]*?(?:interface|type|schema)[\s\S]*?```/.test(featureDocContent)) score++;
  // Cross-references (file paths to model files)
  if (/(?:\.ts|\.js|\.py|\.go|models?|entities?|schemas?)\//i.test(featureDocContent)) score++;
  // Has structured content (tables, lists describing fields)
  if (/\|.*\|.*\|/.test(featureDocContent)) score++;
  return Math.min(score, 5);
}

export function scoreImplementationGuidance(featureDocContent: string): number {
  let score = 0;
  // Architecture Decisions section exists
  if (/## Architecture Decisions/i.test(featureDocContent)) score++;
  // API Contracts section exists
  if (/## API Contracts/i.test(featureDocContent)) score++;
  // Code examples present
  if (/```/.test(featureDocContent)) score++;
  // References to specific files/modules
  if (/(?:src\/|lib\/|import|export|function|class)\s/i.test(featureDocContent)) score++;
  // Structured guidance (numbered steps, decision rationale)
  if (/(?:because|therefore|instead of|trade-?off|decision|chose)/i.test(featureDocContent)) score++;
  return Math.min(score, 5);
}

export function scoreTestCoverageDocumentation(featureDocContent: string): number {
  let score = 0;
  // "How to Test" section exists
  if (/## How to Test/i.test(featureDocContent)) score++;
  // Test-related keywords
  if (/(?:test|spec|verify|assert|expect|should|given|when|then)/i.test(featureDocContent)) score++;
  // Code examples with test commands
  if (/(?:npm test|vitest|jest|pytest|cargo test|go test)/i.test(featureDocContent)) score++;
  // Test file references
  if (/(?:\.test\.|\.spec\.|__tests__|test\/)/i.test(featureDocContent)) score++;
  // Structured steps (numbered list)
  if (/^\d+\.\s/m.test(featureDocContent)) score++;
  return Math.min(score, 5);
}

export function scoreBootstrapCapability(featureDocContent: string): number {
  let score = 0;
  // Recreation Notes or Configuration section exists
  if (/## (?:Recreation Notes|Configuration Changes)/i.test(featureDocContent)) score++;
  // Setup/install/config keywords
  if (/(?:install|setup|configure|environment|\.env|npm|yarn|pip)/i.test(featureDocContent)) score++;
  // Command examples
  if (/(?:\$\s|```(?:bash|sh|shell))/i.test(featureDocContent)) score++;
  // Dependency information
  if (/## Dependencies/i.test(featureDocContent)) score++;
  // Known limitations/prerequisites
  if (/(?:prerequisite|required|depends on|known limitation|## Known)/i.test(featureDocContent)) score++;
  return Math.min(score, 5);
}

export function generateRemediationGuidance(dimensions: RecreationReadinessResult['dimensions']): string[] {
  const guidance: string[] = [];
  const threshold = 3;

  if (dimensions.requirements_coverage <= threshold) {
    guidance.push(`Requirements Coverage scored ${dimensions.requirements_coverage}/5 — add references to FR-* and US-* identifiers, include acceptance criteria traceability`);
  }
  if (dimensions.data_model_completeness <= threshold) {
    guidance.push(`Data Model Completeness scored ${dimensions.data_model_completeness}/5 — add entity relationships, schema definitions, and type examples`);
  }
  if (dimensions.implementation_guidance <= threshold) {
    guidance.push(`Implementation Guidance scored ${dimensions.implementation_guidance}/5 — add architecture decision rationale, API contract details, and code examples`);
  }
  if (dimensions.test_coverage_documentation <= threshold) {
    guidance.push(`Test Coverage Documentation scored ${dimensions.test_coverage_documentation}/5 — add test approach, verification steps, and test file references`);
  }
  if (dimensions.bootstrap_capability <= threshold) {
    guidance.push(`Bootstrap Capability scored ${dimensions.bootstrap_capability}/5 — add setup instructions, environment configuration, and dependency information`);
  }

  return guidance;
}

export function loadRecreationReadinessConfig(projectPath: string): 'advisory' | 'blocking' {
  try {
    const configPath = path.join(projectPath, '.olympus', 'config.json');
    if (!fs.existsSync(configPath)) return 'advisory';
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return config.recreation_readiness_mode === 'blocking' ? 'blocking' : 'advisory';
  } catch {
    return 'advisory';
  }
}

export function evaluateRecreationReadiness(options: RecreationReadinessOptions): RecreationReadinessResult {
  if (options.override === true) {
    const result: RecreationReadinessResult = {
      overall_score: 0,
      passed: true,
      mode: loadRecreationReadinessConfig(options.projectPath),
      dimensions: {
        requirements_coverage: 0,
        data_model_completeness: 0,
        implementation_guidance: 0,
        test_coverage_documentation: 0,
        bootstrap_capability: 0,
      },
    };
    if (options.overrideRationale) {
      result.remediation = [`Override applied: ${options.overrideRationale}`];
    }
    return result;
  }

  if (options.pathway === 'bugfix') {
    // Full skip — bugfix docs are summary-only
    return {
      overall_score: 0,
      passed: true,
      mode: 'advisory',
      dimensions: {
        requirements_coverage: 0,
        data_model_completeness: 0,
        implementation_guidance: 0,
        test_coverage_documentation: 0,
        bootstrap_capability: 0,
      },
    };
  }

  if (options.depth === 'minimal') {
    // Minimal depth: score only 2 dimensions with a lower threshold of 3.5
    const mode = loadRecreationReadinessConfig(options.projectPath);

    let content = '';
    try {
      content = fs.readFileSync(options.featureDocPath, 'utf-8');
    } catch {
      return {
        overall_score: 0,
        passed: false,
        mode,
        dimensions: {
          requirements_coverage: 0,
          data_model_completeness: 0,
          implementation_guidance: 0,
          test_coverage_documentation: 0,
          bootstrap_capability: 0,
        },
        remediation: ['Feature doc could not be read — ensure it exists at the expected path'],
      };
    }

    const reqScore = scoreRequirementsCoverage(content);
    const implScore = scoreImplementationGuidance(content);
    const overall = (reqScore + implScore) / 2;
    const passed = overall >= 3.5 || mode === 'advisory';

    const dimensions = {
      requirements_coverage: reqScore,
      data_model_completeness: 0,
      implementation_guidance: implScore,
      test_coverage_documentation: 0,
      bootstrap_capability: 0,
    };

    const result: RecreationReadinessResult = {
      overall_score: Math.round(overall * 10) / 10,
      passed,
      mode,
      dimensions,
    };

    if (overall < 3.5) {
      result.remediation = generateRemediationGuidance(dimensions);
    }

    return result;
  }

  let content = '';
  try {
    content = fs.readFileSync(options.featureDocPath, 'utf-8');
  } catch {
    return {
      overall_score: 0,
      passed: false,
      mode: loadRecreationReadinessConfig(options.projectPath),
      dimensions: {
        requirements_coverage: 0,
        data_model_completeness: 0,
        implementation_guidance: 0,
        test_coverage_documentation: 0,
        bootstrap_capability: 0,
      },
      remediation: ['Feature doc could not be read — ensure it exists at the expected path'],
    };
  }

  const dimensions = {
    requirements_coverage: scoreRequirementsCoverage(content),
    data_model_completeness: scoreDataModelCompleteness(content),
    implementation_guidance: scoreImplementationGuidance(content),
    test_coverage_documentation: scoreTestCoverageDocumentation(content),
    bootstrap_capability: scoreBootstrapCapability(content),
  };

  const scores = Object.values(dimensions);
  const overall_score = scores.reduce((a, b) => a + b, 0) / scores.length;
  const mode = loadRecreationReadinessConfig(options.projectPath);
  const passed = overall_score >= 4.0 || mode === 'advisory';

  const result: RecreationReadinessResult = {
    overall_score: Math.round(overall_score * 10) / 10,
    passed,
    mode,
    dimensions,
  };

  if (overall_score < 4.0) {
    result.remediation = generateRemediationGuidance(dimensions);
  }

  return result;
}
