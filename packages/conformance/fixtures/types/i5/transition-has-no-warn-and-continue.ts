// I5: a station transition either advances or refuses with a reason from a
// closed set, and a refusal carries the typed payload its reason names. There
// is no shape for "advanced, with a warning" or "advanced, degraded", a
// refusal cannot invent a softer reason, and it cannot be prose alone: the
// message is for people, the payload beside it is what a machine reads. An
// advance also names the approval grant it spent, or null; an advance that
// says nothing about the grant is not representable (A-P4-04).
import type { ModelFamily, StationTransition, TaskId } from '@olympus-ai/core';

declare const task: TaskId;

export const advance: StationTransition = { ok: true, next: 'build', spends: null };
export const spending: StationTransition = { ok: true, next: 'verify', spends: 'build:1' };

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

export const approvalRequired: StationTransition = {
  ok: false,
  reason: 'approval-required',
  key: 'integrate:2',
  message: 'integrate at L2 needs a human approval, and none is recorded',
};

export const sameFamily: StationTransition = {
  ok: false,
  reason: 'same-family-reviewer',
  task,
  family: 'claude' as ModelFamily,
  message: 'the reviewer shares the author family claude, and L3 does not seat it',
};

export const parked: StationTransition = { ok: false, reason: 'parked', task, cause: 'retries-exhausted', limit: 2, message: 'retried twice' };

export const warned: StationTransition = { ok: true, next: 'build', spends: null, warnings: ['suite shrank'] }; // expect-error TS2353: 'warnings' does not exist in type
export const degraded: StationTransition = { ok: true, next: 'build', spends: null, degraded: true }; // expect-error TS2353: 'degraded' does not exist in type
export const soft: StationTransition = { ok: false, reason: 'warning', message: 'suite shrank' }; // expect-error TS2322: Type '"warning"' is not assignable to type
export const skipped: StationTransition = { ok: false, reason: 'skipped', message: 'no adapter' }; // expect-error TS2322: Type '"skipped"' is not assignable to type
export const proseOnly: StationTransition = { ok: false, reason: 'gate-failed', message: 'typecheck failed' }; // expect-error TS2322: Property 'failed' is missing
export const wrongPayload: StationTransition = { ok: false, reason: 'lock-tamper', failed: [], message: 'spec.md changed' }; // expect-error TS2353: 'failed' does not exist in type
export const noMessage: StationTransition = { ok: false, reason: 'gate-failed', failed: [] }; // expect-error TS2322: Property 'message' is missing
export const vagueCause: StationTransition = { ok: false, reason: 'parked', task, cause: 'gave up', limit: 2, message: 'gave up' }; // expect-error TS2322: Type '"gave up"' is not assignable to type 'ParkCause'
export const approvalAsWarning: StationTransition = { ok: true, next: 'observe', spends: null, approval: 'human-required' }; // expect-error TS2353: 'approval' does not exist in type
// An advance says which grant it spent, or that it spent none; silence is not representable (A-P4-04).
export const silentAdvance: StationTransition = { ok: true, next: 'build' }; // expect-error TS2322: Property 'spends' is missing
export const keylessApproval: StationTransition = { ok: false, reason: 'approval-blocked', message: 'blocked' }; // expect-error TS2322: Property 'key' is missing
