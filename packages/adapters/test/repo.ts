/**
 * Throwaway repositories for the suites: each is written into a fresh
 * temporary directory, so no fixture file in this package is itself a test
 * file some runner would pick up.
 */
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const made: string[] = [];

export async function repo(files: Readonly<Record<string, string>>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'adapters-'));
  made.push(root);
  await write(root, files);
  return root;
}

export async function write(root: string, files: Readonly<Record<string, string>>): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    const file = join(root, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, text);
  }
}

/**
 * Links a directory. A junction on Windows, which needs no privilege and
 * which `lstat` reports as a symbolic link, so every link suite runs on every
 * host rather than skipping where file links are not allowed.
 */
export async function linkDirectory(target: string, path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await symlink(target, path, process.platform === 'win32' ? 'junction' : 'dir');
}

export async function cleanup(): Promise<void> {
  while (made.length > 0) {
    const root = made.pop();
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  }
}

export function pkg(devDependencies: Readonly<Record<string, string>>, extra: Readonly<Record<string, unknown>> = {}): string {
  return JSON.stringify({ name: 'fixture', version: '0.0.0', devDependencies, ...extra });
}
