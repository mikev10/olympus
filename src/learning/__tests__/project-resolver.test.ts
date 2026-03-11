import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'path';
import { mkdirSync, rmSync, existsSync } from 'fs';

const { execSync: mockExecSync } = vi.hoisted(() => ({
  execSync: vi.fn(),
}));

vi.mock('child_process', () => ({
  execSync: mockExecSync,
}));

const { loadSessionState: mockLoadSessionState, saveSessionState: mockSaveSessionState } = vi.hoisted(() => ({
  loadSessionState: vi.fn(),
  saveSessionState: vi.fn(),
}));

vi.mock('../session-state.js', () => ({
  loadSessionState: mockLoadSessionState,
  saveSessionState: mockSaveSessionState,
}));

const { mkdirShouldThrowEACCES } = vi.hoisted(() => ({ mkdirShouldThrowEACCES: { value: false } }));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    mkdirSync: (...args: Parameters<typeof actual.mkdirSync>) => {
      if (mkdirShouldThrowEACCES.value) {
        const err = new Error('Permission denied') as NodeJS.ErrnoException;
        err.code = 'EACCES';
        throw err;
      }
      return actual.mkdirSync(...args);
    },
  };
});

import {
  deriveProjectSlug,
  resolveProjectRoot,
  getProjectScopedDir,
  ensureProjectDir,
  getTestProjectDir,
} from '../project-resolver.js';

const TEST_LEARNING_DIR = join(process.cwd(), '.test-project-resolver-learning-' + Date.now());
const dirsToCleanup: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  mkdirShouldThrowEACCES.value = false;
  process.env.OLYMPUS_TEST_LEARNING_DIR = TEST_LEARNING_DIR;
  mkdirSync(TEST_LEARNING_DIR, { recursive: true });
});

afterEach(() => {
  delete process.env.OLYMPUS_TEST_LEARNING_DIR;
  vi.restoreAllMocks();

  for (const dir of dirsToCleanup) {
    rmSync(dir, { recursive: true, force: true });
  }
  dirsToCleanup.length = 0;

  rmSync(TEST_LEARNING_DIR, { recursive: true, force: true });

  const cwd = process.cwd();
  try {
    const entries: string[] = require('fs').readdirSync(cwd);
    for (const entry of entries) {
      if (entry.startsWith('.test-project-')) {
        rmSync(join(cwd, entry), { recursive: true, force: true });
      }
    }
  } catch {
  }
});

describe('deriveProjectSlug', () => {
  it('returns slug for a normal path', () => {
    const slug = deriveProjectSlug('/home/dev/my-project');
    expect(slug).toMatch(/^my-project-[a-f0-9]{8}$/);
  });

  it('sanitizes special characters in basename', () => {
    const slug = deriveProjectSlug('/home/dev/My Project!');
    expect(slug).toMatch(/^my-project-[a-f0-9]{8}$/);
  });

  it('handles root path /', () => {
    const slug = deriveProjectSlug('/');
    expect(slug).toMatch(/^root-[a-f0-9]{8}$/);
  });

  it('handles Windows root C:\\', () => {
    const slug = deriveProjectSlug('C:\\');
    expect(slug).toMatch(/^root-[a-f0-9]{8}$/);
  });

  it('handles drive letter only C:', () => {
    const slug = deriveProjectSlug('C:');
    expect(slug).toMatch(/^root-[a-f0-9]{8}$/);
  });

  it('returns unknown when basename is all special chars', () => {
    const slug = deriveProjectSlug('/home/dev/___');
    expect(slug).toMatch(/^unknown-[a-f0-9]{8}$/);
  });

  it('truncates long basenames to 30 chars before hash', () => {
    const longName = 'a'.repeat(40);
    const slug = deriveProjectSlug(`/home/dev/${longName}`);
    const fullNamePart = slug.substring(0, slug.lastIndexOf('-'));
    expect(fullNamePart.length).toBeLessThanOrEqual(30);
    expect(slug).toMatch(/-[a-f0-9]{8}$/);
  });

  it('is deterministic — same input always gives same output', () => {
    const path = '/home/dev/my-project';
    expect(deriveProjectSlug(path)).toBe(deriveProjectSlug(path));
  });

  it('produces different slugs for different paths', () => {
    const slug1 = deriveProjectSlug('/home/dev/project-a');
    const slug2 = deriveProjectSlug('/home/dev/project-b');
    expect(slug1).not.toBe(slug2);
  });

  it('matches expected format /^[a-z0-9][a-z0-9-]*-[a-f0-9]{8}$/', () => {
    const slug = deriveProjectSlug('/home/dev/my-project');
    expect(slug).toMatch(/^[a-z0-9][a-z0-9-]*-[a-f0-9]{8}$/);
  });
});

describe('resolveProjectRoot', () => {
  it('returns cached value from session state without calling execSync', () => {
    mockLoadSessionState.mockReturnValue({ resolved_project_root: '/cached/path' });

    const result = resolveProjectRoot('/some/dir');

    expect(result).toBe('/cached/path');
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it('calls execSync on cache miss and saves result to state', () => {
    const state = { resolved_project_root: null };
    mockLoadSessionState.mockReturnValue(state);
    mockExecSync.mockReturnValue('/git/root\n');

    const result = resolveProjectRoot('/some/dir');

    expect(mockExecSync).toHaveBeenCalledWith('git rev-parse --show-toplevel', expect.objectContaining({
      cwd: '/some/dir',
      encoding: 'utf-8',
    }));
    expect(result).toMatch(/git[/\\]root/);
    expect(mockSaveSessionState).toHaveBeenCalledWith('/some/dir', expect.objectContaining({
      resolved_project_root: expect.any(String),
    }));
  });

  it('falls back to resolve(directory) when git fails', () => {
    const state = { resolved_project_root: null };
    mockLoadSessionState.mockReturnValue(state);
    mockExecSync.mockImplementation(() => { throw new Error('git not found'); });

    const result = resolveProjectRoot('/fallback/dir');

    expect(result).toContain('fallback');
    expect(mockSaveSessionState).toHaveBeenCalled();
  });

  it('falls back gracefully on git timeout', () => {
    const state = { resolved_project_root: null };
    mockLoadSessionState.mockReturnValue(state);
    const timeoutErr = new Error('Command failed');
    (timeoutErr as NodeJS.ErrnoException).code = 'ETIMEDOUT';
    mockExecSync.mockImplementation(() => { throw timeoutErr; });

    const result = resolveProjectRoot('/timeout/dir');

    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('falls back gracefully when git is not found (ENOENT)', () => {
    const state = { resolved_project_root: null };
    mockLoadSessionState.mockReturnValue(state);
    const enoentErr = new Error('spawn git ENOENT');
    (enoentErr as NodeJS.ErrnoException).code = 'ENOENT';
    mockExecSync.mockImplementation(() => { throw enoentErr; });

    const result = resolveProjectRoot('/no-git/dir');

    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('always returns an absolute normalized path', () => {
    const state = { resolved_project_root: null };
    mockLoadSessionState.mockReturnValue(state);
    mockExecSync.mockReturnValue('/absolute/path\n');

    const result = resolveProjectRoot('/some/dir');

    expect(result).toMatch(/^([A-Za-z]:[/\\]|\/)/);
  });
});

describe('getProjectScopedDir', () => {
  it('returns path under getLearningDir()/projects/{slug}', () => {
    const dir = getProjectScopedDir('/home/dev/my-project');
    expect(dir).toContain('projects');
    expect(dir).toMatch(/my-project-[a-f0-9]{8}/);
  });

  it('respects OLYMPUS_TEST_LEARNING_DIR env var', () => {
    const dir = getProjectScopedDir('/home/dev/my-project');
    expect(dir.startsWith(TEST_LEARNING_DIR)).toBe(true);
  });
});

describe('ensureProjectDir', () => {
  it('creates the project directory', () => {
    const testDir = join(process.cwd(), '.test-project-ensure-' + Date.now());
    dirsToCleanup.push(testDir);
    process.env.OLYMPUS_TEST_LEARNING_DIR = testDir;

    ensureProjectDir('/home/dev/test-ensure-project');

    const expectedDir = getProjectScopedDir('/home/dev/test-ensure-project');
    expect(existsSync(expectedDir)).toBe(true);
  });

  it('does not throw when directory already exists (idempotent)', () => {
    ensureProjectDir('/home/dev/idempotent-project');
    expect(() => ensureProjectDir('/home/dev/idempotent-project')).not.toThrow();
  });

  it('logs error on failure without throwing', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mkdirShouldThrowEACCES.value = true;

    expect(() => ensureProjectDir('/home/dev/no-permission')).not.toThrow();
    expect(errorSpy).toHaveBeenCalledWith('Failed to create project directory:', expect.any(Error));

    mkdirShouldThrowEACCES.value = false;
    errorSpy.mockRestore();
  });
});

describe('getTestProjectDir', () => {
  it('creates a directory with .test-project- prefix', () => {
    const dir = getTestProjectDir('my-test');
    dirsToCleanup.push(dir);

    expect(dir).toContain('.test-project-my-test');
    expect(existsSync(dir)).toBe(true);
  });

  it('returns a string path', () => {
    const dir = getTestProjectDir('string-test');
    dirsToCleanup.push(dir);
    expect(typeof dir).toBe('string');
  });

  it('is idempotent — calling twice does not throw', () => {
    const dir = getTestProjectDir('idempotent-test');
    dirsToCleanup.push(dir);
    expect(() => getTestProjectDir('idempotent-test')).not.toThrow();
  });
});
