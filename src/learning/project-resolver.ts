import { resolve, normalize, basename, join } from 'path';
import { execSync } from 'child_process';
import { mkdirSync } from 'fs';
import { createHash } from 'crypto';
import { getLearningDir } from './storage.js';
import { loadSessionState, saveSessionState } from './session-state.js';

export function resolveProjectRoot(directory: string): string {
  const state = loadSessionState(directory);

  if (state.resolved_project_root !== null) {
    return state.resolved_project_root;
  }

  let root: string;
  try {
    const result = execSync('git rev-parse --show-toplevel', {
      cwd: directory,
      encoding: 'utf-8',
      timeout: 2000,
      stdio: 'pipe',
    });
    root = resolve(normalize(result.trim()));
  } catch {
    root = resolve(directory);
  }

  state.resolved_project_root = root;
  saveSessionState(directory, state);

  return root;
}

export function deriveProjectSlug(canonicalPath: string): string {
  let name = basename(canonicalPath);

  if (!name || /^[A-Za-z]:[\\/]?$/.test(canonicalPath) || /^[A-Za-z]:$/.test(name)) {
    name = 'root';
  }

  let sanitized = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 30);

  if (!sanitized) {
    sanitized = 'unknown';
  }

  const hash8 = createHash('sha256').update(canonicalPath).digest('hex').substring(0, 8);

  return `${sanitized}-${hash8}`;
}

export function getProjectScopedDir(canonicalPath: string): string {
  return join(getLearningDir(), 'projects', deriveProjectSlug(canonicalPath));
}

export function ensureProjectDir(canonicalPath: string): void {
  try {
    mkdirSync(getProjectScopedDir(canonicalPath), { recursive: true });
  } catch (error: unknown) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== 'EEXIST') {
      console.error('Failed to create project directory:', error);
    }
  }
}

export function getTestProjectDir(testName: string): string {
  const dir = join(process.cwd(), '.test-project-' + testName);
  mkdirSync(dir, { recursive: true });
  return dir;
}
