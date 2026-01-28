import { describe, it, expect } from 'vitest';
import { detectFeedbackCategory } from '../../learning/hooks/revision-detector.js';

describe('RevisionDetector', () => {
  describe('correction detection', () => {
    it('detects direct corrections', () => {
      const result = detectFeedbackCategory("No, that's wrong. I wanted X.");
      expect(result?.category).toBe('correction');
      expect(result?.confidence).toBeGreaterThan(0.8);
    });

    it('detects misunderstanding', () => {
      const result = detectFeedbackCategory("You misunderstood the requirements.");
      expect(result?.category).toBe('correction');
    });
  });

  describe('explicit preference detection', () => {
    it('detects "always" statements', () => {
      const result = detectFeedbackCategory("Always use TypeScript strict mode.");
      expect(result?.category).toBe('explicit_preference');
      expect(result?.confidence).toBeGreaterThanOrEqual(0.95);
    });

    it('detects "never" statements', () => {
      const result = detectFeedbackCategory("Never use var, use const or let.");
      expect(result?.category).toBe('explicit_preference');
    });
  });

  describe('rejection detection', () => {
    it('detects stop command', () => {
      const result = detectFeedbackCategory("Stop, I need to rethink this.");
      expect(result?.category).toBe('rejection');
    });

    it('detects cancel command', () => {
      const result = detectFeedbackCategory("Cancel that request.");
      expect(result?.category).toBe('rejection');
    });
  });

  describe('praise detection', () => {
    it('detects perfect', () => {
      const result = detectFeedbackCategory("Perfect, exactly what I needed!");
      expect(result?.category).toBe('praise');
    });
  });

  describe('edge cases', () => {
    it('ignores non-feedback messages', () => {
      const result = detectFeedbackCategory("Can you help me with React?");
      expect(result).toBeNull();
    });

    it('removes code blocks before matching', () => {
      const result = detectFeedbackCategory("Run this: ```stop``` then continue.");
      // 'stop' is in a code block, should not trigger rejection
      expect(result?.category).not.toBe('rejection');
    });
  });
});
