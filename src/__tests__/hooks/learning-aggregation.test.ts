/**
 * Learning Aggregation Hook Tests
 *
 * Tests the learning aggregation hook that:
 * - Runs on Stop event after learning-capture (priority 95)
 * - Aggregates feedback log into agent-performance.json and user-preferences.json
 * - Throttles based on file modification times
 * - Handles errors silently
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'path';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync, utimesSync } from 'fs';
import { clearHooks, getHooksForEvent } from '../../hooks/registry.js';
import { registerLearningAggregationHook } from '../../hooks/registrations/learning-aggregation.js';
import type { HookContext } from '../../hooks/types.js';
import type { FeedbackEntry } from '../../learning/types.js';

const TEST_DIR = '.test-learning-aggregation';

// Mock os.homedir to control learning directory location
const mockHomedir = vi.hoisted(() => vi.fn());
vi.mock('os', () => ({
  homedir: mockHomedir,
}));

describe('Learning Aggregation Hook', () => {
  let testDir: string;
  let learningDir: string;

  beforeEach(() => {
    testDir = join(process.cwd(), TEST_DIR);
    learningDir = join(testDir, '.claude', 'olympus', 'learning');

    // Mock homedir to return test directory
    mockHomedir.mockReturnValue(testDir);

    // Clean and create test directories
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(learningDir, { recursive: true });

    // Clear hooks and register learning aggregation hook
    clearHooks();
    registerLearningAggregationHook();
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    clearHooks();
    vi.clearAllMocks();
  });

  function createFeedbackEntry(overrides: Partial<FeedbackEntry> = {}): FeedbackEntry {
    return {
      id: `test-${Date.now()}-${Math.random()}`,
      timestamp: new Date().toISOString(),
      session_id: 'test-session',
      project_path: '/test/project',
      event_type: 'success',
      user_message: 'Test message',
      feedback_category: 'praise',
      confidence: 0.8,
      ...overrides,
    };
  }

  function writeFeedbackLog(entries: FeedbackEntry[]): void {
    const logPath = join(learningDir, 'feedback-log.jsonl');
    const content = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
    writeFileSync(logPath, content, 'utf-8');
  }

  function readAgentPerformance(): Record<string, any> | null {
    const path = join(learningDir, 'agent-performance.json');
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf-8'));
  }

  function readUserPreferences(): Record<string, any> | null {
    const path = join(learningDir, 'user-preferences.json');
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf-8'));
  }

  async function triggerStopEvent(directory: string = '/test/project'): Promise<void> {
    const hooks = getHooksForEvent('Stop');
    const aggregationHook = hooks.find(h => h.name === 'learningAggregation');

    if (!aggregationHook) {
      throw new Error('learningAggregation hook not found');
    }

    const ctx: HookContext = {
      directory,
      sessionId: 'test-session',
    };

    await aggregationHook.handler(ctx);
  }

  it('aggregates feedback log into agent-performance.json when agents are present', async () => {
    // Create feedback entries with agents
    const entries = [
      createFeedbackEntry({ agent_used: 'oracle', event_type: 'success' }),
      createFeedbackEntry({ agent_used: 'oracle', event_type: 'success' }),
      createFeedbackEntry({ agent_used: 'oracle', event_type: 'revision' }),
      createFeedbackEntry({ agent_used: 'olympian', event_type: 'success' }),
    ];
    writeFeedbackLog(entries);

    // Trigger Stop event
    await triggerStopEvent();

    // Verify agent-performance.json was created
    const performance = readAgentPerformance();
    expect(performance).not.toBeNull();
    expect(performance!.oracle).toBeDefined();
    expect(performance!.oracle.total_invocations).toBe(3);
    expect(performance!.oracle.success_count).toBe(2);
    expect(performance!.oracle.revision_count).toBe(1);
    expect(performance!.olympian).toBeDefined();
    expect(performance!.olympian.total_invocations).toBe(1);
  });

  it('creates user-preferences.json with correct structure', async () => {
    // Create feedback entries
    const entries = [
      createFeedbackEntry({ agent_used: 'oracle', event_type: 'success' }),
      createFeedbackEntry({ agent_used: 'oracle', event_type: 'success' }),
      createFeedbackEntry({ agent_used: 'olympian', event_type: 'success' }),
    ];
    writeFeedbackLog(entries);

    // Trigger Stop event
    await triggerStopEvent();

    // Verify user-preferences.json was created with correct structure
    const prefs = readUserPreferences();
    expect(prefs).not.toBeNull();
    expect(prefs!.verbosity).toBeDefined();
    expect(prefs!.autonomy).toBeDefined();
    expect(prefs!.explicit_rules).toEqual([]);
    expect(prefs!.inferred_preferences).toEqual([]);
    expect(prefs!.recurring_corrections).toEqual([]);
    expect(prefs!.last_updated).toBeDefined();
  });

  it('skips aggregation when feedback log is empty', async () => {
    // No feedback log created

    // Trigger Stop event
    await triggerStopEvent();

    // Verify no files were created
    const performance = readAgentPerformance();
    const prefs = readUserPreferences();
    expect(performance).toBeNull();
    expect(prefs).toBeNull();
  });

  it('skips aggregation when feedback log has fewer than 3 entries', async () => {
    // Create feedback with only 2 entries
    const entries = [
      createFeedbackEntry({ agent_used: 'oracle', event_type: 'success' }),
      createFeedbackEntry({ agent_used: 'olympian', event_type: 'success' }),
    ];
    writeFeedbackLog(entries);

    // Trigger Stop event
    await triggerStopEvent();

    // Verify no files were created
    const performance = readAgentPerformance();
    const prefs = readUserPreferences();
    expect(performance).toBeNull();
    expect(prefs).toBeNull();
  });

  it('skips aggregation when no agents are present in feedback', async () => {
    // Create feedback without agent_used
    const entries = [
      createFeedbackEntry({ event_type: 'success' }), // No agent_used
      createFeedbackEntry({ event_type: 'success' }),
      createFeedbackEntry({ event_type: 'success' }),
    ];
    writeFeedbackLog(entries);

    // Trigger Stop event
    await triggerStopEvent();

    // Verify no files were created
    const performance = readAgentPerformance();
    const prefs = readUserPreferences();
    expect(performance).toBeNull();
    expect(prefs).toBeNull();
  });

  it('throttles aggregation when agent-performance.json is newer than feedback-log.jsonl', async () => {
    // Create initial feedback and aggregate
    const entries = [
      createFeedbackEntry({ agent_used: 'oracle', event_type: 'success' }),
      createFeedbackEntry({ agent_used: 'oracle', event_type: 'success' }),
      createFeedbackEntry({ agent_used: 'oracle', event_type: 'success' }),
    ];
    writeFeedbackLog(entries);

    // First aggregation
    await triggerStopEvent();

    const performance1 = readAgentPerformance();
    expect(performance1).not.toBeNull();

    // Touch agent-performance.json to make it newer
    const performancePath = join(learningDir, 'agent-performance.json');
    const feedbackPath = join(learningDir, 'feedback-log.jsonl');
    const now = new Date();
    const future = new Date(now.getTime() + 1000); // 1 second in the future

    utimesSync(performancePath, future, future);

    // Add more feedback but don't update mtime
    const oldTime = new Date(now.getTime() - 1000);
    utimesSync(feedbackPath, oldTime, oldTime);

    // Trigger Stop again - should skip aggregation
    await triggerStopEvent();

    // Verify agent-performance.json wasn't updated (still has old data)
    const performance2 = readAgentPerformance();
    expect(performance2).toEqual(performance1);
  });

  it('runs aggregation when feedback-log.jsonl is newer than agent-performance.json', async () => {
    // Create initial feedback and aggregate
    const entries = [
      createFeedbackEntry({ agent_used: 'oracle', event_type: 'success' }),
      createFeedbackEntry({ agent_used: 'oracle', event_type: 'success' }),
      createFeedbackEntry({ agent_used: 'oracle', event_type: 'success' }),
    ];
    writeFeedbackLog(entries);

    await triggerStopEvent();

    const performance1 = readAgentPerformance();
    expect(performance1!.oracle.total_invocations).toBe(3);

    // Add new entry and update mtime of feedback log to be newer
    const updatedEntries = [
      ...entries,
      createFeedbackEntry({ agent_used: 'oracle', event_type: 'success' }),
    ];
    writeFeedbackLog(updatedEntries);

    const feedbackPath = join(learningDir, 'feedback-log.jsonl');
    const performancePath = join(learningDir, 'agent-performance.json');

    // Set feedback log to be 1 second in the future
    const future = new Date(Date.now() + 1000);
    utimesSync(feedbackPath, future, future);

    // Set performance file to now (so feedback is newer)
    const now = new Date();
    utimesSync(performancePath, now, now);

    // Trigger Stop again - should run aggregation
    await triggerStopEvent();

    // Verify agent-performance.json was updated
    const performance2 = readAgentPerformance();
    expect(performance2!.oracle.total_invocations).toBe(4);
  });

  it('handles missing directory gracefully', async () => {
    // Trigger Stop without directory
    const hooks = getHooksForEvent('Stop');
    const aggregationHook = hooks.find(h => h.name === 'learningAggregation');

    const ctx: HookContext = {
      sessionId: 'test-session',
    };

    // Should not throw
    await expect(aggregationHook!.handler(ctx)).resolves.not.toThrow();

    // Verify no files were created
    const performance = readAgentPerformance();
    const prefs = readUserPreferences();
    expect(performance).toBeNull();
    expect(prefs).toBeNull();
  });

  it('handles errors silently without throwing', async () => {
    // Create feedback log
    const entries = [
      createFeedbackEntry({ agent_used: 'oracle', event_type: 'success' }),
      createFeedbackEntry({ agent_used: 'oracle', event_type: 'success' }),
      createFeedbackEntry({ agent_used: 'oracle', event_type: 'success' }),
    ];
    writeFeedbackLog(entries);

    // Mock writeJsonFile to throw an error
    const { writeJsonFile } = await import('../../learning/storage.js');
    const spy = vi.spyOn(await import('../../learning/storage.js'), 'writeJsonFile');
    spy.mockImplementation(() => {
      throw new Error('Simulated write error');
    });

    // Trigger Stop - should not throw
    await expect(triggerStopEvent()).resolves.not.toThrow();

    spy.mockRestore();
  });

  it('updates existing preferences instead of overwriting', async () => {
    // Create initial preferences
    const initialPrefs = {
      verbosity: 'concise',
      autonomy: 'just_do_it',
      explanation_depth: 'minimal',
      explicit_rules: ['Always use TypeScript'],
      inferred_preferences: [],
      recurring_corrections: [],
      last_updated: new Date().toISOString(),
    };

    const prefsPath = join(learningDir, 'user-preferences.json');
    writeFileSync(prefsPath, JSON.stringify(initialPrefs, null, 2), 'utf-8');

    // Create feedback
    const entries = [
      createFeedbackEntry({ agent_used: 'oracle', event_type: 'success' }),
      createFeedbackEntry({ agent_used: 'oracle', event_type: 'success' }),
      createFeedbackEntry({ agent_used: 'oracle', event_type: 'success' }),
    ];
    writeFeedbackLog(entries);

    // Trigger Stop
    await triggerStopEvent();

    // Verify preferences were updated but existing rules preserved
    const prefs = readUserPreferences();
    expect(prefs).not.toBeNull();
    expect(prefs!.explicit_rules).toContain('Always use TypeScript');
    expect(prefs!.verbosity).toBe('concise');
    expect(prefs!.autonomy).toBe('just_do_it');
  });
});
