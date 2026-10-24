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
      skippedCounted: [],
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

describe('findUnitArtifacts with several pairs on one date (D-TOOLING-08)', () => {
  const halves: readonly string[] = [
    '2026-10-23-R19-drafting-conformance-review-bundle.txt',
    '2026-10-23-R19-drafting-conformance-review-prompt.txt',
    '2026-10-23-R19-drafting-runtime-review-bundle.txt',
    '2026-10-23-R19-drafting-runtime-review-prompt.txt',
  ];
  const counted =
    (...stems: string[]) =>
    (stem: string): boolean =>
      stems.includes(stem);

  it('passes over the half this family already counted and chooses the other', () => {
    const chosen = findUnitArtifacts(halves, 'R19', counted('2026-10-23-R19-drafting-conformance'));
    expect(chosen.slug).toBe('drafting-runtime');
    expect(chosen.skippedCounted).toEqual(['2026-10-23-R19-drafting-conformance-review-prompt.txt']);
    expect(chosen.matchingPairs).toBe(2);
  });

  it('refuses when more than one pair on the newest date is uncounted', () => {
    expect(() => findUnitArtifacts(halves, 'R19')).toThrow(/2 review prompts dated 2026-10-23/);
  });

  it('keeps the newest when every pair is counted, so the counted refusal still fires', () => {
    const chosen = findUnitArtifacts(
      halves,
      'R19',
      counted('2026-10-23-R19-drafting-conformance', '2026-10-23-R19-drafting-runtime'),
    );
    expect(chosen.date).toBe('2026-10-23');
    expect(chosen.skippedCounted).toEqual([]);
  });

  it('never falls back to an older, superseded pair when the newest is counted', () => {
    const rebundled: readonly string[] = [
      '2026-09-01-P7-x-review-prompt.txt',
      '2026-09-01-P7-x-review-bundle.txt',
      '2026-09-15-P7-x-review-prompt.txt',
      '2026-09-15-P7-x-review-bundle.txt',
    ];
    expect(findUnitArtifacts(rebundled, 'P7', counted('2026-09-15-P7-x')).date).toBe('2026-09-15');
  });
});
