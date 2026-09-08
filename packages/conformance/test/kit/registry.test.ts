import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { external, pending, runtime } from '../../src/kit/assert.js';
import { type PendingBaseline } from '../../src/kit/baseline.js';
import { evaluateRegistry, formatReport, stateOf, verifyExternalAssertion } from '../../src/kit/registry.js';
import { INVARIANT_IDS, INVARIANTS, type InvariantEntry, type InvariantId, type Registry } from '../../src/kit/types.js';
import { validateAssertionId } from '../../src/kit/vitest.js';

const noop = (): void => undefined;

function fullRegistry(overrides: Partial<Record<InvariantId, InvariantEntry>> = {}): Registry {
  const invariants = Object.fromEntries(
    (Object.keys(INVARIANTS) as InvariantId[]).map((id) => [
      id,
      overrides[id] ?? {
        title: INVARIANTS[id],
        assertions: [runtime({ id: `${id}.something`, title: 'holds', run: noop })],
        pending: [],
      },
    ]),
  ) as Record<InvariantId, InvariantEntry>;
  return { invariants, claims: {} };
}

describe('stateOf', () => {
  test('partial when assertions and pending entries both exist', () => {
    expect(
      stateOf({
        assertions: [runtime({ id: 'I1.x', title: 'x', run: noop })],
        pending: [pending({ id: 'I1.y', owner: 'P2', reason: 'later' })],
      }),
    ).toBe('partial');
  });
  test('asserted only when assertions exist and nothing is pending', () => {
    expect(stateOf({ assertions: [runtime({ id: 'I1.x', title: 'x', run: noop })], pending: [] })).toBe('asserted');
  });
  test('pending when only pending entries exist', () => {
    expect(stateOf({ assertions: [], pending: [pending({ id: 'I1.y', owner: 'P2', reason: 'later' })] })).toBe('pending');
  });
  test('missing when there is nothing', () => {
    expect(stateOf({ assertions: [], pending: [] })).toBe('missing');
  });
});

describe('evaluateRegistry', () => {
  test('a sound registry has no problems and counts its states', () => {
    const evaluation = evaluateRegistry(fullRegistry());
    expect(evaluation.problems).toEqual([]);
    expect(evaluation.counts).toMatchObject({ asserted: 10, partial: 0, pending: 0, missing: 0, assertions: 10 });
  });

  test('an invariant with assertions and pending entries is partial, not asserted', () => {
    const evaluation = evaluateRegistry(
      fullRegistry({
        I1: {
          title: INVARIANTS.I1,
          assertions: [runtime({ id: 'I1.type-level', title: 'x', run: noop })],
          pending: [pending({ id: 'I1.mount-layer-enforcement', owner: 'P2', reason: 'no provider until P2' })],
        },
      }),
    );
    expect(evaluation.problems).toEqual([]);
    expect(evaluation.invariants.find((r) => r.id === 'I1')?.state).toBe('partial');
    expect(evaluation.counts).toMatchObject({ asserted: 9, partial: 1, pending: 0, missing: 0 });
  });

  test('an invariant with neither assertions nor pending entries is missing', () => {
    const evaluation = evaluateRegistry(fullRegistry({ I3: { title: 'x', assertions: [], pending: [] } }));
    expect(evaluation.invariants.find((r) => r.id === 'I3')?.state).toBe('missing');
    expect(evaluation.counts.missing).toBe(1);
    expect(evaluation.problems).toContain('I3: missing (no assertion and no pending owner)');
  });

  test('an unregistered invariant is rejected even when the record is cast around the type', () => {
    const registry = fullRegistry();
    const { I7: _dropped, ...rest } = registry.invariants;
    const broken = { invariants: rest, claims: {} } as unknown as Registry;
    const evaluation = evaluateRegistry(broken);
    expect(evaluation.problems).toContain('I7: not registered');
    expect(evaluation.invariants.find((r) => r.id === 'I7')?.state).toBe('missing');
  });

  test('a key that is not an invariant is rejected', () => {
    const registry = fullRegistry();
    const broken = {
      invariants: { ...registry.invariants, I11: { title: 'x', assertions: [], pending: [] } },
      claims: {},
    } as unknown as Registry;
    expect(evaluateRegistry(broken).problems).toContain('I11: not an invariant');
  });

  test('a pending entry needs a known owner and a reason', () => {
    const registry = fullRegistry({
      I4: {
        title: 'x',
        assertions: [],
        pending: [{ id: 'I4.later', owner: 'Q9' as 'P1', reason: '' }],
      },
    });
    const { problems } = evaluateRegistry(registry);
    expect(problems).toContain('I4.later: owner Q9 is not a unit');
    expect(problems).toContain('I4.later: pending without a reason');
  });

  test('assertion ids must carry their invariant prefix and be unique', () => {
    const registry = fullRegistry({
      I5: {
        title: 'x',
        assertions: [
          runtime({ id: 'I6.wrong-home', title: 'x', run: noop }),
          runtime({ id: 'I5.twice', title: 'x', run: noop }),
          runtime({ id: 'I5.twice', title: 'x', run: noop }),
        ],
        pending: [],
      },
    });
    const { problems } = evaluateRegistry(registry);
    expect(problems).toContain('I5: assertion I6.wrong-home does not carry the I5 prefix');
    expect(problems).toContain('I5.twice: registered twice (I5 and I5)');
  });

  test('capability claims are evaluated like invariants', () => {
    const registry: Registry = {
      ...fullRegistry(),
      claims: {
        'driver.subagents': { assertions: [], pending: [pending({ id: 'driver.subagents', owner: 'P5', reason: 'no driver yet' })] },
        'sandbox.gpu': { assertions: [], pending: [] },
      },
    };
    const evaluation = evaluateRegistry(registry);
    expect(evaluation.claims.map((c) => [c.id, c.state])).toEqual([
      ['driver.subagents', 'pending'],
      ['sandbox.gpu', 'missing'],
    ]);
    expect(evaluation.problems).toContain('sandbox.gpu: missing (no assertion and no pending owner)');
  });
});

describe('pending baseline', () => {
  const FILE = 'packages/conformance/pending-baseline.json';
  const owe = (id: `${InvariantId}.${string}` | `driver.${string}`, owner: 'P1' | 'P4' | 'P5' = 'P1') =>
    pending({ id, owner, reason: 'later' });

  /** The baseline a registry currently satisfies exactly, with overrides. */
  function baselineFor(registry: Registry, overrides: Record<string, number> = {}): PendingBaseline {
    return {
      invariants: Object.fromEntries(INVARIANT_IDS.map((id) => [id, overrides[id] ?? registry.invariants[id].pending.length])),
      claims: Object.fromEntries(Object.entries(registry.claims).map(([id, e]) => [id, overrides[id] ?? e.pending.length])),
    };
  }

  test('a pending count above its baseline is a problem that names the file to edit', () => {
    const registry = fullRegistry({
      I3: { title: 'x', assertions: [], pending: [owe('I3.a', 'P1'), owe('I3.b', 'P4')] },
    });
    const evaluation = evaluateRegistry(registry, { baseline: baselineFor(registry, { I3: 1 }) });
    expect(evaluation.problems).toEqual([`I3: pending count 2 exceeds baseline 1; raise it deliberately in ${FILE}`]);
    expect(evaluation.invariants.find((r) => r.id === 'I3')).toMatchObject({ baseline: 1 });
  });

  test('a count equal to its baseline is not a problem', () => {
    const registry = fullRegistry({ I3: { title: 'x', assertions: [], pending: [owe('I3.a')] } });
    expect(evaluateRegistry(registry, { baseline: baselineFor(registry) }).problems).toEqual([]);
  });

  test('a count below its baseline is allowed, and the report shows the delta', () => {
    const registry = fullRegistry();
    const evaluation = evaluateRegistry(registry, { baseline: baselineFor(registry, { I1: 2 }) });
    expect(evaluation.problems).toEqual([]);
    const report = formatReport(evaluation);
    expect(report).toContain('I1   asserted');
    expect(report).toContain('pending 0 (baseline 2, -2)');
    expect(report).toContain('Pending entries: 0 (baseline 2, -2)');
  });

  test('the report shows the baseline beside a count that matches it and marks one that exceeds it', () => {
    const registry = fullRegistry({
      I1: { title: INVARIANTS.I1, assertions: [runtime({ id: 'I1.x', title: 'x', run: noop })], pending: [owe('I1.later', 'P4')] },
      I2: { title: INVARIANTS.I2, assertions: [runtime({ id: 'I2.x', title: 'x', run: noop })], pending: [owe('I2.later', 'P4')] },
    });
    const report = formatReport(evaluateRegistry(registry, { baseline: baselineFor(registry, { I2: 0 }) }));
    expect(report).toContain('pending 1 -> P4 (baseline 1)');
    expect(report).toContain('pending 1 -> P4 (baseline 0, +1 EXCEEDS)');
    expect(report).toContain('Pending entries: 2 (baseline 1, +1 EXCEEDS)');
  });

  test('every registry entry needs a baseline entry, and every baseline entry needs a registry entry', () => {
    const registry: Registry = {
      ...fullRegistry(),
      claims: { 'driver.subagents': { assertions: [], pending: [owe('driver.subagents', 'P5')] } },
    };
    const { I5: _dropped, ...invariants } = baselineFor(registry).invariants;
    const evaluation = evaluateRegistry(registry, {
      baseline: { invariants: { ...invariants, I11: 0 }, claims: { 'driver.ghost': 0 } },
    });
    expect(evaluation.problems).toEqual(
      expect.arrayContaining([
        `I5: no entry in ${FILE}`,
        `driver.subagents: no entry in ${FILE}`,
        `I11: in ${FILE} but not in the registry`,
        `driver.ghost: in ${FILE} but not in the registry`,
      ]),
    );
  });

  test('capability claims are ratcheted like invariants', () => {
    const registry: Registry = {
      ...fullRegistry(),
      claims: { 'driver.subagents': { assertions: [], pending: [owe('driver.subagents', 'P5')] } },
    };
    const evaluation = evaluateRegistry(registry, { baseline: baselineFor(registry, { 'driver.subagents': 0 }) });
    expect(evaluation.problems).toEqual([`driver.subagents: pending count 1 exceeds baseline 0; raise it deliberately in ${FILE}`]);
    expect(evaluation.claims[0]).toMatchObject({ baseline: 0 });
  });

  test('without a baseline nothing is ratcheted and no baseline is reported', () => {
    const evaluation = evaluateRegistry(fullRegistry());
    expect(evaluation.invariants.every((r) => r.baseline === undefined)).toBe(true);
    expect(evaluation.counts.pendingBaseline).toBeUndefined();
    expect(formatReport(evaluation)).not.toContain('baseline');
  });
});

describe('external assertions', () => {
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'conformance-external-'));
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
    const pkg = join(root, 'packages', 'sandbox');
    mkdirSync(join(pkg, 'test'), { recursive: true });
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@olympus-ai/sandbox', types: './src/index.ts' }));
    writeFileSync(
      join(pkg, 'test', 'mount.test.ts'),
      `invariantTest('I1.mount-rejects-second-rw', 'a second rw mount is refused', () => {});\n`,
    );
  });
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const ref = (id: `I1.${string}`, file = 'test/mount.test.ts', pkg = '@olympus-ai/sandbox') =>
    external({ id, title: 'x', level: 'runtime', package: pkg, file });

  test('verifies when the package, file, and id are all present', () => {
    expect(verifyExternalAssertion(ref('I1.mount-rejects-second-rw'), root)).toBeUndefined();
  });
  test('fails for an unknown package', () => {
    expect(verifyExternalAssertion(ref('I1.mount-rejects-second-rw', 'test/mount.test.ts', '@olympus-ai/nope'), root)).toContain(
      'not in the workspace',
    );
  });
  test('fails for a missing file', () => {
    expect(verifyExternalAssertion(ref('I1.mount-rejects-second-rw', 'test/gone.test.ts'), root)).toContain('does not exist');
  });
  test('fails when the file does not register the id', () => {
    expect(verifyExternalAssertion(ref('I1.something-else'), root)).toContain('does not register that id');
  });
  test('a broken external assertion is a registry problem', () => {
    const registry = fullRegistry({ I1: { title: 'x', assertions: [ref('I1.absent')], pending: [] } });
    expect(evaluateRegistry(registry, { root }).problems).toEqual([
      'I1.absent: packages/sandbox/test/mount.test.ts does not register that id',
    ]);
  });
});

describe('validateAssertionId', () => {
  test('accepts invariant and claim ids', () => {
    expect(() => {
      validateAssertionId('I10.greek-free');
    }).not.toThrow();
    expect(() => {
      validateAssertionId('driver.subagents');
    }).not.toThrow();
  });
  test('rejects an invariant that does not exist', () => {
    expect(() => {
      validateAssertionId('I11.anything');
    }).toThrow("'I11' is not an invariant");
  });
  test('rejects malformed ids', () => {
    expect(() => {
      validateAssertionId('I2');
    }).toThrow('not an assertion id');
    expect(() => {
      validateAssertionId('I2.Has Spaces');
    }).toThrow('not an assertion id');
  });
});

describe('formatReport', () => {
  test('names every pending entry with its owner and prints the counts', () => {
    const registry = fullRegistry({
      I1: {
        title: INVARIANTS.I1,
        assertions: [runtime({ id: 'I1.type-level', title: 'x', run: noop })],
        pending: [pending({ id: 'I1.mount-layer-enforcement', owner: 'P2', reason: 'no provider until P2' })],
      },
    });
    const report = formatReport(evaluateRegistry(registry));
    expect(report).toContain('I1   partial');
    expect(report).toContain('I2   asserted');
    expect(report).toContain('pending 1 -> P2');
    expect(report).toContain('P2  I1.mount-layer-enforcement');
    expect(report).toContain('no provider until P2');
    expect(report).toContain('Pending entries: 1');
    expect(report).toContain('asserted: 9  partial: 1  pending: 0  missing: 0');
  });
  test('lists problems when there are any', () => {
    const report = formatReport(evaluateRegistry(fullRegistry({ I9: { title: 'x', assertions: [], pending: [] } })));
    expect(report).toContain('I9   missing');
    expect(report).toContain('Problems');
  });
});
