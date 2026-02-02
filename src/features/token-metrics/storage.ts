import { join } from 'path';
import { existsSync, mkdirSync, appendFileSync, readFileSync, renameSync, readdirSync, unlinkSync, statSync } from 'fs';
import type { TokenMetricsEntry } from './types.js';

/** Maximum lines before rotating JSONL files */
const MAX_JSONL_LINES = 10000;

/** Get token metrics storage directory (project-specific) */
export function getTokenMetricsDir(projectPath: string): string {
  return join(projectPath, '.olympus');
}

/** Get token metrics archive directory */
export function getTokenMetricsArchiveDir(projectPath: string): string {
  return join(projectPath, '.olympus', 'archives');
}

/** Ensure token metrics directories exist */
export function ensureTokenMetricsDirs(projectPath: string): void {
  const metricsDir = getTokenMetricsDir(projectPath);
  if (!existsSync(metricsDir)) {
    mkdirSync(metricsDir, { recursive: true });
  }

  const archiveDir = getTokenMetricsArchiveDir(projectPath);
  if (!existsSync(archiveDir)) {
    mkdirSync(archiveDir, { recursive: true });
  }
}

/** Rotate JSONL file if it exceeds size threshold */
function rotateIfNeeded(filePath: string, projectPath: string, maxLines: number = MAX_JSONL_LINES): void {
  if (!existsSync(filePath)) return;

  try {
    const content = readFileSync(filePath, 'utf-8');
    const lineCount = content.split('\n').filter(l => l.trim()).length;

    if (lineCount >= maxLines) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const archiveDir = getTokenMetricsArchiveDir(projectPath);
      const archivePath = join(archiveDir, `token-metrics-${timestamp}.jsonl`);

      renameSync(filePath, archivePath);
      console.log(`[Olympus Token Metrics] Archived ${lineCount} entries to ${archivePath}`);
    }
  } catch (error) {
    console.error(`[Olympus Token Metrics] Failed to rotate ${filePath}:`, error);
    // Don't throw - rotation failures should not block appending
  }
}

/** Log a token metric entry */
export async function logTokenMetric(entry: TokenMetricsEntry, projectPath?: string): Promise<void> {
  // Use project path from entry if not provided
  const path = projectPath || entry.project_path || process.cwd();

  ensureTokenMetricsDirs(path);
  const logPath = join(getTokenMetricsDir(path), 'token-metrics.jsonl');

  // Rotate before appending
  rotateIfNeeded(logPath, path);

  appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf-8');
}

/** Read token metrics from JSONL file */
export async function readTokenMetrics(projectPath?: string, limit?: number): Promise<TokenMetricsEntry[]> {
  const path = projectPath || process.cwd();
  const logPath = join(getTokenMetricsDir(path), 'token-metrics.jsonl');

  if (!existsSync(logPath)) return [];

  try {
    const content = readFileSync(logPath, 'utf-8');
    const entries = content
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line) as TokenMetricsEntry);

    if (limit && limit > 0) {
      return entries.slice(-limit); // Return last N entries
    }

    return entries;
  } catch (error) {
    console.error(`[Olympus Token Metrics] Failed to read ${logPath}:`, error);
    return [];
  }
}

/** Read all token metrics including archived files */
export async function readAllTokenMetrics(projectPath?: string): Promise<TokenMetricsEntry[]> {
  const path = projectPath || process.cwd();
  const allEntries: TokenMetricsEntry[] = [];

  // Read current file
  const currentEntries = await readTokenMetrics(path);
  allEntries.push(...currentEntries);

  // Read archived files
  const archiveDir = getTokenMetricsArchiveDir(path);
  if (existsSync(archiveDir)) {
    try {
      const archiveFiles = readdirSync(archiveDir)
        .filter(f => f.startsWith('token-metrics-') && f.endsWith('.jsonl'))
        .sort(); // Chronological order

      for (const file of archiveFiles) {
        const archivePath = join(archiveDir, file);
        try {
          const content = readFileSync(archivePath, 'utf-8');
          const entries = content
            .split('\n')
            .filter(line => line.trim())
            .map(line => JSON.parse(line) as TokenMetricsEntry);
          allEntries.push(...entries);
        } catch (error) {
          console.error(`[Olympus Token Metrics] Failed to read archive ${file}:`, error);
        }
      }
    } catch (error) {
      console.error(`[Olympus Token Metrics] Failed to read archive directory:`, error);
    }
  }

  return allEntries;
}

/** Clean up old metrics files beyond retention period */
export async function cleanupOldMetrics(daysToKeep: number, projectPath?: string): Promise<void> {
  const path = projectPath || process.cwd();
  const archiveDir = getTokenMetricsArchiveDir(path);

  if (!existsSync(archiveDir)) return;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

  try {
    const archiveFiles = readdirSync(archiveDir)
      .filter(f => f.startsWith('token-metrics-') && f.endsWith('.jsonl'));

    let deletedCount = 0;

    for (const file of archiveFiles) {
      const filePath = join(archiveDir, file);
      try {
        const stats = statSync(filePath);
        if (stats.mtime < cutoffDate) {
          unlinkSync(filePath);
          deletedCount++;
        }
      } catch (error) {
        console.error(`[Olympus Token Metrics] Failed to process ${file}:`, error);
      }
    }

    if (deletedCount > 0) {
      console.log(`[Olympus Token Metrics] Cleaned up ${deletedCount} old archive files`);
    }
  } catch (error) {
    console.error(`[Olympus Token Metrics] Failed to cleanup old metrics:`, error);
  }
}
