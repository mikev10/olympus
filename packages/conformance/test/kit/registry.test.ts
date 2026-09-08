import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { external, pending, runtime } from '../../src/kit/assert.js';
import { evaluateRegistry, formatReport, stateOf, verifyExternalAssertion } from '../../src/kit/registry.js';
import { INVARIANTS, type InvariantEntry, type InvariantId, type Registry } from '../../src/kit/types.js';
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
  test('asserted when at least one assertion exists, even with pending entries', () => {
    expect(
      stateOf({
        assertions: [runtime({ id: 'I1.x', title: 'x', run: noop })],
        pending: [pending({ id: 'I1.y', owner: 'P2', reason: 'later' })],
      }),
    ).toBe('asserted');
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
    expect(evaluation.counts).toMatchObject({ asserted: 10, pending: 0, missing: 0, assertions: 10 });
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
    expect(report).toContain('I1   asserted');
    expect(report).toContain('pending 1 -> P2');
    expect(report).toContain('P2  I1.mount-layer-enforcement');
    expect(report).toContain('no provider until P2');
    expect(report).toContain('Pending entries: 1');
    expect(report).toContain('missing: 0');
  });
  test('lists problems when there are any', () => {
    const report = formatReport(evaluateRegistry(fullRegistry({ I9: { title: 'x', assertions: [], pending: [] } })));
    expect(report).toContain('I9   missing');
    expect(report).toContain('Problems');
  });
});
