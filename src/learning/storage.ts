import { homedir } from 'os';
import { join, resolve, dirname } from 'path';
import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync, renameSync } from 'fs';
import { createHash } from 'crypto';
import type { FeedbackEntry } from './types.js';

/** Maximum lines before rotating JSONL files */
const MAX_JSONL_LINES = 10000;

/** Get learning storage directory (cross-platform) */
export function getLearningDir(): string {
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

/** Rotate JSONL file if it exceeds size threshold */
function rotateIfNeeded(filePath: string, maxLines: number = MAX_JSONL_LINES): void {
  if (!existsSync(filePath)) return;

  try {
    const content = readFileSync(filePath, 'utf-8');
    const lineCount = content.split('\n').filter(l => l.trim()).length;

    if (lineCount >= maxLines) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const archivePath = filePath.replace('.jsonl', `.${timestamp}.old.jsonl`);
      renameSync(filePath, archivePath);
      console.log(`[Olympus Learning] Archived ${lineCount} entries to ${archivePath}`);
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

/** Export rotation function for use in discovery.ts and cleanup */
export { rotateIfNeeded };
