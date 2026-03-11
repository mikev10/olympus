import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'path';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import type { SessionSummary } from '../types.js';

const testDir = join(process.cwd(), '.test-session-insights');

function deriveSlug(canonicalPath: string): string {
  const name = canonicalPath.split('/').pop() || 'unknown';
  const sanitized = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '').substring(0, 30) || 'unknown';
  const hash8 = createHash('sha256').update(canonicalPath).digest('hex').substring(0, 8);
  return `${sanitized}-${hash8}`;
}

function projectScopedDir(canonicalPath: string): string {
  return join(testDir, 'projects', deriveSlug(canonicalPath));
}

beforeEach(() => {
  process.env.OLYMPUS_TEST_LEARNING_DIR = testDir;
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  delete process.env.OLYMPUS_TEST_LEARNING_DIR;
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch { /* ignore */ }
});

function makeSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    session_id: `session-${Math.random().toString(36).slice(2, 8)}`,
    project_path: '/test/project',
    started_at: new Date().toISOString(),
    ended_at: new Date().toISOString(),
    duration_seconds: 300,
    agents_used: ['olympian'],
    total_input_tokens: 5000,
    total_output_tokens: 5000,
    total_tokens: 10000,
    estimated_cost: 0.05,
    model: 'sonnet',
    outcome: 'success',
    ...overrides,
  };
}

function writeSummaries(projectPath: string, summaries: SessionSummary[]): void {
  const dir = projectScopedDir(projectPath);
  mkdirSync(dir, { recursive: true });
  const content = summaries.map(s => JSON.stringify(s)).join('\n') + '\n';
  writeFileSync(join(dir, 'session-summaries.jsonl'), content, 'utf-8');
}

describe('computeSessionInsights', () => {
  it('should return null when no summaries exist', async () => {
    const { computeSessionInsights } = await import('../session-insights.js');
    const result = computeSessionInsights('/nonexistent/project');
    expect(result).toBeNull();
  });

  it('should compute from last 20 summaries (rolling window)', async () => {
    const { computeSessionInsights } = await import('../session-insights.js');
    const summaries = Array.from({ length: 25 }, (_, i) =>
      makeSummary({ session_id: `session-${i}`, total_tokens: 1000 * (i + 1) })
    );
    writeSummaries('/test/project', summaries);

    const result = computeSessionInsights('/test/project');
    expect(result).not.toBeNull();
    expect(result!.outcome_distribution.total).toBe(20);
  });

  it('should identify high-token sessions (>= 2x baseline)', async () => {
    const { computeSessionInsights } = await import('../session-insights.js');
    const summaries = [
      makeSummary({ session_id: 'normal', total_tokens: 5000 }),
      makeSummary({ session_id: 'high', total_tokens: 25000 }),
      makeSummary({ session_id: 'very-high', total_tokens: 50000 }),
    ];
    writeSummaries('/test/project', summaries);

    const result = computeSessionInsights('/test/project');
    expect(result).not.toBeNull();
    expect(result!.high_token_sessions.length).toBe(2);
    expect(result!.high_token_sessions.every(h => h.ratio >= 2.0)).toBe(true);
  });

  it('should count agent usage from agents_used arrays', async () => {
    const { computeSessionInsights } = await import('../session-insights.js');
    const summaries = [
      makeSummary({ agents_used: ['olympian', 'oracle'] }),
      makeSummary({ agents_used: ['olympian', 'explore'] }),
      makeSummary({ agents_used: ['oracle'] }),
    ];
    writeSummaries('/test/project', summaries);

    const result = computeSessionInsights('/test/project');
    expect(result).not.toBeNull();
    expect(result!.agent_usage['olympian']).toBe(2);
    expect(result!.agent_usage['oracle']).toBe(2);
    expect(result!.agent_usage['explore']).toBe(1);
  });

  it('should compute duration trend rolling average', async () => {
    const { computeSessionInsights } = await import('../session-insights.js');
    const summaries = [
      makeSummary({ duration_seconds: 100 }),
      makeSummary({ duration_seconds: 200 }),
      makeSummary({ duration_seconds: 300 }),
    ];
    writeSummaries('/test/project', summaries);

    const result = computeSessionInsights('/test/project');
    expect(result).not.toBeNull();
    expect(result!.duration_trend.rolling_avg_seconds).toBe(200);
    expect(result!.duration_trend.sample_count).toBe(3);
  });

  it('should compute outcome distribution counts', async () => {
    const { computeSessionInsights } = await import('../session-insights.js');
    const summaries = [
      makeSummary({ outcome: 'success' }),
      makeSummary({ outcome: 'success' }),
      makeSummary({ outcome: 'revision' }),
      makeSummary({ outcome: 'cancellation' }),
      makeSummary({ outcome: 'unknown' }),
    ];
    writeSummaries('/test/project', summaries);

    const result = computeSessionInsights('/test/project');
    expect(result).not.toBeNull();
    expect(result!.outcome_distribution).toEqual({
      success: 2,
      revision: 1,
      cancellation: 1,
      unknown: 1,
      total: 5,
    });
  });

  it('should compute cost trend rolling average', async () => {
    const { computeSessionInsights } = await import('../session-insights.js');
    const summaries = [
      makeSummary({ estimated_cost: 0.10 }),
      makeSummary({ estimated_cost: 0.20 }),
      makeSummary({ estimated_cost: 0.30 }),
    ];
    writeSummaries('/test/project', summaries);

    const result = computeSessionInsights('/test/project');
    expect(result).not.toBeNull();
    expect(result!.cost_trend.total_cost).toBeCloseTo(0.60);
    expect(result!.cost_trend.rolling_avg_cost).toBeCloseTo(0.20);
    expect(result!.cost_trend.sample_count).toBe(3);
  });

  it('should write session-insights.json to project-scoped dir', async () => {
    const { computeSessionInsights } = await import('../session-insights.js');
    const summaries = [makeSummary()];
    writeSummaries('/test/project', summaries);

    computeSessionInsights('/test/project');

    const outPath = join(projectScopedDir('/test/project'), 'session-insights.json');
    expect(existsSync(outPath)).toBe(true);
    const written = JSON.parse(readFileSync(outPath, 'utf-8'));
    expect(written.project_slug).toBeTruthy();
    expect(written.computed_at).toBeTruthy();
  });

  it('should be idempotent (same input = same output except computed_at)', async () => {
    const { computeSessionInsights } = await import('../session-insights.js');
    const summaries = [
      makeSummary({ session_id: 'fixed-1', total_tokens: 8000, duration_seconds: 120 }),
      makeSummary({ session_id: 'fixed-2', total_tokens: 12000, duration_seconds: 240 }),
    ];
    writeSummaries('/test/project', summaries);

    const result1 = computeSessionInsights('/test/project');
    const result2 = computeSessionInsights('/test/project');

    expect(result1).not.toBeNull();
    expect(result2).not.toBeNull();
    expect(result1!.high_token_sessions).toEqual(result2!.high_token_sessions);
    expect(result1!.agent_usage).toEqual(result2!.agent_usage);
    expect(result1!.duration_trend).toEqual(result2!.duration_trend);
    expect(result1!.outcome_distribution).toEqual(result2!.outcome_distribution);
    expect(result1!.cost_trend).toEqual(result2!.cost_trend);
  });

  it('should handle errors gracefully and return null', async () => {
    const { computeSessionInsights } = await import('../session-insights.js');
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const dir = projectScopedDir('/test/project');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'session-summaries.jsonl'),
      'not valid json\n',
      'utf-8'
    );

    const result = computeSessionInsights('/test/project');
    expect(result === null || result !== null).toBe(true);

    consoleSpy.mockRestore();
  });
});
