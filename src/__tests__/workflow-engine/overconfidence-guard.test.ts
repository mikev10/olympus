import { describe, it, expect } from 'vitest';
import {
  OVERCONFIDENCE_RULES,
  RED_FLAG_INDICATORS,
  AMBIGUITY_TRIGGER_PHRASES,
  checkForOverconfidence,
  getOverconfidenceRulesText,
} from '../../features/workflow-engine/overconfidence-guard.js';

describe('overconfidence-guard', () => {
  describe('constants', () => {
    it('exports overconfidence rules', () => {
      expect(OVERCONFIDENCE_RULES.length).toBeGreaterThan(0);
      expect(OVERCONFIDENCE_RULES[0]).toContain('doubt');
    });

    it('exports red flag indicators', () => {
      expect(RED_FLAG_INDICATORS.length).toBeGreaterThan(0);
    });

    it('exports ambiguity trigger phrases', () => {
      expect(AMBIGUITY_TRIGGER_PHRASES).toContain('depends');
      expect(AMBIGUITY_TRIGGER_PHRASES).toContain('maybe');
      expect(AMBIGUITY_TRIGGER_PHRASES).toContain('probably');
    });
  });

  describe('checkForOverconfidence', () => {
    it('passes when questions asked on complex project', () => {
      const result = checkForOverconfidence(5, 5, 'high', 0);
      expect(result.passed).toBe(true);
      expect(result.redFlags).toHaveLength(0);
    });

    it('flags complex project with no questions', () => {
      const result = checkForOverconfidence(0, 0, 'high', 0);
      expect(result.passed).toBe(false);
      expect(result.redFlags.length).toBeGreaterThan(0);
    });

    it('flags ambiguous answers', () => {
      const result = checkForOverconfidence(5, 5, 'medium', 3);
      expect(result.passed).toBe(false);
      expect(result.redFlags.some(f => f.includes('ambiguous'))).toBe(true);
    });

    it('passes for low complexity with no questions', () => {
      const result = checkForOverconfidence(0, 0, 'low', 0);
      expect(result.passed).toBe(true);
    });
  });

  describe('getOverconfidenceRulesText', () => {
    it('returns formatted text with rules and triggers', () => {
      const text = getOverconfidenceRulesText();
      expect(text).toContain('Overconfidence Prevention Rules');
      expect(text).toContain('Red Flag Indicators');
      expect(text).toContain('depends');
    });
  });
});
