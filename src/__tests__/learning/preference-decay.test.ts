import { describe, it, expect } from 'vitest';
import { updatePreferences, createDefaultPreferences } from '../../learning/preference-learner.js';
import type { UserPreferences, ExtractedPattern } from '../../learning/types.js';

const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString();

function basePrefs(overrides: Partial<UserPreferences> = {}): UserPreferences {
  return {
    ...createDefaultPreferences(),
    ...overrides,
  };
}

describe('preference decay', () => {
  it('removes recurring corrections older than 30 days', () => {
    const prefs = basePrefs({
      recurring_corrections: [
        { pattern: 'old-pattern', count: 3, last_seen: daysAgo(31), examples: [] },
      ],
    });
    const result = updatePreferences(prefs, [], []);
    expect(result.recurring_corrections.find(c => c.pattern === 'old-pattern')).toBeUndefined();
  });

  it('keeps recurring corrections 29 days old', () => {
    const prefs = basePrefs({
      recurring_corrections: [
        { pattern: 'recent-pattern', count: 2, last_seen: daysAgo(29), examples: [] },
      ],
    });
    const result = updatePreferences(prefs, [], []);
    expect(result.recurring_corrections.find(c => c.pattern === 'recent-pattern')).toBeDefined();
  });

  it('keeps inferred_preferences that are backed by current patterns', () => {
    const prefs = basePrefs({ inferred_preferences: ['use-typescript'] });
    const patterns: ExtractedPattern[] = [
      { pattern: 'use-typescript', confidence: 0.9, evidence_count: 3, evidence_examples: [], scope: 'global', category: 'tooling' },
    ];
    const result = updatePreferences(prefs, [], patterns);
    expect(result.inferred_preferences).toContain('use-typescript');
  });

  it('prunes inferred_preferences not present in current patterns when patterns non-empty', () => {
    const prefs = basePrefs({ inferred_preferences: ['old-pref', 'keep-pref'] });
    const patterns: ExtractedPattern[] = [
      { pattern: 'keep-pref', confidence: 0.9, evidence_count: 2, evidence_examples: [], scope: 'global', category: 'style' },
    ];
    const result = updatePreferences(prefs, [], patterns);
    expect(result.inferred_preferences).not.toContain('old-pref');
    expect(result.inferred_preferences).toContain('keep-pref');
  });

  it('does not prune inferred_preferences when extractedPatterns is empty', () => {
    const prefs = basePrefs({ inferred_preferences: ['saved-pref'] });
    const result = updatePreferences(prefs, [], []);
    expect(result.inferred_preferences).toContain('saved-pref');
  });

  it('never decays explicit_rules', () => {
    const prefs = basePrefs({ explicit_rules: ['Always: use TypeScript', 'Never: use var'] });
    const result = updatePreferences(prefs, [], []);
    expect(result.explicit_rules).toContain('Always: use TypeScript');
    expect(result.explicit_rules).toContain('Never: use var');
  });

  it('keeps corrections with missing last_seen (does not crash)', () => {
    const prefs = basePrefs({
      recurring_corrections: [
        { pattern: 'no-date', count: 1, last_seen: undefined as unknown as string, examples: [] },
      ],
    });
    const result = updatePreferences(prefs, [], []);
    expect(result.recurring_corrections.find(c => c.pattern === 'no-date')).toBeDefined();
  });

  it('keeps corrections with malformed last_seen (does not crash)', () => {
    const prefs = basePrefs({
      recurring_corrections: [
        { pattern: 'bad-date', count: 1, last_seen: 'not-a-date', examples: [] },
      ],
    });
    expect(() => updatePreferences(prefs, [], [])).not.toThrow();
    const result = updatePreferences(prefs, [], []);
    expect(result.recurring_corrections.find(c => c.pattern === 'bad-date')).toBeDefined();
  });
});
