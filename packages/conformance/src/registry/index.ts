/**
 * The invariant registry. One entry per invariant, keyed by the closed
 * InvariantId union, plus one entry per capability claim. The meta-test in
 * test/registry.test.ts runs every local assertion, verifies every external
 * one, derives each entry's state, and fails CI on `missing`.
 */
import { defineRegistry } from '../kit/registry.js';
import { CLAIMS } from './claims.js';
import { I1 } from './i1.js';
import { I2 } from './i2.js';
import { I3 } from './i3.js';
import { I4 } from './i4.js';
import { I5 } from './i5.js';
import { I6 } from './i6.js';
import { I7 } from './i7.js';
import { I8 } from './i8.js';
import { I9 } from './i9.js';
import { I10 } from './i10.js';

export const REGISTRY = defineRegistry({
  invariants: { I1, I2, I3, I4, I5, I6, I7, I8, I9, I10 },
  claims: CLAIMS,
});
