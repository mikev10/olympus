// I5: a station transition either advances or refuses with a reason from a
// closed set. There is no shape for "advanced, with a warning" or "advanced,
// degraded", and a refusal cannot invent a softer reason.
import type { StationTransition } from '@olympus-ai/core';

export const advance: StationTransition = { ok: true, next: 'build' };
export const refuse: StationTransition = { ok: false, reason: 'gate-failed', detail: 'typecheck failed' };
export const warned: StationTransition = { ok: true, next: 'build', warnings: ['suite shrank'] }; // expect-error TS2353: 'warnings' does not exist in type
export const degraded: StationTransition = { ok: true, next: 'build', degraded: true }; // expect-error TS2353: 'degraded' does not exist in type
export const soft: StationTransition = { ok: false, reason: 'warning', detail: 'suite shrank' }; // expect-error TS2322: Type '"warning"' is not assignable to type
export const skipped: StationTransition = { ok: false, reason: 'skipped', detail: 'no adapter' }; // expect-error TS2322: Type '"skipped"' is not assignable to type
