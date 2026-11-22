import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Reads one file as text; a parameter only so a test can hand it one that fails. */
export type TextReader = (path: string) => Promise<string>;

const readText: TextReader = (path) => readFile(path, 'utf8');

/**
 * Every file under `dir`, read as text. A file that cannot be read rejects
 * the call (I5, #93): a negative check over this text, such as "the Vault does
 * not hold the token", would otherwise pass on a file it never read.
 */
export async function allText(dir: string, read: TextReader = readText): Promise<string> {
  let out = '';
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) out += await read(join(entry.parentPath, entry.name));
  }
  return out;
}
