/**
 * How a path inside one tree is made to resolve into another. Windows grants
 * a directory junction without elevation and withholds a symlink; POSIX has
 * no junctions and takes the symlink. Both reach the same `realpath` in the
 * mount layer, which is the thing under test.
 *
 * Chosen by platform, never skipped and never wrapped in a catch: a mount
 * layer whose escape check silently goes unexercised on a platform is worse
 * than one with no check, because the suite reports it as covered. The
 * mechanism appears in each test's name so a CI log says which one ran.
 */
import { symlink } from 'node:fs/promises';

export const ESCAPE_MECHANISM: 'junction' | 'symlink' = process.platform === 'win32' ? 'junction' : 'symlink';

/** Creates `link` pointing at `target`, by whichever mechanism this platform grants. */
export async function linkTo(target: string, link: string): Promise<void> {
  await symlink(target, link, ESCAPE_MECHANISM === 'junction' ? 'junction' : 'dir');
}
