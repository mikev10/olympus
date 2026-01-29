import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, readdirSync, unlinkSync, statSync } from 'fs';
import { getLearningDir, getProjectLearningDir } from './storage.js';
import type { FeedbackEntry, AgentDiscovery } from './types.js';

export interface CleanupOptions {
  dryRun?: boolean;
  ageDays?: number;
  removeArchived?: boolean;
  compactExpired?: boolean;
}

export interface CleanupResult {
  feedback_entries_removed: number;
  discoveries_removed: number;
  archived_files_removed: number;
  space_freed_mb: number;
  files_processed: string[];
}

/** Clean up old learning data */
export function cleanupLearning(
  projectPath: string,
  options: CleanupOptions = {}
): CleanupResult {
  const {
    dryRun = false,
    ageDays = 180,
    removeArchived = false,
    compactExpired = true,
  } = options;

  const result: CleanupResult = {
    feedback_entries_removed: 0,
    discoveries_removed: 0,
    archived_files_removed: 0,
    space_freed_mb: 0,
    files_processed: [],
  };

  const globalDir = getLearningDir();
  const projectDir = getProjectLearningDir(projectPath);
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - ageDays);

  // Clean feedback log
  const feedbackPath = join(globalDir, 'feedback-log.jsonl');
  if (existsSync(feedbackPath)) {
    const sizeBefore = statSync(feedbackPath).size;
    const removed = cleanupFeedbackLog(feedbackPath, cutoffDate, dryRun);
    result.feedback_entries_removed += removed;
    result.files_processed.push(feedbackPath);

    if (!dryRun && removed > 0) {
      const sizeAfter = existsSync(feedbackPath) ? statSync(feedbackPath).size : 0;
      result.space_freed_mb += (sizeBefore - sizeAfter) / (1024 * 1024);
    }
  }

  // Clean discoveries
  if (compactExpired) {
    for (const dir of [globalDir, projectDir]) {
      const discoveryPath = join(dir, 'discoveries.jsonl');
      if (existsSync(discoveryPath)) {
        const sizeBefore = statSync(discoveryPath).size;
        const removed = compactExpiredDiscoveries(discoveryPath, dryRun);
        result.discoveries_removed += removed;
        result.files_processed.push(discoveryPath);

        if (!dryRun && removed > 0) {
          const sizeAfter = existsSync(discoveryPath) ? statSync(discoveryPath).size : 0;
          result.space_freed_mb += (sizeBefore - sizeAfter) / (1024 * 1024);
        }
      }
    }
  }

  // Remove archived files
  if (removeArchived) {
    for (const dir of [globalDir, projectDir]) {
      if (existsSync(dir)) {
        const files = readdirSync(dir);
        for (const file of files) {
          if (file.endsWith('.old.jsonl') || file.includes('.backup.')) {
            const filePath = join(dir, file);
            const sizeBefore = statSync(filePath).size;
            result.archived_files_removed++;
            result.space_freed_mb += sizeBefore / (1024 * 1024);
            result.files_processed.push(filePath);

            if (!dryRun) {
              unlinkSync(filePath);
            }
          }
        }
      }
    }
  }

  result.space_freed_mb = parseFloat(result.space_freed_mb.toFixed(2));

  return result;
}

/** Clean old entries from feedback log */
function cleanupFeedbackLog(
  filePath: string,
  cutoffDate: Date,
  dryRun: boolean
): number {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());

  let removed = 0;
  const kept: string[] = [];

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as FeedbackEntry;
      const entryDate = new Date(entry.timestamp);

      if (entryDate >= cutoffDate) {
        kept.push(line);
      } else {
        removed++;
      }
    } catch {
      // Keep malformed lines
      kept.push(line);
    }
  }

  if (!dryRun && removed > 0) {
    writeFileSync(filePath, kept.join('\n') + '\n', 'utf-8');
  }

  return removed;
}

/** Remove expired discoveries from JSONL file */
function compactExpiredDiscoveries(
  filePath: string,
  dryRun: boolean
): number {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());

  let removed = 0;
  const kept: string[] = [];
  const now = new Date();

  for (const line of lines) {
    try {
      const discovery = JSON.parse(line) as AgentDiscovery;

      // Keep if no expiration or not yet expired
      if (!discovery.expires_at || new Date(discovery.expires_at) > now) {
        kept.push(line);
      } else {
        removed++;
      }
    } catch {
      // Keep malformed lines
      kept.push(line);
    }
  }

  if (!dryRun && removed > 0) {
    writeFileSync(filePath, kept.join('\n') + '\n', 'utf-8');
  }

  return removed;
}

/** Format cleanup result for console output */
export function formatCleanupResult(result: CleanupResult, dryRun: boolean): string {
  const lines: string[] = [];

  lines.push('');
  if (dryRun) {
    lines.push('Cleanup Preview (Dry Run)');
  } else {
    lines.push('Cleanup Complete');
  }
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('');

  if (result.feedback_entries_removed > 0) {
    lines.push(`Feedback entries: ${result.feedback_entries_removed} ${dryRun ? 'would be' : ''} removed`);
  }

  if (result.discoveries_removed > 0) {
    lines.push(`Discoveries:      ${result.discoveries_removed} expired ${dryRun ? 'would be' : ''} removed`);
  }

  if (result.archived_files_removed > 0) {
    lines.push(`Archived files:   ${result.archived_files_removed} ${dryRun ? 'would be' : ''} deleted`);
  }

  if (result.space_freed_mb > 0) {
    lines.push(`Space freed:      ${result.space_freed_mb} MB`);
  }

  if (result.feedback_entries_removed === 0 &&
      result.discoveries_removed === 0 &&
      result.archived_files_removed === 0) {
    lines.push('No cleanup needed.');
  }

  lines.push('');

  if (dryRun && (result.feedback_entries_removed > 0 || result.discoveries_removed > 0 || result.archived_files_removed > 0)) {
    lines.push('Run without --dry-run to execute cleanup.');
    lines.push('');
  }

  return lines.join('\n');
}
