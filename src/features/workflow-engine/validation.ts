/**
 * IDEA Artifact Validation
 *
 * Validates completeness of IDEA stage artifacts against required criteria.
 * An IDEA artifact must contain all essential sections for progression to PRD stage.
 */

import { readFileSync } from 'fs';
import { ValidationResult } from './types.js';

/**
 * Required sections for a valid IDEA artifact
 */
const REQUIRED_SECTIONS = [
  'Problem Statement',
  'Business Context',
  'Success Metrics',
  'Constraints',
  'Solution Approach',
] as const;

/**
 * Validates an IDEA artifact for completeness.
 *
 * Checks 6 criteria:
 * 1. Problem statement present (non-empty ## Problem Statement section)
 * 2. Business context present (non-empty ## Business Context section)
 * 3. At least 2 success metrics (check ## Success Metrics section has 2+ bullet points)
 * 4. Constraints documented (## Constraints section present with content)
 * 5. Risk tier assessed (YAML frontmatter has risk_tier field)
 * 6. All required sections present (all 5 sections exist in document)
 *
 * @param artifactPath - Absolute path to the IDEA artifact file
 * @returns ValidationResult with pass/fail status, coverage percentage, and any blocking issues
 *
 * @example
 * const result = await validateIdea('.olympus/workflows/feature-x/idea.md');
 * if (result.passed) {
 *   console.log('IDEA artifact is complete!');
 * } else {
 *   console.log('Issues found:', result.blocking_issues);
 * }
 */
export async function validateIdea(artifactPath: string): Promise<ValidationResult> {
  const timestamp = new Date().toISOString();
  const blockingIssues: string[] = [];

  // Read artifact file
  let content: string;
  try {
    content = readFileSync(artifactPath, 'utf-8');
  } catch (error) {
    return {
      passed: false,
      coverage_percentage: 0,
      blocking_issues: ['Artifact file not found'],
      timestamp,
    };
  }

  // Parse YAML frontmatter
  const frontmatter = parseFrontmatter(content);
  if (!frontmatter || !frontmatter.risk_tier) {
    blockingIssues.push('Risk tier not specified in frontmatter');
  }

  // Remove frontmatter from content for section parsing
  const markdownContent = removeFrontmatter(content);

  // Parse markdown sections
  const sections = parseSections(markdownContent);

  // Check criterion 1: Problem statement present and non-empty
  const problemStatement = sections.get('Problem Statement');
  if (!problemStatement || problemStatement.trim().length === 0) {
    blockingIssues.push('Missing problem statement section');
  }

  // Check criterion 2: Business context present and non-empty
  const businessContext = sections.get('Business Context');
  if (!businessContext || businessContext.trim().length === 0) {
    blockingIssues.push('Business context section is empty');
  }

  // Check criterion 3: At least 2 success metrics
  const successMetrics = sections.get('Success Metrics');
  if (successMetrics) {
    const metricCount = countBulletPoints(successMetrics);
    if (metricCount < 2) {
      blockingIssues.push(
        `Only ${metricCount} success metric found, need at least 2`
      );
    }
  } else {
    blockingIssues.push('Missing success metrics section');
  }

  // Check criterion 4: Constraints documented
  const constraints = sections.get('Constraints');
  if (!constraints || constraints.trim().length === 0) {
    blockingIssues.push('Constraints section missing');
  }

  // Check criterion 6: All required sections present
  for (const section of REQUIRED_SECTIONS) {
    if (!sections.has(section)) {
      blockingIssues.push(`Missing required section: ${section}`);
    }
  }

  // Calculate coverage (6 total criteria)
  const totalCriteria = 6;
  const passedCriteria = totalCriteria - blockingIssues.length;
  const coveragePercentage = Math.round((passedCriteria / totalCriteria) * 100);

  return {
    passed: blockingIssues.length === 0,
    coverage_percentage: coveragePercentage,
    blocking_issues: blockingIssues,
    timestamp,
  };
}

/**
 * Parses YAML frontmatter from markdown content.
 * Frontmatter must be delimited by --- at the start of the file.
 *
 * @param content - Full markdown content
 * @returns Parsed frontmatter object or null if not found/invalid
 */
function parseFrontmatter(content: string): Record<string, any> | null {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    return null;
  }

  const yamlContent = frontmatterMatch[1];
  try {
    // Simple YAML parser for key: value pairs
    const result: Record<string, any> = {};
    const lines = yamlContent.split('\n');
    for (const line of lines) {
      const match = line.match(/^(\w+):\s*(.+)$/);
      if (match) {
        const [, key, value] = match;
        result[key] = value.trim();
      }
    }
    return result;
  } catch {
    return null;
  }
}

/**
 * Removes YAML frontmatter from markdown content.
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
    // Check for ## heading
    const headingMatch = line.match(/^##\s+(.+)$/);
    if (headingMatch) {
      // Save previous section if it exists
      if (currentSection) {
        sections.set(currentSection, currentContent.join('\n'));
      }
      // Start new section
      currentSection = headingMatch[1].trim();
      currentContent = [];
    } else if (currentSection) {
      // Add line to current section
      currentContent.push(line);
    }
  }

  // Save last section
  if (currentSection) {
    sections.set(currentSection, currentContent.join('\n'));
  }

  return sections;
}

/**
 * Counts bullet points in a markdown section.
 * Looks for lines starting with -, *, or + (standard markdown bullets).
 *
 * @param content - Section content
 * @returns Number of bullet points found
 */
function countBulletPoints(content: string): number {
  const lines = content.split('\n');
  let count = 0;
  for (const line of lines) {
    if (line.trim().match(/^[-*+]\s+/)) {
      count++;
    }
  }
  return count;
}

/**
 * Validates a PRD artifact for coverage against IDEA constraints.
 *
 * **Phase 2 MVP Stub Implementation**
 * This is a simplified implementation that calculates coverage but does not
 * invoke the Momus agent for critical review. Full Momus integration is
 * deferred to Phase 3.
 *
 * Checks:
 * - PRD addresses >= 90% of IDEA constraints
 * - User stories are present
 * - Requirement coverage section exists
 *
 * TODO (Phase 3): Integrate Momus agent for:
 * - Scope drift detection
 * - Acceptance criteria completeness check
 * - Risk alignment verification
 *
 * @param artifactPath - Absolute path to the PRD artifact file
 * @param ideaPath - Absolute path to the IDEA artifact file
 * @returns ValidationResult with coverage percentage and Momus placeholder
 *
 * @example
 * const result = await validatePrd(
 *   '.olympus/workflows/feature-x/prd.md',
 *   '.olympus/workflows/feature-x/idea.md'
 * );
 * if (result.coverage_percentage >= 90) {
 *   console.log('PRD has sufficient coverage');
 * }
 */
export async function validatePrd(
  artifactPath: string,
  ideaPath: string
): Promise<ValidationResult> {
  const timestamp = new Date().toISOString();
  const blockingIssues: string[] = [];

  // Read PRD artifact
  let prdContent: string;
  try {
    prdContent = readFileSync(artifactPath, 'utf-8');
  } catch (error) {
    return {
      passed: false,
      coverage_percentage: 0,
      blocking_issues: ['PRD artifact file not found'],
      reviewer: 'momus',
      timestamp,
    };
  }

  // Read IDEA artifact
  let ideaContent: string;
  try {
    ideaContent = readFileSync(ideaPath, 'utf-8');
  } catch (error) {
    return {
      passed: false,
      coverage_percentage: 0,
      blocking_issues: ['IDEA artifact file not found for reference'],
      reviewer: 'momus',
      timestamp,
    };
  }

  // Parse IDEA constraints
  const ideaMarkdown = removeFrontmatter(ideaContent);
  const ideaSections = parseSections(ideaMarkdown);
  const constraintsSection = ideaSections.get('Constraints');
  const ideaConstraints = constraintsSection
    ? countBulletPoints(constraintsSection)
    : 0;

  // Parse PRD user stories
  const prdMarkdown = removeFrontmatter(prdContent);
  const prdSections = parseSections(prdMarkdown);

  // Count user stories (sections starting with "US-" or "### US-")
  let userStoryCount = 0;
  for (const line of prdMarkdown.split('\n')) {
    if (line.match(/^###?\s+US-\d+/)) {
      userStoryCount++;
    }
  }

  // Check for requirement coverage section
  const hasCoverageSection = prdSections.has('Requirement Coverage');

  // Calculate coverage percentage
  // Simplified: assume each user story addresses one constraint
  // Real implementation would parse the coverage table
  const coveragePercentage =
    ideaConstraints > 0
      ? Math.round((Math.min(userStoryCount, ideaConstraints) / ideaConstraints) * 100)
      : 100;

  // Validate completeness
  if (userStoryCount === 0) {
    blockingIssues.push('No user stories found in PRD');
  }

  if (!hasCoverageSection) {
    blockingIssues.push('Missing Requirement Coverage section');
  }

  if (coveragePercentage < 90) {
    blockingIssues.push(
      `Coverage only ${coveragePercentage}%, need at least 90% (${userStoryCount}/${ideaConstraints} constraints addressed)`
    );
  }

  // TODO (Phase 3): Invoke Momus agent here for critical review
  // const momusReview = await invokeMomusAgent(prdContent, ideaContent);
  // blockingIssues.push(...momusReview.issues);

  return {
    passed: blockingIssues.length === 0 && coveragePercentage >= 90,
    coverage_percentage: coveragePercentage,
    blocking_issues: blockingIssues,
    reviewer: 'momus',  // Placeholder - real Momus review deferred to Phase 3
    timestamp,
  };
}
