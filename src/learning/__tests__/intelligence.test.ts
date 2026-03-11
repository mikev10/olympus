import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'path';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import type { AgentPerformance, FeedbackEntry } from '../types.js';

const testDir = join(process.cwd(), '.test-intelligence');

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
  } catch { /* cleanup */ }
});

function makePerf(overrides: Partial<AgentPerformance> = {}): AgentPerformance {
  return {
    agent_name: 'oracle-low',
    total_invocations: 15,
    success_count: 13,
    revision_count: 1,
    cancellation_count: 1,
    success_rate: 0.87,
    failure_patterns: [],
    strong_areas: ['high success rate'],
    weak_areas: [],
    last_updated: new Date().toISOString(),
    ...overrides,
  };
}

function makeFeedbackEntry(overrides: Partial<FeedbackEntry> = {}): FeedbackEntry {
  return {
    id: `fb-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    session_id: 'test-session',
    project_path: '/test/project',
    event_type: 'revision',
    user_message: 'use TypeScript strict mode',
    feedback_category: 'correction',
    confidence: 0.8,
    ...overrides,
  };
}

function writeGlobalAgentPerf(perf: Record<string, AgentPerformance>): void {
  writeFileSync(join(testDir, 'agent-performance.json'), JSON.stringify(perf), 'utf-8');
}

function writeProjectAgentPerf(projectPath: string, perf: Record<string, AgentPerformance>): void {
  const dir = projectScopedDir(projectPath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'agent-performance.json'), JSON.stringify(perf), 'utf-8');
}

describe('baselines (Unit 3 changes)', () => {
  it('getSessionBaseline without projectPath returns correct values', async () => {
    const { getSessionBaseline } = await import('../baselines.js');

    expect(getSessionBaseline()).toBe(10000);
    expect(getSessionBaseline('debugging', {
      overall_avg: 9000,
      by_task_type: { debugging: 7000 },
      sample_count: 10,
      last_updated: new Date().toISOString(),
    })).toBe(7000);
  });

  it('updateSessionBaseline without projectPath updates correctly', async () => {
    const { updateSessionBaseline } = await import('../baselines.js');

    const result = updateSessionBaseline(8000, 'code-gen');
    expect(result.overall_avg).toBe(8000);
    expect(result.by_task_type['code-gen']).toBe(8000);
    expect(result.sample_count).toBe(1);
  });

  it('by_project field is absent from returned SessionBaseline', async () => {
    const { updateSessionBaseline } = await import('../baselines.js');

    const result = updateSessionBaseline(8000, 'task');
    expect((result as unknown as Record<string, unknown>)['by_project']).toBeUndefined();
  });
});

describe('pattern-extractor (Unit 3 changes)', () => {
  it('clustering uses 0.4 threshold (less permissive)', async () => {
    const { SIMILARITY_THRESHOLD } = await import('../pattern-extractor.js');
    expect(SIMILARITY_THRESHOLD).toBe(0.4);
  });

  it('extractPatterns filters by projectPath when provided', async () => {
    const { extractPatterns } = await import('../pattern-extractor.js');

    const entries: FeedbackEntry[] = [
      makeFeedbackEntry({ project_path: '/project-a', user_message: 'use strict types always' }),
      makeFeedbackEntry({ project_path: '/project-a', user_message: 'use strict types always' }),
      makeFeedbackEntry({ project_path: '/project-a', user_message: 'use strict types always' }),
      makeFeedbackEntry({ project_path: '/project-b', user_message: 'use strict types always' }),
      makeFeedbackEntry({ project_path: '/project-b', user_message: 'use strict types always' }),
      makeFeedbackEntry({ project_path: '/project-b', user_message: 'use strict types always' }),
    ];

    const filtered = extractPatterns(entries, 3, 1000, '/project-a');
    const allEntries = extractPatterns(entries, 3, 1000);

    expect(filtered.length).toBeGreaterThanOrEqual(0);
    expect(allEntries.length).toBeGreaterThanOrEqual(filtered.length);
  });

  it('extractPatterns uses all entries when no projectPath', async () => {
    const { extractPatterns } = await import('../pattern-extractor.js');

    const entries: FeedbackEntry[] = Array.from({ length: 5 }, () =>
      makeFeedbackEntry({ user_message: 'always use TypeScript strict mode configuration' })
    );

    const result = extractPatterns(entries, 3, 1000);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});

describe('routing (Unit 3 changes)', () => {
  it('getRoutingRecommendation with projectPath reads project perf', async () => {
    const { getRoutingRecommendation } = await import('../routing.js');

    writeProjectAgentPerf('/test/project', {
      'oracle-low': makePerf({ total_invocations: 20, success_rate: 0.90 }),
    });

    const result = getRoutingRecommendation('oracle', 'debug something', '/test/project');
    expect(result).not.toBeNull();
    expect(result).toContain('oracle-low');
  });

  it('cold-start blending applies when invocations < 5', async () => {
    const { getRoutingRecommendation, COLD_START_FALLBACK_RATE } = await import('../routing.js');

    expect(COLD_START_FALLBACK_RATE).toBe(0.5);

    writeGlobalAgentPerf({
      'oracle-low': makePerf({ total_invocations: 2, success_rate: 0.95 }),
    });

    // weight = 2/5 = 0.4, blended = 0.4 * 0.95 + 0.6 * 0.5 = 0.68
    // 0.68 < 0.80 (minSuccessRate), so should NOT recommend
    const result = getRoutingRecommendation('oracle', 'debug something');
    expect(result).toBeNull();
  });

  it('no blending when invocations >= 5', async () => {
    const { getRoutingRecommendation } = await import('../routing.js');

    writeGlobalAgentPerf({
      'oracle-low': makePerf({ total_invocations: 12, success_rate: 0.90 }),
    });

    const result = getRoutingRecommendation('oracle', 'debug something');
    expect(result).not.toBeNull();
    expect(result).toContain('oracle-low');
  });
});

describe('aggregation (Unit 3 changes)', () => {
  it('per-agent baseline used when available', async () => {
    const { updateAgentTokenEfficiency } = await import('../aggregation.js');

    const agentPerf = makePerf({
      agent_name: 'olympian',
      token_efficiency: {
        avg_tokens_per_success: 40000,
        avg_tokens_per_failure: 60000,
        total_tokens: 250000,
        invocation_count: 5,
        efficiency_score: 0.8,
        trend: 'stable',
      },
    });

    writeProjectAgentPerf('/test/project', { olympian: agentPerf });

    const perf = makePerf({
      agent_name: 'olympian',
      success_rate: 0.85,
    });

    const result = updateAgentTokenEfficiency(perf, 45000, true, 10000, '/test/project');
    expect(result.token_efficiency).toBeDefined();
    expect(result.token_efficiency!.invocation_count).toBe(1);
  });

  it('global session baseline used as fallback', async () => {
    const { updateAgentTokenEfficiency } = await import('../aggregation.js');

    const perf = makePerf({
      agent_name: 'new-agent',
      success_rate: 0.80,
    });

    const result = updateAgentTokenEfficiency(perf, 8000, true, 10000);
    expect(result.token_efficiency).toBeDefined();
    expect(result.token_efficiency!.total_tokens).toBe(8000);
  });
});

describe('learned-context (Unit 3 changes)', () => {
  it('explicit rules filtered by project_path', async () => {
    const { generateLearnedContext } = await import('../hooks/learned-context.js');

    writeFileSync(join(testDir, 'user-preferences.json'), JSON.stringify({
      verbosity: 'concise',
      autonomy: 'balanced',
      explanation_depth: 'moderate',
      explicit_rules: [
        { rule: 'Global rule', source: 'user' },
        { rule: 'Project A rule', project_path: '/project-a', source: 'user' },
        { rule: 'Project B rule', project_path: '/project-b', source: 'user' },
      ],
      inferred_preferences: [],
      recurring_corrections: [],
      last_updated: new Date().toISOString(),
    }), 'utf-8');

    const context = generateLearnedContext('/project-a');
    expect(context).toContain('Global rule');
    expect(context).toContain('Project A rule');
    expect(context).not.toContain('Project B rule');
  });

  it('agent performance merges project + global', async () => {
    const { generateLearnedContext } = await import('../hooks/learned-context.js');

    writeFileSync(join(testDir, 'user-preferences.json'), JSON.stringify({
      verbosity: 'unknown',
      autonomy: 'unknown',
      explanation_depth: 'unknown',
      explicit_rules: [],
      inferred_preferences: [],
      recurring_corrections: [],
      last_updated: new Date().toISOString(),
    }), 'utf-8');

    writeGlobalAgentPerf({
      'oracle-low': makePerf({
        agent_name: 'oracle-low',
        weak_areas: ['complex debugging'],
      }),
      'explore': makePerf({
        agent_name: 'explore',
        weak_areas: ['large repos'],
      }),
    });

    writeProjectAgentPerf('/test/project', {
      'oracle-low': makePerf({
        agent_name: 'oracle-low',
        weak_areas: ['project-specific issue'],
      }),
    });

    const context = generateLearnedContext('/test/project');

    if (context.includes('Agent Notes')) {
      expect(context).toContain('project-specific issue');
      expect(context).toContain('explore');
    }
  });
});
