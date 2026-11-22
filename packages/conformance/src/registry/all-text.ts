import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Reads one file as text; a parameter only so a test can hand it one that fails. */
export type TextReader = (path: string) => Promise<string>;

const readText: TextReader = (path) => readFile(path, 'utf8');

/**
 * Every file under `dir`, read as text. A file that cannot be read rejects
 * the call (I5, #93): a negative check over this text, such as "the Vault does
 * not hold the token", would otherwise pass on a file it never read. So does
 * any entry that is neither a file nor a directory (codex-6, gemini-4): a
 * symlink, dangling or not, is not followed and not skipped, but refused,
 * since its target is text the walk never read.
 */
export async function allText(dir: string, read: TextReader = readText): Promise<string> {
  let out = '';
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name);
    if (entry.isFile()) out += await read(path);
    else if (!entry.isDirectory()) throw new Error(`allText: ${path} is neither a file nor a directory, so its text cannot be read as part of ${dir}`);
  }
  return out;
}
