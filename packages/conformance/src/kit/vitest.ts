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

/** An invariant assertion: `I<n>.` and a kebab-case name. */
const INVARIANT_SHAPE = /^(I\d+)\.[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * A capability claim: `driver.` or `sandbox.` and a capability key exactly as
 * the interface spells it.
 *
 * Not kebab-case, unlike an invariant assertion. A claim id is held equal to
 * `keyof DriverCapabilities` and `keyof SandboxCapabilities` by a generated
 * compile-ok fixture (`I8.claim-keys-registered`), and those keys are
 * camelCase — `computerUse`, `stablePrefixCaching`. Requiring kebab-case here
 * would mean no claim id could ever be written, which went unnoticed until P5
 * became the first package to contribute one from its own suite.
 */
const CLAIM_SHAPE = /^(driver|sandbox)\.[a-z][A-Za-z0-9]*$/;

/** Throws unless `id` names a real invariant assertion or a capability claim. */
export function validateAssertionId(id: string): asserts id is AssertionId | ClaimId {
  if (CLAIM_SHAPE.test(id)) return;
  const match = INVARIANT_SHAPE.exec(id);
  if (match === null) {
    throw new Error(
      `conformance: '${id}' is not an assertion id (expected I<n>.<kebab-name>, or driver.<capabilityKey> / sandbox.<capabilityKey>)`,
    );
  }
  const family = match[1] ?? '';
  if (!INVARIANT_IDS.includes(family as InvariantId)) {
    throw new Error(`conformance: '${family}' is not an invariant`);
  }
}

export function invariantTest(id: string, title: string, fn: () => void | Promise<void>): void {
  validateAssertionId(id);
  test(`[${id}] ${title}`, fn);
}
