/**
 * Tests for session summary storage
 * Verifies JSONL writing, loading, and retrieval of session summaries
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { appendSessionSummary, loadSessionSummaries, getLastSessionSummary } from '../../learning/storage.js';
import type { SessionSummary } from '../../learning/types.js';

const TEST_DIR = join(process.cwd(), '.test-session-summary');
const TEST_LEARNING_DIR = join(TEST_DIR, '.claude', 'olympus', 'learning');

describe('Session Summary Storage', () => {
  beforeEach(() => {
    // Create test directory
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }
    mkdirSync(TEST_LEARNING_DIR, { recursive: true });

    // Override learning directory to use test directory
    process.env.OLYMPUS_TEST_LEARNING_DIR = TEST_LEARNING_DIR;
  });

  afterEach(() => {
    // Clean up environment variable
    delete process.env.OLYMPUS_TEST_LEARNING_DIR;

    // Clean up test directory
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  const createSampleSummary = (overrides?: Partial<SessionSummary>): SessionSummary => ({
    session_id: 'test-session-123',
    project_path: '/test/project',
    started_at: '2026-02-05T10:00:00.000Z',
    ended_at: '2026-02-05T10:05:00.000Z',
    duration_seconds: 300,
    agents_used: ['oracle', 'explore'],
    total_input_tokens: 5000,
    total_output_tokens: 8000,
    total_tokens: 13000,
    estimated_cost: 0.04,
    model: 'claude-sonnet-4-5',
    outcome: 'success',
    ...overrides,
  });

  it('should append session summary and write valid JSONL', () => {
    const summary = createSampleSummary();
    appendSessionSummary(summary);

    // Read the file directly
    const filePath = join(TEST_LEARNING_DIR, 'session-summaries.jsonl');
    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    expect(lines).toHaveLength(1);

    const parsed = JSON.parse(lines[0]);
    expect(parsed).toEqual(summary);
  });

  it('should load all session summaries', () => {
    const summaries = [
      createSampleSummary({ session_id: 'session-1', duration_seconds: 100 }),
      createSampleSummary({ session_id: 'session-2', duration_seconds: 200 }),
      createSampleSummary({ session_id: 'session-3', duration_seconds: 300 }),
    ];

    summaries.forEach(s => appendSessionSummary(s));

    const loaded = loadSessionSummaries();
    expect(loaded).toHaveLength(3);
    expect(loaded[0].session_id).toBe('session-1');
    expect(loaded[1].session_id).toBe('session-2');
    expect(loaded[2].session_id).toBe('session-3');
  });

  it('should get the last session summary', () => {
    const summaries = [
      createSampleSummary({ session_id: 'session-1', duration_seconds: 100 }),
      createSampleSummary({ session_id: 'session-2', duration_seconds: 200 }),
    ];

    summaries.forEach(s => appendSessionSummary(s));

    const last = getLastSessionSummary();
    expect(last).not.toBeNull();
    expect(last!.session_id).toBe('session-2');
    expect(last!.duration_seconds).toBe(200);
  });

  it('should return empty array when file does not exist', () => {
    const loaded = loadSessionSummaries();
    expect(loaded).toEqual([]);
  });

  it('should return null when no session summaries exist', () => {
    const last = getLastSessionSummary();
    expect(last).toBeNull();
  });

  it('should handle malformed JSON entries gracefully', () => {
    const filePath = join(TEST_LEARNING_DIR, 'session-summaries.jsonl');

    // Write valid + invalid entries
    const validSummary = createSampleSummary({ session_id: 'valid-1' });
    const content = [
      JSON.stringify(validSummary),
      'this is not valid json',
      JSON.stringify(createSampleSummary({ session_id: 'valid-2' })),
      '{ "incomplete": ',
    ].join('\n');

    writeFileSync(filePath, content, 'utf-8');

    const loaded = loadSessionSummaries();
    expect(loaded).toHaveLength(2);
    expect(loaded[0].session_id).toBe('valid-1');
    expect(loaded[1].session_id).toBe('valid-2');
  });

  it('should create directory if needed', () => {
    // Delete the test learning dir
    if (existsSync(TEST_LEARNING_DIR)) {
      rmSync(TEST_LEARNING_DIR, { recursive: true, force: true });
    }

    expect(existsSync(TEST_LEARNING_DIR)).toBe(false);

    const summary = createSampleSummary();
    appendSessionSummary(summary);

    // Verify directory was created
    expect(existsSync(TEST_LEARNING_DIR)).toBe(true);

    // Verify summary was written
    const loaded = loadSessionSummaries();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].session_id).toBe('test-session-123');
  });

  it('should preserve all SessionSummary fields', () => {
    const summary: SessionSummary = {
      session_id: 'detailed-session',
      project_path: '/complex/path/to/project',
      started_at: '2026-02-05T14:30:00.123Z',
      ended_at: '2026-02-05T15:45:30.456Z',
      duration_seconds: 4530,
      agents_used: ['oracle', 'olympian', 'librarian', 'explore'],
      total_input_tokens: 15000,
      total_output_tokens: 22000,
      total_tokens: 37000,
      estimated_cost: 0.124,
      model: 'anthropic/claude-opus-4-6',
      outcome: 'revision',
    };

    appendSessionSummary(summary);

    const loaded = loadSessionSummaries();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toEqual(summary);
  });

  it('should handle empty agents_used array', () => {
    const summary = createSampleSummary({ agents_used: [] });
    appendSessionSummary(summary);

    const loaded = loadSessionSummaries();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].agents_used).toEqual([]);
  });

  it('should handle different outcome types', () => {
    const outcomes: Array<'success' | 'revision' | 'cancellation' | 'unknown'> = [
      'success',
      'revision',
      'cancellation',
      'unknown',
    ];

    outcomes.forEach((outcome, idx) => {
      appendSessionSummary(
        createSampleSummary({ session_id: `session-${idx}`, outcome })
      );
    });

    const loaded = loadSessionSummaries();
    expect(loaded).toHaveLength(4);
    expect(loaded[0].outcome).toBe('success');
    expect(loaded[1].outcome).toBe('revision');
    expect(loaded[2].outcome).toBe('cancellation');
    expect(loaded[3].outcome).toBe('unknown');
  });

  it('should append multiple summaries sequentially', () => {
    for (let i = 1; i <= 5; i++) {
      const summary = createSampleSummary({
        session_id: `session-${i}`,
        duration_seconds: i * 100,
      });
      appendSessionSummary(summary);
    }

    const loaded = loadSessionSummaries();
    expect(loaded).toHaveLength(5);

    // Verify order is preserved
    for (let i = 0; i < 5; i++) {
      expect(loaded[i].session_id).toBe(`session-${i + 1}`);
      expect(loaded[i].duration_seconds).toBe((i + 1) * 100);
    }
  });

  it('should handle large agent lists', () => {
    const manyAgents = [
      'oracle',
      'oracle-low',
      'oracle-medium',
      'olympian',
      'olympian-low',
      'olympian-high',
      'librarian',
      'librarian-low',
      'explore',
      'explore-medium',
      'frontend-engineer',
      'frontend-engineer-low',
      'document-writer',
      'prometheus',
      'momus',
      'metis',
    ];

    const summary = createSampleSummary({ agents_used: manyAgents });
    appendSessionSummary(summary);

    const loaded = loadSessionSummaries();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].agents_used).toEqual(manyAgents);
    expect(loaded[0].agents_used).toHaveLength(16);
  });
});
