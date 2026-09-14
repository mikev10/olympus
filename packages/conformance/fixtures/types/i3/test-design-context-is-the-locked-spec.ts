// I3: test-design writes the acceptance tests an agent is later judged by, so
// it may be granted the locked spec and nothing else. A seat that has seen the
// plan, the repository, or the conversation writes tests of the implementation
// it expects rather than of the capability. The contract table's type holds
// test-design to exactly ['locked-spec']; widening it does not compile.
import type { StationContractTable } from '@olympus-ai/core';

declare const table: StationContractTable;

export const exact: StationContractTable = { ...table, 'test-design': { ...table['test-design'], allowedContext: ['locked-spec'] } };
export const withTests: StationContractTable = { ...table, 'test-design': { ...table['test-design'], allowedContext: ['locked-spec', 'acceptance-tests'] } }; // expect-error TS2322: is not assignable to type '["locked-spec"]'
export const withPlan: StationContractTable = { ...table, 'test-design': { ...table['test-design'], allowedContext: ['plan'] } }; // expect-error TS2322: Type '"plan"' is not assignable to type '"locked-spec"'
export const withRepo: StationContractTable = { ...table, 'test-design': { ...table['test-design'], allowedContext: ['locked-spec', 'base-repo-readonly'] } }; // expect-error TS2322: is not assignable to type '["locked-spec"]'
export const nothing: StationContractTable = { ...table, 'test-design': { ...table['test-design'], allowedContext: [] } }; // expect-error TS2322: Source has 0 element(s) but target requires 1
