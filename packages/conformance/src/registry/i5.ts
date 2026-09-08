import { compileError, pending } from '../kit/assert.js';
import { INVARIANTS, type InvariantEntry } from '../kit/types.js';

/** I5: Fail closed. */
export const I5: InvariantEntry = {
  title: INVARIANTS.I5,
  assertions: [
    compileError({
      id: 'I5.transition-has-no-warn-and-continue',
      title: 'StationTransition advances or refuses with a closed reason; there is no warned or degraded advance',
      fixture: 'i5/transition-has-no-warn-and-continue.ts',
    }),
    compileError({
      id: 'I5.policy-refusal-is-explicit',
      title: 'PolicyResolution and CapabilityResolution refuse with a reason and detail or succeed with the value; no downgrade marker',
      fixture: 'i5/policy-refusal-is-explicit.ts',
    }),
    compileError({
      id: 'I5.station-requires-declared-capabilities',
      title: 'StationContract.requires accepts only keys of DriverCapabilities',
      fixture: 'i5/station-requires-declared-capabilities.ts',
    }),
    compileError({
      id: 'I5.adapter-set-declares-absent-controls',
      title: 'AdapterSet slots are T | null, never optional, and unavailableControls() is required',
      fixture: 'i5/adapter-set-declares-absent-controls.ts',
    }),
    compileError({
      id: 'I5.check-result-declares-suite-count',
      title: 'CheckResult.suiteCount is required: null is a declared unknown, omission is not representable',
      fixture: 'i5/check-result-declares-suite-count.ts',
    }),
  ],
  pending: [
    pending({
      id: 'I5.over-request-refused',
      owner: 'P3',
      reason:
        'resolveAutonomy must return a PolicyRefusal, never a lower level, when the requested level exceeds ' +
        'the station cap or the global cap. Needs the engine P3 delivers.',
    }),
    pending({
      id: 'I5.missing-check-or-shrunken-suite-refuses',
      owner: 'P6',
      reason:
        'A required CheckSpec with no CheckResult, a driver lacking a required capability, or a suiteCount ' +
        'below expectedSuiteCount must fail the gate. Needs the verification runtime P6 delivers.',
    }),
    pending({
      id: 'I5.unsupported-stack-is-loud',
      owner: 'P8',
      reason:
        'AdapterSet.unavailableControls() must name every null slot for a stack, and a stack with any must ' +
        'be refused at L3. Needs the adapter implementations P8 delivers.',
    }),
  ],
};
