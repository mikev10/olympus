/**
 * AIDLC Alignment Engine
 *
 * Verification & Validation (V&V) for phase transitions in the AI-Driven Development
 * Life Cycle (AIDLC) workflow engine.
 *
 * Verification: Confirms target artifact conforms to source artifact requirements.
 * Validation: Confirms target artifact achieves intended purpose and delivers value.
 *
 * Key responsibilities:
 * - Compute verification scores (heuristic text analysis)
 * - Generate validation questions for human/AI review
 * - Run full alignment checks (verification + validation)
 * - Run dual validation (parent + root INTENT checks)
 * - Adaptive thresholds based on trust levels
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
 * Supported transition types between AIDLC phases.
 */
export type TransitionType = 'intent-to-unit' | 'unit-to-bolt';

/**
 * Root validation types for checking alignment back to the original INTENT.
 */
export type RootValidationType = 'unit-to-intent' | 'bolt-to-intent';

/**
 * Conformance thresholds (percentage) for each transition type and root validation type.
 * Verification must meet or exceed threshold to pass.
 */
const CONFORMANCE_THRESHOLDS: Record<TransitionType | RootValidationType, number> = {
  'intent-to-unit': 95,
  'unit-to-bolt': 100,
  'unit-to-intent': 80,
  'bolt-to-intent': 70,
};

/**
 * Validation questions for each transition type and root validation type.
 * Each transition has two questions:
 * - Verification question: Checks conformance to source
 * - Validation question: Checks real-world value and intent
 */
const VALIDATION_QUESTIONS: Record<
  TransitionType | RootValidationType,
  { verification: string; validation: string }
> = {
  'intent-to-unit': {
    verification: 'Does the UNIT cover its assigned scope from the INTENT?',
    validation: 'Will this UNIT produce a working module that contributes to the feature?',
  },
  'unit-to-bolt': {
    verification: 'Does the BOLT cover all acceptance criteria from the UNIT?',
    validation: 'Does this BOLT deliver meaningful, testable progress?',
  },
  'unit-to-intent': {
    verification: "Does this UNIT contribute to the INTENT's problem statement?",
    validation: "Does this UNIT help achieve the INTENT's success metrics?",
  },
  'bolt-to-intent': {
    verification: "Does this BOLT contribute to solving the INTENT's stated problem?",
    validation: "Is this BOLT still aligned with the original INTENT's goals?",
  },
};

/**
 * Configuration mapping for extracting relevant sections from source artifacts.
 * Different transitions require different source sections to be validated.
 */
const TRANSITION_SOURCE_SECTIONS: Record<TransitionType | RootValidationType, string[]> = {
  'intent-to-unit': ['Business Requirements', 'Implementation Plan'],
  'unit-to-bolt': ['Acceptance Criteria', 'Target Files'],
  'unit-to-intent': ['Problem Statement', 'Success Criteria'],
  'bolt-to-intent': ['Problem Statement', 'Success Criteria'],
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
 * Also handles checkboxes [ ] and [x].
 *
 * @param content - Section content
 * @returns Array of bullet point text (without the bullet marker)
 */
function extractBulletPoints(content: string): string[] {
  const bullets: string[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    // Match standard bullets and checkboxes
    const match = line.match(/^\s*[-*+]\s+(?:\[[ x]\]\s+)?(.+)$/);
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
 * @param transition - Transition type or root validation type
 * @returns Array of requirement strings to validate against
 */
function extractRequirements(
  content: string,
  transition: TransitionType | RootValidationType
): string[] {
  const markdownContent = removeFrontmatter(content);

  // Special case: intent-to-unit - extract Proposed UNITs and Business Requirements
  if (transition === 'intent-to-unit') {
    const sections = parseSections(markdownContent);
    const requirements: string[] = [];

    // Extract from Business Requirements section
    const businessReqs = sections.get('Business Requirements');
    if (businessReqs) {
      requirements.push(...extractBulletPoints(businessReqs));
    }

    // Extract from Implementation Plan section (Proposed UNITs)
    const implPlan = sections.get('Implementation Plan');
    if (implPlan) {
      requirements.push(...extractBulletPoints(implPlan));
    }

    return requirements;
  }

  // Special case: unit-to-bolt - extract Acceptance Criteria and Target Files
  if (transition === 'unit-to-bolt') {
    const sections = parseSections(markdownContent);
    const requirements: string[] = [];

    const acceptanceCriteria = sections.get('Acceptance Criteria');
    if (acceptanceCriteria) {
      requirements.push(...extractBulletPoints(acceptanceCriteria));
    }

    const targetFiles = sections.get('Target Files');
    if (targetFiles) {
      requirements.push(...extractBulletPoints(targetFiles));
    }

    return requirements;
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
 * @param transition - Transition type or root validation type (determines extraction strategy)
 * @returns Verification result with conformance score, coverage, and missing items
 */
export function computeVerification(
  sourceContent: string,
  targetContent: string,
  transition: TransitionType | RootValidationType
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
 * Generates validation questions for a specific transition type or root validation type.
 * Questions start unanswered (answer: null, passed: null).
 *
 * @param transition - Transition type or root validation type
 * @returns Array of unanswered validation questions
 */
export function generateValidationQuestions(
  transition: TransitionType | RootValidationType
): AlignmentQuestion[] {
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
 * @param transition - Transition type or root validation type
 * @returns Complete alignment check with verification, validation, and pass/fail status
 */
export function runAlignmentCheck(
  sourceContent: string,
  targetContent: string,
  sourceId: string,
  targetId: string,
  transition: TransitionType | RootValidationType
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
 * Runs dual validation: parent check + root INTENT check.
 * This ensures the artifact is aligned with both its immediate parent and the original INTENT.
 *
 * @param artifactContent - Full content of the artifact to validate
 * @param parentContent - Full content of the parent artifact
 * @param rootIntentContent - Full content of the root INTENT artifact
 * @param transition - Parent transition type
 * @param rootTransition - Root validation type
 * @param sourceId - Parent artifact ID
 * @param targetId - Target artifact ID
 * @param rootId - Root INTENT artifact ID
 * @returns Combined result with both parent and root checks, and overall pass status
 */
export function runDualValidation(
  artifactContent: string,
  parentContent: string,
  rootIntentContent: string,
  transition: TransitionType,
  rootTransition: RootValidationType,
  sourceId: string,
  targetId: string,
  rootId: string
): { parentCheck: AlignmentCheck; rootCheck: AlignmentCheck; passed: boolean } {
  // Run parent check
  const parentCheck = runAlignmentCheck(parentContent, artifactContent, sourceId, targetId, transition);

  // Run root INTENT check
  const rootCheck = runAlignmentCheck(rootIntentContent, artifactContent, rootId, targetId, rootTransition);

  // Both checks must pass
  const passed = parentCheck.alignment_passed && rootCheck.alignment_passed;

  return {
    parentCheck,
    rootCheck,
    passed,
  };
}

/**
 * Calculates adaptive threshold based on trust level.
 * Trust 0-1: base threshold
 * Trust 2: base - 10
 * Trust 3: base - 20
 * Minimum: 0
 *
 * @param baseThreshold - Base conformance threshold
 * @param trustLevel - Trust level (0-3)
 * @returns Adjusted threshold
 */
export function getAdaptiveThreshold(baseThreshold: number, trustLevel: number): number {
  let adjustment = 0;

  if (trustLevel >= 2) {
    adjustment += 10;
  }

  if (trustLevel >= 3) {
    adjustment += 10;
  }

  const adaptiveThreshold = baseThreshold - adjustment;
  return Math.max(0, adaptiveThreshold);
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
 * Gets the conformance threshold for a specific transition type or root validation type.
 *
 * @param transition - Transition type or root validation type
 * @returns Conformance threshold percentage (0-100)
 */
export function getConformanceThreshold(transition: TransitionType | RootValidationType): number {
  return CONFORMANCE_THRESHOLDS[transition];
}
