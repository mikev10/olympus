/**
 * The meta-test. It reads the registry, runs every local assertion as its own
 * test, verifies every external assertion statically, and fails when any
 * invariant or capability claim is `missing` or any record is malformed.
 * The report it prints is the CI artifact: every pending entry with the unit
 * that owes it, so the pending count is visible and cannot quietly grow.
 */
import { afterAll, describe, expect, test } from 'vitest';
import { evaluateRegistry, formatReport, verifyExternalAssertion } from '../src/kit/registry.js';
import { INVARIANT_IDS, INVARIANTS } from '../src/kit/types.js';
import { REGISTRY } from '../src/registry/index.js';

const evaluation = evaluateRegistry(REGISTRY);

describe('registry', () => {
  test('every invariant I1-I10 is registered under its spine title', () => {
    for (const id of INVARIANT_IDS) {
      expect(REGISTRY.invariants[id].title).toBe(INVARIANTS[id]);
    }
  });

  test('no invariant or capability claim is missing and no record is malformed', () => {
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
