/**
 * Overconfidence Prevention Guard
 *
 * AWS AIDLC explicitly guards against AI making assumptions instead of asking
 * clarifying questions. Philosophy: "When in doubt, ask the question —
 * overconfidence leads to poor outcomes."
 */

export const OVERCONFIDENCE_RULES = [
  'When in doubt, ask the question — overconfidence leads to poor outcomes',
  'Default to asking: ANY ambiguity triggers clarifying questions',
  'Comprehensive coverage: evaluate ALL relevant categories, do not skip',
  'Mandatory follow-up: create follow-up questions for ANY unclear responses',
  'No proceeding with ambiguity: do not advance until ALL ambiguities resolved',
] as const;

export const RED_FLAG_INDICATORS = [
  'Stage completing without questions on complex projects',
  'Proceeding with vague/ambiguous responses',
  'Skipping entire question categories without justification',
  'Making assumptions instead of asking',
] as const;

export const AMBIGUITY_TRIGGER_PHRASES = [
  'depends', 'maybe', 'not sure', 'mix of', 'somewhere between',
  'probably', 'standard', 'typical',
] as const;

export interface OverconfidenceCheck {
  passed: boolean;
  redFlags: string[];
  recommendations: string[];
}

/**
 * Check if a set of answers exhibits overconfidence patterns.
 * Returns red flags and recommendations.
 */
export function checkForOverconfidence(
  questionsAsked: number,
  answersReceived: number,
  projectComplexity: 'low' | 'medium' | 'high',
  ambiguousAnswerCount: number,
): OverconfidenceCheck {
  const redFlags: string[] = [];
  const recommendations: string[] = [];

  // Red flag: complex project with no questions asked
  if (projectComplexity === 'high' && questionsAsked === 0) {
    redFlags.push('Stage completing without questions on complex projects');
    recommendations.push('Ask clarifying questions about scope, risks, and dependencies');
  }

  // Red flag: medium+ project with very few questions
  if (projectComplexity !== 'low' && questionsAsked > 0 && questionsAsked < 3) {
    redFlags.push('Skipping entire question categories without justification');
    recommendations.push('Ensure all categories are covered: functional, non-functional, business-context');
  }

  // Red flag: proceeding with ambiguous answers
  if (ambiguousAnswerCount > 0) {
    redFlags.push(`Proceeding with ${ambiguousAnswerCount} vague/ambiguous responses`);
    recommendations.push('Create follow-up questions for all ambiguous responses before proceeding');
  }

  // Red flag: low question-to-answer ratio on complex projects
  if (projectComplexity === 'high' && answersReceived > 0 && questionsAsked < answersReceived * 0.5) {
    redFlags.push('Making assumptions instead of asking');
    recommendations.push('Increase question depth — high-complexity projects need thorough exploration');
  }

  return {
    passed: redFlags.length === 0,
    redFlags,
    recommendations,
  };
}

/**
 * Get overconfidence rules formatted for injection into skill templates.
 */
export function getOverconfidenceRulesText(): string {
  const rules = OVERCONFIDENCE_RULES.map((r, i) => `${i + 1}. ${r}`).join('\n');
  const flags = RED_FLAG_INDICATORS.map(f => `- ${f}`).join('\n');
  const triggers = AMBIGUITY_TRIGGER_PHRASES.join(', ');

  return `## Overconfidence Prevention Rules

${rules}

### Red Flag Indicators
${flags}

### Ambiguity Trigger Phrases
Watch for these phrases in user answers: ${triggers}
If detected, MUST create follow-up clarification questions.`;
}
