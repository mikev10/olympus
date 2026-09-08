// I8: the registry type is total over InvariantId and closed over owners and
// claim families. Leaving an invariant out, naming one that does not exist,
// owing an assertion to a unit that does not exist, or filing a claim outside
// driver.* / sandbox.* is a compile error before the meta-test runs.
import { defineRegistry } from '../../../src/kit/registry.js';

const entry = { title: 'x', assertions: [], pending: [] };

export const complete = defineRegistry({
  invariants: { I1: entry, I2: entry, I3: entry, I4: entry, I5: entry, I6: entry, I7: entry, I8: entry, I9: entry, I10: entry },
  claims: {},
});

export const incomplete = defineRegistry({
  invariants: { I1: entry, I2: entry, I3: entry, I4: entry, I5: entry, I6: entry, I7: entry, I8: entry, I9: entry }, // expect-error TS2741: Property 'I10' is missing
  claims: {},
});

export const invented = defineRegistry({
  invariants: { I1: entry, I2: entry, I3: entry, I4: entry, I5: entry, I6: entry, I7: entry, I8: entry, I9: entry, I10: entry, I11: entry }, // expect-error TS2353: 'I11' does not exist in type
  claims: {},
});

export const unknownOwner = defineRegistry({
  invariants: {
    I1: { title: 'x', assertions: [], pending: [{ id: 'I1.later', owner: 'Q9', reason: 'x' }] }, // expect-error TS2322: Type '"Q9"' is not assignable to type 'UnitId'
    I2: entry, I3: entry, I4: entry, I5: entry, I6: entry, I7: entry, I8: entry, I9: entry, I10: entry,
  },
  claims: {},
});

export const strayClaim = defineRegistry({
  invariants: { I1: entry, I2: entry, I3: entry, I4: entry, I5: entry, I6: entry, I7: entry, I8: entry, I9: entry, I10: entry },
  claims: { 'vault.encryption': { assertions: [], pending: [] } }, // expect-error TS2353: does not exist in type 'Readonly<Record<ClaimId, ClaimEntry>>'
});
