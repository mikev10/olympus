import { describe, it, expect } from 'vitest';
import {
  formatStageCompletion,
  formatInceptionComplete,
} from '../../../features/workflow-engine/inception/response-formatter.js';

describe('formatStageCompletion', () => {
  it('includes REVIEW REQUIRED section', () => {
    const result = formatStageCompletion(
      'requirements-analysis',
      ['inception/requirements.md'],
      ['Review requirements for accuracy'],
      'user-stories',
      '',
    );
    expect(result).toContain('## REVIEW REQUIRED');
  });

  it('includes WHAT\'S NEXT section when nextStage is provided', () => {
    const result = formatStageCompletion(
      'requirements-analysis',
      ['inception/requirements.md'],
      ['Review requirements for accuracy'],
      'user-stories',
      '',
    );
    expect(result).toContain("## WHAT'S NEXT");
    expect(result).toContain('User Stories');
  });

  it('shows inception complete message when nextStage is null', () => {
    const result = formatStageCompletion(
      'units-generation',
      ['inception/unit-of-work.md'],
      ['Review units'],
      null,
      '',
    );
    expect(result).toContain("## WHAT'S NEXT");
    expect(result).toContain('Inception phase is complete');
  });

  it('lists artifact paths as inline code', () => {
    const result = formatStageCompletion(
      'workspace-detection',
      ['inception/workspace-config.json', 'inception/pathway.md'],
      [],
      'reverse-engineering',
      '',
    );
    expect(result).toContain('`inception/workspace-config.json`');
    expect(result).toContain('`inception/pathway.md`');
  });

  it('shows default artifact message when no artifacts', () => {
    const result = formatStageCompletion(
      'workspace-detection',
      [],
      [],
      'reverse-engineering',
      '',
    );
    expect(result).toContain('_(no artifacts generated)_');
  });

  it('shows review items as checkboxes', () => {
    const result = formatStageCompletion(
      'requirements-analysis',
      [],
      ['Check requirement 1', 'Check requirement 2'],
      'user-stories',
      '',
    );
    expect(result).toContain('- [ ] Check requirement 1');
    expect(result).toContain('- [ ] Check requirement 2');
  });

  it('shows default review item when reviewItems is empty', () => {
    const result = formatStageCompletion(
      'workspace-detection',
      [],
      [],
      'reverse-engineering',
      '',
    );
    expect(result).toContain('- [ ] Review the generated artifacts');
  });

  it('includes human-readable stage label in What was completed', () => {
    const result = formatStageCompletion(
      'requirements-analysis',
      [],
      [],
      'user-stories',
      '',
    );
    expect(result).toContain('**Requirements Analysis**');
  });

  it('includes human-readable next stage label', () => {
    const result = formatStageCompletion(
      'requirements-analysis',
      [],
      [],
      'application-design',
      '',
    );
    expect(result).toContain('**Application Design**');
  });

  it('includes action prompts for user', () => {
    const result = formatStageCompletion(
      'user-stories',
      [],
      [],
      'workflow-planning',
      '',
    );
    expect(result).toContain('continue');
    expect(result).toContain('approve');
    expect(result).toContain('revise');
  });

  it('includes estimated time hint', () => {
    const result = formatStageCompletion(
      'requirements-analysis',
      [],
      [],
      'user-stories',
      '',
      'standard',
    );
    expect(result).toContain('Estimated time:');
  });

  it('adjusts time hint for comprehensive depth', () => {
    const standard = formatStageCompletion(
      'requirements-analysis',
      [],
      [],
      'user-stories',
      '',
      'standard',
    );
    const comprehensive = formatStageCompletion(
      'requirements-analysis',
      [],
      [],
      'user-stories',
      '',
      'comprehensive',
    );
    expect(standard).not.toEqual(comprehensive);
  });

  it('uses provided nextStageDescription when supplied', () => {
    const result = formatStageCompletion(
      'workspace-detection',
      [],
      [],
      'reverse-engineering',
      'Custom description for next stage',
    );
    expect(result).toContain('Custom description for next stage');
  });

  it('handles unknown stageName gracefully', () => {
    const result = formatStageCompletion(
      'unknown-stage',
      [],
      [],
      null,
      '',
    );
    expect(result).toContain('## REVIEW REQUIRED');
    expect(result).toContain('## WHAT\'S NEXT');
  });

  it('handles all known inception stages without throwing', () => {
    const stages = [
      'workspace-detection',
      'reverse-engineering',
      'requirements-analysis',
      'user-stories',
      'workflow-planning',
      'application-design',
      'units-generation',
    ] as const;

    for (const stage of stages) {
      expect(() =>
        formatStageCompletion(stage, [], [], null, '')
      ).not.toThrow();
    }
  });

  it('formats separator lines for clear structure', () => {
    const result = formatStageCompletion(
      'user-stories',
      [],
      [],
      'workflow-planning',
      '',
    );
    expect(result).toContain('---');
  });
});

describe('formatInceptionComplete', () => {
  it('includes inception complete header', () => {
    const result = formatInceptionComplete('wf-123', 7, 14);
    expect(result).toContain('Inception Phase Complete');
  });

  it('shows total stages count', () => {
    const result = formatInceptionComplete('wf-abc', 5, 10);
    expect(result).toContain('5 inception stage(s)');
  });

  it('shows artifact count', () => {
    const result = formatInceptionComplete('wf-abc', 7, 14);
    expect(result).toContain('14 artifact(s)');
  });

  it('includes workflow artifact path with workflowId', () => {
    const result = formatInceptionComplete('my-workflow-id', 7, 10);
    expect(result).toContain('aidlc-docs/my-workflow-id/inception/');
  });

  it('mentions Construction phase as next step', () => {
    const result = formatInceptionComplete('wf-123', 7, 14);
    expect(result).toContain('Construction');
  });

  it('includes continue action prompt', () => {
    const result = formatInceptionComplete('wf-123', 7, 14);
    expect(result).toContain('continue');
  });

  it('includes separator lines', () => {
    const result = formatInceptionComplete('wf-123', 7, 14);
    expect(result).toContain('---');
  });

  it('handles zero artifacts gracefully', () => {
    const result = formatInceptionComplete('wf-empty', 0, 0);
    expect(result).toContain('0 inception stage(s)');
    expect(result).toContain('0 artifact(s)');
  });
});
