import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs';
import { collectProjectDirStats, cleanupLearning, formatCleanupResult } from '../cleanup.js';

const TEST_DIR = join(process.cwd(), '.test-cli-operations-' + Date.now());

beforeEach(() => {
  process.env.OLYMPUS_TEST_LEARNING_DIR = TEST_DIR;
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  delete process.env.OLYMPUS_TEST_LEARNING_DIR;
  rmSync(TEST_DIR, { recursive: true, force: true });
});

function makeProjectDir(base: string, slug: string, files: Record<string, string> = {}): string {
  const dir = join(base, slug);
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, 'utf-8');
  }
  return dir;
}

describe('collectProjectDirStats', () => {
  it('returns empty array when projects dir does not exist', () => {
    const result = collectProjectDirStats(join(TEST_DIR, 'nonexistent'));
    expect(result).toEqual([]);
  });

  it('returns empty array when projects dir exists but has no subdirectories', () => {
    const projectsDir = join(TEST_DIR, 'projects');
    mkdirSync(projectsDir, { recursive: true });
    const result = collectProjectDirStats(projectsDir);
    expect(result).toEqual([]);
  });

  it('computes correct stats for a project dir with known files', () => {
    const projectsDir = join(TEST_DIR, 'projects');
    makeProjectDir(projectsDir, 'my-project-abc12345', {
      'feedback-log.jsonl': '{"a":1}\n{"b":2}\n',
      'session-summaries.jsonl': '{"s":1}\n',
      'agent-performance.json': '{}',
    });

    const result = collectProjectDirStats(projectsDir);
    expect(result).toHaveLength(1);
    expect(result[0].slug).toBe('my-project-abc12345');
    expect(result[0].feedbackCount).toBe(2);
    expect(result[0].sessionCount).toBe(1);
    expect(result[0].sizeBytes).toBeGreaterThan(0);
    expect(result[0].lastModified).toBeInstanceOf(Date);
  });

  it('counts only non-empty lines for feedbackCount and sessionCount', () => {
    const projectsDir = join(TEST_DIR, 'projects');
    makeProjectDir(projectsDir, 'proj-abc12345', {
      'feedback-log.jsonl': '{"a":1}\n\n{"b":2}\n\n',
      'session-summaries.jsonl': '\n\n{"s":1}\n',
    });
    const result = collectProjectDirStats(projectsDir);
    expect(result[0].feedbackCount).toBe(2);
    expect(result[0].sessionCount).toBe(1);
  });

  it('sorts results by lastModified descending', async () => {
    const projectsDir = join(TEST_DIR, 'projects');
    makeProjectDir(projectsDir, 'older-aaa11111', { 'feedback-log.jsonl': '{"x":1}\n' });
    await new Promise(r => setTimeout(r, 20));
    makeProjectDir(projectsDir, 'newer-bbb22222', { 'feedback-log.jsonl': '{"x":1}\n' });

    const result = collectProjectDirStats(projectsDir);
    expect(result).toHaveLength(2);
    expect(result[0].lastModified.getTime()).toBeGreaterThanOrEqual(result[1].lastModified.getTime());
  });

  it('handles project dir with no known files (zero stats)', () => {
    const projectsDir = join(TEST_DIR, 'projects');
    makeProjectDir(projectsDir, 'empty-ccc33333');
    const result = collectProjectDirStats(projectsDir);
    expect(result[0].feedbackCount).toBe(0);
    expect(result[0].sessionCount).toBe(0);
    expect(result[0].sizeBytes).toBe(0);
  });
});

describe('cleanupLearning pruning', () => {
  it('removes project dirs older than 90 days', () => {
    const projectsDir = join(TEST_DIR, 'projects');
    const oldSlug = 'old-project-ddd44444';
    makeProjectDir(projectsDir, oldSlug);

    const dirPath = join(projectsDir, oldSlug);
    const oldMtime = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000);
    const { utimesSync } = require('fs');
    utimesSync(dirPath, oldMtime, oldMtime);

    const result = cleanupLearning(process.cwd(), { dryRun: false });
    expect(result.projects_pruned).toBe(1);
    expect(existsSync(dirPath)).toBe(false);
  });

  it('prunes oldest dirs when count exceeds 50', () => {
    const projectsDir = join(TEST_DIR, 'projects');
    for (let i = 0; i < 55; i++) {
      const slug = `proj-${String(i).padStart(3, '0')}-${i.toString(16).padStart(8, '0')}`;
      makeProjectDir(projectsDir, slug);
    }

    const result = cleanupLearning(process.cwd(), { dryRun: false });
    expect(result.projects_pruned).toBeGreaterThanOrEqual(5);
  });

  it('dry-run counts prunable dirs but does not delete them', () => {
    const projectsDir = join(TEST_DIR, 'projects');
    const oldSlug = 'old-dryrun-eee55555';
    makeProjectDir(projectsDir, oldSlug);

    const dirPath = join(projectsDir, oldSlug);
    const oldMtime = new Date(Date.now() - 95 * 24 * 60 * 60 * 1000);
    const { utimesSync } = require('fs');
    utimesSync(dirPath, oldMtime, oldMtime);

    const result = cleanupLearning(process.cwd(), { dryRun: true });
    expect(result.projects_pruned).toBe(1);
    expect(existsSync(dirPath)).toBe(true);
  });

  it('does not prune dirs when under age and count thresholds', () => {
    const projectsDir = join(TEST_DIR, 'projects');
    makeProjectDir(projectsDir, 'recent-fff66666');
    makeProjectDir(projectsDir, 'recent-ggg77777');

    const result = cleanupLearning(process.cwd(), { dryRun: false });
    expect(result.projects_pruned).toBe(0);
  });
});

describe('CleanupResult', () => {
  it('includes projects_pruned field initialized to 0', () => {
    const result = cleanupLearning(process.cwd(), { dryRun: true });
    expect(result).toHaveProperty('projects_pruned');
    expect(result.projects_pruned).toBe(0);
  });
});

describe('formatCleanupResult', () => {
  it('shows projects_pruned line when non-zero', () => {
    const result = {
      feedback_entries_removed: 0,
      discoveries_removed: 0,
      archived_files_removed: 0,
      space_freed_mb: 0,
      files_processed: [],
      projects_pruned: 3,
    };
    const output = formatCleanupResult(result, false);
    expect(output).toContain('Project directories: 3');
    expect(output).not.toContain('No cleanup needed');
  });

  it('shows "No cleanup needed" only when all fields including projects_pruned are zero', () => {
    const result = {
      feedback_entries_removed: 0,
      discoveries_removed: 0,
      archived_files_removed: 0,
      space_freed_mb: 0,
      files_processed: [],
      projects_pruned: 0,
    };
    const output = formatCleanupResult(result, false);
    expect(output).toContain('No cleanup needed');
  });

  it('includes "would be" in dry-run output for projects_pruned', () => {
    const result = {
      feedback_entries_removed: 0,
      discoveries_removed: 0,
      archived_files_removed: 0,
      space_freed_mb: 0,
      files_processed: [],
      projects_pruned: 2,
    };
    const output = formatCleanupResult(result, true);
    expect(output).toContain('would be');
  });
});
