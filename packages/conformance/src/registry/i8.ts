import { join, resolve } from 'node:path';
import { compileError, keysEqual, pending, runtime } from '../kit/assert.js';
import { PENDING_BASELINE_FILE, readPendingBaseline } from '../kit/baseline.js';
import { conformancePathsMap } from '../kit/paths.js';
import { EXTERNAL_RECONCILIATION_ID, evaluateRegistry, formatReport } from '../kit/registry.js';
import { INVARIANTS, type InvariantEntry, type Registry } from '../kit/types.js';
import { conformanceRoot, toPosix, walkFiles, workspacePackages, workspaceRelative } from '../kit/workspace.js';
import { claimKeys } from './claims.js';

const CONFORMANCE = '@olympus-ai/conformance';

/** I8: Every capability claim maps to an executable assertion. */
export const I8: InvariantEntry = {
  title: INVARIANTS.I8,
  assertions: [
    runtime({
      id: 'I8.registry-complete',
      title: 'every invariant and capability claim is asserted, or pending with a named owner and reason; no record is malformed',
      run: async () => {
        const { REGISTRY } = await import('./index.js');
        const evaluation = evaluateRegistry(REGISTRY, { baseline: readPendingBaseline() });
        if (evaluation.problems.length > 0 || evaluation.counts.missing > 0) {
          throw new Error(`I8: the registry is incomplete\n${formatReport(evaluation)}`);
        }
      },
    }),
    runtime({
      id: 'I8.pending-count-never-exceeds-baseline',
      title: 'every entry has a committed pending baseline, none owes more than it allows, and one pending entry added without a baseline edit is refused',
      run: async () => {
        const { REGISTRY } = await import('./index.js');
        const baseline = readPendingBaseline();
        const real = evaluateRegistry(REGISTRY, { baseline });
        const violations = real.problems.filter((p) => p.includes(PENDING_BASELINE_FILE));
        if (violations.length > 0) throw new Error(`I8: the pending ratchet is violated\n  ${violations.join('\n  ')}`);
        // The ratchet must fire, not merely exist: raise I1 to one entry above
        // its baseline, keep the baseline, and require the refusal.
        const current = REGISTRY.invariants.I1;
        const allowed = baseline.invariants.I1 ?? 0;
        const extra = Array.from({ length: allowed + 1 - current.pending.length }, (_, i) =>
          pending({ id: `I1.ratchet-self-test-${String(i)}`, owner: 'S1', reason: 'must be refused by the ratchet' }),
        );
        const raised: Registry = {
          ...REGISTRY,
          invariants: { ...REGISTRY.invariants, I1: { ...current, pending: [...current.pending, ...extra] } },
        };
        const expected = `I1: pending count ${String(allowed + 1)} exceeds baseline ${String(allowed)}`;
        if (!evaluateRegistry(raised, { baseline }).problems.some((p) => p.startsWith(expected))) {
          throw new Error(`I8: the pending ratchet did not refuse a count one above its baseline (expected "${expected}")`);
        }
      },
    }),
    compileError({
      id: 'I8.registry-type-is-total',
      title: 'the registry type rejects a missing invariant, an invented one, an unknown owner, and a stray claim family at compile time',
      fixture: 'kit/registry-total-over-invariants.ts',
    }),
    keysEqual({
      id: 'I8.driver-capability-keys-registered',
      title:
        'the registry lists exactly the keys of DriverCapabilities as driver.* claims, in both directions, and the interface has a finite non-empty key set',
      name: 'generated/driver-capability-keys.ts',
      typeName: 'DriverCapabilities',
      declare: `import type { DriverCapabilities } from '@olympus-ai/core';`,
      keys: () => claimKeys('driver'),
    }),
    keysEqual({
      id: 'I8.sandbox-capability-keys-registered',
      title:
        'the registry lists exactly the keys of SandboxCapabilities as sandbox.* claims, in both directions, and the interface has a finite non-empty key set',
      name: 'generated/sandbox-capability-keys.ts',
      typeName: 'SandboxCapabilities',
      declare: `import type { SandboxCapabilities } from '@olympus-ai/sandbox';`,
      keys: () => claimKeys('sandbox'),
    }),
    runtime({
      id: 'I8.every-fixture-is-registered',
      title: 'every file under fixtures/ is read by a registered assertion; a fixture nothing runs is not evidence',
      run: async () => {
        const { REGISTRY } = await import('./index.js');
        const referenced = new Set<string>();
        for (const entry of [...Object.values(REGISTRY.invariants), ...Object.values(REGISTRY.claims)]) {
          for (const a of entry.assertions) if (a.kind === 'local' && a.fixture !== undefined) referenced.add(a.fixture);
        }
        const prefix = 'packages/conformance/';
        const onDisk = walkFiles(join(conformanceRoot(), 'fixtures')).map((f) => workspaceRelative(f).slice(prefix.length));
        if (onDisk.length === 0) throw new Error('I8: no fixtures found');
        const orphans = onDisk.filter((f) => !referenced.has(f));
        if (orphans.length > 0) {
          throw new Error(`I8: fixtures exist that no registered assertion reads\n  ${orphans.join('\n  ')}`);
        }
      },
    }),
    runtime({
      id: 'I8.fixture-paths-match-published-entries',
      title: 'the conformance tsconfig maps every sibling package to its published entry, so fixtures assert against the real contracts',
      run: () => {
        const paths = conformancePathsMap();
        const packages = workspacePackages().filter((p) => p.name !== CONFORMANCE);
        if (packages.length === 0) throw new Error('I8: no sibling packages found');
        const problems: string[] = [];
        for (const pkg of packages) {
          const mapped = paths[pkg.name];
          const target = mapped?.length === 1 ? mapped[0] : undefined;
          if (target === undefined) {
            problems.push(`${pkg.name}: not mapped to exactly one target in packages/conformance/tsconfig.json`);
            continue;
          }
          if (pkg.entry === undefined) {
            problems.push(`${pkg.name}: package.json declares no types or main entry`);
            continue;
          }
          const expected = toPosix(resolve(pkg.dir, pkg.entry));
          const actual = toPosix(resolve(conformanceRoot(), target));
          if (expected !== actual) problems.push(`${pkg.name}: mapped to ${target} but its published entry is ${pkg.entry}`);
        }
        for (const key of Object.keys(paths)) {
          if (!packages.some((p) => p.name === key)) problems.push(`${key}: mapped but not a workspace package`);
        }
        if (problems.length > 0) throw new Error(`I8: fixture resolution does not follow the published entries\n  ${problems.join('\n  ')}`);
      },
    }),
  ],
  pending: [
    pending({
      id: EXTERNAL_RECONCILIATION_ID,
      owner: 'P2',
      reason:
        'An external assertion, one another package runs in its own suite, is refused by the registry today: the only ' +
        'check available was that a file quotes the id, which a comment or a skipped test satisfies. Before the first ' +
        'one is accepted, the registry must reconcile every external id it lists against the tests the owning package ' +
        'actually ran and passed, read from that package\'s own test run, and refuse an id that did not run. Owed to the ' +
        'first Phase 2 unit that needs an implementation-backed assertion: P2, which owes I1.mount-layer-enforcement.',
    }),
  ],
};
