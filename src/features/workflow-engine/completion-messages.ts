import { formatStageCompletion, formatInceptionComplete } from './inception/response-formatter.js';
import type { InceptionStage } from './phase-types.js';

export { formatStageCompletion, formatInceptionComplete };

export const INCEPTION_STAGE_REVIEW_ITEMS: Record<InceptionStage, string[]> = {
  'workspace-detection': [
    'Verify the detected pathway type (greenfield/brownfield) is correct',
    'Confirm workspace configuration matches your project structure',
  ],
  'reverse-engineering': [
    'Review the component inventory for completeness',
    'Verify the technology stack analysis is accurate',
    'Check that dependency relationships are correctly identified',
  ],
  'requirements-analysis': [
    'Review the generated requirements for accuracy',
    'Verify no missing requirements from the Q&A session',
    'Confirm NFR requirements are captured',
  ],
  'user-stories': [
    'Review user personas for relevance to your target users',
    'Verify each user story has clear acceptance criteria',
    'Check story priorities align with business goals',
  ],
  'workflow-planning': [
    'Review the execution plan for completeness',
    'Verify stage dependencies in the workflow diagram are correct',
    'Confirm estimated effort aligns with your expectations',
  ],
  'application-design': [
    'Review component design for architectural soundness',
    'Verify service boundaries and responsibilities are clear',
    'Check component dependency graph for circular dependencies',
  ],
  'units-generation': [
    'Review each unit of work for clear scope and boundaries',
    'Verify unit dependencies are correctly mapped',
    'Confirm story-to-unit mapping covers all user stories',
  ],
};

export function buildInceptionStageCompletionMessage(
  stage: InceptionStage,
  artifacts: string[],
  nextStage: InceptionStage | null,
  depth: string = 'standard',
): string {
  const reviewItems = INCEPTION_STAGE_REVIEW_ITEMS[stage] ?? [];
  const nextStageDescription = '';
  return formatStageCompletion(stage, artifacts, reviewItems, nextStage, nextStageDescription, depth);
}

export const INCEPTION_COMPLETION_FORMAT = `## Stage Complete: {stage}

{summary}

---

⚠️ **REVIEW REQUIRED**

> Please review the artifacts at: \`{reviewPath}\`

**What would you like to do?**
1. 🔧 **Request Changes** — I'll revise based on your feedback
2. ➕ **Add Skipped Stage** — Include a stage that was previously excluded
3. ✅ **Approve & Continue** — Proceed to the next stage` as const;

export const CONSTRUCTION_COMPLETION_FORMAT = `## Stage Complete: {stage}

{summary}

---

⚠️ **REVIEW REQUIRED**

> Please review the artifacts at: \`{reviewPath}\`

**What would you like to do?**
1. 🔧 **Request Changes** — I'll revise based on your feedback
2. ✅ **Continue to Next Stage** — Approve and proceed` as const;

/**
 * Build a standardized completion message for a stage.
 *
 * @param stage - Stage name (e.g., "Requirements Analysis", "Functional Design")
 * @param phase - Phase: 'inception' uses 3-option format, 'construction' uses 2-option format
 * @param summary - Factual bullet points only, NO workflow instructions
 * @param reviewPath - Path to artifact directory for review
 * @param _nextStep - Description of what happens next (used internally, not in output)
 * @returns Formatted completion message string
 */
export function buildCompletionMessage(
  stage: string,
  phase: 'inception' | 'construction',
  summary: string,
  reviewPath: string,
  _nextStep: string,
): string {
  const template = phase === 'inception'
    ? INCEPTION_COMPLETION_FORMAT
    : CONSTRUCTION_COMPLETION_FORMAT;

  return template
    .replace('{stage}', stage)
    .replace('{summary}', summary)
    .replace('{reviewPath}', reviewPath);
}

/**
 * Format a summary from bullet points.
 * Ensures no workflow instructions leak into the summary section.
 *
 * @param bullets - Array of factual bullet point strings
 * @returns Formatted summary string
 */
export function formatSummaryBullets(bullets: string[]): string {
  if (bullets.length === 0) return '_No summary available._';
  return bullets.map(b => `- ${b}`).join('\n');
}

/**
 * Completion message rules for skill template injection.
 */
export const COMPLETION_MESSAGE_RULES = `## Completion Message Rules

At the end of EVERY stage:
1. Display the stage completion header with factual summary
2. Add a \`---\` horizontal rule separator
3. Display ⚠️ **REVIEW REQUIRED** header (emoji + bold, NOT a ## markdown header)
4. Use blockquotes (\`>\`) for artifact paths to highlight them with a colored bar
5. Show options with emoji prefixes:
   - Inception stages: 3 options (🔧 Request Changes / ➕ Add Skipped Stage / ✅ Approve & Continue)
   - Construction stages: 2 options ONLY (🔧 Request Changes / ✅ Continue to Next Stage)
6. WAIT for user selection before proceeding`;
