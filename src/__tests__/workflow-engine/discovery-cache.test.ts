import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs-extra';
import * as os from 'os';

vi.mock('../../features/workflow-engine/git-utils.js', () => ({
  getGitHeadSha: vi.fn(),
  getChangedFilesSince: vi.fn(),
  isGitAvailable: vi.fn(),
}));

vi.mock('../../features/workflow-engine/brownfield-scanner.js', () => ({
  scanWorkspace: vi.fn(),
}));

import {
  readCacheManifest,
  writeCacheManifest,
  isCacheStale,
  clearCache,
  invalidateCacheForModules,
  incrementalRescan,
  buildInitialManifest,
} from '../../features/workflow-engine/discovery-cache.js';
import type { DiscoveryCacheManifest } from '../../features/workflow-engine/discovery-cache.js';
import { getGitHeadSha, isGitAvailable, getChangedFilesSince } from '../../features/workflow-engine/git-utils.js';
import { scanWorkspace } from '../../features/workflow-engine/brownfield-scanner.js';
import type { WorkspaceScanResult } from '../../features/workflow-engine/brownfield-scanner.js';

const mockGetGitHeadSha = getGitHeadSha as ReturnType<typeof vi.fn>;
const mockIsGitAvailable = isGitAvailable as ReturnType<typeof vi.fn>;
const mockGetChangedFilesSince = getChangedFilesSince as ReturnType<typeof vi.fn>;
const mockScanWorkspace = scanWorkspace as ReturnType<typeof vi.fn>;

let tmpDir: string;

function makeManifest(overrides: Partial<DiscoveryCacheManifest> = {}): DiscoveryCacheManifest {
  return {
    schemaVersion: '1.0',
    toolVersion: '4.4.18',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    gitSha: 'abc123',
    fileTimestamps: {},
    cachedArtifacts: ['workspace-scan'],
    sourceFileCount: 42,
    ...overrides,
  };
}

function makeWorkspaceScanResult(overrides: Partial<WorkspaceScanResult> = {}): WorkspaceScanResult {
  return {
    totalFiles: 10,
    sourceFiles: 8,
    directoryTree: [],
    languageDistribution: { '.ts': 8 },
    importGraph: [],
    entryPoints: [],
    largestFilesByDirectory: {},
    configFiles: [],
    ...overrides,
  };
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'discovery-cache-test-'));
  vi.clearAllMocks();
});

afterEach(async () => {
  await fs.remove(tmpDir);
  vi.restoreAllMocks();
});

describe('writeCacheManifest + readCacheManifest round-trip', () => {
  it('writes and reads back an identical manifest', async () => {
    const manifest = makeManifest({ sourceFileCount: 99 });
    await writeCacheManifest(tmpDir, manifest);
    const result = await readCacheManifest(tmpDir);
    expect(result).toEqual(manifest);
  });

  it('creates the cache directory if it does not exist', async () => {
    const manifest = makeManifest();
    await writeCacheManifest(tmpDir, manifest);
    const cachePath = path.join(tmpDir, '.olympus', 'cache', 'discovery-cache.json');
    const exists = await fs.pathExists(cachePath);
    expect(exists).toBe(true);
  });
});

describe('readCacheManifest', () => {
  it('returns null when cache file does not exist', async () => {
    const result = await readCacheManifest(tmpDir);
    expect(result).toBeNull();
  });

  it('returns null when JSON is corrupted', async () => {
    const cacheDir = path.join(tmpDir, '.olympus', 'cache');
    await fs.ensureDir(cacheDir);
    await fs.writeFile(path.join(cacheDir, 'discovery-cache.json'), '{ invalid json !!!', 'utf-8');
    const result = await readCacheManifest(tmpDir);
    expect(result).toBeNull();
  });

  it('returns null when manifest is missing required fields', async () => {
    const cacheDir = path.join(tmpDir, '.olympus', 'cache');
    await fs.ensureDir(cacheDir);
    await fs.writeFile(
      path.join(cacheDir, 'discovery-cache.json'),
      JSON.stringify({ gitSha: 'abc', fileTimestamps: {} }),
      'utf-8'
    );
    const result = await readCacheManifest(tmpDir);
    expect(result).toBeNull();
  });
});

describe('isCacheStale', () => {
  it('returns not stale when git SHA matches', async () => {
    mockIsGitAvailable.mockResolvedValue(true);
    mockGetGitHeadSha.mockResolvedValue('abc123');

    const manifest = makeManifest({ gitSha: 'abc123' });
    const result = await isCacheStale(tmpDir, manifest);
    expect(result.stale).toBe(false);
  });

  it('returns stale with reason git-sha-changed when SHA differs', async () => {
    mockIsGitAvailable.mockResolvedValue(true);
    mockGetGitHeadSha.mockResolvedValue('newsha999');
    mockGetChangedFilesSince.mockResolvedValue(['src/foo.ts']);

    const manifest = makeManifest({ gitSha: 'abc123' });
    const result = await isCacheStale(tmpDir, manifest);
    expect(result.stale).toBe(true);
    expect(result.reason).toBe('git-sha-changed');
    expect(result.changedFiles).toContain('src/foo.ts');
  });

  it('returns stale when schema version does not match', async () => {
    const manifest = makeManifest({ schemaVersion: '0.9' });
    const result = await isCacheStale(tmpDir, manifest);
    expect(result.stale).toBe(true);
    expect(result.reason).toBe('schema-version-mismatch');
  });

  it('returns stale with no-cached-sha when manifest.gitSha is null', async () => {
    mockIsGitAvailable.mockResolvedValue(true);
    mockGetGitHeadSha.mockResolvedValue('abc123');

    const manifest = makeManifest({ gitSha: null });
    const result = await isCacheStale(tmpDir, manifest);
    expect(result.stale).toBe(true);
    expect(result.reason).toBe('no-cached-sha');
  });

  it('falls back to timestamps when git is unavailable and returns stale for empty timestamps', async () => {
    mockIsGitAvailable.mockResolvedValue(false);

    const manifest = makeManifest({ gitSha: 'abc123', fileTimestamps: {} });
    const result = await isCacheStale(tmpDir, manifest);
    expect(result.stale).toBe(true);
    expect(result.reason).toBe('no-timestamps');
  });

  it('falls back to timestamps when HEAD SHA cannot be read', async () => {
    mockIsGitAvailable.mockResolvedValue(true);
    mockGetGitHeadSha.mockResolvedValue(null);

    const manifest = makeManifest({ gitSha: 'abc123', fileTimestamps: {} });
    const result = await isCacheStale(tmpDir, manifest);
    expect(result.stale).toBe(true);
  });

  it('returns stale when a timestamp entry is marked as invalidated (mtime=0)', async () => {
    mockIsGitAvailable.mockResolvedValue(false);

    const manifest = makeManifest({
      gitSha: 'abc123',
      fileTimestamps: { 'src/foo.ts': 0 },
    });
    const result = await isCacheStale(tmpDir, manifest);
    expect(result.stale).toBe(true);
  });

  it('returns stale with reason tool-version-mismatch when tool version differs', async () => {
    const manifest = makeManifest({ toolVersion: '4.3.0' });
    const result = await isCacheStale(tmpDir, manifest, '4.4.18');
    expect(result.stale).toBe(true);
    expect(result.reason).toBe('tool-version-mismatch');
  });

  it('returns stale with reason cache-too-old when updatedAt is older than 7 days', async () => {
    mockIsGitAvailable.mockResolvedValue(true);
    mockGetGitHeadSha.mockResolvedValue('abc123');

    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const manifest = makeManifest({ gitSha: 'abc123', updatedAt: eightDaysAgo });
    const result = await isCacheStale(tmpDir, manifest);
    expect(result.stale).toBe(true);
    expect(result.reason).toBe('cache-too-old');
  });

  it('does not flag tool-version-mismatch when currentToolVersion is not provided', async () => {
    mockIsGitAvailable.mockResolvedValue(true);
    mockGetGitHeadSha.mockResolvedValue('abc123');

    const manifest = makeManifest({ toolVersion: '4.3.0', gitSha: 'abc123' });
    const result = await isCacheStale(tmpDir, manifest);
    expect(result.stale).toBe(false);
  });
});

describe('clearCache', () => {
  it('removes the .olympus/cache directory', async () => {
    const manifest = makeManifest();
    await writeCacheManifest(tmpDir, manifest);

    const cacheDir = path.join(tmpDir, '.olympus', 'cache');
    expect(await fs.pathExists(cacheDir)).toBe(true);

    await clearCache(tmpDir);

    expect(await fs.pathExists(cacheDir)).toBe(false);
  });

  it('does not throw when cache directory does not exist', async () => {
    await expect(clearCache(tmpDir)).resolves.not.toThrow();
  });
});

describe('invalidateCacheForModules', () => {
  it('marks affected paths with mtime=0 and leaves untouched paths unchanged', async () => {
    const manifest = makeManifest({
      fileTimestamps: {
        'src/foo.ts': 1000,
        'src/bar.ts': 2000,
        'src/baz.ts': 3000,
      },
    });
    await writeCacheManifest(tmpDir, manifest);

    await invalidateCacheForModules(tmpDir, ['src/foo.ts', 'src/bar.ts']);

    const updated = await readCacheManifest(tmpDir);
    expect(updated).not.toBeNull();
    expect(updated!.fileTimestamps['src/foo.ts']).toBe(0);
    expect(updated!.fileTimestamps['src/bar.ts']).toBe(0);
    expect(updated!.fileTimestamps['src/baz.ts']).toBe(3000);
  });

  it('updates updatedAt to a more recent timestamp', async () => {
    const before = new Date().toISOString();
    const manifest = makeManifest({
      updatedAt: '2020-01-01T00:00:00.000Z',
      fileTimestamps: { 'src/a.ts': 111 },
    });
    await writeCacheManifest(tmpDir, manifest);

    await invalidateCacheForModules(tmpDir, ['src/a.ts']);

    const updated = await readCacheManifest(tmpDir);
    expect(updated!.updatedAt >= before).toBe(true);
  });

  it('does nothing if no cache manifest exists', async () => {
    await expect(
      invalidateCacheForModules(tmpDir, ['src/foo.ts'])
    ).resolves.not.toThrow();
  });
});

describe('incrementalRescan', () => {
  it('returns existingResult unchanged when changedFiles is empty', async () => {
    const existing = makeWorkspaceScanResult({ totalFiles: 5 });
    const result = await incrementalRescan(tmpDir, [], existing);
    expect(result).toBe(existing);
  });

  it('merges fresh scan totals and replaces edges for changed files', async () => {
    const freshResult = makeWorkspaceScanResult({
      totalFiles: 20,
      sourceFiles: 15,
      largestFilesByDirectory: { src: ['new-largest.ts'] },
      importGraph: [{ sourceFile: 'src/foo.ts', importedModule: './bar.js' }],
    });
    mockScanWorkspace.mockResolvedValue(freshResult);

    const existing = makeWorkspaceScanResult({
      totalFiles: 10,
      sourceFiles: 8,
      largestFilesByDirectory: {
        src: ['old-largest.ts'],
        lib: ['helper.ts'],
      },
      importGraph: [
        { sourceFile: 'src/other.ts', importedModule: './utils.js' },
        { sourceFile: 'src/foo.ts', importedModule: './old-dep.js' },
      ],
    });

    const result = await incrementalRescan(tmpDir, ['src/foo.ts'], existing);

    expect(result.totalFiles).toBe(20);
    expect(result.sourceFiles).toBe(15);

    const fooEdges = result.importGraph.filter((e) => e.sourceFile === 'src/foo.ts');
    expect(fooEdges).toHaveLength(1);
    expect(fooEdges[0].importedModule).toBe('./bar.js');

    const otherEdges = result.importGraph.filter((e) => e.sourceFile === 'src/other.ts');
    expect(otherEdges).toHaveLength(1);
  });

  it('returns existing result when scanWorkspace throws', async () => {
    mockScanWorkspace.mockRejectedValue(new Error('scan failed'));
    const existing = makeWorkspaceScanResult({ totalFiles: 7 });

    const result = await incrementalRescan(tmpDir, ['src/changed.ts'], existing);
    expect(result).toEqual(existing);
  });
});

describe('buildInitialManifest', () => {
  it('includes agentsMdStatus=present when passed', () => {
    const scanResult = makeWorkspaceScanResult({ sourceFiles: 10 });
    const manifest = buildInitialManifest('sha123', scanResult, {}, 'present');
    expect(manifest.agentsMdStatus).toBe('present');
  });

  it('includes agentsMdStatus=absent when passed', () => {
    const scanResult = makeWorkspaceScanResult({ sourceFiles: 5 });
    const manifest = buildInitialManifest('sha123', scanResult, {}, 'absent');
    expect(manifest.agentsMdStatus).toBe('absent');
  });

  it('leaves agentsMdStatus undefined when not passed', () => {
    const scanResult = makeWorkspaceScanResult({ sourceFiles: 5 });
    const manifest = buildInitialManifest('sha123', scanResult, {});
    expect(manifest.agentsMdStatus).toBeUndefined();
  });

  it('sets sourceFileCount from scanResult.sourceFiles', () => {
    const scanResult = makeWorkspaceScanResult({ sourceFiles: 42 });
    const manifest = buildInitialManifest(null, scanResult, {});
    expect(manifest.sourceFileCount).toBe(42);
  });

  it('preserves round-trip through write/read with agentsMdStatus', async () => {
    const scanResult = makeWorkspaceScanResult({ sourceFiles: 7 });
    const manifest = buildInitialManifest('sha456', scanResult, {}, 'stale');
    await writeCacheManifest(tmpDir, manifest);
    const result = await readCacheManifest(tmpDir);
    expect(result?.agentsMdStatus).toBe('stale');
  });

  it('sets toolVersion when provided', () => {
    const scanResult = makeWorkspaceScanResult({ sourceFiles: 10 });
    const manifest = buildInitialManifest('sha123', scanResult, {}, 'present', '4.4.18');
    expect(manifest.toolVersion).toBe('4.4.18');
  });

  it('defaults toolVersion to unknown when not provided', () => {
    const scanResult = makeWorkspaceScanResult({ sourceFiles: 10 });
    const manifest = buildInitialManifest('sha123', scanResult, {});
    expect(manifest.toolVersion).toBe('unknown');
  });
});
