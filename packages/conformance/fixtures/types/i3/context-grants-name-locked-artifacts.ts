// I3: a station is granted the locked spec and the locked acceptance tests.
// The grant vocabulary has no entry for the mutable form of either, so a
// contract cannot show an agent the artifact it will be judged by in a form
// it could edit.
import type { ContextGrant } from '@olympus-ai/core';

export const lockedSpec: ContextGrant = 'locked-spec';
export const acceptanceTests: ContextGrant = 'acceptance-tests';
export const mutableSpec: ContextGrant = 'spec'; // expect-error TS2322: Type '"spec"' is not assignable to type 'ContextGrant'
export const workspaceSpec: ContextGrant = 'workspace-spec'; // expect-error TS2322: Type '"workspace-spec"' is not assignable to type 'ContextGrant'
export const editableTests: ContextGrant = 'tests'; // expect-error TS2322: Type '"tests"' is not assignable to type 'ContextGrant'
