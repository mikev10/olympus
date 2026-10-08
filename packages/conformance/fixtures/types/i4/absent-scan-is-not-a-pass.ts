// I4 (R1 §4): an absent scan is not a pass. The readiness term is never
// optional: a run on an unscanned repository passes `NOT_SCANNED`, an explicit
// state, and there is no `undefined` that could flow through a comparison and
// read as clearance. A level is reachable only after narrowing to a scan.
import type { AutonomyLevel, Policy, PolicyEngine, RoleId, StationId } from '@olympus-ai/core';
import { NOT_SCANNED, resolveWithReadiness, type ReadinessCeiling, type ReadinessReport } from '@olympus-ai/readiness';

declare const engine: PolicyEngine;
declare const policy: Policy;
declare const role: RoleId;
declare const station: StationId;
declare const requested: AutonomyLevel;
declare const ceiling: ReadinessCeiling;
declare const maybe: ReadinessReport | undefined;

export const unscanned = resolveWithReadiness(engine, requested, station, role, policy, NOT_SCANNED);
export const omitted = resolveWithReadiness(engine, requested, station, role, policy); // expect-error TS2554: Expected 6 arguments, but got 5
export const passedUndefined = resolveWithReadiness(engine, requested, station, role, policy, undefined); // expect-error TS2345: Argument of type 'undefined' is not assignable to parameter of type 'ReadinessCeiling'
export const fromMaybe = resolveWithReadiness(engine, requested, station, role, policy, maybe?.ceiling); // expect-error TS2345: Argument of type '{ readonly kind: "scanned"; readonly level: ScanLevel; readonly heldBy: HeldBy; readonly commit: string; } | undefined' is not assignable to parameter of type 'ReadinessCeiling'

export const unnarrowed: AutonomyLevel = ceiling.level; // expect-error TS2339: Property 'level' does not exist on type 'ReadinessCeiling'
export const narrowed: AutonomyLevel | null = ceiling.kind === 'scanned' ? ceiling.level : null;

export const grantsL3: ReadinessCeiling = { kind: 'scanned', level: 3, heldBy: { kind: 'scan-limit' }, commit: 'c' }; // expect-error TS2322: Type '3' is not assignable to type 'ScanLevel'
export const blank: ReadinessCeiling = { kind: 'scanned' }; // expect-error TS2322: is missing the following properties from type '{ readonly kind: "scanned"; readonly level: ScanLevel; readonly heldBy: HeldBy; readonly commit: string; }': level, heldBy, commit
