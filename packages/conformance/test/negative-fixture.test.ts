/**
 * The I8 negative-fixture judgement (#38, D-R2-10). The old check failed a
 * fixture only on `supported` or a missing probe, so a probe that could not
 * run — `indeterminate` — passed it as if its check had refused.
 */
import type { ProbeResult } from '@olympus-ai/readiness';
import { describe, expect, test } from 'vitest';
import { negativeFailure } from '../src/registry/readiness.js';

const secret = { names: /^the secret scan found leaks: /u, via: 'executed' as const };

function result(over: Partial<ProbeResult>): ProbeResult {
  return {
    probe: 'integrate.secret-scan',
    pillar: 'security-and-governance',
    ceilingBearing: true,
    outcome: 'absent',
    detail: 'the secret scan found leaks: config.js',
    evidence: { via: 'executed', argv: ['gitleaks'], image: 'scan', run: { kind: 'exited', exitCode: 2, durationMs: 1, outputSha256: 'a' } },
    collectedBy: 'runtime',
    ...over,
  };
}

describe('a negative fixture is met only by the refusal it was built to cause', () => {
  test('absent, observed as expected, naming the failure: met', () => {
    expect(negativeFailure('integrate.secret-scan', 'f', result({}), secret)).toBeNull();
  });

  test('indeterminate is refused: a gitleaks start-up failure is not a found leak', () => {
    const startUp = result({
      outcome: 'indeterminate',
      detail: 'the secret scan exited 1: could not load config',
      evidence: { via: 'executed', argv: ['gitleaks'], image: 'scan', run: { kind: 'exited', exitCode: 1, durationMs: 1, outputSha256: 'a' } },
    });
    expect(negativeFailure('integrate.secret-scan', 'f', startUp, secret)).toMatch(/was indeterminate/u);
  });

  test('supported and missing are refused, as before', () => {
    expect(negativeFailure('integrate.secret-scan', 'f', result({ outcome: 'supported' }), secret)).toMatch(/was supported/u);
    expect(negativeFailure('integrate.secret-scan', 'f', undefined, secret)).toMatch(/missing/u);
  });

  test('absent for another reason than the fixture\'s is refused', () => {
    expect(negativeFailure('integrate.secret-scan', 'f', result({ detail: 'something else' }), secret)).toMatch(/another reason/u);
  });

  test('absent but observed another way, or stopped, is refused', () => {
    expect(negativeFailure('integrate.secret-scan', 'f', result({ evidence: { via: 'static', read: 'x' } }), secret)).toMatch(/via static/u);
    const stopped = result({ evidence: { via: 'executed', argv: ['gitleaks'], image: 'scan', run: { kind: 'stopped', reason: 'timeout', durationMs: 1 } } });
    expect(negativeFailure('integrate.secret-scan', 'f', stopped, secret)).toMatch(/was stopped/u);
  });
});
