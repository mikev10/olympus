/**
 * Construction Phase Validation
 *
 * Validates structural completeness of Construction stage artifacts (units, design, bolts).
 * These are structural checks only - NOT V&V alignment checks.
 *
 * Validates:
 * - Unit files in construction/UNIT-NNN/spec.md (new) or construction/UNIT-NNN.md (legacy)
 * - Design artifacts (interfaces, components, data flows) in construction/design/
 * - Bolt files (BOLT-*.md) in construction/UNIT-NNN/ directories or construction/bolts/ (legacy)
 * - Overall Construction phase structural integrity
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
 * Validates a single unit's content.
 *
 * @param content - The markdown content of the unit file
 * @param unitId - The unit identifier (e.g., UNIT-001)
 * @param intentIds - Set of valid intent IDs
 * @returns Object with isValid flag, blocking issues, and tracked parent intent
 */
function validateUnitContent(
  content: string,
  unitId: string,
  intentIds: Set<string>
): { isValid: boolean; blockingIssues: string[]; parentIntent: string | null } {
  const blockingIssues: string[] = [];
  let parentIntent: string | null = null;

  // Parse frontmatter
  const frontmatter = parseFrontmatter(content);
  if (!frontmatter) {
    blockingIssues.push(`${unitId}: Missing frontmatter`);
    return { isValid: false, blockingIssues, parentIntent };
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
    return { isValid: false, blockingIssues, parentIntent };
  }

  // Validate parent_intent references a valid intent
  parentIntent = frontmatter.parent_intent;
  // Accept INTENT-NNN format (validated against known intents) or intent-{id} format (loose)
  if (!intentIds.has(parentIntent!) && !parentIntent!.startsWith('intent-')) {
    blockingIssues.push(`${unitId}: References non-existent parent intent: ${parentIntent}`);
    return { isValid: false, blockingIssues, parentIntent };
  }

  // Track intent has children (only for known intents)
  // parentIntent is set above

  // Validate effort estimate
  const effortEstimate = parseInt(frontmatter.estimated_effort, 10);
  if (isNaN(effortEstimate) || !VALID_EFFORT_ESTIMATES.includes(effortEstimate)) {
    blockingIssues.push(
      `${unitId}: Invalid effort estimate ${frontmatter.estimated_effort} (must be 1, 2, 4, 8, or 16)`
    );
    return { isValid: false, blockingIssues, parentIntent };
  }

  // Parse sections
  const markdownContent = removeFrontmatter(content);
  const sections = parseSections(markdownContent);

  // Check required sections - support both new and old template formats
  // NEW template sections
  const newRequiredSections = ['Scope & Responsibility', 'Interface Contracts', 'Dependencies', 'Acceptance Criteria', 'Proposed BOLTs'];
  // OLD template sections (backward compat)
  const oldRequiredSections = ['Goal', 'Acceptance Criteria', 'Implementation Notes'];

  const hasNewSections = newRequiredSections.every(s => sections.has(s));
  const hasOldSections = oldRequiredSections.every(s => sections.has(s));

  if (!hasNewSections && !hasOldSections) {
    // Report which sections are missing from the NEW template (since that's the target)
    const missingSections = newRequiredSections.filter(s => !sections.has(s));
    blockingIssues.push(`${unitId}: Missing sections: ${missingSections.join(', ')}`);
    return { isValid: false, blockingIssues, parentIntent };
  }

  // Check at least one acceptance criterion
  const acceptanceCriteria = sections.get('Acceptance Criteria');
  if (acceptanceCriteria) {
    const criteriaCount = countBulletPoints(acceptanceCriteria);
    if (criteriaCount === 0) {
      blockingIssues.push(`${unitId}: No acceptance criteria found`);
      return { isValid: false, blockingIssues, parentIntent };
    }
  } else {
    blockingIssues.push(`${unitId}: Acceptance Criteria section is empty`);
    return { isValid: false, blockingIssues, parentIntent };
  }

  return { isValid: true, blockingIssues, parentIntent };
}

/**
 * Validates UNIT artifacts in the construction directory.
 *
 * Supports two directory layouts:
 * - NEW: construction/UNIT-NNN/spec.md (subdirectory per unit)
 * - OLD: construction/UNIT-NNN.md (flat files, backward compatible)
 *
 * Checks structural completeness:
 * - Each unit file has frontmatter (id, title, parent_intent, status, estimated_effort)
 * - Each unit references a valid parent intent (INTENT-NNN or intent-{id})
 * - Unit has required sections (new or old template format)
 * - At least one acceptance criterion exists
 * - Effort estimate is valid (1, 2, 4, 8, or 16 hours)
 *
 * Also checks that all intents have at least one unit child.
 *
 * @param constructionDir - Absolute path to the construction/ directory
 * @param intentsDir - Absolute path to the intents/ directory (inception/)
 * @returns ValidationResult with coverage percentage and blocking issues
 *
 * @example
 * const result = await validateUnits(
 *   'C:\\path\\to\\.olympus\\workflows\\feature-x\\construction',
 *   'C:\\path\\to\\.olympus\\workflows\\feature-x\\inception'
 * );
 * if (result.passed) {
 *   console.log('All units are structurally complete');
 * }
 */
export async function validateUnits(
  constructionDir: string,
  intentsDir: string
): Promise<ValidationResult> {
  const timestamp = new Date().toISOString();
  const blockingIssues: string[] = [];

  // Read construction directory entries
  let entries: import('fs').Dirent[];
  try {
    entries = readdirSync(constructionDir, { withFileTypes: true });
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    console.error(`[Validation] Failed to read construction directory: ${err.message}`);
    console.error(`[Validation] Path: ${constructionDir}`);

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

  // Step 1: Look for UNIT-NNN subdirectories with spec.md (new style)
  const unitDirs = entries.filter(e => e.isDirectory() && /^UNIT-\d{3}$/.test(e.name));

  // Step 2: Look for top-level UNIT-NNN.md files (old style / backward compat)
  const topLevelUnits = entries.filter(e => e.isFile() && /^UNIT-\d{3}\.md$/.test(e.name));

  // Track which unit IDs we've discovered
  const discoveredUnitIds = new Set<string>();

  // Collect unit entries to validate: { unitId, filePath }
  const unitEntries: { unitId: string; filePath: string }[] = [];

  // New-style: UNIT-NNN/spec.md
  for (const dir of unitDirs) {
    const unitId = dir.name;
    const specPath = join(constructionDir, dir.name, 'spec.md');
    if (existsSync(specPath)) {
      discoveredUnitIds.add(unitId);
      unitEntries.push({ unitId, filePath: specPath });
    }
  }

  // Old-style: top-level UNIT-NNN.md (only if not already found via subdirectory)
  for (const file of topLevelUnits) {
    const unitId = file.name.replace('.md', '');
    if (!discoveredUnitIds.has(unitId)) {
      discoveredUnitIds.add(unitId);
      unitEntries.push({ unitId, filePath: join(constructionDir, file.name) });
    }
  }

  if (unitEntries.length === 0) {
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

  // Validate each unit
  let validUnits = 0;
  const totalUnits = unitEntries.length;

  for (const { unitId, filePath } of unitEntries) {
    // Read unit file
    let content: string;
    try {
      content = readFileSync(filePath, 'utf-8');
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      console.error(`[Validation] Failed to read unit file: ${err.message}`);
      console.error(`[Validation] Path: ${filePath}`);

      const errorMsg = err.code === 'ENOENT'
        ? `Unit file not found: ${unitId}`
        : err.code === 'EACCES' || err.code === 'EPERM'
        ? `Permission denied reading unit file: ${unitId}`
        : `Failed to read unit file ${unitId}: ${err.message}`;

      blockingIssues.push(errorMsg);
      continue;
    }

    const result = validateUnitContent(content, unitId, intentIds);
    blockingIssues.push(...result.blockingIssues);

    if (result.parentIntent && intentIds.has(result.parentIntent)) {
      intentsWithChildren.add(result.parentIntent);
    }

    if (result.isValid) {
      validUnits++;
    }
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
 * Validates design artifacts in construction/design/ directory.
 *
 * Checks:
 * - interfaces.json exists and is valid JSON
 * - data-flow.json exists and is valid JSON
 * - components.json exists and is valid JSON
 * - Each interface has at least one input or output
 * - Each component references valid interfaces
 * - Data flows reference valid components
 *
 * @param designDir - Absolute path to the construction/design/ directory
 * @returns ValidationResult with coverage percentage and blocking issues
 *
 * @example
 * const result = await validateDesignArtifacts(
 *   'C:\\path\\to\\.olympus\\workflows\\feature-x\\construction\\design'
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
 * - Has required sections (new or old template format):
 *   NEW: Domain Design, Logical Design, Target Files, Implementation Steps, Acceptance Criteria
 *   OLD: Goal, Implementation Steps, Acceptance Criteria
 * - At least one implementation step
 * - At least one acceptance criterion
 * - References a valid parent unit (UNIT-NNN) or "none" for SHALLOW mode
 * - Effort estimate is valid (1, 2, 4, 8, or 16 hours)
 *
 * @param boltPath - Absolute path to the BOLT-*.md file
 * @returns ValidationResult with coverage percentage and blocking issues
 *
 * @example
 * const result = await validateBolt(
 *   'C:\\path\\to\\.olympus\\workflows\\feature-x\\construction\\UNIT-001\\BOLT-001.md'
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

  // Validate parent_unit format (UNIT-NNN or "none" for SHALLOW mode)
  const parentUnit = frontmatter.parent_unit;
  if (parentUnit && (/^UNIT-\d{3}$/.test(parentUnit) || parentUnit === 'none')) {
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

  // Check required sections - support both new and old template formats
  // NEW template sections
  const newRequiredSections = ['Domain Design', 'Logical Design', 'Target Files', 'Implementation Steps', 'Acceptance Criteria'];
  // OLD template sections (backward compat)
  const oldRequiredSections = ['Goal', 'Implementation Steps', 'Acceptance Criteria'];

  const hasNewSections = newRequiredSections.every(s => sections.has(s));
  const hasOldSections = oldRequiredSections.every(s => sections.has(s));

  if (hasNewSections || hasOldSections) {
    passedChecks++; // Check 4: All required sections present
  } else {
    // Report which sections are missing from the NEW template (since that's the target)
    const missingSections = newRequiredSections.filter(s => !sections.has(s));
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
 * High-level validation of entire Construction phase.
 *
 * Runs validateUnits, validateDesignArtifacts, and checks bolts.
 * Returns aggregate ValidationResult.
 *
 * Supports both new and legacy directory layouts:
 * - NEW: construction/UNIT-NNN/spec.md, construction/UNIT-NNN/BOLT-NNN.md
 * - OLD: construction/units/UNIT-NNN.md, construction/bolts/BOLT-NNN.md
 *
 * @param projectPath - Absolute path to the project root
 * @param workflowId - Workflow ID for the feature
 * @returns ValidationResult with aggregated coverage and blocking issues
 *
 * @example
 * const result = await validateConstructionPhase(
 *   'C:\\path\\to\\project',
 *   'feature-x-20240115'
 * );
 * if (result.passed) {
 *   console.log('Construction phase is structurally complete');
 * }
 */
export async function validateConstructionPhase(
  projectPath: string,
  workflowId: string
): Promise<ValidationResult> {
  const timestamp = new Date().toISOString();
  const blockingIssues: string[] = [];

  const workflowDir = join(projectPath, 'aidlc-docs');
  const constructionDir = join(workflowDir, 'construction');
  const intentsDir = join(workflowDir, 'inception');
  const designDir = join(constructionDir, 'design');

  // Check if construction directory exists
  if (!existsSync(constructionDir)) {
    return {
      passed: false,
      coverage_percentage: 0,
      blocking_issues: ['Construction directory not found'],
      timestamp,
    };
  }

  // Validate units (reads from constructionDir now, not units/ subdir)
  let unitsResult: ValidationResult | null = null;
  if (existsSync(intentsDir)) {
    unitsResult = await validateUnits(constructionDir, intentsDir);
    if (!unitsResult.passed) {
      blockingIssues.push(...unitsResult.blocking_issues.map(i => `[Units] ${i}`));
    }
  } else {
    // Also check for legacy units/ directory
    const legacyUnitsDir = join(constructionDir, 'units');
    if (existsSync(legacyUnitsDir)) {
      unitsResult = await validateUnits(legacyUnitsDir, intentsDir);
      if (!unitsResult.passed) {
        blockingIssues.push(...unitsResult.blocking_issues.map(i => `[Units] ${i}`));
      }
    } else {
      blockingIssues.push('Units or intents directory not found');
    }
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

  // Validate bolts - scan UNIT-NNN directories for BOLT-*.md files
  let boltsResult: ValidationResult | null = null;
  let totalBolts = 0;
  let validBolts = 0;

  try {
    const entries = readdirSync(constructionDir, { withFileTypes: true });
    const unitDirs = entries.filter(e => e.isDirectory() && /^UNIT-\d{3}$/.test(e.name));

    // Check bolts in UNIT-NNN directories (new style)
    for (const dir of unitDirs) {
      const unitDirPath = join(constructionDir, dir.name);
      try {
        const boltFiles = readdirSync(unitDirPath)
          .filter(f => f.startsWith('BOLT-') && f.endsWith('.md'));

        for (const boltFile of boltFiles) {
          totalBolts++;
          const boltPath = join(unitDirPath, boltFile);
          const boltResult = await validateBolt(boltPath);

          if (boltResult.passed) {
            validBolts++;
          } else {
            blockingIssues.push(...boltResult.blocking_issues.map(i => `[${boltFile}] ${i}`));
          }
        }
      } catch {
        // Skip directories we can't read
      }
    }

    // Also check for top-level BOLT-*.md files in construction/ (SHALLOW mode)
    const topLevelBolts = entries.filter(e => e.isFile() && e.name.startsWith('BOLT-') && e.name.endsWith('.md'));
    for (const boltEntry of topLevelBolts) {
      totalBolts++;
      const boltPath = join(constructionDir, boltEntry.name);
      const boltResult = await validateBolt(boltPath);

      if (boltResult.passed) {
        validBolts++;
      } else {
        blockingIssues.push(...boltResult.blocking_issues.map(i => `[${boltEntry.name}] ${i}`));
      }
    }
  } catch {
    // constructionDir already checked for existence above
  }

  // Also check legacy bolts/ directory for backward compat
  const legacyBoltsDir = join(constructionDir, 'bolts');
  if (existsSync(legacyBoltsDir)) {
    try {
      const boltFiles = readdirSync(legacyBoltsDir).filter(f => f.startsWith('BOLT-') && f.endsWith('.md'));

      for (const boltFile of boltFiles) {
        totalBolts++;
        const boltPath = join(legacyBoltsDir, boltFile);
        const boltResult = await validateBolt(boltPath);

        if (boltResult.passed) {
          validBolts++;
        } else {
          blockingIssues.push(...boltResult.blocking_issues.map(i => `[${boltFile}] ${i}`));
        }
      }
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      console.error(`[Validation] Failed to read bolts directory: ${err.message}`);

      const errorMsg = err.code === 'EACCES' || err.code === 'EPERM'
        ? 'Permission denied reading bolts directory'
        : `Failed to read bolts directory: ${err.message}`;

      blockingIssues.push(errorMsg);
    }
  }

  // If no bolts found anywhere, that's a blocking issue
  if (totalBolts === 0) {
    blockingIssues.push('No bolt files found');
  } else {
    const boltsCoveragePercentage = Math.round((validBolts / totalBolts) * 100);
    boltsResult = {
      passed: validBolts === totalBolts,
      coverage_percentage: boltsCoveragePercentage,
      blocking_issues: [],
      timestamp,
    };
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

/** @deprecated Use validateConstructionPhase instead */
export const validateForgePhase = validateConstructionPhase;
