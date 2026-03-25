import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getGitHeadSha, getChangedFilesSince, isGitAvailable, getFileLastModified, isFileStale } from '../../features/workflow-engine/git-utils.js';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('node:util', () => ({
  promisify: (fn: unknown) => fn,
}));

import { execFile } from 'node:child_process';

const mockExecFile = execFile as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getGitHeadSha', () => {
  it('returns the SHA when git rev-parse succeeds', async () => {
    mockExecFile.mockResolvedValueOnce({ stdout: 'abc123def456\n', stderr: '' });
    const sha = await getGitHeadSha('/some/project');
    expect(sha).toBe('abc123def456');
  });

  it('returns null when stdout is empty', async () => {
    mockExecFile.mockResolvedValueOnce({ stdout: '   \n', stderr: '' });
    const sha = await getGitHeadSha('/some/project');
    expect(sha).toBeNull();
  });

  it('returns null when git command throws (non-git directory)', async () => {
    mockExecFile.mockRejectedValueOnce(new Error('not a git repository'));
    const sha = await getGitHeadSha('/not/a/git/repo');
    expect(sha).toBeNull();
  });

  it('returns null on any unexpected error', async () => {
    mockExecFile.mockRejectedValueOnce(new Error('ENOENT: git not found'));
    const sha = await getGitHeadSha('/some/path');
    expect(sha).toBeNull();
  });
});

describe('getChangedFilesSince', () => {
  it('returns list of changed files', async () => {
    mockExecFile.mockResolvedValueOnce({
      stdout: 'src/foo.ts\nsrc/bar.ts\n',
      stderr: '',
    });
    const files = await getChangedFilesSince('/some/project', 'deadbeef');
    expect(files).toEqual(['src/foo.ts', 'src/bar.ts']);
  });

  it('returns empty array when no files changed', async () => {
    mockExecFile.mockResolvedValueOnce({ stdout: '\n', stderr: '' });
    const files = await getChangedFilesSince('/some/project', 'deadbeef');
    expect(files).toEqual([]);
  });

  it('returns empty array on error', async () => {
    mockExecFile.mockRejectedValueOnce(new Error('bad revision'));
    const files = await getChangedFilesSince('/some/project', 'invalid-sha');
    expect(files).toEqual([]);
  });

  it('filters blank lines from stdout', async () => {
    mockExecFile.mockResolvedValueOnce({
      stdout: 'src/a.ts\n\nsrc/b.ts\n',
      stderr: '',
    });
    const files = await getChangedFilesSince('/some/project', 'sha1');
    expect(files).toEqual(['src/a.ts', 'src/b.ts']);
  });
});

describe('isGitAvailable', () => {
  it('returns true when git status succeeds', async () => {
    mockExecFile.mockResolvedValueOnce({ stdout: '', stderr: '' });
    const available = await isGitAvailable('/some/project');
    expect(available).toBe(true);
  });

  it('returns false when git status throws (not a git repo)', async () => {
    mockExecFile.mockRejectedValueOnce(new Error('not a git repository'));
    const available = await isGitAvailable('/not/a/git/repo');
    expect(available).toBe(false);
  });

  it('returns false when git is not installed', async () => {
    mockExecFile.mockRejectedValueOnce(new Error('ENOENT: git not found'));
    const available = await isGitAvailable('/some/path');
    expect(available).toBe(false);
  });
});

describe('getFileLastModified', () => {
  it('returns timestamp from git log when available', async () => {
    mockExecFile.mockResolvedValueOnce({ stdout: '1700000000\n', stderr: '' });
    const ts = await getFileLastModified('/project', 'AGENTS.md');
    expect(ts).toBe(1700000000000);
  });

  it('returns null when git returns empty and file does not exist', async () => {
    mockExecFile.mockResolvedValueOnce({ stdout: '\n', stderr: '' });
    const ts = await getFileLastModified('/nonexistent', 'AGENTS.md');
    expect(ts).toBeNull();
  });

  it('returns null when git throws and file does not exist', async () => {
    mockExecFile.mockRejectedValueOnce(new Error('not a git repo'));
    const ts = await getFileLastModified('/nonexistent', 'AGENTS.md');
    expect(ts).toBeNull();
  });
});

describe('isFileStale', () => {
  it('returns true when file is older than maxAgeDays', async () => {
    const thirtyOneDaysAgo = Math.floor((Date.now() - 31 * 24 * 60 * 60 * 1000) / 1000);
    mockExecFile.mockResolvedValueOnce({ stdout: `${thirtyOneDaysAgo}\n`, stderr: '' });
    const stale = await isFileStale('/project', 'AGENTS.md', 30);
    expect(stale).toBe(true);
  });

  it('returns false when file is newer than maxAgeDays', async () => {
    const oneDayAgo = Math.floor((Date.now() - 1 * 24 * 60 * 60 * 1000) / 1000);
    mockExecFile.mockResolvedValueOnce({ stdout: `${oneDayAgo}\n`, stderr: '' });
    const stale = await isFileStale('/project', 'AGENTS.md', 30);
    expect(stale).toBe(false);
  });

  it('returns false when file cannot be checked', async () => {
    mockExecFile.mockRejectedValueOnce(new Error('no git'));
    const stale = await isFileStale('/nonexistent', 'nope.md', 30);
    expect(stale).toBe(false);
  });
});
