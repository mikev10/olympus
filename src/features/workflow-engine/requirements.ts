/**
 * Structured Requirements Engineering
 *
 * Provides stakeholder mapping and constraint classification for the
 * AIDLC Inception phase requirements analysis stage.
 */

/**
 * Represents a project stakeholder with interest and influence levels
 */
export interface Stakeholder {
  name: string;
  role: string;
  interest: 'high' | 'medium' | 'low';
  influence: 'high' | 'medium' | 'low';
  concerns: string[];
}

/**
 * A collection of stakeholders for a project
 */
export interface StakeholderMap {
  stakeholders: Stakeholder[];
  created_at: string;
}

/**
 * Constraint category types for classification
 */
export type ConstraintCategory = 'technical' | 'timeline' | 'budget' | 'resource' | 'policy' | 'regulatory';

/**
 * A classified constraint with category and severity
 */
export interface ClassifiedConstraint {
  text: string;
  category: ConstraintCategory;
  severity: 'hard' | 'soft';
}

/**
 * Collection of classified constraints with summary
 */
export interface ConstraintClassification {
  constraints: ClassifiedConstraint[];
  summary: Record<ConstraintCategory, number>;
  created_at: string;
}

/**
 * Parses YAML frontmatter from markdown content.
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
 * Extracts bullet point items from markdown content.
 *
 * @param content - Section content with bullet points
 * @returns Array of bullet item text (without bullet markers)
 */
function extractBulletItems(content: string): string[] {
  const items: string[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const match = line.trim().match(/^[-*+]\s+(.+)$/);
    if (match) {
      items.push(match[1].trim());
    }
  }

  return items;
}

/**
 * Builds a stakeholder map from INTENT artifact content.
 *
 * Parses the Stakeholders section if present, or generates default stakeholders
 * based on content analysis if not found.
 *
 * @param intentContent - Full INTENT artifact markdown content
 * @returns StakeholderMap with identified stakeholders and timestamp
 *
 * @example
 * const map = buildStakeholderMap(intentContent);
 * console.log(`Found ${map.stakeholders.length} stakeholders`);
 * map.stakeholders.forEach(s => console.log(`- ${s.name} (${s.role})`));
 */
export function buildStakeholderMap(intentContent: string): StakeholderMap {
  const timestamp = new Date().toISOString();
  const stakeholders: Stakeholder[] = [];

  try {
    const markdown = removeFrontmatter(intentContent);
    const sections = parseSections(markdown);
    const stakeholdersSection = sections.get('Stakeholders');

    if (stakeholdersSection && stakeholdersSection.trim().length > 0) {
      // Parse explicit stakeholder entries
      const lines = stakeholdersSection.split('\n');

      for (const line of lines) {
        // Match: - **Role Name** (interest level, influence level): description
        const match = line.match(/^[-*+]\s+\*\*([^*]+)\*\*\s+\((\w+)\s+interest,\s+(\w+)\s+influence\):\s*(.+)$/i);
        if (match) {
          const [, role, interest, influence, description] = match;
          stakeholders.push({
            name: role.trim(),
            role: role.trim(),
            interest: normalizeLevel(interest),
            influence: normalizeLevel(influence),
            concerns: [description.trim()],
          });
        }
      }
    }

    // If no stakeholders section or no stakeholders parsed, generate defaults
    if (stakeholders.length === 0) {
      // Always include development team
      stakeholders.push({
        name: 'Development Team',
        role: 'Development Team',
        interest: 'high',
        influence: 'medium',
        concerns: ['Implementation feasibility', 'Technical quality', 'Maintainability'],
      });

      // Check for user/customer mentions in Business Context
      const businessContext = sections.get('Business Context') || '';
      if (businessContext.toLowerCase().includes('user') || businessContext.toLowerCase().includes('customer')) {
        stakeholders.push({
          name: 'End Users',
          role: 'End Users',
          interest: 'high',
          influence: 'low',
          concerns: ['Usability', 'Feature availability', 'Performance'],
        });
      }

      // Check for compliance/regulatory mentions in Constraints
      const constraints = sections.get('Constraints') || '';
      if (constraints.toLowerCase().includes('compliance') || constraints.toLowerCase().includes('regulatory')) {
        stakeholders.push({
          name: 'Compliance Team',
          role: 'Compliance Team',
          interest: 'medium',
          influence: 'high',
          concerns: ['Regulatory compliance', 'Policy adherence', 'Audit requirements'],
        });
      }

      // Check for budget mentions in Constraints
      if (constraints.toLowerCase().includes('budget')) {
        stakeholders.push({
          name: 'Finance',
          role: 'Finance',
          interest: 'low',
          influence: 'medium',
          concerns: ['Cost control', 'Budget adherence', 'ROI'],
        });
      }
    }
  } catch (error) {
    console.error('[Requirements] Failed to build stakeholder map:', error);
    // Return default stakeholder on error
    stakeholders.push({
      name: 'Development Team',
      role: 'Development Team',
      interest: 'high',
      influence: 'medium',
      concerns: ['Implementation feasibility', 'Technical quality'],
    });
  }

  return {
    stakeholders,
    created_at: timestamp,
  };
}

/**
 * Normalizes interest/influence level strings to valid types.
 *
 * @param level - String level (case insensitive)
 * @returns Normalized level
 */
function normalizeLevel(level: string): 'high' | 'medium' | 'low' {
  const normalized = level.toLowerCase().trim();
  if (normalized === 'high' || normalized === 'medium' || normalized === 'low') {
    return normalized as 'high' | 'medium' | 'low';
  }
  return 'medium'; // default
}

/**
 * Classifies constraints from INTENT artifact into categories.
 *
 * Parses the Constraints section and classifies each constraint by:
 * - Category (technical, timeline, budget, resource, policy, regulatory)
 * - Severity (hard or soft)
 *
 * @param intentContent - Full INTENT artifact markdown content
 * @returns ConstraintClassification with categorized constraints and summary
 *
 * @example
 * const classification = classifyConstraints(intentContent);
 * console.log(`Technical constraints: ${classification.summary.technical}`);
 * console.log(`Hard constraints: ${classification.constraints.filter(c => c.severity === 'hard').length}`);
 */
export function classifyConstraints(intentContent: string): ConstraintClassification {
  const timestamp = new Date().toISOString();
  const constraints: ClassifiedConstraint[] = [];
  const summary: Record<ConstraintCategory, number> = {
    technical: 0,
    timeline: 0,
    budget: 0,
    resource: 0,
    policy: 0,
    regulatory: 0,
  };

  try {
    const markdown = removeFrontmatter(intentContent);
    const sections = parseSections(markdown);
    const constraintsSection = sections.get('Constraints');

    if (constraintsSection && constraintsSection.trim().length > 0) {
      const items = extractBulletItems(constraintsSection);

      for (const item of items) {
        const category = categorizeConstraint(item);
        const severity = determineSeverity(item);

        constraints.push({
          text: item,
          category,
          severity,
        });

        summary[category]++;
      }
    }
  } catch (error) {
    console.error('[Requirements] Failed to classify constraints:', error);
  }

  return {
    constraints,
    summary,
    created_at: timestamp,
  };
}

/**
 * Categorizes a constraint based on keyword matching.
 *
 * @param text - Constraint text
 * @returns Constraint category
 */
function categorizeConstraint(text: string): ConstraintCategory {
  const lowerText = text.toLowerCase();

  // Regulatory keywords (check first, most specific)
  if (
    lowerText.includes('gdpr') ||
    lowerText.includes('soc') ||
    lowerText.includes('hipaa') ||
    lowerText.includes('compliance') ||
    lowerText.includes('regulatory') ||
    lowerText.includes('legal') ||
    lowerText.includes('privacy') ||
    lowerText.includes('pii')
  ) {
    return 'regulatory';
  }

  // Policy keywords
  if (
    lowerText.includes('policy') ||
    lowerText.includes('standard') ||
    lowerText.includes('convention') ||
    lowerText.includes('guideline') ||
    lowerText.includes('practice') ||
    lowerText.includes('approval')
  ) {
    return 'policy';
  }

  // Budget keywords
  if (
    lowerText.includes('budget') ||
    lowerText.includes('$') ||
    lowerText.includes('cost') ||
    lowerText.includes('spend') ||
    lowerText.includes('investment') ||
    lowerText.includes('pricing')
  ) {
    return 'budget';
  }

  // Resource keywords
  if (
    lowerText.includes('team') ||
    lowerText.includes('engineer') ||
    lowerText.includes('developer') ||
    lowerText.includes('headcount') ||
    lowerText.includes('bandwidth') ||
    lowerText.includes('capacity')
  ) {
    return 'resource';
  }

  // Timeline keywords
  if (
    lowerText.includes('deadline') ||
    lowerText.includes('sprint') ||
    lowerText.includes('weeks') ||
    lowerText.includes('months') ||
    lowerText.includes('before') ||
    lowerText.includes('by date') ||
    lowerText.includes('timeline')
  ) {
    return 'timeline';
  }

  // Technical keywords (default catch-all)
  if (
    lowerText.includes('integrate') ||
    lowerText.includes('api') ||
    lowerText.includes('database') ||
    lowerText.includes('schema') ||
    lowerText.includes('architecture') ||
    lowerText.includes('compatible') ||
    lowerText.includes('performance') ||
    lowerText.includes('scalable')
  ) {
    return 'technical';
  }

  // Default to technical if no keywords match
  return 'technical';
}

/**
 * Determines constraint severity based on language.
 *
 * @param text - Constraint text
 * @returns Severity level
 */
function determineSeverity(text: string): 'hard' | 'soft' {
  const lowerText = text.toLowerCase();

  // Hard constraint keywords
  if (
    lowerText.includes('must') ||
    lowerText.includes('required') ||
    lowerText.includes('mandatory') ||
    lowerText.includes('cannot') ||
    lowerText.includes('shall not')
  ) {
    return 'hard';
  }

  return 'soft';
}

