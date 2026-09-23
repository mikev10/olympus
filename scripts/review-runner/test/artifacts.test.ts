import { describe, expect, it } from 'vitest';
import { findUnitArtifacts } from '../artifacts.ts';

const FILES: readonly string[] = [
  '2026-09-11-P3-policy-engine-review-bundle.txt',
  '2026-09-11-P3-policy-engine-review-request.md',
  '2026-09-14-P4-station-machine-review-bundle.txt',
  '2026-09-14-P4-station-machine-review-prompt.txt',
  '2026-09-19-P5-driver-claude-code-review-bundle.txt',
  '2026-09-19-P5-driver-claude-code-review-prompt.txt',
  '2026-09-20-P5-driver-claude-code-adversarial-review.md',
];

describe('findUnitArtifacts', () => {
  it('finds the prompt and bundle pair for a unit', () => {
    expect(findUnitArtifacts(FILES, 'P5')).toEqual({
      date: '2026-09-19',
      slug: 'driver-claude-code',
      promptFile: '2026-09-19-P5-driver-claude-code-review-prompt.txt',
      bundleFile: '2026-09-19-P5-driver-claude-code-review-bundle.txt',
      matchingPairs: 1,
    });
  });

  it('is case sensitive on the unit id, because the convention keeps its case', () => {
    expect(() => findUnitArtifacts(FILES, 'p5')).toThrow(/no review prompt/);
  });

  it('does not confuse P4 with P5', () => {
    expect(findUnitArtifacts(FILES, 'P4').slug).toBe('station-machine');
  });

  it('refuses a unit whose prompt exists without a bundle', () => {
    const orphan = ['2026-09-20-P6-thing-review-prompt.txt'];
    expect(() => findUnitArtifacts(orphan, 'P6')).toThrow(/bundle/);
  });

  it('refuses a unit with no prompt at all, naming the unit', () => {
    expect(() => findUnitArtifacts(FILES, 'P9')).toThrow(/P9/);
  });

  it('picks the most recent date when a unit was re-bundled', () => {
    const twice: readonly string[] = [
      '2026-09-01-P7-x-review-prompt.txt',
      '2026-09-01-P7-x-review-bundle.txt',
      '2026-09-15-P7-x-review-prompt.txt',
      '2026-09-15-P7-x-review-bundle.txt',
    ];
    expect(findUnitArtifacts(twice, 'P7').date).toBe('2026-09-15');
  });

  it('reports how many pairs matched, so a selection among several is not silent', () => {
    expect(findUnitArtifacts(FILES, 'P5').matchingPairs).toBe(1);

    const twice: readonly string[] = [
      '2026-09-01-P7-x-review-prompt.txt',
      '2026-09-01-P7-x-review-bundle.txt',
      '2026-09-15-P7-x-review-prompt.txt',
      '2026-09-15-P7-x-review-bundle.txt',
    ];
    const chosen = findUnitArtifacts(twice, 'P7');
    expect(chosen.matchingPairs).toBe(2);
    expect(chosen.date).toBe('2026-09-15');
  });
});
