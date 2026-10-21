/**
 * The tier a task runs at (A-R14-01): the role's, or its station's, raised by
 * escalation only where policy grants it, one step at a time, never past the
 * ceiling, and decided from the attempt counts alone (I2, I4).
 */
import { describe, expect, test } from 'vitest';
import { escalationAt, failedGates, gatedIterations, tierFor, type CapabilityScope, type TaskAttempts, type TaskId } from '../src/index.js';

function scope(overrides: Partial<CapabilityScope> = {}): CapabilityScope {
  return {
    stations: ['plan', 'build', 'review'],
    writableGlobs: ['src/**'],
    tools: [],
    network: { egress: 'none' },
    tier: 'fast',
    tierByStation: {},
    escalation: 'none',
    autonomyCeiling: 2,
    triggerKinds: ['human'],
    budget: { maxTokens: 1000, maxCostUsd: 1, maxWallClockMs: 60_000 },
    ...overrides,
  };
}

function at(iterations: number): TaskAttempts {
  return { iterations, retries: 0, starts: iterations, conflicts: [] };
}

describe('a tier per station', () => {
  test('a station the map names runs at its tier; any other runs at the role\'s', () => {
    const s = scope({ tier: 'standard', tierByStation: { plan: 'deep' } });
    expect(tierFor(s, 'plan', at(1))).toBe('deep');
    expect(tierFor(s, 'build', at(1))).toBe('standard');
  });
});

describe('escalation', () => {
  test('without a grant, no number of failed gates moves the tier', () => {
    const s = scope({ tier: 'fast' });
    for (const n of [1, 2, 3, 10]) expect(tierFor(s, 'build', at(n))).toBe('fast');
    for (const n of [1, 2, 3, 10]) expect(escalationAt(s, 'build', at(n))).toBeNull();
  });

  test('under a grant, the tier rises one step for every afterFailedGates failures, and stops at the ceiling', () => {
    const s = scope({ tier: 'fast', escalation: { afterFailedGates: 1, ceiling: 'deep' } });
    expect([1, 2, 3, 4].map((n) => tierFor(s, 'build', at(n)))).toStrictEqual(['fast', 'standard', 'deep', 'deep']);
  });

  test('a larger failure count waits for that many failures before each step', () => {
    const s = scope({ tier: 'fast', escalation: { afterFailedGates: 2, ceiling: 'deep' } });
    expect([1, 2, 3, 4, 5, 6].map((n) => tierFor(s, 'build', at(n)))).toStrictEqual(['fast', 'fast', 'standard', 'standard', 'deep', 'deep']);
  });

  test('a ceiling below deep holds the tier there', () => {
    const s = scope({ tier: 'fast', escalation: { afterFailedGates: 1, ceiling: 'standard' } });
    expect([1, 2, 3].map((n) => tierFor(s, 'build', at(n)))).toStrictEqual(['fast', 'standard', 'standard']);
  });

  test('escalation climbs from the station tier, not the role tier', () => {
    const s = scope({ tier: 'fast', tierByStation: { build: 'standard' }, escalation: { afterFailedGates: 1, ceiling: 'deep' } });
    expect(tierFor(s, 'build', at(2))).toBe('deep');
  });

  test('retries and replays are not failed gates: only iterations count', () => {
    const s = scope({ tier: 'fast', escalation: { afterFailedGates: 1, ceiling: 'deep' } });
    expect(tierFor(s, 'build', { iterations: 1, retries: 2, starts: 5, conflicts: [] })).toBe('fast');
  });

  test('a conflict is not a failed gate: an iteration a conflict sent back raises no tier (A-R4-01)', () => {
    const s = scope({ tier: 'fast', escalation: { afterFailedGates: 1, ceiling: 'deep' } });
    const conflict = { with: ['b' as TaskId] as const, paths: ['x.txt'] as const };
    const attempts: TaskAttempts = { iterations: 2, retries: 0, starts: 2, conflicts: [conflict] };
    expect(failedGates(attempts)).toBe(0);
    expect(gatedIterations(attempts)).toBe(1);
    expect(tierFor(s, 'build', attempts)).toBe('fast');
    expect(escalationAt(s, 'build', attempts)).toBeNull();
  });

  test('each escalation is one step, named with the failures it was decided on', () => {
    const s = scope({ tier: 'fast', escalation: { afterFailedGates: 1, ceiling: 'deep' } });
    expect(escalationAt(s, 'build', at(1))).toBeNull();
    expect(escalationAt(s, 'build', at(2))).toStrictEqual({ from: 'fast', to: 'standard', failedGates: 1 });
    expect(escalationAt(s, 'build', at(3))).toStrictEqual({ from: 'standard', to: 'deep', failedGates: 2 });
    expect(escalationAt(s, 'build', at(4))).toBeNull();
  });
});
