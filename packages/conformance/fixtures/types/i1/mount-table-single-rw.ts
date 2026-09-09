// I1 at the substrate, restated: at most one mount is rw, and if one is, it is
// the workspace. `others` is ro by type, so a second rw mount has no slot to
// occupy; the workspace itself may be ro, which is how verification runs
// against a tree the checks cannot modify (I3). A table that mounts anything
// but the workspace writable does not typecheck.
import type { MountTable } from '@olympus-ai/sandbox';

/** Build: the one rw mount is the workspace. */
export const buildTable: MountTable = {
  workspace: { source: '/host/work', target: '/work', mode: 'rw' },
  others: [{ source: '/host/base', target: '/base', mode: 'ro' }],
};

/** Verification: the workspace is ro too, so no mount is writable. */
export const verifyTable: MountTable = {
  workspace: { source: '/host/work', target: '/work', mode: 'ro' },
  others: [{ source: '/host/base', target: '/base', mode: 'ro' }],
};

/** The one rw mount is not the workspace: refused. */
export const writableOtherMount: MountTable = {
  workspace: { source: '/host/work', target: '/work', mode: 'ro' },
  others: [{ source: '/host/vault', target: '/vault', mode: 'rw' }], // expect-error TS2322: Type '"rw"' is not assignable to type '"ro"'
};

/** Two rw mounts: the second has nowhere to go. */
export const twoWritableMounts: MountTable = {
  workspace: { source: '/host/work', target: '/work', mode: 'rw' },
  others: [
    { source: '/host/base', target: '/base', mode: 'ro' },
    { source: '/host/vault', target: '/vault', mode: 'rw' }, // expect-error TS2322: Type '"rw"' is not assignable to type '"ro"'
  ],
};

/** A mode outside the union is refused on the workspace as anywhere else. */
export const unknownMode: MountTable = {
  workspace: { source: '/host/work', target: '/work', mode: 'append' }, // expect-error TS2322: Type '"append"' is not assignable to type
  others: [],
};
