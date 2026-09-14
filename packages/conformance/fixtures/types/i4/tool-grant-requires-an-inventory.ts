// I4 / D-P3-04: validateToolGrants cannot be called without the inventory of
// tools a driver actually offers. The parameter has no default and is not
// optional, so a caller cannot reach the function's easy path: there is none.
// A validator callable with no inventory validates nothing, and the whole
// point of checking a grant against what exists is lost the moment the check
// can be skipped by omission.
import { validateToolGrants, type Policy } from '@olympus-ai/core';

declare const policy: Policy;

// The supported call: a policy and the inventory it is checked against.
export const checked = validateToolGrants(policy, ['read', 'write']);

// An empty inventory is a legitimate argument — it refuses every grant at run
// time (I4.empty-inventory-refuses-every-grant). It must compile, because the
// refusal it produces is the behaviour under test there.
export const emptyInventory = validateToolGrants(policy, []);

export const noInventory = validateToolGrants(policy); // expect-error TS2554: Expected 2 arguments, but got 1
export const undefinedInventory = validateToolGrants(policy, undefined); // expect-error TS2345: Argument of type 'undefined' is not assignable to parameter of type 'readonly string[]'
