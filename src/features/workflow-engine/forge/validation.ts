/**
 * Forge Phase Validation
 *
 * Validates structural completeness of Forge stage artifacts (units, design, bolts).
 * These are structural checks only - NOT V&V alignment checks.
 *
 * Validates:
 * - Unit files (UNIT-*.md) in forge/units/ directory
 * - Design artifacts (interfaces, components, data flows) in forge/design/
 * - Bolt files (BOLT-*.md) representing implementation tasks
 * - Overall Forge phase structural integrity
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { ValidationResult } from '../types.js';
import type { HierarchicalNode } from '../phase-types.js';

/**
 * Valid effort estimates for units and bolts (in hours)
 */
const VALID_EFFORT_ESTIMATES = [1, 2, 4, 8, 16];

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
 * Validates UNIT-*.md files in the forge/units/ directory.
 *
 * Checks structural completeness:
 * - Each unit file has frontmatter (id, title, parent_intent, status, estimated_effort)
 * - Each unit references a valid parent intent (INTENT-NNN)
 * - Unit has required sections: Goal, Acceptance Criteria, Implementation Notes
 * - At least one acceptance criterion exists
 * - Effort estimate is valid (1, 2, 4, 8, or 16 hours)
 *
 * Also checks that all intents have at least one unit child.
 *
 * @param unitsDir - Absolute path to the forge/units/ directory
 * @param intentsDir - Absolute path to the intents/ directory
 * @returns ValidationResult with coverage percentage and blocking issues
 *
 * @example
 * const result = await validateUnits(
 *   'C:\\path\\to\\.olympus\\workflows\\feature-x\\forge\\units',
 *   'C:\\path\\to\\.olympus\\workflows\\feature-x\\intents'
 * );
 * if (result.passed) {
 *   console.log('All units are structurally complete');
 * }
 */
export async function validateUnits(
  unitsDir: string,
  intentsDir: string
): Promise<ValidationResult> {
  const timestamp = new Date().toISOString();
  const blockingIssues: string[] = [];

  // Read unit files
  let unitFiles: string[] = [];
  try {
    unitFiles = readdirSync(unitsDir).filter(f => f.startsWith('UNIT-') && f.endsWith('.md'));
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    console.error(`[Validation] Failed to read units directory: ${err.message}`);
    console.error(`[Validation] Path: ${unitsDir}`);

    const errorMsg = err.code === 'ENOENT'
      ? 'Units directory not found'
      : err.code === 'EACCES' || err.code === 'EPERM'
      ? 'Permission denied reading units directory'
      : `Failed to read units directory: ${err.message}`;

    return {
      passed: false,
      coverage_percentage: 0,
      blocking_issues: [errorMsg],
      timestamp,
    };
  }

  if (unitFiles.length === 0) {
    return {
      passed: false,
      coverage_percentage: 0,
      blocking_issues: ['No unit files found in units directory'],
      timestamp,
    };
  }

  // Read intent files to get valid parent IDs
  let intentIds: Set<string> = new Set();
  try {
    const intentFiles = readdirSync(intentsDir).filter(f => f.startsWith('INTENT-') && f.endsWith('.md'));
    intentIds = new Set(intentFiles.map(f => f.replace('.md', '')));
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    console.error(`[Validation] Failed to read intents directory: ${err.message}`);
    console.error(`[Validation] Path: ${intentsDir}`);

    const errorMsg = err.code === 'ENOENT'
      ? 'Intents directory not found'
      : err.code === 'EACCES' || err.code === 'EPERM'
      ? 'Permission denied reading intents directory'
      : `Failed to read intents directory: ${err.message}`;

    return {
      passed: false,
      coverage_percentage: 0,
      blocking_issues: [errorMsg],
      timestamp,
    };
  }

  // Track which intents have unit children
  const intentsWithChildren = new Set<string>();

  // Validate each unit file
  let validUnits = 0;
  const totalUnits = unitFiles.length;

  for (const unitFile of unitFiles) {
    const unitPath = join(unitsDir, unitFile);
    const unitId = unitFile.replace('.md', '');

    // Read unit file
    let content: string;
    try {
      content = readFileSync(unitPath, 'utf-8');
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      console.error(`[Validation] Failed to read unit file: ${err.message}`);
      console.error(`[Validation] Path: ${unitPath}`);

      const errorMsg = err.code === 'ENOENT'
        ? `Unit file not found: ${unitFile}`
        : err.code === 'EACCES' || err.code === 'EPERM'
        ? `Permission denied reading unit file: ${unitFile}`
        : `Failed to read unit file ${unitFile}: ${err.message}`;

      blockingIssues.push(errorMsg);
      continue;
    }

    // Parse frontmatter
    const frontmatter = parseFrontmatter(content);
    if (!frontmatter) {
      blockingIssues.push(`${unitId}: Missing frontmatter`);
      continue;
    }

    // Check required frontmatter fields
    const requiredFields = ['id', 'title', 'parent_intent', 'status', 'estimated_effort'];
    const missingFields: string[] = [];
    for (const field of requiredFields) {
      if (!frontmatter[field]) {
        missingFields.push(field);
      }
    }

    if (missingFields.length > 0) {
      blockingIssues.push(`${unitId}: Missing frontmatter fields: ${missingFields.join(', ')}`);
      continue;
    }

    // Validate parent_intent references a valid intent
    const parentIntent = frontmatter.parent_intent;
    if (!intentIds.has(parentIntent)) {
      blockingIssues.push(`${unitId}: References non-existent parent intent: ${parentIntent}`);
      continue;
    }

    // Track intent has children
    intentsWithChildren.add(parentIntent);

    // Validate effort estimate
    const effortEstimate = parseInt(frontmatter.estimated_effort, 10);
    if (isNaN(effortEstimate) || !VALID_EFFORT_ESTIMATES.includes(effortEstimate)) {
      blockingIssues.push(
        `${unitId}: Invalid effort estimate ${frontmatter.estimated_effort} (must be 1, 2, 4, 8, or 16)`
      );
      continue;
    }

    // Parse sections
    const markdownContent = removeFrontmatter(content);
    const sections = parseSections(markdownContent);

    // Check required sections
    const requiredSections = ['Goal', 'Acceptance Criteria', 'Implementation Notes'];
    const missingSections: string[] = [];
    for (const section of requiredSections) {
      if (!sections.has(section)) {
        missingSections.push(section);
      }
    }

    if (missingSections.length > 0) {
      blockingIssues.push(`${unitId}: Missing sections: ${missingSections.join(', ')}`);
      continue;
    }

    // Check at least one acceptance criterion
    const acceptanceCriteria = sections.get('Acceptance Criteria');
    if (acceptanceCriteria) {
      const criteriaCount = countBulletPoints(acceptanceCriteria);
      if (criteriaCount === 0) {
        blockingIssues.push(`${unitId}: No acceptance criteria found`);
        continue;
      }
    } else {
      blockingIssues.push(`${unitId}: Acceptance Criteria section is empty`);
      continue;
    }

    // All checks passed for this unit
    validUnits++;
  }

  // Check all intents have at least one unit child
  for (const intentId of intentIds) {
    if (!intentsWithChildren.has(intentId)) {
      blockingIssues.push(`Intent ${intentId} has no unit children`);
    }
  }

  // Calculate coverage
  const coveragePercentage = Math.round((validUnits / totalUnits) * 100);

  return {
    passed: blockingIssues.length === 0 && validUnits === totalUnits,
    coverage_percentage: coveragePercentage,
    blocking_issues: blockingIssues,
    timestamp,
  };
}

/**
 * Validates design artifacts in forge/design/ directory.
 *
 * Checks:
 * - interfaces.json exists and is valid JSON
 * - data-flow.json exists and is valid JSON
 * - components.json exists and is valid JSON
 * - Each interface has at least one input or output
 * - Each component references valid interfaces
 * - Data flows reference valid components
 *
 * @param designDir - Absolute path to the forge/design/ directory
 * @returns ValidationResult with coverage percentage and blocking issues
 *
 * @example
 * const result = await validateDesignArtifacts(
 *   'C:\\path\\to\\.olympus\\workflows\\feature-x\\forge\\design'
 * );
 * if (result.passed) {
 *   console.log('All design artifacts are valid');
 * }
 */
export async function validateDesignArtifacts(designDir: string): Promise<ValidationResult> {
  const timestamp = new Date().toISOString();
  const blockingIssues: string[] = [];

  const expectedArtifacts = ['interfaces.json', 'data-flow.json', 'components.json'];
  const totalExpectedArtifacts = expectedArtifacts.length;
  let validArtifacts = 0;

  // Check if design directory exists
  if (!existsSync(designDir)) {
    return {
      passed: false,
      coverage_percentage: 0,
      blocking_issues: ['Design directory not found'],
      timestamp,
    };
  }

  // Track parsed data for cross-validation
  let interfaces: Record<string, any> = {};
  let components: Record<string, any> = {};
  let dataFlows: any[] = [];

  // Validate interfaces.json
  const interfacesPath = join(designDir, 'interfaces.json');
  try {
    const interfacesContent = readFileSync(interfacesPath, 'utf-8');
    interfaces = JSON.parse(interfacesContent);

    // Check each interface has at least one input or output
    for (const [interfaceId, iface] of Object.entries(interfaces)) {
      const ifaceData = iface as any;
      const hasInputs = ifaceData.inputs && Array.isArray(ifaceData.inputs) && ifaceData.inputs.length > 0;
      const hasOutputs = ifaceData.outputs && Array.isArray(ifaceData.outputs) && ifaceData.outputs.length > 0;

      if (!hasInputs && !hasOutputs) {
        blockingIssues.push(`Interface ${interfaceId} has no inputs or outputs`);
      }
    }

    validArtifacts++;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    console.error(`[Validation] Failed to read interfaces.json: ${err.message}`);

    const errorMsg = err.code === 'ENOENT'
      ? 'interfaces.json not found'
      : err.code === 'EACCES' || err.code === 'EPERM'
      ? 'Permission denied reading interfaces.json'
      : err instanceof SyntaxError
      ? 'interfaces.json is not valid JSON'
      : `Failed to read interfaces.json: ${err.message}`;

    blockingIssues.push(errorMsg);
  }

  // Validate components.json
  const componentsPath = join(designDir, 'components.json');
  try {
    const componentsContent = readFileSync(componentsPath, 'utf-8');
    components = JSON.parse(componentsContent);

    // Check each component references valid interfaces
    const interfaceIds = new Set(Object.keys(interfaces));
    for (const [componentId, component] of Object.entries(components)) {
      const componentData = component as any;
      if (componentData.interfaces && Array.isArray(componentData.interfaces)) {
        for (const interfaceRef of componentData.interfaces) {
          if (!interfaceIds.has(interfaceRef)) {
            blockingIssues.push(
              `Component ${componentId} references non-existent interface: ${interfaceRef}`
            );
          }
        }
      }
    }

    validArtifacts++;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    console.error(`[Validation] Failed to read components.json: ${err.message}`);

    const errorMsg = err.code === 'ENOENT'
      ? 'components.json not found'
      : err.code === 'EACCES' || err.code === 'EPERM'
      ? 'Permission denied reading components.json'
      : err instanceof SyntaxError
      ? 'components.json is not valid JSON'
      : `Failed to read components.json: ${err.message}`;

    blockingIssues.push(errorMsg);
  }

  // Validate data-flow.json
  const dataFlowPath = join(designDir, 'data-flow.json');
  try {
    const dataFlowContent = readFileSync(dataFlowPath, 'utf-8');
    dataFlows = JSON.parse(dataFlowContent);

    // Check data flows reference valid components
    const componentIds = new Set(Object.keys(components));
    if (Array.isArray(dataFlows)) {
      for (const flow of dataFlows) {
        if (flow.from && !componentIds.has(flow.from)) {
          blockingIssues.push(`Data flow references non-existent component: ${flow.from}`);
        }
        if (flow.to && !componentIds.has(flow.to)) {
          blockingIssues.push(`Data flow references non-existent component: ${flow.to}`);
        }
      }
    }

    validArtifacts++;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    console.error(`[Validation] Failed to read data-flow.json: ${err.message}`);

    const errorMsg = err.code === 'ENOENT'
      ? 'data-flow.json not found'
      : err.code === 'EACCES' || err.code === 'EPERM'
      ? 'Permission denied reading data-flow.json'
      : err instanceof SyntaxError
      ? 'data-flow.json is not valid JSON'
      : `Failed to read data-flow.json: ${err.message}`;

    blockingIssues.push(errorMsg);
  }

  // Calculate coverage
  const coveragePercentage = Math.round((validArtifacts / totalExpectedArtifacts) * 100);

  return {
    passed: blockingIssues.length === 0 && validArtifacts === totalExpectedArtifacts,
    coverage_percentage: coveragePercentage,
    blocking_issues: blockingIssues,
    timestamp,
  };
}

/**
 * Validates a single BOLT-*.md file.
 *
 * Checks structural completeness:
 * - Frontmatter has id, title, parent_unit, status, estimated_effort
 * - Has required sections: Goal, Implementation Steps, Acceptance Criteria
 * - At least one implementation step
 * - At least one acceptance criterion
 * - References a valid parent unit (UNIT-NNN)
 * - Effort estimate is valid (1, 2, 4, 8, or 16 hours)
 *
 * @param boltPath - Absolute path to the BOLT-*.md file
 * @returns ValidationResult with coverage percentage and blocking issues
 *
 * @example
 * const result = await validateBolt(
 *   'C:\\path\\to\\.olympus\\workflows\\feature-x\\forge\\bolts\\BOLT-001.md'
 * );
 * if (result.passed) {
 *   console.log('Bolt is structurally complete');
 * }
 */
export async function validateBolt(boltPath: string): Promise<ValidationResult> {
  const timestamp = new Date().toISOString();
  const blockingIssues: string[] = [];

  // Extract bolt ID from filename
  const boltId = boltPath.split(/[/\\]/).pop()?.replace('.md', '') || 'unknown';

  // Read bolt file
  let content: string;
  try {
    content = readFileSync(boltPath, 'utf-8');
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    console.error(`[Validation] Failed to read bolt file: ${err.message}`);
    console.error(`[Validation] Path: ${boltPath}`);

    const errorMsg = err.code === 'ENOENT'
      ? 'Bolt file not found'
      : err.code === 'EACCES' || err.code === 'EPERM'
      ? 'Permission denied reading bolt file'
      : `Failed to read bolt file: ${err.message}`;

    return {
      passed: false,
      coverage_percentage: 0,
      blocking_issues: [errorMsg],
      timestamp,
    };
  }

  // Parse frontmatter
  const frontmatter = parseFrontmatter(content);
  const totalChecks = 7; // Total number of validation checks
  let passedChecks = 0;

  if (!frontmatter) {
    blockingIssues.push('Missing frontmatter');
    return {
      passed: false,
      coverage_percentage: 0,
      blocking_issues: blockingIssues,
      timestamp,
    };
  }

  // Check required frontmatter fields
  const requiredFields = ['id', 'title', 'parent_unit', 'status', 'estimated_effort'];
  const missingFields: string[] = [];
  for (const field of requiredFields) {
    if (!frontmatter[field]) {
      missingFields.push(field);
    }
  }

  if (missingFields.length > 0) {
    blockingIssues.push(`Missing frontmatter fields: ${missingFields.join(', ')}`);
  } else {
    passedChecks++; // Check 1: All frontmatter fields present
  }

  // Validate parent_unit format (UNIT-NNN)
  const parentUnit = frontmatter.parent_unit;
  if (parentUnit && /^UNIT-\d{3}$/.test(parentUnit)) {
    passedChecks++; // Check 2: Valid parent unit reference
  } else {
    blockingIssues.push(`Invalid parent_unit format: ${parentUnit} (expected UNIT-NNN)`);
  }

  // Validate effort estimate
  const effortEstimate = parseInt(frontmatter.estimated_effort, 10);
  if (!isNaN(effortEstimate) && VALID_EFFORT_ESTIMATES.includes(effortEstimate)) {
    passedChecks++; // Check 3: Valid effort estimate
  } else {
    blockingIssues.push(
      `Invalid effort estimate ${frontmatter.estimated_effort} (must be 1, 2, 4, 8, or 16)`
    );
  }

  // Parse sections
  const markdownContent = removeFrontmatter(content);
  const sections = parseSections(markdownContent);

  // Check required sections
  const requiredSections = ['Goal', 'Implementation Steps', 'Acceptance Criteria'];
  const missingSections: string[] = [];
  for (const section of requiredSections) {
    if (!sections.has(section)) {
      missingSections.push(section);
    }
  }

  if (missingSections.length === 0) {
    passedChecks++; // Check 4: All required sections present
  } else {
    blockingIssues.push(`Missing sections: ${missingSections.join(', ')}`);
  }

  // Check at least one implementation step
  const implementationSteps = sections.get('Implementation Steps');
  if (implementationSteps) {
    const stepsCount = countBulletPoints(implementationSteps);
    if (stepsCount > 0) {
      passedChecks++; // Check 5: Has implementation steps
    } else {
      blockingIssues.push('No implementation steps found');
    }
  } else {
    blockingIssues.push('Implementation Steps section is empty');
  }

  // Check at least one acceptance criterion
  const acceptanceCriteria = sections.get('Acceptance Criteria');
  if (acceptanceCriteria) {
    const criteriaCount = countBulletPoints(acceptanceCriteria);
    if (criteriaCount > 0) {
      passedChecks++; // Check 6: Has acceptance criteria
    } else {
      blockingIssues.push('No acceptance criteria found');
    }
  } else {
    blockingIssues.push('Acceptance Criteria section is empty');
  }

  // Check 7: Overall structural completeness (if we got this far with few issues)
  if (blockingIssues.length === 0) {
    passedChecks++; // Check 7: Overall completeness
  }

  // Calculate coverage
  const coveragePercentage = Math.round((passedChecks / totalChecks) * 100);

  return {
    passed: blockingIssues.length === 0 && passedChecks === totalChecks,
    coverage_percentage: coveragePercentage,
    blocking_issues: blockingIssues,
    timestamp,
  };
}

/**
 * High-level validation of entire Forge phase.
 *
 * Runs validateUnits, validateDesignArtifacts, and checks bolts.
 * Returns aggregate ValidationResult.
 *
 * @param projectPath - Absolute path to the project root
 * @param workflowId - Workflow ID for the feature
 * @returns ValidationResult with aggregated coverage and blocking issues
 *
 * @example
 * const result = await validateForgePhase(
 *   'C:\\path\\to\\project',
 *   'feature-x-20240115'
 * );
 * if (result.passed) {
 *   console.log('Forge phase is structurally complete');
 * }
 */
export async function validateForgePhase(
  projectPath: string,
  workflowId: string
): Promise<ValidationResult> {
  const timestamp = new Date().toISOString();
  const blockingIssues: string[] = [];

  const workflowDir = join(projectPath, '.olympus', 'workflows', workflowId);
  const forgeDir = join(workflowDir, 'forge');
  const unitsDir = join(forgeDir, 'units');
  const designDir = join(forgeDir, 'design');
  const boltsDir = join(forgeDir, 'bolts');
  const intentsDir = join(workflowDir, 'intents');

  // Check if forge directory exists
  if (!existsSync(forgeDir)) {
    return {
      passed: false,
      coverage_percentage: 0,
      blocking_issues: ['Forge directory not found'],
      timestamp,
    };
  }

  // Validate units
  let unitsResult: ValidationResult | null = null;
  if (existsSync(unitsDir) && existsSync(intentsDir)) {
    unitsResult = await validateUnits(unitsDir, intentsDir);
    if (!unitsResult.passed) {
      blockingIssues.push(...unitsResult.blocking_issues.map(i => `[Units] ${i}`));
    }
  } else {
    blockingIssues.push('Units or intents directory not found');
  }

  // Validate design artifacts
  let designResult: ValidationResult | null = null;
  if (existsSync(designDir)) {
    designResult = await validateDesignArtifacts(designDir);
    if (!designResult.passed) {
      blockingIssues.push(...designResult.blocking_issues.map(i => `[Design] ${i}`));
    }
  } else {
    blockingIssues.push('Design directory not found');
  }

  // Validate bolts
  let boltsResult: ValidationResult | null = null;
  let boltFiles: string[] = [];
  if (existsSync(boltsDir)) {
    try {
      boltFiles = readdirSync(boltsDir).filter(f => f.startsWith('BOLT-') && f.endsWith('.md'));

      if (boltFiles.length > 0) {
        let validBolts = 0;
        const totalBolts = boltFiles.length;

        for (const boltFile of boltFiles) {
          const boltPath = join(boltsDir, boltFile);
          const boltResult = await validateBolt(boltPath);

          if (boltResult.passed) {
            validBolts++;
          } else {
            blockingIssues.push(...boltResult.blocking_issues.map(i => `[${boltFile}] ${i}`));
          }
        }

        const boltsCoveragePercentage = Math.round((validBolts / totalBolts) * 100);
        boltsResult = {
          passed: validBolts === totalBolts,
          coverage_percentage: boltsCoveragePercentage,
          blocking_issues: [],
          timestamp,
        };
      } else {
        blockingIssues.push('No bolt files found in bolts directory');
      }
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      console.error(`[Validation] Failed to read bolts directory: ${err.message}`);

      const errorMsg = err.code === 'EACCES' || err.code === 'EPERM'
        ? 'Permission denied reading bolts directory'
        : `Failed to read bolts directory: ${err.message}`;

      blockingIssues.push(errorMsg);
    }
  } else {
    blockingIssues.push('Bolts directory not found');
  }

  // Calculate aggregate coverage
  const coverages: number[] = [];
  if (unitsResult) coverages.push(unitsResult.coverage_percentage);
  if (designResult) coverages.push(designResult.coverage_percentage);
  if (boltsResult) coverages.push(boltsResult.coverage_percentage);

  const aggregateCoverage = coverages.length > 0
    ? Math.round(coverages.reduce((a, b) => a + b, 0) / coverages.length)
    : 0;

  return {
    passed: blockingIssues.length === 0,
    coverage_percentage: aggregateCoverage,
    blocking_issues: blockingIssues,
    timestamp,
  };
}
