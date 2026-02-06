import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, existsSync, rmSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { pruneArchives } from '../../learning/storage.js';
import type { ArchiveRetentionConfig } from '../../learning/types.js';

describe('Archive Pruning', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(process.cwd(), '.olympus-test-archive-pruning');
    process.env.OLYMPUS_TEST_LEARNING_DIR = testDir;

    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    delete process.env.OLYMPUS_TEST_LEARNING_DIR;
  });

  /**
   * Helper to create an archive file with a specific age in days
   */
  function createArchiveFile(baseFileName: string, daysAgo: number): string {
    const date = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
    const dateStr = date.toISOString().replace(/[:.]/g, '-');
    const archivePath = join(testDir, `${baseFileName}.${dateStr}.old.jsonl`);
    writeFileSync(archivePath, '{"test": true}\n');
    return archivePath;
  }

  /**
   * Count archive files matching the base name pattern
   */
  function countArchiveFiles(baseFileName: string): number {
    const files = readdirSync(testDir);
    const archivePattern = new RegExp(`^${baseFileName}\\..*\\.old\\.jsonl$`);
    return files.filter(f => archivePattern.test(f)).length;
  }

  /** The original file path that pruneArchives expects */
  function feedbackLogPath(): string {
    return join(testDir, 'feedback-log.jsonl');
  }

  function sessionSummariesPath(): string {
    return join(testDir, 'session-summaries.jsonl');
  }

  it('should prune archives older than 30 days', () => {
    createArchiveFile('feedback-log', 5);   // Recent (keep)
    createArchiveFile('feedback-log', 20);  // Recent (keep)
    createArchiveFile('feedback-log', 35);  // Old (prune)
    createArchiveFile('feedback-log', 60);  // Old (prune)
    createArchiveFile('feedback-log', 90);  // Old (prune)

    expect(countArchiveFiles('feedback-log')).toBe(5);

    pruneArchives(feedbackLogPath());

    // 2 recent kept, 3 old pruned
    expect(countArchiveFiles('feedback-log')).toBe(2);
  });

  it('should cap archives at 5 when many recent', () => {
    // Create 8 recent archives (all within 30 days)
    for (let i = 1; i <= 8; i++) {
      createArchiveFile('feedback-log', i);
    }

    expect(countArchiveFiles('feedback-log')).toBe(8);

    pruneArchives(feedbackLogPath());

    // Capped at 5
    expect(countArchiveFiles('feedback-log')).toBe(5);
  });

  it('should not prune when fewer than max', () => {
    createArchiveFile('feedback-log', 1);
    createArchiveFile('feedback-log', 5);
    createArchiveFile('feedback-log', 10);

    expect(countArchiveFiles('feedback-log')).toBe(3);

    pruneArchives(feedbackLogPath());

    // All 3 kept (under max of 5, all recent)
    expect(countArchiveFiles('feedback-log')).toBe(3);
  });

  it('should handle no archives gracefully', () => {
    expect(() => pruneArchives(feedbackLogPath())).not.toThrow();
    expect(countArchiveFiles('feedback-log')).toBe(0);
  });

  it('should handle malformed filenames gracefully', () => {
    createArchiveFile('feedback-log', 5);
    createArchiveFile('feedback-log', 10);

    // Create files that don't match the archive pattern
    writeFileSync(join(testDir, 'feedback-log.malformed.jsonl'), '{}');
    writeFileSync(join(testDir, 'feedback-log.txt'), 'test');
    writeFileSync(join(testDir, 'other-file.old.jsonl'), '{}');

    pruneArchives(feedbackLogPath());

    // Malformed files should not be touched
    expect(existsSync(join(testDir, 'feedback-log.malformed.jsonl'))).toBe(true);
    expect(existsSync(join(testDir, 'feedback-log.txt'))).toBe(true);
    expect(existsSync(join(testDir, 'other-file.old.jsonl'))).toBe(true);

    // 2 valid archives still present
    expect(countArchiveFiles('feedback-log')).toBe(2);
  });

  it('should respect custom retention config', () => {
    createArchiveFile('feedback-log', 5);   // Keep (under 7 days)
    createArchiveFile('feedback-log', 8);   // Prune (over custom maxAge=7)
    createArchiveFile('feedback-log', 15);  // Prune

    const customRetention: ArchiveRetentionConfig = {
      maxAgeInDays: 7,
      maxArchiveCount: 2,
    };

    pruneArchives(feedbackLogPath(), customRetention);

    expect(countArchiveFiles('feedback-log')).toBe(1);
  });

  it('should work with session-summaries.jsonl', () => {
    createArchiveFile('session-summaries', 5);
    createArchiveFile('session-summaries', 40);  // Old (prune)

    expect(countArchiveFiles('session-summaries')).toBe(2);

    pruneArchives(sessionSummariesPath());

    // 1 recent kept, 1 old pruned
    expect(countArchiveFiles('session-summaries')).toBe(1);
  });

  it('should prune correctly when both age and count conditions apply', () => {
    createArchiveFile('feedback-log', 1);   // Recent (keep)
    createArchiveFile('feedback-log', 2);   // Recent (keep)
    createArchiveFile('feedback-log', 3);   // Recent (keep)
    createArchiveFile('feedback-log', 4);   // Recent (keep)
    createArchiveFile('feedback-log', 5);   // Recent (keep, at limit)
    createArchiveFile('feedback-log', 6);   // Recent but over count (prune)
    createArchiveFile('feedback-log', 35);  // Old (prune by age)
    createArchiveFile('feedback-log', 45);  // Old (prune by age)

    expect(countArchiveFiles('feedback-log')).toBe(8);

    pruneArchives(feedbackLogPath());

    // 5 newest kept (cap), 3 pruned (2 by age, 1 by count)
    expect(countArchiveFiles('feedback-log')).toBe(5);
  });

  it('should be idempotent when called multiple times', () => {
    for (let i = 1; i <= 10; i++) {
      createArchiveFile('feedback-log', i);
    }

    expect(countArchiveFiles('feedback-log')).toBe(10);

    pruneArchives(feedbackLogPath());
    expect(countArchiveFiles('feedback-log')).toBe(5);

    // Call again — should be idempotent
    pruneArchives(feedbackLogPath());
    expect(countArchiveFiles('feedback-log')).toBe(5);
  });
});
