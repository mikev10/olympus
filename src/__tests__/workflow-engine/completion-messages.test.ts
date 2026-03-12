import { describe, it, expect } from 'vitest';
import {
  INCEPTION_COMPLETION_FORMAT,
  CONSTRUCTION_COMPLETION_FORMAT,
  buildCompletionMessage,
  formatSummaryBullets,
  COMPLETION_MESSAGE_RULES,
  buildInceptionStageCompletionMessage,
  INCEPTION_STAGE_REVIEW_ITEMS,
  formatStageCompletion,
  formatInceptionComplete,
  formatFieldsetBox,
} from '../../features/workflow-engine/completion-messages.js';
import type { InceptionStage } from '../../features/workflow-engine/phase-types.js';

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

describe('INCEPTION_STAGE_REVIEW_ITEMS', () => {
  it('has review items for all 7 inception stages', () => {
    const stages: InceptionStage[] = [
      'workspace-detection',
      'reverse-engineering',
      'requirements-analysis',
      'user-stories',
      'workflow-planning',
      'application-design',
      'units-generation',
    ];
    for (const stage of stages) {
      expect(INCEPTION_STAGE_REVIEW_ITEMS[stage]).toBeDefined();
      expect(INCEPTION_STAGE_REVIEW_ITEMS[stage].length).toBeGreaterThan(0);
    }
  });

  it('has meaningful review item text for requirements-analysis', () => {
    const items = INCEPTION_STAGE_REVIEW_ITEMS['requirements-analysis'];
    expect(items.some(i => i.toLowerCase().includes('requirement'))).toBe(true);
  });

  it('has meaningful review item text for user-stories', () => {
    const items = INCEPTION_STAGE_REVIEW_ITEMS['user-stories'];
    expect(items.some(i => i.toLowerCase().includes('stor') || i.toLowerCase().includes('persona'))).toBe(true);
  });
});

describe('buildInceptionStageCompletionMessage', () => {
  it('returns REVIEW REQUIRED format', () => {
    const result = buildInceptionStageCompletionMessage(
      'requirements-analysis',
      ['inception/requirements/requirements.md', 'inception/requirements/requirements-analysis-questions.md'],
      'user-stories',
    );
    expect(result).toContain('⚠ REVIEW REQUIRED');
  });

  it("includes WHAT'S NEXT when nextStage provided", () => {
    const result = buildInceptionStageCompletionMessage(
      'requirements-analysis',
      [],
      'user-stories',
    );
    expect(result).toContain("📋 WHAT'S NEXT");
    expect(result).toContain('User Stories');
  });

  it("shows inception complete message when nextStage is null", () => {
    const result = buildInceptionStageCompletionMessage(
      'units-generation',
      [],
      null,
    );
    expect(result).toContain('Inception phase is complete');
  });

  it('uses stage-specific review items', () => {
    const result = buildInceptionStageCompletionMessage(
      'workspace-detection',
      [],
      'reverse-engineering',
    );
    const reviewItems = INCEPTION_STAGE_REVIEW_ITEMS['workspace-detection'];
    expect(result).toContain(reviewItems[0]);
  });

  it('lists artifacts in output', () => {
    const result = buildInceptionStageCompletionMessage(
      'user-stories',
      ['inception/user-stories/personas.md', 'inception/user-stories/stories.md'],
      'workflow-planning',
    );
    expect(result).toContain('`inception/user-stories/personas.md`');
    expect(result).toContain('`inception/user-stories/stories.md`');
  });

  it('accepts custom depth and reflects in time hints', () => {
    const minimal = buildInceptionStageCompletionMessage(
      'requirements-analysis',
      [],
      'user-stories',
      'minimal',
    );
    const comprehensive = buildInceptionStageCompletionMessage(
      'requirements-analysis',
      [],
      'user-stories',
      'comprehensive',
    );
    expect(minimal).not.toEqual(comprehensive);
  });

  it('does not throw for any combination of valid stages', () => {
    const stages: InceptionStage[] = [
      'workspace-detection',
      'reverse-engineering',
      'requirements-analysis',
      'user-stories',
      'workflow-planning',
      'application-design',
      'units-generation',
    ];
    for (const stage of stages) {
      expect(() =>
        buildInceptionStageCompletionMessage(stage, [], null)
      ).not.toThrow();
    }
  });
});

describe('re-exports from response-formatter', () => {
  it('formatStageCompletion is re-exported', () => {
    expect(typeof formatStageCompletion).toBe('function');
    const result = formatStageCompletion('workspace-detection', [], [], null, '');
    expect(result).toContain('⚠ REVIEW REQUIRED');
  });

  it('formatInceptionComplete is re-exported', () => {
    expect(typeof formatInceptionComplete).toBe('function');
    const result = formatInceptionComplete('wf-test', 7, 14);
    expect(result).toContain('INCEPTION COMPLETE');
  });

  it('formatFieldsetBox is re-exported', () => {
    expect(typeof formatFieldsetBox).toBe('function');
  });
});

describe('formatFieldsetBox', () => {
  it('creates a box with label and content', () => {
    const result = formatFieldsetBox('TEST LABEL', ['Line 1', 'Line 2']);
    expect(result).toContain('┌─ TEST LABEL');
    expect(result).toContain('┐');
    expect(result).toContain('│');
    expect(result).toContain('└');
    expect(result).toContain('┘');
    expect(result).toContain('Line 1');
    expect(result).toContain('Line 2');
  });

  it('pads short lines to box width', () => {
    const result = formatFieldsetBox('LABEL', ['Hi']);
    const lines = result.split('\n');
    expect(lines[0].length).toBe(80);
    expect(lines[1].length).toBe(80);
    expect(lines[lines.length - 1].length).toBe(80);
  });

  it('handles empty lines as spacers', () => {
    const result = formatFieldsetBox('LABEL', ['', 'Content', '']);
    const lines = result.split('\n');
    expect(lines[1]).toMatch(/^│\s+│$/);
  });

  it('handles long lines gracefully', () => {
    const longLine = 'A'.repeat(80);
    const result = formatFieldsetBox('LABEL', [longLine]);
    expect(result).toContain(longLine);
    expect(result).toContain(' │');
  });
});
