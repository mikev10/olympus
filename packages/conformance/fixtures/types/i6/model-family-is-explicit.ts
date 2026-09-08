// I6: ModelFamily is branded. A driver cannot pass a plain string, its own
// id, the provider, or the model name as the family by accident; it has to
// assign the family on purpose, with a cast that a reviewer can see.
import type { Driver, ModelFamily, ModelIdentity } from '@olympus-ai/core';

declare const identity: ModelIdentity;
declare const driver: Driver;

export const plain: ModelFamily = 'claude'; // expect-error TS2322: is not assignable to type 'ModelFamily'
export const fromModel: ModelFamily = identity.model; // expect-error TS2322: Type 'string' is not assignable to type 'ModelFamily'
export const fromProvider: ModelFamily = identity.provider; // expect-error TS2322: Type 'string' is not assignable to type 'ModelFamily'
export const fromDriverId: ModelFamily = driver.id; // expect-error TS2322: Type 'string' is not assignable to type 'ModelFamily'
export const inferred: ModelIdentity = { ...identity, family: driver.id }; // expect-error TS2322: Type 'string' is not assignable to type 'ModelFamily'
export const explicit: ModelIdentity = { ...identity, family: 'claude' as ModelFamily };
