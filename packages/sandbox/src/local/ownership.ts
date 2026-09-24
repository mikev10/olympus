/**
 * Whether a user can create entries in a directory, from its owner, group,
 * and mode alone. Internal to the local provider; not part of the package's
 * exports.
 *
 * Creating an entry takes both write and search permission on the directory,
 * from the one class the user falls in. Write alone lets nothing be created:
 * a directory at `0600` rejects every entry its own owner tries to make in it
 * (codex-8).
 */
export interface DirectoryFacts {
  readonly uid: number;
  readonly gid: number;
  readonly mode: number;
}

export function canCreateIn(directory: DirectoryFacts, user: { readonly uid: number; readonly gid: number }): boolean {
  const bits = directory.uid === user.uid ? 0o300 : directory.gid === user.gid ? 0o030 : 0o003;
  return (directory.mode & bits) === bits;
}
