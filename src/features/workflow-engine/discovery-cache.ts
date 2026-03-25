import * as path from 'path';
import * as fs from 'fs-extra';
import { getGitHeadSha, getChangedFilesSince, isGitAvailable } from './git-utils.js';
import type { WorkspaceScanResult } from './brownfield-scanner.js';
import { scanWorkspace } from './brownfield-scanner.js';

const CACHE_SCHEMA_VERSION = '1.0';
const CACHE_DIR = path.join('.olympus', 'cache');
const CACHE_FILENAME = 'discovery-cache.json';
const CACHE_MAX_AGE_DAYS = 7;

export interface DiscoveryCacheManifest {
  schemaVersion: string;
  toolVersion: string;
  createdAt: string;
  updatedAt: string;
  gitSha: string | null;
  fileTimestamps: Record<string, number>;
  cachedArtifacts: string[];
  sourceFileCount: number;
  agentsMdStatus?: 'present' | 'absent' | 'stale';
}

function getCachePath(projectPath: string): string {
  return path.join(projectPath, CACHE_DIR, CACHE_FILENAME);
}

export async function readCacheManifest(
  projectPath: string
): Promise<DiscoveryCacheManifest | null> {
  const cachePath = getCachePath(projectPath);
  try {
    const raw = await fs.readFile(cachePath, 'utf-8');
    const parsed = JSON.parse(raw) as DiscoveryCacheManifest;
    if (!parsed.schemaVersion || !parsed.createdAt) {
      console.warn('[DiscoveryCache] Manifest missing required fields — treating as cache miss');
      return null;
    }
    return parsed;
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      'code' in err &&
      (err as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return null;
    }
    console.warn('[DiscoveryCache] Failed to read/parse cache manifest — treating as cache miss:', err);
    return null;
  }
}

export async function writeCacheManifest(
  projectPath: string,
  manifest: DiscoveryCacheManifest
): Promise<void> {
  const cachePath = getCachePath(projectPath);
  await fs.ensureDir(path.dirname(cachePath));
  await fs.writeFile(cachePath, JSON.stringify(manifest, null, 2), 'utf-8');
}

export async function isCacheStale(
  projectPath: string,
  manifest: DiscoveryCacheManifest,
  currentToolVersion?: string
): Promise<{ stale: boolean; reason?: string; changedFiles?: string[] }> {
  if (manifest.schemaVersion !== CACHE_SCHEMA_VERSION) {
    return { stale: true, reason: 'schema-version-mismatch' };
  }

  // Tool version check: stale if manifest was created by a different Olympus version
  if (currentToolVersion && manifest.toolVersion && manifest.toolVersion !== currentToolVersion) {
    return { stale: true, reason: 'tool-version-mismatch' };
  }

  // Age check: stale if cache is older than CACHE_MAX_AGE_DAYS
  const cacheAge = Date.now() - new Date(manifest.updatedAt).getTime();
  const maxAgeMs = CACHE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  if (cacheAge > maxAgeMs) {
    return { stale: true, reason: 'cache-too-old' };
  }

  const gitAvailable = await isGitAvailable(projectPath);

  if (!gitAvailable) {
    console.warn('[DiscoveryCache] Git unavailable — staleness check using file timestamps only');
    return checkTimestampStaleness(manifest);
  }

  const currentSha = await getGitHeadSha(projectPath);

  if (currentSha === null) {
    console.warn('[DiscoveryCache] Could not read HEAD SHA — falling back to timestamps');
    return checkTimestampStaleness(manifest);
  }

  if (manifest.gitSha === null) {
    return { stale: true, reason: 'no-cached-sha' };
  }

  if (currentSha !== manifest.gitSha) {
    const changedFiles = await getChangedFilesSince(projectPath, manifest.gitSha);
    return { stale: true, reason: 'git-sha-changed', changedFiles };
  }

  return { stale: false };
}

function checkTimestampStaleness(
  manifest: DiscoveryCacheManifest
): { stale: boolean; reason?: string } {
  const timestamps = manifest.fileTimestamps;
  if (!timestamps || Object.keys(timestamps).length === 0) {
    return { stale: true, reason: 'no-timestamps' };
  }

  for (const [filePath, cachedMtime] of Object.entries(timestamps)) {
    if (cachedMtime === 0) {
      return { stale: true, reason: `invalidated:${filePath}` };
    }
    try {
      const stat = require('fs').statSync(filePath);
      if (stat.mtimeMs !== cachedMtime) {
        return { stale: true, reason: `timestamp-changed:${filePath}` };
      }
    } catch {
      return { stale: true, reason: `file-missing:${filePath}` };
    }
  }

  return { stale: false };
}

export async function clearCache(projectPath: string): Promise<void> {
  const cacheDir = path.join(projectPath, CACHE_DIR);
  await fs.remove(cacheDir);
}

export async function invalidateCacheForModules(
  projectPath: string,
  affectedPaths: string[]
): Promise<void> {
  const manifest = await readCacheManifest(projectPath);
  if (!manifest) return;

  const updated: DiscoveryCacheManifest = {
    ...manifest,
    updatedAt: new Date().toISOString(),
    fileTimestamps: { ...manifest.fileTimestamps },
  };

  for (const p of affectedPaths) {
    updated.fileTimestamps[p] = 0;
  }

  await writeCacheManifest(projectPath, updated);
}

export async function incrementalRescan(
  projectPath: string,
  changedFiles: string[],
  existingResult: WorkspaceScanResult
): Promise<WorkspaceScanResult> {
  if (changedFiles.length === 0) {
    return existingResult;
  }

  try {
    const changedDirs = new Set(
      changedFiles.map((f) => path.dirname(path.resolve(projectPath, f)))
    );

    const freshResult = await scanWorkspace(projectPath);

    const merged: WorkspaceScanResult = {
      ...existingResult,
      totalFiles: freshResult.totalFiles,
      sourceFiles: freshResult.sourceFiles,
      largestFilesByDirectory: { ...existingResult.largestFilesByDirectory },
      importGraph: existingResult.importGraph.filter(
        (edge) =>
          !changedFiles.some(
            (f) =>
              edge.sourceFile.endsWith(f) || edge.importedModule.endsWith(f)
          )
      ),
    };

    for (const dir of changedDirs) {
      const relDir = path.relative(projectPath, dir);
      if (freshResult.largestFilesByDirectory[relDir] !== undefined) {
        merged.largestFilesByDirectory[relDir] =
          freshResult.largestFilesByDirectory[relDir];
      } else {
        delete merged.largestFilesByDirectory[relDir];
      }
    }

    const newEdges = freshResult.importGraph.filter((edge) =>
      changedFiles.some(
        (f) => edge.sourceFile.endsWith(f) || edge.importedModule.endsWith(f)
      )
    );

    merged.importGraph = [...merged.importGraph, ...newEdges];

    return merged;
  } catch (err) {
    console.error('[DiscoveryCache] Incremental rescan failed — returning existing result:', err);
    return existingResult;
  }
}

export function buildInitialManifest(
  gitSha: string | null,
  scanResult: WorkspaceScanResult,
  fileTimestamps: Record<string, number>,
  agentsMdStatus?: 'present' | 'absent' | 'stale',
  toolVersion?: string
): DiscoveryCacheManifest {
  const now = new Date().toISOString();
  return {
    schemaVersion: CACHE_SCHEMA_VERSION,
    toolVersion: toolVersion || 'unknown',
    createdAt: now,
    updatedAt: now,
    gitSha,
    fileTimestamps,
    cachedArtifacts: ['workspace-scan'],
    sourceFileCount: scanResult.sourceFiles,
    agentsMdStatus,
  };
}
