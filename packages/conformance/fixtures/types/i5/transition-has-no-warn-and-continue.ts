// I5: a station transition either advances or refuses with a reason from a
// closed set, and a refusal carries the typed payload its reason names. There
// is no shape for "advanced, with a warning" or "advanced, degraded", a
// refusal cannot invent a softer reason, and it cannot be prose alone: the
// message is for people, the payload beside it is what a machine reads.
import type { StationTransition } from '@olympus-ai/core';

export const advance: StationTransition = { ok: true, next: 'build' };

export const gateFailed: StationTransition = {
  ok: false,
  reason: 'gate-failed',
  failed: [
    { checkId: 'typecheck', exitCode: 2, cause: 'exit-code' },
    { checkId: 'unit', exitCode: null, cause: 'no-result' },
  ],
  message: 'typecheck: exit code 2; unit: no result',
};

export const lockTamper: StationTransition = {
  ok: false,
  reason: 'lock-tamper',
  tampered: [{ path: 'spec.md', expected: 'a1', actual: 'b2' }],
  message: 'spec.md changed after the lock',
};

export const unsafe: StationTransition = {
  ok: false,
  reason: 'unsafe-above-l1',
  components: ['StubVault', 'SkeletonLine'],
  message: 'L2 requested; StubVault and SkeletonLine cannot enforce their contracts',
};

export const warned: StationTransition = { ok: true, next: 'build', warnings: ['suite shrank'] }; // expect-error TS2353: 'warnings' does not exist in type
export const degraded: StationTransition = { ok: true, next: 'build', degraded: true }; // expect-error TS2353: 'degraded' does not exist in type
export const soft: StationTransition = { ok: false, reason: 'warning', message: 'suite shrank' }; // expect-error TS2322: Type '"warning"' is not assignable to type
export const skipped: StationTransition = { ok: false, reason: 'skipped', message: 'no adapter' }; // expect-error TS2322: Type '"skipped"' is not assignable to type
export const proseOnly: StationTransition = { ok: false, reason: 'gate-failed', message: 'typecheck failed' }; // expect-error TS2322: Property 'failed' is missing
export const wrongPayload: StationTransition = { ok: false, reason: 'lock-tamper', failed: [], message: 'spec.md changed' }; // expect-error TS2353: 'failed' does not exist in type
export const noMessage: StationTransition = { ok: false, reason: 'gate-failed', failed: [] }; // expect-error TS2322: Property 'message' is missing
