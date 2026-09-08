// I5: a stack with no adapter for a control must say so. Every slot is
// `T | null` rather than optional, and unavailableControls() is required, so
// an absent control is declared loudly instead of omitted quietly.
import type { AdapterSet } from '@olympus-ai/adapters';

declare const set: AdapterSet;

export const declared: AdapterSet = { ...set, mutation: null };

export const omitted: AdapterSet = { // expect-error TS2741: Property 'mutation' is missing
  stack: set.stack,
  test: set.test,
  coverage: set.coverage,
  behavioral: set.behavioral,
  manifest: set.manifest,
  unavailableControls: set.unavailableControls,
};

export const silent: AdapterSet = { // expect-error TS2741: Property 'unavailableControls' is missing
  stack: set.stack,
  test: set.test,
  coverage: set.coverage,
  mutation: set.mutation,
  behavioral: set.behavioral,
  manifest: set.manifest,
};

export const undefinedSlot: AdapterSet = { ...set, coverage: undefined }; // expect-error TS2322: Type 'undefined' is not assignable to type 'CoverageAdapter | null'
