// I5: a station can only require capabilities the driver contract declares,
// so "the driver lacks a required capability" is always decidable and a
// misspelt requirement cannot be silently unsatisfiable.
import type { StationContract } from '@olympus-ai/core';

declare const station: StationContract;

export const declared: StationContract = { ...station, requires: ['subagents', 'steering'] };
export const undeclared: StationContract = { ...station, requires: ['telepathy'] }; // expect-error TS2322: Type '"telepathy"' is not assignable to type
export const misspelt: StationContract = { ...station, requires: ['subAgents'] }; // expect-error TS2820: Type '"subAgents"' is not assignable to type 'keyof DriverCapabilities'
