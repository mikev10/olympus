import { compileError, pending } from '../kit/assert.js';
import { INVARIANTS, type InvariantEntry } from '../kit/types.js';

/** I4: Default deny. */
export const I4: InvariantEntry = {
  title: INVARIANTS.I4,
  assertions: [
    compileError({
      id: 'I4.capability-scope-is-explicit',
      title: 'CapabilityScope requires every grant to be stated, and egress is none or an explicit list',
      fixture: 'i4/capability-scope-is-explicit.ts',
    }),
    compileError({
      id: 'I4.task-request-tools-are-required',
      title: 'TaskRequest cannot be built without the policy-granted tool list or the sandbox',
      fixture: 'i4/task-request-tools-are-required.ts',
    }),
    compileError({
      id: 'I4.compiled-role-carries-no-grants',
      title: 'CompiledRole has no field for tools, network, globs, or autonomy; policy is the only source of grants',
      fixture: 'i4/compiled-role-carries-no-grants.ts',
    }),
    compileError({
      id: 'I4.resolved-policy-is-total',
      title: 'Policy.approvals requires all forty station:level keys; only PolicyDocument may be sparse',
      fixture: 'i4/resolved-policy-is-total.ts',
    }),
  ],
  pending: [
    pending({
      id: 'I4.unlisted-capability-refused',
      owner: 'P3',
      reason:
        'PolicyEngine.resolveCapabilities must refuse a tool, station, or trigger kind the policy does not ' +
        'grant, with reason "capability-missing" or "station-forbidden". There is no engine until P3.',
    }),
    pending({
      id: 'I4.omitted-approval-is-human-required',
      owner: 'P3',
      reason:
        'PolicyEngine.resolvePolicy must resolve every approval the document omits to "human-required", ' +
        'never "auto". Asserting that needs the engine P3 delivers.',
    }),
  ],
};
