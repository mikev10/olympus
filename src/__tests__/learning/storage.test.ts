import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { appendFeedback, readFeedbackLog, getLearningDir } from '../../learning/storage.js';
import type { FeedbackEntry } from '../../learning/types.js';

const TEST_DIR = join(process.cwd(), '.test-learning');

describe('Storage with Rotation', () => {
  beforeEach(() => {
    // Override getLearningDir for testing
    process.env.HOME = TEST_DIR;
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
    delete process.env.HOME;
  });

  it('rotates JSONL file when exceeding threshold', () => {
    const testEntry: FeedbackEntry = {
      id: 'test-1',
      timestamp: new Date().toISOString(),
      session_id: 'session-1',
      project_path: '/test',
      event_type: 'revision',
      user_message: 'Test message',
      feedback_category: 'correction',
      confidence: 0.9,
    };

    // Create a file with many lines (simulating large file)
    const learningDir = join(TEST_DIR, '.claude', 'olympus', 'learning');
    mkdirSync(learningDir, { recursive: true });
    const logPath = join(learningDir, 'feedback-log.jsonl');

    // Write 10,001 lines to trigger rotation
    const lines: string[] = [];
    for (let i = 0; i < 10001; i++) {
      lines.push(JSON.stringify({ ...testEntry, id: `test-${i}` }));
    }
    writeFileSync(logPath, lines.join('\n') + '\n', 'utf-8');

    // Append new entry (should trigger rotation)
    appendFeedback(testEntry);

    // Check that archive file was created
    const files = require('fs').readdirSync(learningDir);
    const archiveFiles = files.filter((f: string) => f.includes('.old.jsonl'));

    expect(archiveFiles.length).toBeGreaterThan(0);

    // Check that new file has only 1 entry
    const newLog = readFeedbackLog();
    expect(newLog.length).toBe(1);
  });

  it('does not rotate when below threshold', () => {
    const testEntry: FeedbackEntry = {
      id: 'test-1',
      timestamp: new Date().toISOString(),
      session_id: 'session-1',
      project_path: '/test',
      event_type: 'revision',
      user_message: 'Test message',
      feedback_category: 'correction',
      confidence: 0.9,
    };

    // Add a few entries (below threshold)
    for (let i = 0; i < 5; i++) {
      appendFeedback({ ...testEntry, id: `test-${i}` });
    }

    const learningDir = join(TEST_DIR, '.claude', 'olympus', 'learning');
    const files = require('fs').readdirSync(learningDir);
    const archiveFiles = files.filter((f: string) => f.includes('.old.jsonl'));

    expect(archiveFiles.length).toBe(0);

    const log = readFeedbackLog();
    expect(log.length).toBe(5);
  });
});
