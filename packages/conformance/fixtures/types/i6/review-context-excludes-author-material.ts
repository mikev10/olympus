// I6: a review seat is never granted the author's narrative or the plan the
// work was built to. A reviewer handed the author's account grades the
// account. The contract table's type excludes both grants from review;
// granting either does not compile.
import type { StationContractTable } from '@olympus-ai/core';

declare const table: StationContractTable;

export const facts: StationContractTable = { ...table, review: { ...table.review, allowedContext: ['locked-spec', 'acceptance-tests', 'diff', 'evidence-bundle'] } };
export const narrative: StationContractTable = { ...table, review: { ...table.review, allowedContext: ['diff', 'author-narrative'] } }; // expect-error TS2322: Type '"author-narrative"' is not assignable to type
export const plan: StationContractTable = { ...table, review: { ...table.review, allowedContext: ['plan', 'evidence-bundle'] } }; // expect-error TS2322: Type '"plan"' is not assignable to type
