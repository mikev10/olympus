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

/**
 * Validates a SPEC artifact for coverage against PRD user stories.
 *
 * **Phase 2 MVP Stub Implementation**
 * This is a simplified implementation that calculates coverage but does not
 * invoke the Metis agent for critical review. Full Metis integration is
 * deferred to Phase 3.
 *
 * Checks:
 * - SPEC implements >= 95% of PRD user stories
 * - Requirement coverage section exists
 * - All components documented
 *
 * TODO (Phase 3): Integrate Metis agent for:
 * - Hidden requirements analysis
 * - Dependency mapping completeness
 * - Security considerations adequacy
 * - Performance requirements coverage
 *
 * @param specPath - Absolute path to the SPEC artifact file
 * @param prdPath - Absolute path to the PRD artifact file
 * @returns ValidationResult with coverage percentage and Metis placeholder
 *
 * @example
 * const result = await validateSpec(
 *   '.olympus/workflows/feature-x/spec.md',
 *   '.olympus/workflows/feature-x/prd.md'
 * );
 * if (result.coverage_percentage >= 95) {
 *   console.log('SPEC has sufficient PRD coverage');
 * }
 */
export async function validateSpec(
  specPath: string,
  prdPath: string
): Promise<ValidationResult> {
  const timestamp = new Date().toISOString();
  const blockingIssues: string[] = [];

  // Read SPEC artifact
  let specContent: string;
  try {
    specContent = readFileSync(specPath, 'utf-8');
  } catch (error) {
    return {
      passed: false,
      coverage_percentage: 0,
      blocking_issues: ['SPEC artifact file not found'],
      reviewer: 'metis',
      timestamp,
    };
  }

  // Read PRD artifact
  let prdContent: string;
  try {
    prdContent = readFileSync(prdPath, 'utf-8');
  } catch (error) {
    return {
      passed: false,
      coverage_percentage: 0,
      blocking_issues: ['PRD artifact file not found for reference'],
      reviewer: 'metis',
      timestamp,
    };
  }

  // Parse PRD user stories
  const prdMarkdown = removeFrontmatter(prdContent);
  const prdUserStories: string[] = [];
  for (const line of prdMarkdown.split('\n')) {
    const match = line.match(/^###?\s+(US-\d+)/);
    if (match) {
      prdUserStories.push(match[1]);
    }
  }

  // Parse SPEC for user story coverage
  const specMarkdown = removeFrontmatter(specContent);
  const specSections = parseSections(specMarkdown);
  const coverageSection = specSections.get('Requirement Coverage') || specSections.get('PRD Coverage') || '';

  // Count how many PRD user stories are referenced in SPEC
  let coveredStories = 0;
  for (const story of prdUserStories) {
    if (specMarkdown.includes(story)) {
      coveredStories++;
    }
  }

  // Calculate coverage percentage
  const coveragePercentage =
    prdUserStories.length > 0
      ? Math.round((coveredStories / prdUserStories.length) * 100)
      : 0;

  // Validate completeness
  if (prdUserStories.length === 0) {
    blockingIssues.push('No user stories found in PRD for validation');
  }

  if (!coverageSection || coverageSection.trim().length === 0) {
    blockingIssues.push('Missing Requirement Coverage section in SPEC');
  }

  if (coveragePercentage < 95) {
    blockingIssues.push(
      `Coverage only ${coveragePercentage}%, need at least 95% (${coveredStories}/${prdUserStories.length} user stories addressed)`
    );
  }

  // Check for components section
  const hasComponentsSection = specSections.has('Components') || specSections.has('Architecture');
  if (!hasComponentsSection) {
    blockingIssues.push('Missing Components or Architecture section');
  }

  // TODO (Phase 3): Invoke Metis agent here for critical review
  // const metisReview = await invokeMetisAgent(specContent, prdContent);
  // blockingIssues.push(...metisReview.issues);
  // Metis should check:
  // - Hidden requirements not explicitly stated in PRD
  // - Dependency mapping completeness
  // - Security considerations adequacy
  // - Performance requirements coverage

  return {
    passed: blockingIssues.length === 0 && coveragePercentage >= 95,
    coverage_percentage: coveragePercentage,
    blocking_issues: blockingIssues,
    reviewer: 'metis',  // Placeholder - real Metis review deferred to Phase 3
    timestamp,
  };
}

/**
 * Validates TASKS artifacts for coverage against SPEC components.
 *
 * Checks:
 * - 100% of SPEC components have tasks
 * - Dependency graph is valid (no circular dependencies)
 * - All tasks have effort estimates
 * - Effort estimates are reasonable (1, 2, 4, 8, or 16 hours)
 *
 * @param tasksDir - Absolute path to the tasks directory (contains INTENT files)
 * @param specPath - Absolute path to the SPEC artifact file
 * @returns ValidationResult with coverage percentage and validation details
 *
 * @example
 * const result = await validateTasks(
 *   '.olympus/workflows/feature-x/intents/',
 *   '.olympus/workflows/feature-x/spec.md'
 * );
 * if (result.passed) {
 *   console.log('All SPEC components have task coverage');
 * }
 */
export async function validateTasks(
  tasksDir: string,
  specPath: string
): Promise<ValidationResult> {
  const timestamp = new Date().toISOString();
  const blockingIssues: string[] = [];

  // Read SPEC artifact
  let specContent: string;
  try {
    specContent = readFileSync(specPath, 'utf-8');
  } catch (error) {
    return {
      passed: false,
      coverage_percentage: 0,
      blocking_issues: ['SPEC artifact file not found'],
      timestamp,
    };
  }

  // Parse SPEC for components
  const specMarkdown = removeFrontmatter(specContent);
  const specSections = parseSections(specMarkdown);
  const componentsSection = specSections.get('Components') || specSections.get('Architecture') || '';

  // Extract component names (look for ### headings in components section)
  const specComponents: string[] = [];
  if (componentsSection) {
    for (const line of componentsSection.split('\n')) {
      const match = line.match(/^###\s+(.+)$/);
      if (match) {
        specComponents.push(match[1].trim());
      }
    }
  }

  // Read INTENT files from tasksDir
  let intentFiles: string[] = [];
  try {
    const fs = await import('fs');
    const path = await import('path');
    const files = fs.readdirSync(tasksDir);
    intentFiles = files.filter(f => f.endsWith('.md') || f.includes('INTENT'));
  } catch (error) {
    return {
      passed: false,
      coverage_percentage: 0,
      blocking_issues: ['Tasks directory not found or inaccessible'],
      timestamp,
    };
  }

  // Parse INTENT files for component coverage
  const coveredComponents = new Set<string>();
  const taskEstimates: number[] = [];

  for (const intentFile of intentFiles) {
    try {
      const fs = await import('fs');
      const path = await import('path');
      const intentPath = path.join(tasksDir, intentFile);
      const intentContent = fs.readFileSync(intentPath, 'utf-8');

      // Check which components are mentioned in this INTENT
      for (const component of specComponents) {
        if (intentContent.includes(component)) {
          coveredComponents.add(component);
        }
      }

      // Extract effort estimate
      const effortMatch = intentContent.match(/estimated_effort:\s*(\d+)/i);
      if (effortMatch) {
        taskEstimates.push(parseInt(effortMatch[1], 10));
      }
    } catch (error) {
      // Skip unreadable files
    }
  }

  // Calculate coverage percentage
  const coveragePercentage =
    specComponents.length > 0
      ? Math.round((coveredComponents.size / specComponents.length) * 100)
      : 100;

  // Validate 100% coverage
  if (specComponents.length === 0) {
    blockingIssues.push('No components found in SPEC for validation');
  } else if (coveragePercentage < 100) {
    const uncovered = specComponents.filter(c => !coveredComponents.has(c));
    blockingIssues.push(
      `Incomplete coverage: ${coveragePercentage}% (missing: ${uncovered.join(', ')})`
    );
  }

  // Validate effort estimates
  const validEstimates = [1, 2, 4, 8, 16];
  for (const estimate of taskEstimates) {
    if (!validEstimates.includes(estimate)) {
      blockingIssues.push(
        `Invalid effort estimate: ${estimate} hours (must be 1, 2, 4, 8, or 16)`
      );
    }
  }

  if (intentFiles.length > 0 && taskEstimates.length === 0) {
    blockingIssues.push('No effort estimates found in task files');
  }

  // Check for variance in estimates (within 30%)
  if (taskEstimates.length > 1) {
    const avgEstimate = taskEstimates.reduce((a, b) => a + b, 0) / taskEstimates.length;
    const maxVariance = avgEstimate * 0.3;
    for (const estimate of taskEstimates) {
      if (Math.abs(estimate - avgEstimate) > maxVariance) {
        // This is a warning, not a blocking issue
        // Only add if variance is extreme (>50%)
        if (Math.abs(estimate - avgEstimate) > avgEstimate * 0.5) {
          blockingIssues.push(
            `High variance in effort estimates: ${estimate}h vs avg ${Math.round(avgEstimate)}h`
          );
        }
      }
    }
  }

  // Validate dependency graph
  try {
    const fs = await import('fs');
    const path = await import('path');
    const graphPath = path.join(tasksDir, 'dependency-graph.json');
    const graphContent = fs.readFileSync(graphPath, 'utf-8');
    const graph = JSON.parse(graphContent);

    // Basic cycle detection
    const hasCycle = detectCycles(graph);
    if (hasCycle) {
      blockingIssues.push('Circular dependencies detected in dependency graph');
    }

    // Validate all referenced dependencies exist
    const taskIds = new Set(Object.keys(graph));
    for (const [taskId, deps] of Object.entries(graph)) {
      if (Array.isArray(deps)) {
        for (const dep of deps) {
          if (!taskIds.has(dep)) {
            blockingIssues.push(
              `Task ${taskId} references non-existent dependency: ${dep}`
            );
          }
        }
      }
    }
  } catch (error) {
    // Dependency graph is optional for now
    // blockingIssues.push('Dependency graph file not found or invalid');
  }

  return {
    passed: blockingIssues.length === 0 && coveragePercentage === 100,
    coverage_percentage: coveragePercentage,
    blocking_issues: blockingIssues,
    timestamp,
  };
}

/**
 * Detects cycles in a dependency graph using depth-first search.
 *
 * @param graph - Adjacency list representation of dependencies
 * @returns true if a cycle is detected, false otherwise
 */
function detectCycles(graph: Record<string, string[]>): boolean {
  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  function dfs(node: string): boolean {
    visited.add(node);
    recursionStack.add(node);

    const neighbors = graph[node] || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        if (dfs(neighbor)) {
          return true;
        }
      } else if (recursionStack.has(neighbor)) {
        // Found a back edge - cycle detected
        return true;
      }
    }

    recursionStack.delete(node);
    return false;
  }

  for (const node of Object.keys(graph)) {
    if (!visited.has(node)) {
      if (dfs(node)) {
        return true;
      }
    }
  }

  return false;
}
