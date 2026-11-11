/**
 * The start-up check that the trees directory can hold a symbolic link
 * (R35, #28, #123). A run's base is copied with its links kept as links, so a
 * host that cannot create one fails mid-run, at admission, with `EPERM`. This
 * check creates and removes one file link under `FACTORY_TREES` before the
 * host listens, on every platform, so the refusal follows the capability and
 * not a guess about the operating system (I5).
 *
 * Emulating links is rejected (#28): a junction links directories only, and a
 * link stored as a file changes the content hash the locks are taken over.
 */
import { mkdir, mkdtemp, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type MakeLink = (target: string, path: string) => Promise<void>;

const fileLink: MakeLink = (target, path) => symlink(target, path, 'file');

/** Null when a link was created, read back, and removed; otherwise the refusal, naming the remedy. */
export async function probeSymlinks(trees: string, makeLink: MakeLink = fileLink): Promise<string | null> {
  let dir: string | null = null;
  try {
    await mkdir(trees, { recursive: true });
    dir = await mkdtemp(join(trees, '.symlink-probe-'));
    await writeFile(join(dir, 'target'), 'probe');
    await makeLink('target', join(dir, 'link'));
    const read = await readlink(join(dir, 'link'));
    if (read !== 'target') return `FACTORY_TREES (${trees}) does not keep a symbolic link as written: it read back ${JSON.stringify(read)}`;
    return null;
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'error';
    return [
      `FACTORY_TREES (${trees}) cannot hold a symbolic link (${code}), and every run's base is copied with its links kept.`,
      'On Windows, run the host under WSL2 (recommended), or enable Developer Mode so a process can create links;',
      'see README.md, "Supported hosts"',
    ].join(' ');
  } finally {
    if (dir !== null) await rm(dir, { recursive: true, force: true });
  }
}
