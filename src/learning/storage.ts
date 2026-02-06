import { homedir } from 'os';
import { join, resolve, dirname, basename } from 'path';
import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync, renameSync, readdirSync, unlinkSync } from 'fs';
import { createHash } from 'crypto';
import type { FeedbackEntry, AgentPerformance, TokenEfficiency, SessionSummary, ArchiveRetentionConfig } from './types.js';
import { DEFAULT_ARCHIVE_RETENTION } from './types.js';
import { getTokenUsage, safeTokenTotal } from './utils.js';

/** Maximum lines before rotating JSONL files */
const MAX_JSONL_LINES = 10000;

/** Get learning storage directory (cross-platform) */
export function getLearningDir(): string {
  // Allow tests to override the learning directory via environment variable
  if (process.env.OLYMPUS_TEST_LEARNING_DIR) {
    return process.env.OLYMPUS_TEST_LEARNING_DIR;
  }
  return join(homedir(), '.claude', 'olympus', 'learning');
}

/** Get project-specific learning directory */
export function getProjectLearningDir(projectPath: string): string {
  return join(projectPath, '.olympus', 'learning');
}

/** Generate deterministic hash for project path */
export function getProjectHash(projectPath: string): string {
  const absolutePath = resolve(projectPath);
  return createHash('sha256').update(absolutePath).digest('hex').substring(0, 16);
}

/** Ensure learning directories exist */
export function ensureLearningDirs(projectPath?: string): void {
  const globalDir = getLearningDir();
  if (!existsSync(globalDir)) {
    mkdirSync(globalDir, { recursive: true });
  }

  if (projectPath) {
    const projectDir = getProjectLearningDir(projectPath);
    if (!existsSync(projectDir)) {
      mkdirSync(projectDir, { recursive: true });
    }
  }
}

/**
 * Prune old archives based on retention policy.
 * Deletes archives older than maxAgeInDays and caps at maxArchiveCount.
 */
function pruneArchives(
  originalFilePath: string,
  retention: ArchiveRetentionConfig = DEFAULT_ARCHIVE_RETENTION
): void {
  try {
    const dir = dirname(originalFilePath);
    const baseFileName = basename(originalFilePath, '.jsonl');
    const files = readdirSync(dir);

    // Find all archive files matching this base name
    const archivePattern = new RegExp(
      `^${baseFileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\..*\\.old\\.jsonl$`
    );
    const archives = files
      .filter(f => archivePattern.test(f))
      .map(f => {
        // Extract date portion: "2026-02-05T14-30-00-000Z" → "2026-02-05"
        const dateMatch = f.match(/\.(\d{4}-\d{2}-\d{2})T/);
        const timestamp = dateMatch ? new Date(dateMatch[1]) : null;
        return { filename: f, filepath: join(dir, f), timestamp };
      })
      .filter(a => a.timestamp !== null && !isNaN(a.timestamp!.getTime()))
      .sort((a, b) => b.timestamp!.getTime() - a.timestamp!.getTime()); // Newest first

    const maxAge = retention.maxAgeInDays ?? 30;
    const maxCount = retention.maxArchiveCount ?? 5;
    const cutoffDate = new Date(Date.now() - maxAge * 24 * 60 * 60 * 1000);
    let pruneCount = 0;

    for (let i = 0; i < archives.length; i++) {
      const archive = archives[i];
      const shouldPruneByAge = archive.timestamp! < cutoffDate;
      const shouldPruneByCount = i >= maxCount;

      if (shouldPruneByAge || shouldPruneByCount) {
        try {
          unlinkSync(archive.filepath);
          pruneCount++;
        } catch {
          // Silent failure on individual file deletion
        }
      }
    }

    if (pruneCount > 0) {
      console.log(`[Olympus Learning] Pruned ${pruneCount} old archives`);
    }
  } catch (error) {
    // Archive pruning is non-critical
    console.error('[Olympus Learning] Failed to prune archives:', error);
  }
}

/** Rotate JSONL file if it exceeds size threshold */
function rotateIfNeeded(
  filePath: string,
  maxLines: number = MAX_JSONL_LINES,
  retention: ArchiveRetentionConfig = DEFAULT_ARCHIVE_RETENTION
): void {
  if (!existsSync(filePath)) return;

  try {
    const content = readFileSync(filePath, 'utf-8');
    const lineCount = content.split('\n').filter(l => l.trim()).length;

    if (lineCount >= maxLines) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const archivePath = filePath.replace('.jsonl', `.${timestamp}.old.jsonl`);
      renameSync(filePath, archivePath);
      console.log(`[Olympus Learning] Archived ${lineCount} entries to ${archivePath}`);

      // Prune old archives
      pruneArchives(filePath, retention);
    }
  } catch (error) {
    console.error(`[Olympus Learning] Failed to rotate ${filePath}:`, error);
    // Don't throw - rotation failures should not block appending
  }
}

/** Append feedback entry to JSONL log */
export function appendFeedback(entry: FeedbackEntry): void {
  ensureLearningDirs();
  const logPath = join(getLearningDir(), 'feedback-log.jsonl');

  // Rotate before appending
  rotateIfNeeded(logPath);

  appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf-8');
}

/** Read feedback log */
export function readFeedbackLog(): FeedbackEntry[] {
  const logPath = join(getLearningDir(), 'feedback-log.jsonl');
  if (!existsSync(logPath)) return [];

  const content = readFileSync(logPath, 'utf-8');
  return content
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line) as FeedbackEntry);
}

/** Save feedback entry (alias for appendFeedback) */
export function saveFeedback(entry: FeedbackEntry): void {
  appendFeedback(entry);
}

/** Load feedback entries (alias for readFeedbackLog) */
export function loadFeedback(): FeedbackEntry[] {
  return readFeedbackLog();
}

/**
 * Update agent performance metrics with token efficiency
 * Recalculates token_efficiency based on feedback entries with token usage
 */
export function updateAgentPerformance(
  agentName: string,
  feedbackEntries: FeedbackEntry[]
): AgentPerformance | null {
  const agentEntries = feedbackEntries.filter(e => e.agent_used === agentName);

  if (agentEntries.length === 0) {
    return null;
  }

  // Basic performance metrics
  const totalInvocations = agentEntries.length;
  const successCount = agentEntries.filter(e => e.event_type === 'success').length;
  const revisionCount = agentEntries.filter(e => e.event_type === 'revision').length;
  const cancellationCount = agentEntries.filter(e => e.event_type === 'cancellation').length;
  const successRate = totalInvocations > 0 ? successCount / totalInvocations : 0;

  // Token efficiency metrics
  let tokenEfficiency: TokenEfficiency | undefined;

  const entriesWithTokens = agentEntries.filter(e => getTokenUsage(e) !== null);

  if (entriesWithTokens.length > 0) {
    const successEntries = entriesWithTokens.filter(e => e.event_type === 'success');
    const failureEntries = entriesWithTokens.filter(
      e => e.event_type === 'revision' || e.event_type === 'cancellation'
    );

    const totalTokens = entriesWithTokens.reduce((sum, e) => sum + safeTokenTotal(e), 0);
    const successTokens = successEntries.reduce((sum, e) => sum + safeTokenTotal(e), 0);
    const failureTokens = failureEntries.reduce((sum, e) => sum + safeTokenTotal(e), 0);

    const avgTokensPerSuccess = successEntries.length > 0 ? successTokens / successEntries.length : 0;
    const avgTokensPerFailure = failureEntries.length > 0 ? failureTokens / failureEntries.length : 0;

    tokenEfficiency = {
      avg_tokens_per_success: avgTokensPerSuccess,
      avg_tokens_per_failure: avgTokensPerFailure,
      total_tokens: totalTokens,
      invocation_count: entriesWithTokens.length,
      efficiency_score: avgTokensPerSuccess,
      trend: 'insufficient_data' as const
    };

    // Calculate trend (simple heuristic: compare first half vs second half)
    if (entriesWithTokens.length >= 10) {
      const midpoint = Math.floor(entriesWithTokens.length / 2);
      const firstHalf = entriesWithTokens.slice(0, midpoint);
      const secondHalf = entriesWithTokens.slice(midpoint);

      const firstAvg = firstHalf.reduce((sum, e) => sum + safeTokenTotal(e), 0) / firstHalf.length;
      const secondAvg = secondHalf.reduce((sum, e) => sum + safeTokenTotal(e), 0) / secondHalf.length;

      const difference = secondAvg - firstAvg;
      const threshold = firstAvg * 0.1; // 10% threshold

      if (Math.abs(difference) < threshold) {
        tokenEfficiency.trend = 'stable';
      } else if (difference < 0) {
        tokenEfficiency.trend = 'improving'; // Fewer tokens is better
      } else {
        tokenEfficiency.trend = 'declining';
      }
    }
  }

  return {
    agent_name: agentName,
    total_invocations: totalInvocations,
    success_count: successCount,
    revision_count: revisionCount,
    cancellation_count: cancellationCount,
    success_rate: successRate,
    failure_patterns: [],
    strong_areas: [],
    weak_areas: [],
    last_updated: new Date().toISOString(),
    token_efficiency: tokenEfficiency
  };
}

/**
 * Get session baseline for token budgeting
 * Default to 10000 tokens if not configured
 */
export function getSessionBaseline(config?: { learning?: { tokenMetrics?: { sessionBaseline?: number } } }): number {
  return config?.learning?.tokenMetrics?.sessionBaseline ?? 10000;
}

/** Read JSON file with type safety and error handling */
export function readJsonFile<T>(path: string, defaultValue: T): T {
  if (!existsSync(path)) return defaultValue;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T;
  } catch (error) {
    console.error(`[Olympus Learning] Failed to read ${path}:`, error);
    return defaultValue;
  }
}

/** Write JSON file with error handling */
export function writeJsonFile<T>(filePath: string, data: T): void {
  try {
    const dir = dirname(filePath);
    if (dir && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (error) {
    console.error(`[Olympus Learning] Failed to write ${filePath}:`, error);
    // Don't throw - learning failures should not block main functionality
  }
}

/** Append session summary to JSONL log */
export function appendSessionSummary(summary: SessionSummary): void {
  ensureLearningDirs();
  const logPath = join(getLearningDir(), 'session-summaries.jsonl');
  rotateIfNeeded(logPath);
  appendFileSync(logPath, JSON.stringify(summary) + '\n', 'utf-8');
}

/** Load all session summaries */
export function loadSessionSummaries(): SessionSummary[] {
  const logPath = join(getLearningDir(), 'session-summaries.jsonl');
  if (!existsSync(logPath)) return [];
  try {
    const content = readFileSync(logPath, 'utf-8');
    return content
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        try {
          return JSON.parse(line) as SessionSummary;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is SessionSummary => entry !== null);
  } catch {
    return [];
  }
}

/** Get the most recent session summary */
export function getLastSessionSummary(): SessionSummary | null {
  const summaries = loadSessionSummaries();
  return summaries.length > 0 ? summaries[summaries.length - 1] : null;
}

/** Export rotation and pruning functions for use in discovery.ts and cleanup */
export { rotateIfNeeded, pruneArchives };
