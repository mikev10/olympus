/**
 * Artifact Validation
 *
 * Validates completeness of INTENT stage artifacts against required criteria.
 * An INTENT artifact must contain all essential sections for progression to PRD stage.
 *
 * Performance optimizations:
 * - Parallel validation where possible
 * - Cached file reads within validation session
 * - Optimized regex patterns
 */

import { readFileSync } from 'fs';
import { ValidationResult } from './types.js';

/**
 * Simple file content cache to avoid redundant reads during validation
 */
const fileCache = new Map<string, { content: string; timestamp: number }>();
const FILE_CACHE_TTL = 10000; // 10 seconds

/**
 * Read file with caching
 */
function readFileWithCache(filePath: string): string {
  const cached = fileCache.get(filePath);
  if (cached && Date.now() - cached.timestamp < FILE_CACHE_TTL) {
    return cached.content;
  }

  const content = readFileSync(filePath, 'utf-8');
  fileCache.set(filePath, { content, timestamp: Date.now() });
  return content;
}

/**
 * Clear the file cache
 */
export function clearFileCache(): void {
  fileCache.clear();
}

/**
 * Required sections for a valid INTENT artifact
 */
const REQUIRED_SECTIONS = [
  'Problem Statement',
  'User Personas',
  'Success Metrics',
  'Business Constraints',
  'Out of Scope',
] as const;

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
 * Validates an INTENT artifact for completeness.
 *
 * Checks 6 criteria:
 * 1. Frontmatter has all required fields (id, title, parent, status, depth_score, risk_tier)
 * 2. Business Requirements section exists with at least 1 User Story (US-NNN pattern)
 * 3. Each User Story has an Acceptance criterion (look for "Acceptance:" under each US-NNN)
 * 4. Technical Specification section exists and is non-empty
 * 5. Implementation Plan section exists
 * 6. Proposed UNITs section has at least 1 UNIT listed (UNIT-NNN pattern)
 *
 * @param artifactPath - Absolute path to the INTENT artifact file
 * @returns ValidationResult with pass/fail status, coverage percentage, and any blocking issues
 *
 * @example
 * const result = await validateIntent('aidlc-docs/feature-x/inception/intent.md');
 * if (result.passed) {
 *   console.log('INTENT artifact is complete!');
 * } else {
 *   console.log('Issues found:', result.blocking_issues);
 * }
 */
export async function validateIntent(artifactPath: string): Promise<ValidationResult> {
  const timestamp = new Date().toISOString();
  const blockingIssues: string[] = [];

  // Read artifact file with caching
  let content: string;
  try {
    content = readFileWithCache(artifactPath);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;

    if (err.code === 'ENOENT') {
      console.error(`[Validation] INTENT artifact not found: ${artifactPath}`);
      return {
        passed: false,
        coverage_percentage: 0,
        blocking_issues: ['Artifact file not found'],
        timestamp,
      };
    }

    if (err.code === 'EACCES' || err.code === 'EPERM') {
      console.error(`[Validation] Permission denied reading INTENT artifact: ${artifactPath}`);
      return {
        passed: false,
        coverage_percentage: 0,
        blocking_issues: ['Permission denied reading artifact file'],
        timestamp,
      };
    }

    console.error(`[Validation] Failed to read INTENT artifact: ${err.message}`);
    console.error(`[Validation] Path: ${artifactPath}`);
    return {
      passed: false,
      coverage_percentage: 0,
      blocking_issues: [`Failed to read artifact: ${err.message}`],
      timestamp,
    };
  }

  // Parse YAML frontmatter - Criterion 1
  const frontmatter = parseFrontmatter(content);
  const requiredFrontmatterFields = ['id', 'title', 'parent', 'status', 'depth_score', 'risk_tier'];
  let frontmatterValid = true;
  for (const field of requiredFrontmatterFields) {
    if (!frontmatter || !frontmatter[field]) {
      blockingIssues.push(`Frontmatter missing required field: ${field}`);
      frontmatterValid = false;
    }
  }

  // Remove frontmatter from content for section parsing
  const markdownContent = removeFrontmatter(content);

  // Parse markdown sections
  const sections = parseSections(markdownContent);

  // Track criteria pass/fail (not blocking issues count)
  let passedCriteria = frontmatterValid ? 1 : 0;

  // Run all validations
  const validationChecks = [
    // Check criterion 2: Business Requirements section with at least 1 User Story
    () => {
      const businessReqs = sections.get('Business Requirements');
      if (!businessReqs) {
        return 'Missing Business Requirements section';
      }
      const userStoryMatches = businessReqs.match(/US-\d{3}/g);
      if (!userStoryMatches || userStoryMatches.length === 0) {
        return 'No User Stories found (expected US-NNN pattern)';
      }
      return null;
    },
    // Check criterion 3: Each User Story has Acceptance criterion
    () => {
      const businessReqs = sections.get('Business Requirements');
      if (businessReqs) {
        const userStoryMatches = businessReqs.match(/US-\d{3}/g);
        if (userStoryMatches) {
          for (const story of userStoryMatches) {
            // Check if there's an "Acceptance:" line after this story ID
            const storyIndex = businessReqs.indexOf(story);
            const nextStoryIndex = businessReqs.indexOf('US-', storyIndex + 1);
            const storySection = nextStoryIndex > 0
              ? businessReqs.substring(storyIndex, nextStoryIndex)
              : businessReqs.substring(storyIndex);

            if (!storySection.match(/Acceptance:/i)) {
              return `User Story ${story} missing Acceptance criterion`;
            }
          }
        }
      }
      return null;
    },
    // Check criterion 4: Technical Specification section exists and non-empty
    () => {
      const techSpec = sections.get('Technical Specification');
      if (!techSpec || techSpec.trim().length === 0) {
        return 'Technical Specification section missing or empty';
      }
      return null;
    },
    // Check criterion 5: Implementation Plan section exists
    () => {
      const implPlan = sections.get('Implementation Plan');
      if (!implPlan || implPlan.trim().length === 0) {
        return 'Implementation Plan section missing or empty';
      }
      return null;
    },
    // Check criterion 6: Proposed UNITs section has at least 1 UNIT
    () => {
      const implPlan = sections.get('Implementation Plan');
      // If Implementation Plan is missing, we can't check for UNITs
      // This is a separate criterion failure (don't return null)
      if (!implPlan || implPlan.trim().length === 0) {
        // Don't add a duplicate error message, just fail the criterion
        return ''; // Return empty string to fail criterion without adding to blocking issues
      }
      const unitMatches = implPlan.match(/UNIT-\d{3}/g);
      if (!unitMatches || unitMatches.length === 0) {
        return 'No Proposed UNITs found (expected UNIT-NNN pattern)';
      }
      return null;
    },
  ];

  // Execute all checks
  for (const check of validationChecks) {
    const issue = check();
    if (issue !== null) {
      // Criterion failed
      // Only add non-empty issues to blocking issues list
      if (issue.trim().length > 0) {
        blockingIssues.push(issue);
      }
    } else {
      // Criterion passed
      passedCriteria++;
    }
  }

  // Calculate coverage (6 total criteria)
  const totalCriteria = 6;
  const coveragePercentage = Math.round((passedCriteria / totalCriteria) * 100);

  return {
    passed: blockingIssues.length === 0,
    coverage_percentage: coveragePercentage,
    blocking_issues: blockingIssues,
    timestamp,
  };
}
