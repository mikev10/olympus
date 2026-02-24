/**
 * Standardized Completion Messages
 *
 * AWS AIDLC uses a strict completion message format at every stage:
 * announcement header, optional AI summary (no workflow instructions),
 * mandatory REVIEW REQUIRED + WHAT'S NEXT block.
 * Construction uses 2-option only (Request Changes / Continue).
 */

export const INCEPTION_COMPLETION_FORMAT = `## Stage Complete: {stage}

{summary}

---

### REVIEW REQUIRED

Please review the artifacts at: \`{reviewPath}\`

**What would you like to do?**
1. **Request Changes** — I'll revise based on your feedback
2. **Add Skipped Stage** — Include a stage that was previously excluded
3. **Approve & Continue** — Proceed to the next stage
` as const;

export const CONSTRUCTION_COMPLETION_FORMAT = `## Stage Complete: {stage}

{summary}

---

### REVIEW REQUIRED

Please review the artifacts at: \`{reviewPath}\`

**What would you like to do?**
1. **Request Changes** — I'll revise based on your feedback
2. **Continue to Next Stage** — Approve and proceed
` as const;

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
1. Display the stage completion header
2. Include a factual summary (bullet points ONLY — NO workflow instructions in summary)
3. Show REVIEW REQUIRED block with artifact path
4. Show options:
   - Inception stages: 3 options (Request Changes / Add Skipped Stage / Approve & Continue)
   - Construction stages: 2 options ONLY (Request Changes / Continue to Next Stage)
5. WAIT for user selection before proceeding`;
