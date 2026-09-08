// I1 at the substrate: the workspace is the only rw mount and every other
// mount is ro. A table that mounts anything else writable does not typecheck.
import type { MountTable } from '@olympus-ai/sandbox';

export const workspaceOnly: MountTable = {
  workspace: { source: '/host/work', target: '/work', mode: 'rw' },
  others: [{ source: '/host/base', target: '/base', mode: 'ro' }],
};

export const readOnlyWorkspace: MountTable = {
  workspace: { source: '/host/work', target: '/work', mode: 'ro' }, // expect-error TS2322: Type '"ro"' is not assignable to type '"rw"'
  others: [],
};

export const writableSecondMount: MountTable = {
  workspace: { source: '/host/work', target: '/work', mode: 'rw' },
  others: [{ source: '/host/vault', target: '/vault', mode: 'rw' }], // expect-error TS2322: Type '"rw"' is not assignable to type '"ro"'
};
