/**
 * The meta-test. It reads the registry, runs every local assertion as its own
 * test, verifies every external assertion statically, and fails when any
 * invariant or capability claim is `missing`, any record is malformed, or any
 * entry's pending count exceeds the committed baseline
 * (pending-baseline.json). The report it prints is the CI artifact: every
 * pending entry with the unit that owes it and the delta against the
 * baseline, so owed work is visible and cannot quietly grow.
 */
import { afterAll, describe, expect, test } from 'vitest';
import { readPendingBaseline } from '../src/kit/baseline.js';
import { evaluateRegistry, formatReport, verifyExternalAssertion } from '../src/kit/registry.js';
import { INVARIANT_IDS, INVARIANTS } from '../src/kit/types.js';
import { REGISTRY } from '../src/registry/index.js';

const evaluation = evaluateRegistry(REGISTRY, { baseline: readPendingBaseline() });

describe('registry', () => {
  test('every invariant I1-I10 is registered under its spine title', () => {
    for (const id of INVARIANT_IDS) {
      expect(REGISTRY.invariants[id].title).toBe(INVARIANTS[id]);
    }
  });

  test('no entry is missing, no record is malformed, and no pending count exceeds its baseline', () => {
    expect(evaluation.problems).toEqual([]);
    expect(evaluation.counts.missing).toBe(0);
  });
});

for (const report of [...evaluation.invariants, ...evaluation.claims]) {
  const heading = 'title' in report ? `${report.id} ${report.title}` : report.id;
  describe(heading, () => {
    if (report.assertions.length === 0) {
      const owners = [...new Set(report.pending.map((p) => p.owner))].join(', ');
      test(`no live assertion yet; pending -> ${owners}`, () => {
        expect(report.state).toBe('pending');
      });
      return;
    }
    for (const assertion of report.assertions) {
      if (assertion.kind === 'local') {
        test(`[${assertion.id}] ${assertion.title}`, async () => {
          await assertion.run();
        });
      } else {
        test(`[${assertion.id}] ${assertion.title} (external: ${assertion.package} ${assertion.file})`, () => {
          expect(verifyExternalAssertion(assertion)).toBeUndefined();
        });
      }
    }
  });
}

afterAll(() => {
  // Straight to stdout: vitest's default reporter drops console output from
  // a file whose tests all pass, and the report must print either way.
  process.stdout.write(`\n${formatReport(evaluation)}\n\n`);
});
