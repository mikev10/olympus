import { describe, it, expect } from 'vitest';
import { extractPatterns, jaccardSimilarity } from '../../learning/pattern-extractor.js';
import { MOCK_FEEDBACK_FOR_CLUSTERING, MOCK_FEEDBACK_INSUFFICIENT } from './fixtures/mock-feedback.js';

describe('PatternExtractor', () => {
  describe('jaccardSimilarity', () => {
    it('returns 1 for identical texts', () => {
      const similarity = jaccardSimilarity('hello world', 'hello world');
      expect(similarity).toBe(1);
    });

    it('returns 0 for completely different texts', () => {
      const similarity = jaccardSimilarity('hello world', 'foo bar baz');
      expect(similarity).toBe(0);
    });
  });

  describe('extractPatterns', () => {
    it('groups similar feedback using Jaccard similarity', () => {
      const patterns = extractPatterns(MOCK_FEEDBACK_FOR_CLUSTERING);
      expect(patterns.length).toBeGreaterThan(0);
    });

    it('requires minimum 3 occurrences by default', () => {
      const patterns = extractPatterns(MOCK_FEEDBACK_INSUFFICIENT);
      expect(patterns).toHaveLength(0);
    });

    it('allows custom minimum occurrences', () => {
      const patterns = extractPatterns(MOCK_FEEDBACK_INSUFFICIENT, 2);
      expect(patterns.length).toBeGreaterThan(0);
    });
  });
});
