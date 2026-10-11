import { describe, expect, it } from 'vitest';
import { CEILING_BEARING, NOT_SCANNED, PROBES, deriveCeiling, renderReport, resolveWithReadiness, type ProbeId, type ProbeOutcome, type ProbeResult } from '../src/index.js';
import { StrictPolicyEngine, type PolicyDocument, type RoleId } from '@olympus-ai/core';

const result = (probe: ProbeId, outcome: ProbeOutcome): ProbeResult => ({
  probe, pillar: 'testing', ceilingBearing: true, outcome, detail: `${probe} ${outcome}`, evidence: { via: 'static', read: 'test' }, collectedBy: 'runtime',
});
const allSupported = () => CEILING_BEARING.map((id) => result(id, 'supported'));

describe('deriveCeiling', () => {
  it('names the first gap in derivation order', () => {
    const results = allSupported().map((r) => (r.probe === 'testing.green-at-base' || r.probe === 'build.clean' ? result(r.probe, 'absent') : r));
    expect(deriveCeiling(results)).toEqual({ level: 0, heldBy: { kind: 'probe', probe: 'build.clean' } });
  });

  it('a duplicate supported result cannot outvote a gap', () => {
    expect(deriveCeiling([...allSupported(), result('testing.coverage', 'absent')])).toEqual({ level: 1, heldBy: { kind: 'probe', probe: 'testing.coverage' } });
  });

  it('declares every probe once, advisory probes included', () => {
    expect(new Set(PROBES.map((p) => p.id)).size).toBe(PROBES.length);
    expect(PROBES.filter((p) => !p.ceilingBearing).map((p) => p.pillar)).toEqual(
      expect.arrayContaining(['style-and-validation', 'dev-environment', 'documentation', 'code-quality']),
    );
  });
});

describe('resolveWithReadiness', () => {
  const engine = new StrictPolicyEngine();
  const role = 'builder' as RoleId;
  const document: PolicyDocument = {
    globalCap: 3,
    stationCaps: {},
    approvals: {},
    roles: {
      [role]: {
        stations: ['build'], writableGlobs: ['**'], tools: [], network: { egress: 'none' }, tier: 'standard', tierByStation: {},
        escalation: 'none', autonomyCeiling: 3, triggerKinds: ['human'], budget: { maxTokens: 1000, maxCostUsd: 1, maxWallClockMs: 60_000 },
      },
    },
    protectedPaths: [],
    triggers: {
      enabled: ['human'], entryStation: { human: 'intake' }, taskTemplate: {}, maxAutonomy: { human: 3 },
      minAuthorTrust: { human: 'owner' }, maxTriggerDepth: 1, budgetPerWindow: { runs: 1, windowMs: 1000 },
    },
    concurrency: { maxParallelTasks: 1, maxConflictRetries: 0 },
  };

  it('grants exactly what the engine grants when the repository is unscanned, and refuses above a scanned ceiling', () => {
    const policy = engine.resolvePolicy(document);
    expect(resolveWithReadiness(engine, 3, 'build', role, policy, NOT_SCANNED)).toMatchObject({ ok: true, level: 3 });
    const refused = resolveWithReadiness(engine, 2, 'build', role, policy, { kind: 'scanned', level: 1, heldBy: { kind: 'probe', probe: 'testing.coverage' }, commit: 'c0ffee' });
    expect(refused).toMatchObject({ ok: false, reason: 'exceeds-bound', bounds: [{ term: 'readiness', ceiling: 1 }] });
  });
});

describe('renderReport', () => {
  it('names the holding probe, never a score', () => {
    const probes = allSupported().map((r) => (r.probe === 'integrate.branch-protection' ? result(r.probe, 'indeterminate') : r));
    const text = renderReport({ commit: 'abc', ceiling: { kind: 'scanned', level: 1, heldBy: { kind: 'probe', probe: 'integrate.branch-protection' }, commit: 'abc' }, probes, skipped: [], collectedBy: 'runtime' });
    expect(text).toContain('Readiness ceiling L1 at abc, held by integrate.branch-protection: integrate.branch-protection indeterminate');
    expect(text).not.toMatch(/score|index/iu);
  });
});
