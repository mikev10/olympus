import { describe, it, expect } from 'vitest';
import {
  INCEPTION_COMPLETION_FORMAT,
  CONSTRUCTION_COMPLETION_FORMAT,
  buildCompletionMessage,
  formatSummaryBullets,
  COMPLETION_MESSAGE_RULES,
} from '../../features/workflow-engine/completion-messages.js';

describe('completion-messages', () => {
  describe('constants', () => {
    it('inception format has 3 options', () => {
      expect(INCEPTION_COMPLETION_FORMAT).toContain('Request Changes');
      expect(INCEPTION_COMPLETION_FORMAT).toContain('Add Skipped Stage');
      expect(INCEPTION_COMPLETION_FORMAT).toContain('Approve & Continue');
    });

    it('construction format has 2 options only', () => {
      expect(CONSTRUCTION_COMPLETION_FORMAT).toContain('Request Changes');
      expect(CONSTRUCTION_COMPLETION_FORMAT).toContain('Continue to Next Stage');
      expect(CONSTRUCTION_COMPLETION_FORMAT).not.toContain('Add Skipped Stage');
    });
  });

  describe('buildCompletionMessage', () => {
    it('uses inception format for inception phase', () => {
      const msg = buildCompletionMessage('Requirements', 'inception', '- 5 requirements captured', 'aidlc-docs/wf/inception/', 'Next: User Stories');
      expect(msg).toContain('Requirements');
      expect(msg).toContain('5 requirements captured');
      expect(msg).toContain('Add Skipped Stage');
    });

    it('uses construction format for construction phase', () => {
      const msg = buildCompletionMessage('Functional Design', 'construction', '- Design complete', 'aidlc-docs/wf/construction/', 'Next: NFR');
      expect(msg).toContain('Functional Design');
      expect(msg).toContain('Continue to Next Stage');
      expect(msg).not.toContain('Add Skipped Stage');
    });
  });

  describe('formatSummaryBullets', () => {
    it('formats bullet points', () => {
      expect(formatSummaryBullets(['Item 1', 'Item 2'])).toBe('- Item 1\n- Item 2');
    });

    it('handles empty array', () => {
      expect(formatSummaryBullets([])).toContain('No summary');
    });
  });

  describe('COMPLETION_MESSAGE_RULES', () => {
    it('exports rules for skill templates', () => {
      expect(COMPLETION_MESSAGE_RULES).toContain('REVIEW REQUIRED');
      expect(COMPLETION_MESSAGE_RULES).toContain('WAIT');
    });
  });
});
