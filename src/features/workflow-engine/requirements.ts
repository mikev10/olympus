/**
 * Structured Requirements Engineering
 *
 * Provides stakeholder mapping, constraint classification, and requirements
 * traceability for the ODLC Vision phase. Links requirements across stages:
 * IDEA → PRD → SPEC → INTENTS.
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
 * A link between requirements at different stages
 */
export interface TraceabilityLink {
  source_id: string;
  source_stage: string;
  target_id: string;
  target_stage: string;
  link_type: 'derives' | 'implements' | 'validates';
  description: string;
}

/**
 * Complete requirements traceability matrix
 */
export interface RequirementsTrace {
  links: TraceabilityLink[];
  coverage: Record<string, number>;
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
 * Builds a stakeholder map from IDEA artifact content.
 *
 * Parses the Stakeholders section if present, or generates default stakeholders
 * based on content analysis if not found.
 *
 * @param ideaContent - Full IDEA artifact markdown content
 * @returns StakeholderMap with identified stakeholders and timestamp
 *
 * @example
 * const map = buildStakeholderMap(ideaContent);
 * console.log(`Found ${map.stakeholders.length} stakeholders`);
 * map.stakeholders.forEach(s => console.log(`- ${s.name} (${s.role})`));
 */
export function buildStakeholderMap(ideaContent: string): StakeholderMap {
  const timestamp = new Date().toISOString();
  const stakeholders: Stakeholder[] = [];

  try {
    const markdown = removeFrontmatter(ideaContent);
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
 * Classifies constraints from IDEA artifact into categories.
 *
 * Parses the Constraints section and classifies each constraint by:
 * - Category (technical, timeline, budget, resource, policy, regulatory)
 * - Severity (hard or soft)
 *
 * @param ideaContent - Full IDEA artifact markdown content
 * @returns ConstraintClassification with categorized constraints and summary
 *
 * @example
 * const classification = classifyConstraints(ideaContent);
 * console.log(`Technical constraints: ${classification.summary.technical}`);
 * console.log(`Hard constraints: ${classification.constraints.filter(c => c.severity === 'hard').length}`);
 */
export function classifyConstraints(ideaContent: string): ConstraintClassification {
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
    const markdown = removeFrontmatter(ideaContent);
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

/**
 * Builds a requirements traceability matrix across ODLC stages.
 *
 * Links requirements from IDEA → PRD → SPEC → INTENTS and calculates
 * coverage percentages at each stage transition.
 *
 * @param ideaContent - IDEA artifact markdown content
 * @param prdContent - PRD artifact markdown content (optional)
 * @param specContent - SPEC artifact markdown content (optional)
 * @param intentsContent - Array of INTENT file contents (optional)
 * @returns RequirementsTrace with links and coverage metrics
 *
 * @example
 * const trace = buildRequirementsTrace(idea, prd, spec, intents);
 * console.log(`IDEA → PRD coverage: ${trace.coverage['idea->prd']}%`);
 * console.log(`Total links: ${trace.links.length}`);
 */
export function buildRequirementsTrace(
  ideaContent: string,
  prdContent: string | null,
  specContent: string | null,
  intentsContent: string[] | null
): RequirementsTrace {
  const timestamp = new Date().toISOString();
  const links: TraceabilityLink[] = [];
  const coverage: Record<string, number> = {};

  try {
    // Parse IDEA constraints as source requirements
    const ideaMarkdown = removeFrontmatter(ideaContent);
    const ideaSections = parseSections(ideaMarkdown);
    const constraintsSection = ideaSections.get('Constraints');
    const ideaConstraints: Array<{ id: string; text: string }> = [];

    if (constraintsSection) {
      const items = extractBulletItems(constraintsSection);
      items.forEach((text, index) => {
        ideaConstraints.push({
          id: `IDEA-C-${String(index + 1).padStart(3, '0')}`,
          text,
        });
      });
    }

    // Link IDEA → PRD
    if (prdContent) {
      const prdMarkdown = removeFrontmatter(prdContent);
      const userStories: Array<{ id: string; content: string }> = [];

      // Parse user stories (### US-NNN)
      const prdLines = prdMarkdown.split('\n');
      let currentStory: { id: string; content: string } | null = null;

      for (const line of prdLines) {
        const storyMatch = line.match(/^###\s+(US-\d+)/);
        if (storyMatch) {
          // Save previous story
          if (currentStory) {
            userStories.push(currentStory);
          }
          // Start new story
          currentStory = { id: storyMatch[1], content: '' };
        } else if (currentStory) {
          currentStory.content += line + '\n';
        }
      }
      if (currentStory) {
        userStories.push(currentStory);
      }

      // Link user stories to IDEA constraints
      const linkedConstraints = new Set<string>();
      for (const story of userStories) {
        for (const constraint of ideaConstraints) {
          // Case-insensitive substring matching
          if (story.content.toLowerCase().includes(constraint.text.toLowerCase().substring(0, 30))) {
            links.push({
              source_id: constraint.id,
              source_stage: 'IDEA',
              target_id: story.id,
              target_stage: 'PRD',
              link_type: 'derives',
              description: `User story ${story.id} derives from constraint ${constraint.id}`,
            });
            linkedConstraints.add(constraint.id);
          }
        }
      }

      // Calculate IDEA → PRD coverage
      const ideaToPrdCoverage = ideaConstraints.length > 0
        ? Math.round((linkedConstraints.size / ideaConstraints.length) * 100)
        : 0;
      coverage['idea->prd'] = ideaToPrdCoverage;

      // Link PRD → SPEC
      if (specContent) {
        const specMarkdown = removeFrontmatter(specContent);
        const specSections = parseSections(specMarkdown);
        const componentsSection = specSections.get('Components') || specSections.get('Architecture') || '';
        const components: Array<{ id: string; content: string }> = [];

        // Parse components (### headings in Components section)
        if (componentsSection) {
          const componentLines = componentsSection.split('\n');
          let currentComponent: { id: string; content: string } | null = null;
          let componentIndex = 0;

          for (const line of componentLines) {
            const componentMatch = line.match(/^###\s+(.+)$/);
            if (componentMatch) {
              // Save previous component
              if (currentComponent) {
                components.push(currentComponent);
              }
              // Start new component
              componentIndex++;
              currentComponent = {
                id: `SPEC-C-${String(componentIndex).padStart(3, '0')}`,
                content: componentMatch[1] + '\n',
              };
            } else if (currentComponent) {
              currentComponent.content += line + '\n';
            }
          }
          if (currentComponent) {
            components.push(currentComponent);
          }
        }

        // Link components to user stories
        const linkedStories = new Set<string>();
        for (const component of components) {
          for (const story of userStories) {
            // Case-insensitive substring matching
            if (component.content.toLowerCase().includes(story.id.toLowerCase())) {
              links.push({
                source_id: story.id,
                source_stage: 'PRD',
                target_id: component.id,
                target_stage: 'SPEC',
                link_type: 'implements',
                description: `Component ${component.id} implements ${story.id}`,
              });
              linkedStories.add(story.id);
            }
          }
        }

        // Calculate PRD → SPEC coverage
        const prdToSpecCoverage = userStories.length > 0
          ? Math.round((linkedStories.size / userStories.length) * 100)
          : 0;
        coverage['prd->spec'] = prdToSpecCoverage;

        // Link SPEC → INTENTS
        if (intentsContent && intentsContent.length > 0) {
          const intents: Array<{ id: string; content: string }> = [];

          // Parse intent files
          intentsContent.forEach((content, index) => {
            // Try to extract intent ID from content or use index
            const intentIdMatch = content.match(/intent[_-](\d+)/i);
            const intentId = intentIdMatch
              ? `INTENT-${intentIdMatch[1].padStart(3, '0')}`
              : `INTENT-${String(index + 1).padStart(3, '0')}`;

            intents.push({
              id: intentId,
              content,
            });
          });

          // Link intents to components
          const linkedComponents = new Set<string>();
          for (const intent of intents) {
            for (const component of components) {
              // Case-insensitive substring matching
              if (intent.content.toLowerCase().includes(component.id.toLowerCase())) {
                links.push({
                  source_id: component.id,
                  source_stage: 'SPEC',
                  target_id: intent.id,
                  target_stage: 'INTENTS',
                  link_type: 'implements',
                  description: `Intent ${intent.id} implements ${component.id}`,
                });
                linkedComponents.add(component.id);
              }
            }
          }

          // Calculate SPEC → INTENTS coverage
          const specToIntentsCoverage = components.length > 0
            ? Math.round((linkedComponents.size / components.length) * 100)
            : 0;
          coverage['spec->intents'] = specToIntentsCoverage;
        }
      }
    }
  } catch (error) {
    console.error('[Requirements] Failed to build requirements trace:', error);
  }

  return {
    links,
    coverage,
    created_at: timestamp,
  };
}

/**
 * Generates a human-readable traceability summary.
 *
 * @param trace - Requirements trace object
 * @returns Formatted summary string
 *
 * @example
 * const summary = getTraceabilitySummary(trace);
 * console.log(summary);
 * // Output:
 * // Requirements Traceability:
 * //   IDEA → PRD: 85% coverage (17/20 constraints traced)
 * //   PRD → SPEC: 90% coverage (9/10 user stories traced)
 * //   SPEC → INTENTS: 100% coverage (5/5 components traced)
 */
export function getTraceabilitySummary(trace: RequirementsTrace): string {
  const lines: string[] = ['Requirements Traceability:'];

  // Calculate link counts per stage transition
  const ideaToPrdLinks = trace.links.filter(
    l => l.source_stage === 'IDEA' && l.target_stage === 'PRD'
  );
  const prdToSpecLinks = trace.links.filter(
    l => l.source_stage === 'PRD' && l.target_stage === 'SPEC'
  );
  const specToIntentsLinks = trace.links.filter(
    l => l.source_stage === 'SPEC' && l.target_stage === 'INTENTS'
  );

  // IDEA → PRD
  if (trace.coverage['idea->prd'] !== undefined) {
    const sourceCount = new Set(ideaToPrdLinks.map(l => l.source_id)).size;
    const coverage = trace.coverage['idea->prd'];
    const totalCount = Math.round((sourceCount / coverage) * 100);
    lines.push(`  IDEA → PRD: ${coverage}% coverage (${sourceCount}/${totalCount} constraints traced)`);
  }

  // PRD → SPEC
  if (trace.coverage['prd->spec'] !== undefined) {
    const sourceCount = new Set(prdToSpecLinks.map(l => l.source_id)).size;
    const coverage = trace.coverage['prd->spec'];
    const totalCount = Math.round((sourceCount / coverage) * 100);
    lines.push(`  PRD → SPEC: ${coverage}% coverage (${sourceCount}/${totalCount} user stories traced)`);
  }

  // SPEC → INTENTS
  if (trace.coverage['spec->intents'] !== undefined) {
    const sourceCount = new Set(specToIntentsLinks.map(l => l.source_id)).size;
    const coverage = trace.coverage['spec->intents'];
    const totalCount = coverage > 0 ? Math.round((sourceCount / coverage) * 100) : sourceCount;
    lines.push(`  SPEC → INTENTS: ${coverage}% coverage (${sourceCount}/${totalCount} components traced)`);
  }

  return lines.join('\n');
}
