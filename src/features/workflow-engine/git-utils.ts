/**
 * git-utils.ts — Thin git wrapper for discovery cache staleness detection.
 *
 * All functions use execFile (not exec) to avoid shell injection.
 * All functions catch errors and return safe fallbacks.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Returns the current HEAD commit SHA, or null if git is unavailable
 * or the directory is not a git repository.
 */
export async function getGitHeadSha(projectPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
      cwd: projectPath,
      timeout: 5000,
    });
    const sha = stdout.trim();
    return sha.length > 0 ? sha : null;
  } catch {
    return null;
  }
}

/**
 * Returns the list of files changed since the given commit SHA.
 * Returns an empty array if git is unavailable or on any error.
 */
export async function getChangedFilesSince(
  projectPath: string,
  sinceCommit: string
): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['diff', '--name-only', sinceCommit],
      {
        cwd: projectPath,
        timeout: 10000,
      }
    );
    return stdout
      .trim()
      .split('\n')
      .map((f) => f.trim())
      .filter((f) => f.length > 0);
  } catch {
    return [];
  }
}

/**
 * Returns true if git is available and the project path is inside a git repository.
 * Returns false on any error or if git is not installed.
 */
export async function isGitAvailable(projectPath: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['status', '--porcelain'], {
      cwd: projectPath,
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns the last modified timestamp (in ms since epoch) of a file according to git.
 * Falls back to file system mtime if git is unavailable.
 * Returns null if the file doesn't exist or can't be read.
 */
export async function getFileLastModified(
  projectPath: string,
  filePath: string
): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['log', '-1', '--format=%at', '--', filePath],
      { cwd: projectPath, timeout: 5000 }
    );
    const timestamp = parseInt(stdout.trim(), 10);
    if (!isNaN(timestamp) && timestamp > 0) {
      return timestamp * 1000;
    }
  } catch (_) {
    void _;
  }

  try {
    const fs = await import('fs/promises');
    const nodePath = await import('path');
    const fullPath = nodePath.join(projectPath, filePath);
    const stat = await fs.stat(fullPath);
    return stat.mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Checks if a file is stale (older than maxAgeDays).
 * Returns true if the file was last modified more than maxAgeDays ago.
 * Returns false if the file is fresh or can't be checked.
 */
export async function isFileStale(
  projectPath: string,
  filePath: string,
  maxAgeDays: number = 30
): Promise<boolean> {
  const lastModified = await getFileLastModified(projectPath, filePath);
  if (lastModified === null) return false;

  const ageMs = Date.now() - lastModified;
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  return ageMs > maxAgeMs;
}
