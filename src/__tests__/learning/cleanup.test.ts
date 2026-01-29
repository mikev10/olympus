import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { cleanupLearning } from '../../learning/cleanup.js';
import type { FeedbackEntry, AgentDiscovery } from '../../learning/types.js';

const TEST_DIR = join(process.cwd(), '.test-cleanup');

describe('Learning Cleanup', () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
    process.env.HOME = TEST_DIR;
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true });
    }
    delete process.env.HOME;
  });

  it('removes old feedback entries', () => {
    const learningDir = join(TEST_DIR, '.claude', 'olympus', 'learning');
    mkdirSync(learningDir, { recursive: true });
    const logPath = join(learningDir, 'feedback-log.jsonl');

    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 200); // 200 days ago

    const entries: FeedbackEntry[] = [
      {
        id: 'old-1',
        timestamp: oldDate.toISOString(),
        session_id: 'session-1',
        project_path: '/test',
        event_type: 'revision',
        user_message: 'Old message',
        feedback_category: 'correction',
        confidence: 0.9,
      },
      {
        id: 'new-1',
        timestamp: new Date().toISOString(),
        session_id: 'session-2',
        project_path: '/test',
        event_type: 'revision',
        user_message: 'New message',
        feedback_category: 'correction',
        confidence: 0.9,
      },
    ];

    writeFileSync(logPath, entries.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf-8');

    const result = cleanupLearning('/test', { ageDays: 180, dryRun: false });

    expect(result.feedback_entries_removed).toBe(1);
    expect(result.space_freed_mb).toBeGreaterThan(0);
  });

  it('removes expired discoveries', () => {
    const learningDir = join(TEST_DIR, '.claude', 'olympus', 'learning');
    mkdirSync(learningDir, { recursive: true });
    const discoveryPath = join(learningDir, 'discoveries.jsonl');

    const expiredDate = new Date();
    expiredDate.setDate(expiredDate.getDate() - 10);

    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 10);

    const discoveries: AgentDiscovery[] = [
      {
        id: 'expired-1',
        timestamp: new Date().toISOString(),
        session_id: 'session-1',
        project_path: '/test',
        category: 'workaround',
        summary: 'Expired discovery',
        details: 'This is expired',
        agent_name: 'oracle',
        confidence: 0.9,
        verified: false,
        verification_count: 0,
        scope: 'global',
        expires_at: expiredDate.toISOString(),
        last_useful: new Date().toISOString(),
      },
      {
        id: 'active-1',
        timestamp: new Date().toISOString(),
        session_id: 'session-1',
        project_path: '/test',
        category: 'pattern',
        summary: 'Active discovery',
        details: 'This is active',
        agent_name: 'oracle',
        confidence: 0.9,
        verified: false,
        verification_count: 0,
        scope: 'global',
        expires_at: futureDate.toISOString(),
        last_useful: new Date().toISOString(),
      },
    ];

    writeFileSync(discoveryPath, discoveries.map(d => JSON.stringify(d)).join('\n') + '\n', 'utf-8');

    const result = cleanupLearning('/test', { compactExpired: true, dryRun: false });

    expect(result.discoveries_removed).toBe(1);
  });

  it('dry run does not modify files', () => {
    const learningDir = join(TEST_DIR, '.claude', 'olympus', 'learning');
    mkdirSync(learningDir, { recursive: true });
    const logPath = join(learningDir, 'feedback-log.jsonl');

    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 200);

    const entry: FeedbackEntry = {
      id: 'old-1',
      timestamp: oldDate.toISOString(),
      session_id: 'session-1',
      project_path: '/test',
      event_type: 'revision',
      user_message: 'Old message',
      feedback_category: 'correction',
      confidence: 0.9,
    };

    writeFileSync(logPath, JSON.stringify(entry) + '\n', 'utf-8');

    const sizeBefore = require('fs').statSync(logPath).size;

    cleanupLearning('/test', { ageDays: 180, dryRun: true });

    const sizeAfter = require('fs').statSync(logPath).size;

    expect(sizeBefore).toBe(sizeAfter);
  });
});
