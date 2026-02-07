/**
 * ODLC Alignment Engine
 *
 * Verification & Validation (V&V) for phase transitions in the Olympus Development
 * Life Cycle (ODLC) workflow engine.
 *
 * Verification: Confirms target artifact conforms to source artifact requirements.
 * Validation: Confirms target artifact achieves intended purpose and delivers value.
 *
 * Key responsibilities:
 * - Compute verification scores (heuristic text analysis)
 * - Generate validation questions for human/AI review
 * - Run full alignment checks (verification + validation)
 * - Record alignment results in manifest
 */

import type {
  AlignmentVerificationResult,
  AlignmentValidationResult,
  AlignmentQuestion,
  AlignmentCheck,
} from './phase-types.js';
import { loadManifest, saveManifest } from './manifest.js';

/**
 * Supported transition types between ODLC phases.
 */
export type TransitionType =
  | 'idea-to-prd'
  | 'prd-to-spec'
  | 'spec-to-intents'
  | 'intents-to-units'
  | 'units-to-design'
  | 'design-to-build';

/**
 * Conformance thresholds (percentage) for each transition type.
 * Verification must meet or exceed threshold to pass.
 */
const CONFORMANCE_THRESHOLDS: Record<TransitionType, number> = {
  'idea-to-prd': 90,
  'prd-to-spec': 95,
  'spec-to-intents': 100,
  'intents-to-units': 100,
  'units-to-design': 90,
  'design-to-build': 90,
};

/**
 * Validation questions for each transition type.
 * Each transition has two questions:
 * - Verification question: Checks conformance to source
 * - Validation question: Checks real-world value and intent
 */
const VALIDATION_QUESTIONS: Record<
  TransitionType,
  { verification: string; validation: string }
> = {
  'idea-to-prd': {
    verification: 'Does the PRD address all IDEA constraints?',
    validation: 'Does the PRD solve the actual business problem?',
  },
  'prd-to-spec': {
    verification: 'Does the SPEC implement all PRD user stories?',
    validation: 'Does the SPEC achieve the intended user experience?',
  },
  'spec-to-intents': {
    verification: 'Do the INTENTS cover all SPEC components?',
    validation: 'Are the intents decomposed to deliver real value?',
  },
  'intents-to-units': {
    verification: 'Do the UNITS cover all INTENT acceptance criteria?',
    validation: 'Will these units produce a working feature?',
  },
  'units-to-design': {
    verification: 'Does the DESIGN address all UNIT requirements?',
    validation: 'Does the design align with architectural goals?',
  },
  'design-to-build': {
    verification: 'Does the BUILD satisfy DESIGN contracts?',
    validation: 'Does the implementation deliver user value?',
  },
};

/**
 * Configuration mapping for extracting relevant sections from source artifacts.
 * Different transitions require different source sections to be validated.
 */
const TRANSITION_SOURCE_SECTIONS: Record<TransitionType, string[]> = {
  'idea-to-prd': ['Constraints', 'Success Metrics', 'Problem Statement'],
  'prd-to-spec': [], // Special case: extract user stories via regex
  'spec-to-intents': ['Components', 'Architecture'],
  'intents-to-units': [], // Special case: all bullet points from all sections
  'units-to-design': [], // Special case: all bullet points
  'design-to-build': [], // Special case: all bullet points
};

/**
 * Removes YAML frontmatter from markdown content.
 * Frontmatter must be delimited by --- at the start of the file.
 *
 * @param content - Full markdown content
 * @returns Content without frontmatter
 */
function removeFrontmatter(content: string): string {
  return content.replace(/^---\n[\s\S]*?\n---\n/, '');
}

/**
 * Parses markdown sections based on ## headings.
 *
 * @param content - Markdown content (without frontmatter)
 * @returns Map of section name to section content
 */
function parseSections(content: string): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = content.split('\n');
  let currentSection: string | null = null;
  let currentContent: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+)$/);
    if (headingMatch) {
      if (currentSection) {
        sections.set(currentSection, currentContent.join('\n'));
      }
      currentSection = headingMatch[1].trim();
      currentContent = [];
    } else if (currentSection) {
      currentContent.push(line);
    }
  }

  if (currentSection) {
    sections.set(currentSection, currentContent.join('\n'));
  }

  return sections;
}

/**
 * Extracts bullet point text from markdown content.
 * Looks for lines starting with -, *, or + (standard markdown bullets).
 *
 * @param content - Section content
 * @returns Array of bullet point text (without the bullet marker)
 */
function extractBulletPoints(content: string): string[] {
  const bullets: string[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const match = line.match(/^\s*[-*+]\s+(.+)$/);
    if (match) {
      bullets.push(match[1].trim());
    }
  }

  return bullets;
}

/**
 * Extracts requirements from source artifact based on transition type.
 * Different transitions require different extraction strategies.
 *
 * @param content - Source artifact content
 * @param transition - Transition type
 * @returns Array of requirement strings to validate against
 */
function extractRequirements(content: string, transition: TransitionType): string[] {
  const markdownContent = removeFrontmatter(content);

  // Special case: PRD to SPEC - extract user stories via regex
  if (transition === 'prd-to-spec') {
    const requirements: string[] = [];
    const lines = markdownContent.split('\n');
    for (const line of lines) {
      const match = line.match(/^###?\s+(US-\d+)/);
      if (match) {
        requirements.push(match[1]);
      }
    }
    return requirements;
  }

  // Special case: Intents/Units/Design/Build - extract all bullet points
  if (
    transition === 'intents-to-units' ||
    transition === 'units-to-design' ||
    transition === 'design-to-build'
  ) {
    return extractBulletPoints(markdownContent);
  }

  // Standard case: extract bullets from specific sections
  const sections = parseSections(markdownContent);
  const sectionNames = TRANSITION_SOURCE_SECTIONS[transition];
  const requirements: string[] = [];

  for (const sectionName of sectionNames) {
    const sectionContent = sections.get(sectionName);
    if (sectionContent) {
      const bullets = extractBulletPoints(sectionContent);
      requirements.push(...bullets);
    }
  }

  return requirements;
}

/**
 * Computes verification score for alignment between source and target artifacts.
 * Uses heuristic text analysis to check if target content references source requirements.
 *
 * @param sourceContent - Full content of source artifact
 * @param targetContent - Full content of target artifact
 * @param transition - Transition type (determines extraction strategy)
 * @returns Verification result with conformance score, coverage, and missing items
 */
export function computeVerification(
  sourceContent: string,
  targetContent: string,
  transition: TransitionType
): AlignmentVerificationResult {
  try {
    // Extract requirements from source
    const requirements = extractRequirements(sourceContent, transition);

    // Handle edge case: no requirements found
    if (requirements.length === 0) {
      return {
        conformance_score: 100,
        coverage_percentage: 100,
        missing_items: [],
        passed: true,
      };
    }

    // Check coverage: how many requirements are mentioned in target
    const targetLower = targetContent.toLowerCase();
    const missing: string[] = [];
    let matched = 0;

    for (const requirement of requirements) {
      const requirementLower = requirement.toLowerCase();
      if (targetLower.includes(requirementLower)) {
        matched++;
      } else {
        missing.push(requirement);
      }
    }

    // Calculate conformance score
    const conformanceScore = Math.round((matched / requirements.length) * 100);
    const coveragePercentage = conformanceScore; // In v1, coverage == conformance

    // Check against threshold
    const threshold = CONFORMANCE_THRESHOLDS[transition];
    const passed = conformanceScore >= threshold;

    return {
      conformance_score: conformanceScore,
      coverage_percentage: coveragePercentage,
      missing_items: missing,
      passed,
    };
  } catch (error) {
    console.error(`[Alignment] Verification computation failed:`, error);
    return {
      conformance_score: 0,
      coverage_percentage: 0,
      missing_items: ['Verification computation error'],
      passed: false,
    };
  }
}

/**
 * Generates validation questions for a specific transition type.
 * Questions start unanswered (answer: null, passed: null).
 *
 * @param transition - Transition type
 * @returns Array of unanswered validation questions
 */
export function generateValidationQuestions(transition: TransitionType): AlignmentQuestion[] {
  const questions = VALIDATION_QUESTIONS[transition];

  return [
    {
      question: questions.verification,
      answer: null,
      answered_by: null,
      passed: null,
    },
    {
      question: questions.validation,
      answer: null,
      answered_by: null,
      passed: null,
    },
  ];
}

/**
 * Runs a full alignment check (verification + validation) between source and target artifacts.
 * Verification uses heuristic analysis. Validation starts with unanswered questions.
 *
 * @param sourceContent - Full content of source artifact
 * @param targetContent - Full content of target artifact
 * @param sourceId - Source artifact ID
 * @param targetId - Target artifact ID
 * @param transition - Transition type
 * @returns Complete alignment check with verification, validation, and pass/fail status
 */
export function runAlignmentCheck(
  sourceContent: string,
  targetContent: string,
  sourceId: string,
  targetId: string,
  transition: TransitionType
): AlignmentCheck {
  try {
    // Step 1: Compute verification
    const verification = computeVerification(sourceContent, targetContent, transition);

    // Step 2: Generate validation questions
    const validationQuestions = generateValidationQuestions(transition);

    // Step 3: Compute validation result
    // Check if all questions are answered and passed
    const allAnswered = validationQuestions.every((q) => q.answer !== null);
    const allPassed = validationQuestions.every((q) => q.passed === true);
    const validationScore = allAnswered && allPassed ? 100 : 0;

    const validation: AlignmentValidationResult = {
      alignment_score: validationScore,
      alignment_questions: validationQuestions,
      passed: allPassed,
    };

    // Step 4: Determine overall alignment pass/fail
    // Both verification AND validation must pass
    const alignmentPassed = verification.passed && validation.passed;

    // Step 5: Build alignment check
    const check: AlignmentCheck = {
      source_artifact_id: sourceId,
      target_artifact_id: targetId,
      verification,
      validation,
      alignment_passed: alignmentPassed,
      checked_at: new Date().toISOString(),
    };

    return check;
  } catch (error) {
    console.error(`[Alignment] Alignment check failed:`, error);

    // Return failed check on error
    return {
      source_artifact_id: sourceId,
      target_artifact_id: targetId,
      verification: {
        conformance_score: 0,
        coverage_percentage: 0,
        missing_items: ['Alignment check error'],
        passed: false,
      },
      validation: {
        alignment_score: 0,
        alignment_questions: [],
        passed: false,
      },
      alignment_passed: false,
      checked_at: new Date().toISOString(),
    };
  }
}

/**
 * Records an alignment check result in the manifest.
 * Appends the check to manifest.alignment_checks and saves.
 *
 * @param manifestPath - Absolute path to manifest.json
 * @param check - Complete alignment check to record
 */
export function recordAlignmentResult(manifestPath: string, check: AlignmentCheck): void {
  try {
    const manifest = loadManifest(manifestPath);
    if (!manifest) {
      console.error(`[Alignment] Manifest not found at ${manifestPath}`);
      return;
    }

    manifest.alignment_checks.push(check);
    saveManifest(manifestPath, manifest);
  } catch (error) {
    console.error(`[Alignment] Failed to record alignment result:`, error);
  }
}

/**
 * Gets the conformance threshold for a specific transition type.
 *
 * @param transition - Transition type
 * @returns Conformance threshold percentage (0-100)
 */
export function getConformanceThreshold(transition: TransitionType): number {
  return CONFORMANCE_THRESHOLDS[transition];
}
