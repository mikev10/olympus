import { homedir } from 'os';
import { join, resolve, dirname } from 'path';
import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import type { FeedbackEntry } from './types.js';

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

/** Append feedback entry to JSONL log */
export function appendFeedback(entry: FeedbackEntry): void {
  ensureLearningDirs();
  const logPath = join(getLearningDir(), 'feedback-log.jsonl');
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
