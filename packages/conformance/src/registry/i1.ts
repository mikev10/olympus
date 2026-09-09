import { compileError, pending } from '../kit/assert.js';
import { INVARIANTS, type InvariantEntry } from '../kit/types.js';

/** I1: No agent writes to the Vault. */
export const I1: InvariantEntry = {
  title: INVARIANTS.I1,
  assertions: [
    compileError({
      id: 'I1.write-boundary-vault-never',
      title: 'WriteBoundary.vault admits no value but "never"',
      fixture: 'i1/write-boundary-vault-never.ts',
    }),
    compileError({
      id: 'I1.mount-table-single-rw',
      title: 'MountTable admits at most one rw mount and only in the workspace slot: every other mount is ro by type, a second rw mount has no slot, and the workspace may itself be ro',
      fixture: 'i1/mount-table-single-rw.ts',
    }),
    compileError({
      id: 'I1.vault-has-no-generic-write',
      title: 'the Vault contract exposes named mutators only; write, put, and delete do not exist',
      fixture: 'i1/vault-has-no-generic-write.ts',
    }),
  ],
  pending: [
    pending({
      id: 'I1.mount-layer-enforcement',
      owner: 'P2',
      reason:
        'The invariant is enforced at the mount layer, not in types: a SandboxProvider must refuse a MountTable ' +
        'with a second rw mount, a Vault path under any mount, or a symlink or path escape; must mount the ' +
        'workspace with the mode the table gives it, so a write inside a sandbox whose workspace is ro fails; ' +
        'and a write attempt to anything but an rw workspace from inside a provisioned sandbox must fail. ' +
        'There is no provider to run that against until P2.',
    }),
    pending({
      id: 'I1.driver-executes-inside-the-sandbox',
      owner: 'P5',
      reason:
        'TaskRequest hands a driver a SandboxHandle, and nothing in the contract lets the driver run anything inside it. ' +
        'A driver with no path into the sandbox runs the model on the host, outside the mount table where I1 is enforced. ' +
        'P5 must give the driver an exec path into the provisioned sandbox, with P2 on the provider side, and assert that ' +
        "a task's commands run inside the sandbox and nowhere else. Surfaced by S1 (docs/decisions.md, owed contract gaps).",
    }),
  ],
};
