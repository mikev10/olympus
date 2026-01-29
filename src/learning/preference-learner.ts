import type { FeedbackEntry, UserPreferences, ExtractedPattern } from './types.js';
import { jaccardSimilarity } from './pattern-extractor.js';

const DEFAULT_PREFERENCES: UserPreferences = {
  verbosity: 'unknown',
  autonomy: 'unknown',
  explanation_depth: 'unknown',
  explicit_rules: [],
  inferred_preferences: [],
  recurring_corrections: [],
  last_updated: new Date().toISOString(),
};

/** Preference decay factor - old preferences lose weight over time */
const DECAY_DAYS = 30;

/** Extract explicit preferences from "always/never" statements */
function extractExplicitPreferences(feedback: FeedbackEntry[]): string[] {
  const explicit = feedback.filter(e => e.feedback_category === 'explicit_preference');

  const rules: string[] = [];
  for (const entry of explicit) {
    // Extract the rule from statements like "always use TypeScript"
    const alwaysMatch = entry.user_message.match(/always\s+(.+?)(?:\.|$)/i);
    const neverMatch = entry.user_message.match(/never\s+(.+?)(?:\.|$)/i);

    if (alwaysMatch) rules.push(`Always: ${alwaysMatch[1].trim()}`);
    if (neverMatch) rules.push(`Never: ${neverMatch[1].trim()}`);
  }

  return [...new Set(rules)];  // Deduplicate
}

/** Infer verbosity preference from feedback patterns */
function inferVerbosity(feedback: FeedbackEntry[]): 'concise' | 'detailed' | 'unknown' {
  const verboseComplaints = feedback.filter(e =>
    /too (long|verbose|much|wordy)/i.test(e.user_message)
  ).length;

  const briefComplaints = feedback.filter(e =>
    /more (detail|info|explanation)|too (brief|short)/i.test(e.user_message)
  ).length;

  if (verboseComplaints >= 3 && verboseComplaints > briefComplaints) return 'concise';
  if (briefComplaints >= 3 && briefComplaints > verboseComplaints) return 'detailed';
  return 'unknown';
}

/** Infer autonomy preference from feedback patterns */
function inferAutonomy(feedback: FeedbackEntry[]): 'ask_first' | 'just_do_it' | 'balanced' | 'unknown' {
  const askFirst = feedback.filter(e =>
    /ask (me )?(first|before)|don't assume|confirm/i.test(e.user_message)
  ).length;

  const justDoIt = feedback.filter(e =>
    /just (do|make|fix)|don't ask|stop asking/i.test(e.user_message)
  ).length;

  if (askFirst >= 3 && askFirst > justDoIt) return 'ask_first';
  if (justDoIt >= 3 && justDoIt > askFirst) return 'just_do_it';
  if (askFirst >= 2 && justDoIt >= 2) return 'balanced';
  return 'unknown';
}

/** Update preferences based on new feedback */
export function updatePreferences(
  currentPrefs: UserPreferences,
  newFeedback: FeedbackEntry[],
  extractedPatterns: ExtractedPattern[]
): UserPreferences {
  // Start with current preferences
  const updated: UserPreferences = { ...currentPrefs };

  // Add new explicit rules
  const newRules = extractExplicitPreferences(newFeedback);
  updated.explicit_rules = [...new Set([...updated.explicit_rules, ...newRules])];

  // Update verbosity if we have enough signal
  const newVerbosity = inferVerbosity(newFeedback);
  if (newVerbosity !== 'unknown') {
    updated.verbosity = newVerbosity;
  }

  // Update autonomy if we have enough signal
  const newAutonomy = inferAutonomy(newFeedback);
  if (newAutonomy !== 'unknown') {
    updated.autonomy = newAutonomy;
  }

  // Add inferred preferences from patterns
  const inferred = extractedPatterns
    .filter(p => p.confidence > 0.7 && p.scope === 'global')
    .map(p => p.pattern);
  updated.inferred_preferences = [...new Set([...updated.inferred_preferences, ...inferred])];

  // Update recurring corrections
  for (const pattern of extractedPatterns) {
    const existing = updated.recurring_corrections.find(
      c => jaccardSimilarity(c.pattern, pattern.pattern) > 0.5
    );

    if (existing) {
      existing.count = pattern.evidence_count;
      existing.last_seen = new Date().toISOString();
      existing.examples = pattern.evidence_examples;
    } else {
      updated.recurring_corrections.push({
        pattern: pattern.pattern,
        count: pattern.evidence_count,
        last_seen: new Date().toISOString(),
        examples: pattern.evidence_examples,
      });
    }
  }

  updated.last_updated = new Date().toISOString();
  return updated;
}

/** Create default preferences object */
export function createDefaultPreferences(): UserPreferences {
  return { ...DEFAULT_PREFERENCES, last_updated: new Date().toISOString() };
}
