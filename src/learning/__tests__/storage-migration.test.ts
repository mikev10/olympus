import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'path';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import {
  appendFeedback,
  readFeedbackLog,
  updateAgentPerformance,
  readAgentPerformance,
  appendSessionSummary,
  loadSessionSummaries,
} from '../storage.js';
import { deriveProjectSlug, getProjectScopedDir } from '../project-resolver.js';
import type { FeedbackEntry, SessionSummary } from '../types.js';

const TEST_DIR = join(process.cwd(), '.test-storage-migration-' + Date.now());

function makeEntry(overrides: Partial<FeedbackEntry> = {}): FeedbackEntry {
  return {
    id: 'test-id',
    timestamp: new Date().toISOString(),
    session_id: 'sess-1',
    project_path: '',
    event_type: 'success',
    user_message: 'test message',
    feedback_category: 'praise',
    confidence: 1,
    ...overrides,
  };
}

function makeSessionSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    session_id: 'sess-1',
    project_path: '/test/project',
    started_at: new Date().toISOString(),
    ended_at: new Date().toISOString(),
    duration_seconds: 60,
    agents_used: [],
    total_input_tokens: 100,
    total_output_tokens: 200,
    total_tokens: 300,
    estimated_cost: 0.01,
    model: 'claude-sonnet',
    outcome: 'success',
    ...overrides,
  };
}

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  process.env.OLYMPUS_TEST_LEARNING_DIR = TEST_DIR;
});

afterEach(() => {
  delete process.env.OLYMPUS_TEST_LEARNING_DIR;
  vi.restoreAllMocks();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('appendFeedback — project routing', () => {
  it('writes to project-scoped path when entry.project_path is set', () => {
    const projectPath = '/home/dev/my-project';
    const slug = deriveProjectSlug(projectPath);
    const entry = makeEntry({ project_path: projectPath });

    appendFeedback(entry);

    const projectFile = join(TEST_DIR, 'projects', slug, 'feedback-log.jsonl');
    expect(existsSync(projectFile)).toBe(true);
    const content = readFileSync(projectFile, 'utf-8');
    expect(JSON.parse(content.trim())).toMatchObject({ project_path: projectPath });
  });

  it('falls back to global when project_path is empty', () => {
    const entry = makeEntry({ project_path: '' });
    appendFeedback(entry);

    const globalFile = join(TEST_DIR, 'feedback-log.jsonl');
    expect(existsSync(globalFile)).toBe(true);
  });
});

describe('readFeedbackLog — project routing', () => {
  it('reads from project-scoped path when projectPath provided', () => {
    const projectPath = '/home/dev/read-test';
    const slug = deriveProjectSlug(projectPath);
    const projectDir = join(TEST_DIR, 'projects', slug);
    mkdirSync(projectDir, { recursive: true });

    const entry = makeEntry({ project_path: projectPath });
    writeFileSync(join(projectDir, 'feedback-log.jsonl'), JSON.stringify(entry) + '\n', 'utf-8');

    const results = readFeedbackLog(projectPath);
    expect(results).toHaveLength(1);
    expect(results[0].project_path).toBe(projectPath);
  });

  it('reads from global when no projectPath provided', () => {
    const entry = makeEntry({ project_path: '' });
    writeFileSync(join(TEST_DIR, 'feedback-log.jsonl'), JSON.stringify(entry) + '\n', 'utf-8');

    const results = readFeedbackLog();
    expect(results).toHaveLength(1);
  });
});

describe('updateAgentPerformance — project routing', () => {
  function makeEntries(agentName: string, projectPath: string): FeedbackEntry[] {
    return [
      makeEntry({ agent_used: agentName, project_path: projectPath, event_type: 'success' }),
    ];
  }

  it('writes to project-scoped file when projectPath provided', () => {
    const projectPath = '/home/dev/perf-test';
    const slug = deriveProjectSlug(projectPath);
    const entries = makeEntries('oracle', projectPath);

    updateAgentPerformance('oracle', entries, projectPath);

    const projectPerfFile = join(TEST_DIR, 'projects', slug, 'agent-performance.json');
    expect(existsSync(projectPerfFile)).toBe(true);
    const data = JSON.parse(readFileSync(projectPerfFile, 'utf-8'));
    expect(data['oracle']).toBeDefined();
  });

  it('always writes to global file', () => {
    const entries = makeEntries('oracle', '/home/dev/any-project');
    updateAgentPerformance('oracle', entries);

    const globalFile = join(TEST_DIR, 'agent-performance.json');
    expect(existsSync(globalFile)).toBe(true);
    const data = JSON.parse(readFileSync(globalFile, 'utf-8'));
    expect(data['oracle']).toBeDefined();
  });

  it('writes global even if project write fails', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const projectPath = '/home/dev/fail-project';

    const entries = makeEntries('oracle', projectPath);

    const slug = deriveProjectSlug(projectPath);
    const projectDir = join(TEST_DIR, 'projects', slug);
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, 'agent-performance.json'), 'NOT_JSON', 'utf-8');

    updateAgentPerformance('oracle', entries, projectPath);

    const globalFile = join(TEST_DIR, 'agent-performance.json');
    expect(existsSync(globalFile)).toBe(true);

    errorSpy.mockRestore();
  });
});

describe('readAgentPerformance — project routing', () => {
  it('reads from project-scoped when projectPath given', () => {
    const projectPath = '/home/dev/read-perf';
    const slug = deriveProjectSlug(projectPath);
    const projectDir = join(TEST_DIR, 'projects', slug);
    mkdirSync(projectDir, { recursive: true });

    const perfData = { oracle: { agent_name: 'oracle', total_invocations: 5 } };
    writeFileSync(join(projectDir, 'agent-performance.json'), JSON.stringify(perfData), 'utf-8');

    const result = readAgentPerformance(projectPath);
    expect(result['oracle']).toBeDefined();
    expect(result['oracle'].total_invocations).toBe(5);
  });

  it('reads from global when no projectPath', () => {
    const perfData = { librarian: { agent_name: 'librarian', total_invocations: 3 } };
    writeFileSync(join(TEST_DIR, 'agent-performance.json'), JSON.stringify(perfData), 'utf-8');

    const result = readAgentPerformance();
    expect(result['librarian']).toBeDefined();
  });
});

describe('appendSessionSummary — project routing', () => {
  it('routes to project-scoped with projectPath', () => {
    const projectPath = '/home/dev/summary-test';
    const slug = deriveProjectSlug(projectPath);
    const summary = makeSessionSummary({ project_path: projectPath });

    appendSessionSummary(summary, projectPath);

    const projectFile = join(TEST_DIR, 'projects', slug, 'session-summaries.jsonl');
    expect(existsSync(projectFile)).toBe(true);
    const content = readFileSync(projectFile, 'utf-8');
    expect(JSON.parse(content.trim()).project_path).toBe(projectPath);
  });

  it('routes to global when no projectPath', () => {
    const summary = makeSessionSummary();
    appendSessionSummary(summary);

    const globalFile = join(TEST_DIR, 'session-summaries.jsonl');
    expect(existsSync(globalFile)).toBe(true);
  });
});

describe('loadSessionSummaries — project routing', () => {
  it('routes to project-scoped with projectPath', () => {
    const projectPath = '/home/dev/load-summaries';
    const slug = deriveProjectSlug(projectPath);
    const projectDir = join(TEST_DIR, 'projects', slug);
    mkdirSync(projectDir, { recursive: true });

    const summary = makeSessionSummary({ project_path: projectPath });
    writeFileSync(
      join(projectDir, 'session-summaries.jsonl'),
      JSON.stringify(summary) + '\n',
      'utf-8'
    );

    const results = loadSessionSummaries(projectPath);
    expect(results).toHaveLength(1);
    expect(results[0].project_path).toBe(projectPath);
  });
});
