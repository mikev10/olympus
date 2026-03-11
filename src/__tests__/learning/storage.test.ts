import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { appendFeedback, readFeedbackLog, getLearningDir, updateAgentPerformance } from '../../learning/storage.js';
import type { FeedbackEntry } from '../../learning/types.js';

const TEST_DIR = join(process.cwd(), '.test-learning');

describe('Storage with Rotation', () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
    process.env.OLYMPUS_TEST_LEARNING_DIR = TEST_DIR;
  });

  afterEach(() => {
    delete process.env.OLYMPUS_TEST_LEARNING_DIR;
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
  });

  it('rotates JSONL file when exceeding threshold', () => {
    const testEntry: FeedbackEntry = {
      id: 'test-1',
      timestamp: new Date().toISOString(),
      session_id: 'session-1',
      project_path: '',
      event_type: 'revision',
      user_message: 'Test message',
      feedback_category: 'correction',
      confidence: 0.9,
    };

    const logPath = join(TEST_DIR, 'feedback-log.jsonl');

    const lines: string[] = [];
    for (let i = 0; i < 10001; i++) {
      lines.push(JSON.stringify({ ...testEntry, id: `test-${i}` }));
    }
    writeFileSync(logPath, lines.join('\n') + '\n', 'utf-8');

    appendFeedback(testEntry);

    const files = require('fs').readdirSync(TEST_DIR);
    const archiveFiles = files.filter((f: string) => f.includes('.old.jsonl'));

    expect(archiveFiles.length).toBeGreaterThan(0);

    const newLog = readFeedbackLog();
    expect(newLog.length).toBe(1);
  });

  it('does not rotate when below threshold', () => {
    const testEntry: FeedbackEntry = {
      id: 'test-1',
      timestamp: new Date().toISOString(),
      session_id: 'session-1',
      project_path: '',
      event_type: 'revision',
      user_message: 'Test message',
      feedback_category: 'correction',
      confidence: 0.9,
    };

    for (let i = 0; i < 5; i++) {
      appendFeedback({ ...testEntry, id: `test-${i}` });
    }

    const files = require('fs').readdirSync(TEST_DIR);
    const archiveFiles = files.filter((f: string) => f.includes('.old.jsonl'));

    expect(archiveFiles.length).toBe(0);

    const log = readFeedbackLog();
    expect(log.length).toBe(5);
  });
});

function mockFeedbackEntry(overrides: Partial<FeedbackEntry>): FeedbackEntry {
  return {
    id: 'test-id',
    timestamp: new Date().toISOString(),
    session_id: 'test-session',
    project_path: '/test',
    event_type: 'success',
    user_message: 'test message',
    feedback_category: 'praise',
    confidence: 0.9,
    ...overrides,
  };
}

describe('updateAgentPerformance derived fields', () => {
  const PERF_TEST_DIR = join(process.cwd(), '.test-learning-perf-' + Date.now());

  beforeEach(() => {
    mkdirSync(PERF_TEST_DIR, { recursive: true });
    process.env.OLYMPUS_TEST_LEARNING_DIR = PERF_TEST_DIR;
  });

  afterEach(() => {
    delete process.env.OLYMPUS_TEST_LEARNING_DIR;
    rmSync(PERF_TEST_DIR, { recursive: true, force: true });
  });

  it('90% success rate populates strong_areas and leaves weak_areas empty', () => {
    const entries: FeedbackEntry[] = [
      ...Array.from({ length: 9 }, (_, i) =>
        mockFeedbackEntry({ id: `s-${i}`, agent_used: 'olympian', event_type: 'success' })
      ),
      mockFeedbackEntry({ id: 'r-0', agent_used: 'olympian', event_type: 'revision' }),
    ];
    const result = updateAgentPerformance('olympian', entries);
    expect(result).not.toBeNull();
    expect(result!.strong_areas).toContain('high success rate');
    expect(result!.weak_areas).toHaveLength(0);
  });

  it('40% success rate populates weak_areas and leaves strong_areas empty', () => {
    const entries: FeedbackEntry[] = [
      ...Array.from({ length: 2 }, (_, i) =>
        mockFeedbackEntry({ id: `s-${i}`, agent_used: 'olympian', event_type: 'success' })
      ),
      ...Array.from({ length: 3 }, (_, i) =>
        mockFeedbackEntry({ id: `r-${i}`, agent_used: 'olympian', event_type: 'revision' })
      ),
    ];
    const result = updateAgentPerformance('olympian', entries);
    expect(result).not.toBeNull();
    expect(result!.weak_areas).toContain('low success rate');
    expect(result!.strong_areas).toHaveLength(0);
  });

  it('3+ revisions with same extracted_lesson produces failure_patterns entry', () => {
    const entries: FeedbackEntry[] = Array.from({ length: 3 }, (_, i) =>
      mockFeedbackEntry({
        id: `r-${i}`,
        agent_used: 'olympian',
        event_type: 'revision',
        extracted_lesson: 'missing-types',
        user_message: `revision message ${i}`,
      })
    );
    const result = updateAgentPerformance('olympian', entries);
    expect(result).not.toBeNull();
    const pattern = result!.failure_patterns.find(p => p.pattern === 'missing-types');
    expect(pattern).toBeDefined();
    expect(pattern!.count).toBe(3);
  });

  it('single-occurrence failures produce no failure_patterns (threshold = 2)', () => {
    const entries: FeedbackEntry[] = [
      mockFeedbackEntry({
        id: 'r-0',
        agent_used: 'olympian',
        event_type: 'revision',
        extracted_lesson: 'unique-lesson',
      }),
    ];
    const result = updateAgentPerformance('olympian', entries);
    expect(result).not.toBeNull();
    expect(result!.failure_patterns).toHaveLength(0);
  });

  it('examples capped at 3 and user_message truncated to 100 chars', () => {
    const longMessage = 'x'.repeat(200);
    const entries: FeedbackEntry[] = Array.from({ length: 5 }, (_, i) =>
      mockFeedbackEntry({
        id: `r-${i}`,
        agent_used: 'olympian',
        event_type: 'revision',
        extracted_lesson: 'overflow-lesson',
        user_message: longMessage,
      })
    );
    const result = updateAgentPerformance('olympian', entries);
    expect(result).not.toBeNull();
    const pattern = result!.failure_patterns.find(p => p.pattern === 'overflow-lesson');
    expect(pattern).toBeDefined();
    expect(pattern!.examples.length).toBeLessThanOrEqual(3);
    for (const ex of pattern!.examples) {
      expect(ex.length).toBeLessThanOrEqual(100);
    }
  });

  it('cancellation_count > 2 adds "frequently cancelled" to weak_areas', () => {
    const entries: FeedbackEntry[] = Array.from({ length: 3 }, (_, i) =>
      mockFeedbackEntry({ id: `c-${i}`, agent_used: 'olympian', event_type: 'cancellation' })
    );
    const result = updateAgentPerformance('olympian', entries);
    expect(result).not.toBeNull();
    expect(result!.weak_areas).toContain('frequently cancelled');
  });
});
