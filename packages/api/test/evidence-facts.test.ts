/**
 * What a review seat is given under its `evidence-bundle` grant (R9, codex-2):
 * the security checks' findings arrive, as the runtime parsed them, so two
 * bundles that differ only in those findings give the seats different context.
 */
import { describe, expect, test } from 'vitest';
import type { EvidenceBundle } from '@olympus-ai/vault';
import { evidenceFactsOf } from '../src/index.js';

const check = { checkId: 'secret-scan', exitCode: 0, stdout: '', stderr: '', suiteCount: null, expectation: null, durationMs: 1, startedAt: '2026-11-02T00:00:00.000Z' };

function bundle(findings: EvidenceBundle['checks'][number]['findings']): EvidenceBundle {
  return {
    taskId: 'hello',
    checks: [{ ...check, findings }],
    unstarted: [],
    claimEvidenceDiff: [],
    notCarried: [],
    tamper: { protectedPathsTouched: [], testsDeleted: [], skipMarkersAdded: [], assertionsWeakened: [], snapshotsRegenerated: [], suppressionMarkersAdded: [] },
  } as unknown as EvidenceBundle;
}

describe('the evidence a review seat is given', () => {
  test("carries each security check's findings, rule and location, and tells a clean scan from an unread one", () => {
    const found = [{ rule: 'seeded-secret', location: { path: 'src/a.ts', line: 3 }, fingerprint: 'f'.repeat(64) }];
    const withFinding = JSON.parse(evidenceFactsOf([bundle(found)])) as Array<{ checks: Array<{ findings: unknown }> }>;
    const clean = evidenceFactsOf([bundle([])]);
    const unread = evidenceFactsOf([bundle(null)]);
    expect(withFinding[0]?.checks[0]?.findings).toEqual([{ rule: 'seeded-secret', path: 'src/a.ts', line: 3 }]);
    expect(new Set([JSON.stringify(withFinding), clean, unread]).size).toBe(3);
  });
});
