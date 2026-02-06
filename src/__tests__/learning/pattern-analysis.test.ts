import { describe, it, expect } from 'vitest';
import { extractPatterns, computePatternConfidence, PATTERN_KEYWORDS } from '../../learning/pattern-matcher.js';

describe('Pattern Matcher', () => {
  describe('extractPatterns', () => {
    it('should extract simple_search pattern', () => {
      const result = extractPatterns('find file for config');
      expect(result).toContain('simple_search');
    });

    it('should extract debugging pattern', () => {
      const result = extractPatterns('debug the login error');
      expect(result).toContain('debugging');
    });

    it('should extract multiple patterns', () => {
      const result = extractPatterns('analyze and debug the search error');
      expect(result).toContain('analysis');
      expect(result).toContain('debugging');
      expect(result.length).toBeGreaterThanOrEqual(2);
    });

    it('should return empty for unmatched tasks', () => {
      const result = extractPatterns('do something random');
      expect(result).toEqual([]);
    });

    it('should handle empty input', () => {
      expect(extractPatterns('')).toEqual([]);
    });

    it('should handle null/undefined input', () => {
      expect(extractPatterns(null as any)).toEqual([]);
      expect(extractPatterns(undefined as any)).toEqual([]);
    });

    it('should match case-insensitively', () => {
      const result = extractPatterns('FIND FILE CONFIG');
      expect(result).toContain('simple_search');
    });

    it('should extract implementation pattern', () => {
      const result = extractPatterns('implement new feature for authentication');
      expect(result).toContain('implementation');
    });

    it('should extract refactoring pattern', () => {
      const result = extractPatterns('refactor the database layer');
      expect(result).toContain('refactoring');
    });

    it('should extract documentation pattern', () => {
      const result = extractPatterns('write docs for the API');
      expect(result).toContain('documentation');
    });

    it('should only match each pattern once', () => {
      const result = extractPatterns('find file and search for config and locate the file');
      const searchCount = result.filter(p => p === 'simple_search').length;
      expect(searchCount).toBe(1);
    });
  });

  describe('computePatternConfidence', () => {
    it('should compute confidence monotonically', () => {
      const conf5 = computePatternConfidence(5);
      const conf10 = computePatternConfidence(10);
      const conf50 = computePatternConfidence(50);

      expect(conf5).toBeLessThan(conf10);
      expect(conf10).toBeLessThan(conf50);
    });

    it('should cap confidence at 1.0', () => {
      expect(computePatternConfidence(100)).toBe(1.0);
      expect(computePatternConfidence(1000)).toBe(1.0);
    });

    it('should return 0 confidence for 0 samples', () => {
      expect(computePatternConfidence(0)).toBe(0);
    });

    it('should return 0 confidence for negative samples', () => {
      expect(computePatternConfidence(-5)).toBe(0);
    });

    it('should return 1.0 for exactly 50 samples', () => {
      expect(computePatternConfidence(50)).toBe(1.0);
    });

    it('should increase gradually for small sample sizes', () => {
      const conf1 = computePatternConfidence(1);
      const conf2 = computePatternConfidence(2);
      const conf3 = computePatternConfidence(3);

      expect(conf1).toBeGreaterThan(0);
      expect(conf1).toBeLessThan(0.5);
      expect(conf2).toBeGreaterThan(conf1);
      expect(conf3).toBeGreaterThan(conf2);
    });
  });

  describe('PATTERN_KEYWORDS', () => {
    it('should export pattern keywords taxonomy', () => {
      expect(PATTERN_KEYWORDS).toBeDefined();
      expect(PATTERN_KEYWORDS.simple_search).toBeDefined();
      expect(PATTERN_KEYWORDS.debugging).toBeDefined();
      expect(PATTERN_KEYWORDS.implementation).toBeDefined();
      expect(PATTERN_KEYWORDS.refactoring).toBeDefined();
      expect(PATTERN_KEYWORDS.documentation).toBeDefined();
      expect(PATTERN_KEYWORDS.analysis).toBeDefined();
    });

    it('should have arrays of keywords for each pattern', () => {
      Object.values(PATTERN_KEYWORDS).forEach(keywords => {
        expect(Array.isArray(keywords)).toBe(true);
        expect(keywords.length).toBeGreaterThan(0);
      });
    });
  });
});
