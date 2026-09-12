/**
 * The policy engine: resolution, refusal, and the two invariants it carries.
 *
 * I4 — nothing is granted that the document did not grant.
 * I5 — an over-request is refused and never downgraded.
 */
import { describe, expect, test } from 'vitest';
import {
  APPROVAL_KEYS, AUTONOMY_LEVELS, DEFAULT_POLICY_DOCUMENT, STATION_IDS,
  StrictPolicyEngine, validateToolGrants,
  type ApprovalKey, type AutonomyLevel, type CapabilityScope, type Policy,
  type PolicyDocument, type RoleId, type StationId,
} from '../src/index.js';

const engine = new StrictPolicyEngine();

const BUILDER = 'builder' as RoleId;
const MISSING = 'reviewer' as RoleId;

function scope(overrides: Partial<CapabilityScope> = {}): CapabilityScope {
  return {
    stations: ['build', 'verify'],
    writableGlobs: ['src/**'],
    tools: ['read', 'write'],
    network: { egress: 'none' },
    tier: 'standard',
    autonomyCeiling: 3,
    triggerKinds: ['human'],
    budget: { maxTokens: 1000, maxCostUsd: 1, maxWallClockMs: 60_000 },
    ...overrides,
  };
}

function document(overrides: Partial<PolicyDocument> = {}): PolicyDocument {
  return {
    ...DEFAULT_POLICY_DOCUMENT,
    globalCap: 3,
    roles: { [BUILDER]: scope() },
    ...overrides,
  };
}

function resolved(overrides: Partial<PolicyDocument> = {}): Policy {
  return engine.resolvePolicy(document(overrides));
}

describe('resolvePolicy makes the approvals table total (R-F2-08)', () => {
  test('all forty station:level keys are present', () => {
    const policy = resolved();
    expect(Object.keys(policy.approvals)).toHaveLength(STATION_IDS.length * AUTONOMY_LEVELS.length);
    expect(Object.keys(policy.approvals)).toHaveLength(40);
    for (const key of APPROVAL_KEYS) expect(policy.approvals[key]).toBeDefined();
  });

  test('every omitted approval reads human-required, never auto', () => {
    const policy = resolved({ approvals: {} });
    for (const key of APPROVAL_KEYS) expect(policy.approvals[key]).toBe('human-required');
    expect(Object.values(policy.approvals)).not.toContain('auto');
  });

  test('an approval the document states is carried through unchanged', () => {
    const policy = resolved({ approvals: { 'build:1': 'auto', 'integrate:3': 'blocked' } });
    expect(policy.approvals['build:1']).toBe('auto');
    expect(policy.approvals['integrate:3']).toBe('blocked');
    expect(policy.approvals['build:2']).toBe('human-required');
  });

  test('no key reads auto that the document did not state', () => {
    const policy = resolved({ approvals: { 'build:1': 'auto' } });
    const auto = Object.entries(policy.approvals)
      .filter(([, outcome]) => outcome === 'auto')
      .map(([key]) => key);
    expect(auto).toStrictEqual(['build:1']);
  });

  test('stationCaps stays sparse in the resolved form, as the contract declares', () => {
    const policy = resolved({ stationCaps: { build: 1 } });
    expect(Object.keys(policy.stationCaps)).toStrictEqual(['build']);
  });
});

describe('the resolved policy is not aliased to the document', () => {
  test('mutating the document afterwards does not change the policy', () => {
    const doc = document();
    const policy = engine.resolvePolicy(doc);
    doc.protectedPaths.push('src/**');
    doc.roles[BUILDER]?.tools.push('shell');
    expect(policy.protectedPaths).not.toContain('src/**');
    expect(policy.roles[BUILDER]?.tools).toStrictEqual(['read', 'write']);
  });

  test('the policy is frozen through its nested values, so a caller cannot widen a grant', () => {
    const policy = resolved();
    expect(() => policy.roles[BUILDER]?.tools.push('shell')).toThrow(TypeError);
    expect(() => policy.protectedPaths.push('/etc')).toThrow(TypeError);
    expect(policy.roles[BUILDER]?.tools).toStrictEqual(['read', 'write']);
  });

  test('two resolutions of one document agree', () => {
    const doc = document();
    expect(engine.resolvePolicy(doc)).toStrictEqual(engine.resolvePolicy(doc));
  });
});

describe('resolveAutonomy refuses an over-request, never downgrades it (I5)', () => {
  test('a request above the global cap is a refusal naming both levels', () => {
    const policy = resolved({ globalCap: 1 });
    const outcome = engine.resolveAutonomy(3, 'build', BUILDER, policy);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.reason).toBe('exceeds-cap');
    expect(outcome.detail).toContain('L3 requested');
    expect(outcome.detail).toContain('effective cap L1');
    expect(outcome.detail).toContain('Refused, not downgraded');
  });

  test('a refusal carries no level at all: there is nothing to mistake for a grant', () => {
    const policy = resolved({ globalCap: 0 });
    const outcome = engine.resolveAutonomy(2, 'build', BUILDER, policy);
    expect(outcome).not.toHaveProperty('level');
  });

  test('a request above the station cap is refused even when the global cap allows it', () => {
    const policy = resolved({ globalCap: 3, stationCaps: { build: 1 } });
    const outcome = engine.resolveAutonomy(2, 'build', BUILDER, policy);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.detail).toContain('build L1');
  });

  test('a request above the role ceiling is refused even when both caps allow it', () => {
    const policy = resolved({ globalCap: 3, roles: { [BUILDER]: scope({ autonomyCeiling: 1 }) } });
    const outcome = engine.resolveAutonomy(3, 'build', BUILDER, policy);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.detail).toContain('role ceiling L1');
  });

  test('a request at the cap is granted at the level asked for', () => {
    const policy = resolved({ globalCap: 2, roles: { [BUILDER]: scope({ autonomyCeiling: 2 }) } });
    const outcome = engine.resolveAutonomy(2, 'build', BUILDER, policy);
    expect(outcome).toStrictEqual({ ok: true, level: 2 });
  });

  test('a request below the cap is granted as requested, not raised to the cap', () => {
    const policy = resolved({ globalCap: 3 });
    for (const level of [0, 1, 2] as const) {
      expect(engine.resolveAutonomy(level, 'build', BUILDER, policy)).toStrictEqual({ ok: true, level });
    }
  });

  test('the tightest of the three bounds is the one that applies', () => {
    const policy = resolved({ globalCap: 3, stationCaps: { build: 2 }, roles: { [BUILDER]: scope({ autonomyCeiling: 1 }) } });
    expect(engine.resolveAutonomy(1, 'build', BUILDER, policy).ok).toBe(true);
    expect(engine.resolveAutonomy(2, 'build', BUILDER, policy).ok).toBe(false);
  });

  test('an omitted station cap leaves the global cap and role ceiling in force (D-P3-06)', () => {
    const policy = resolved({ globalCap: 2, stationCaps: {} });
    expect(engine.resolveAutonomy(2, 'build', BUILDER, policy).ok).toBe(true);
    expect(engine.resolveAutonomy(3, 'build', BUILDER, policy).ok).toBe(false);
  });
});

describe('default deny: an ungranted role or station has nothing (I4)', () => {
  test('a role the policy does not define is refused with capability-missing', () => {
    const policy = resolved();
    for (const outcome of [
      engine.resolveAutonomy(1, 'build', MISSING, policy),
      engine.resolveCapabilities(MISSING, 'build', policy),
    ]) {
      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('unreachable');
      expect(outcome.reason).toBe('capability-missing');
      expect(outcome.detail).toContain('reviewer');
    }
  });

  test('a station outside the role scope is refused with station-forbidden', () => {
    const policy = resolved();
    const outcome = engine.resolveCapabilities(BUILDER, 'integrate', policy);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.reason).toBe('station-forbidden');
    expect(outcome.detail).toContain('build, verify');
    expect(outcome.detail).toContain('integrate');
  });

  test('the shipped default grants no role anything at any station', () => {
    const policy = engine.resolvePolicy(DEFAULT_POLICY_DOCUMENT);
    for (const station of STATION_IDS) {
      expect(engine.resolveCapabilities(BUILDER, station, policy).ok).toBe(false);
      expect(engine.resolveAutonomy(0, station, BUILDER, policy).ok).toBe(false);
    }
  });

  test('a granted station returns exactly the scope the policy states, and nothing more', () => {
    const policy = resolved();
    const outcome = engine.resolveCapabilities(BUILDER, 'build', policy);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('unreachable');
    expect(outcome.scope.tools).toStrictEqual(['read', 'write']);
    expect(outcome.scope.network.egress).toBe('none');
    expect(Object.keys(outcome.scope).sort()).toStrictEqual([
      'autonomyCeiling', 'budget', 'network', 'stations', 'tier', 'tools', 'triggerKinds', 'writableGlobs',
    ]);
  });

  test('a resolved scope is a copy: mutating it changes neither the policy nor the next call', () => {
    const policy = resolved();
    const first = engine.resolveCapabilities(BUILDER, 'build', policy);
    if (!first.ok) throw new Error('unreachable');
    expect(() => first.scope.tools.push('shell')).toThrow(TypeError);
    const second = engine.resolveCapabilities(BUILDER, 'build', policy);
    if (!second.ok) throw new Error('unreachable');
    expect(second.scope.tools).toStrictEqual(['read', 'write']);
    expect(second.scope).not.toBe(first.scope);
    expect(policy.roles[BUILDER]?.tools).toStrictEqual(['read', 'write']);
  });

  test('every station in the role scope resolves, and every other station does not', () => {
    const policy = resolved();
    const granted: StationId[] = ['build', 'verify'];
    for (const station of STATION_IDS) {
      const expected = granted.includes(station);
      expect(engine.resolveCapabilities(BUILDER, station, policy).ok).toBe(expected);
    }
  });
});

describe('validateToolGrants requires a real inventory (D-P3-04)', () => {
  test('a grant the inventory covers passes', () => {
    expect(validateToolGrants(resolved(), ['read', 'write', 'shell'])).toStrictEqual({ ok: true });
  });

  test('an empty inventory refuses every grant rather than admitting all of them', () => {
    const outcome = validateToolGrants(resolved(), []);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.reason).toBe('capability-missing');
    expect(outcome.ungranted).toStrictEqual([
      { role: 'builder', tool: 'read' },
      { role: 'builder', tool: 'write' },
    ]);
  });

  test('a single uncovered tool is named with its role', () => {
    const outcome = validateToolGrants(resolved(), ['read']);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.ungranted).toStrictEqual([{ role: 'builder', tool: 'write' }]);
    expect(outcome.detail).toContain('builder -> write');
  });

  test('a policy granting nothing passes any inventory, including an empty one', () => {
    const policy = engine.resolvePolicy(DEFAULT_POLICY_DOCUMENT);
    expect(validateToolGrants(policy, [])).toStrictEqual({ ok: true });
  });

  test('every role is checked, not only the first', () => {
    const policy = resolved({
      roles: {
        [BUILDER]: scope({ tools: ['read'] }),
        ['tester' as RoleId]: scope({ tools: ['run'] }),
      },
    });
    const outcome = validateToolGrants(policy, ['read']);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.ungranted).toStrictEqual([{ role: 'tester', tool: 'run' }]);
  });
});

describe('the derived union lists cannot drift from the contract', () => {
  test('the ten stations are present, in station order', () => {
    expect(STATION_IDS).toStrictEqual([
      'intake', 'spec', 'test-design', 'plan', 'build',
      'verify', 'review', 'integrate', 'observe', 'learn',
    ]);
  });

  test('the four levels are ascending', () => {
    expect(AUTONOMY_LEVELS).toStrictEqual([0, 1, 2, 3]);
  });

  test('the forty approval keys are the cross product', () => {
    // The digit map mirrors the one the engine builds keys with; a level
    // cannot be interpolated as a number under the I7 lint rules.
    const digit: Readonly<Record<AutonomyLevel, '0' | '1' | '2' | '3'>> = { 0: '0', 1: '1', 2: '2', 3: '3' };
    const expected: ApprovalKey[] = [];
    for (const station of STATION_IDS) {
      for (const level of AUTONOMY_LEVELS) expected.push(`${station}:${digit[level]}`);
    }
    expect(APPROVAL_KEYS).toStrictEqual(expected);
  });

  test('the lists are frozen, so a caller cannot shorten them', () => {
    const levels: readonly AutonomyLevel[] = AUTONOMY_LEVELS;
    expect(Object.isFrozen(levels)).toBe(true);
    expect(Object.isFrozen(STATION_IDS)).toBe(true);
    expect(Object.isFrozen(APPROVAL_KEYS)).toBe(true);
  });
});
