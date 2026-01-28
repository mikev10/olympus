import type { FeedbackEntry, AgentPerformance } from './types.js';

const DEFAULT_AGENT_PERFORMANCE: AgentPerformance = {
  agent_name: '',
  total_invocations: 0,
  success_count: 0,
  revision_count: 0,
  cancellation_count: 0,
  success_rate: 0,
  failure_patterns: [],
  strong_areas: [],
  weak_areas: [],
  last_updated: new Date().toISOString(),
};

/** Evaluate agent performance from feedback log */
export function evaluateAgentPerformance(
  feedbackLog: FeedbackEntry[]
): Map<string, AgentPerformance> {
  const performance = new Map<string, AgentPerformance>();

  // Group feedback by agent
  for (const entry of feedbackLog) {
    if (!entry.agent_used) continue;

    const agent = entry.agent_used;
    if (!performance.has(agent)) {
      performance.set(agent, { ...DEFAULT_AGENT_PERFORMANCE, agent_name: agent });
    }

    const perf = performance.get(agent)!;
    perf.total_invocations++;

    switch (entry.event_type) {
      case 'success':
        perf.success_count++;
        break;
      case 'revision':
        perf.revision_count++;
        break;
      case 'cancellation':
        perf.cancellation_count++;
        break;
    }

    perf.success_rate = perf.total_invocations > 0
      ? perf.success_count / perf.total_invocations
      : 0;

    perf.last_updated = new Date().toISOString();
  }

  // Identify failure patterns for each agent
  for (const [agent, perf] of performance) {
    const agentFeedback = feedbackLog.filter(
      e => e.agent_used === agent &&
           (e.event_type === 'revision' || e.event_type === 'cancellation')
    );

    perf.failure_patterns = identifyFailurePatterns(agentFeedback);
    perf.strong_areas = identifyAreas(feedbackLog, agent, 'success');
    perf.weak_areas = identifyAreas(feedbackLog, agent, 'revision');
  }

  return performance;
}

/** Identify common failure patterns for an agent */
function identifyFailurePatterns(
  feedback: FeedbackEntry[]
): Array<{ pattern: string; count: number; examples: string[] }> {
  const patterns: Map<string, { count: number; examples: string[] }> = new Map();

  for (const entry of feedback) {
    // Extract key themes from the feedback
    const themes = extractThemes(entry.user_message);

    for (const theme of themes) {
      if (!patterns.has(theme)) {
        patterns.set(theme, { count: 0, examples: [] });
      }
      const p = patterns.get(theme)!;
      p.count++;
      if (p.examples.length < 3) {
        p.examples.push(entry.user_message.substring(0, 50));
      }
    }
  }

  return [...patterns.entries()]
    .filter(([_, p]) => p.count >= 2)
    .map(([theme, p]) => ({ pattern: theme, ...p }));
}

/** Extract themes from feedback text */
function extractThemes(text: string): string[] {
  const themes: string[] = [];

  // Common issue categories
  const categoryPatterns = [
    { pattern: /error handling/i, theme: 'error handling' },
    { pattern: /types?|typescript/i, theme: 'TypeScript types' },
    { pattern: /test(s|ing)?/i, theme: 'testing' },
    { pattern: /edge case/i, theme: 'edge cases' },
    { pattern: /documentation|docs|comments?/i, theme: 'documentation' },
    { pattern: /performance|slow|fast/i, theme: 'performance' },
    { pattern: /style|format|prettier|eslint/i, theme: 'code style' },
    { pattern: /security|auth|password/i, theme: 'security' },
    { pattern: /react|component/i, theme: 'React' },
    { pattern: /api|endpoint|fetch/i, theme: 'API' },
  ];

  for (const { pattern, theme } of categoryPatterns) {
    if (pattern.test(text)) {
      themes.push(theme);
    }
  }

  return themes.length > 0 ? themes : ['general'];
}

/** Identify areas where agent is strong or weak */
function identifyAreas(
  feedback: FeedbackEntry[],
  agent: string,
  eventType: 'success' | 'revision'
): string[] {
  const relevantFeedback = feedback.filter(
    e => e.agent_used === agent && e.event_type === eventType
  );

  const areaCounts: Map<string, number> = new Map();

  for (const entry of relevantFeedback) {
    const themes = extractThemes(entry.original_task || entry.user_message);
    for (const theme of themes) {
      areaCounts.set(theme, (areaCounts.get(theme) || 0) + 1);
    }
  }

  return [...areaCounts.entries()]
    .filter(([_, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([area]) => area);
}

/** Create default agent performance object */
export function createDefaultAgentPerformance(agentName: string): AgentPerformance {
  return { ...DEFAULT_AGENT_PERFORMANCE, agent_name: agentName, last_updated: new Date().toISOString() };
}
