/**
 * `invariantTest`: how a package other than this one contributes an
 * assertion to the registry. The test name carries the assertion id, and the
 * registry lists it as an external assertion pointing at the file; the
 * meta-test verifies that the file names the id.
 *
 *     invariantTest('I1.mount-rejects-second-rw', 'a second rw mount is refused', async () => { ... });
 */
import { test } from 'vitest';
import { INVARIANT_IDS, type AssertionId, type ClaimId, type InvariantId } from './types.js';

const ID_SHAPE = /^(I\d+|driver|sandbox)\.[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Throws unless `id` names a real invariant or claim family and a kebab-case assertion. */
export function validateAssertionId(id: string): asserts id is AssertionId | ClaimId {
  const match = ID_SHAPE.exec(id);
  if (match === null) {
    throw new Error(`conformance: '${id}' is not an assertion id (expected I<n>.<kebab-name>, driver.<name>, or sandbox.<name>)`);
  }
  const family = match[1] ?? '';
  if (family.startsWith('I') && !INVARIANT_IDS.includes(family as InvariantId)) {
    throw new Error(`conformance: '${family}' is not an invariant`);
  }
}

export function invariantTest(id: string, title: string, fn: () => void | Promise<void>): void {
  validateAssertionId(id);
  test(`[${id}] ${title}`, fn);
}
