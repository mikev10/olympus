import { join } from 'path';
import type { UserPreferences, AgentPerformance, ProjectPatterns, AgentDiscovery } from '../types.js';
import { readJsonFile, getLearningDir, getProjectLearningDir } from '../storage.js';
import { hasMinimumSamples } from '../aggregation.js';
import { getSessionBaseline } from '../baselines.js';

const MAX_INJECTION_TOKENS = 500;  // Approximate limit

/** Generate learned context for injection */
export function generateLearnedContext(projectPath: string): string {
  const globalPrefs = readJsonFile<UserPreferences | null>(
    join(getLearningDir(), 'user-preferences.json'),
    null
  );

  const projectPatterns = readJsonFile<ProjectPatterns | null>(
    join(getProjectLearningDir(projectPath), 'patterns.json'),
    null
  );

  const agentPerformance = readJsonFile<Record<string, AgentPerformance>>(
    join(getLearningDir(), 'agent-performance.json'),
    {}
  );

  const sections: string[] = [];

  // User preferences
  if (globalPrefs && hasContent(globalPrefs)) {
    sections.push(formatPreferences(globalPrefs));
  }

  // Project conventions
  if (projectPatterns && projectPatterns.conventions.length > 0) {
    sections.push(formatProjectPatterns(projectPatterns));
  }

  // Recent corrections (from recurring_corrections)
  if (globalPrefs?.recurring_corrections && globalPrefs.recurring_corrections.length > 0) {
    sections.push(formatCorrections(globalPrefs.recurring_corrections.slice(0, 5)));
  }

  // Agent notes (only weak areas)
  const weakAgents = Object.values(agentPerformance)
    .filter(a => a.weak_areas.length > 0);
  if (weakAgents.length > 0) {
    sections.push(formatAgentNotes(weakAgents));
  }

  // Token efficiency section (if we have agent data with token metrics)
  const tokenGuidance = formatTokenEfficiency(agentPerformance);
  if (tokenGuidance) {
    sections.push(tokenGuidance);
  }

  // Only inject if we have meaningful content
  if (sections.length === 0) {
    return '';
  }

  const content = `<learned-context>

${sections.join('\n\n')}

</learned-context>

---

`;

  // Truncate if too long (rough token estimate: 1 token ≈ 4 chars)
  if (content.length > MAX_INJECTION_TOKENS * 4) {
    return content.substring(0, MAX_INJECTION_TOKENS * 4) + '\n...</learned-context>\n\n---\n\n';
  }

  return content;
}

function hasContent(prefs: UserPreferences): boolean {
  return (
    prefs.verbosity !== 'unknown' ||
    prefs.autonomy !== 'unknown' ||
    prefs.explicit_rules.length > 0 ||
    prefs.inferred_preferences.length > 0
  );
}

function formatPreferences(prefs: UserPreferences): string {
  const lines: string[] = ['## User Preferences'];

  if (prefs.verbosity !== 'unknown') {
    lines.push(`- Verbosity: ${prefs.verbosity}`);
  }
  if (prefs.autonomy !== 'unknown') {
    lines.push(`- Autonomy: ${prefs.autonomy}`);
  }
  for (const rule of prefs.explicit_rules.slice(0, 5)) {
    lines.push(`- ${rule}`);
  }

  return lines.join('\n');
}

function formatProjectPatterns(patterns: ProjectPatterns): string {
  const lines: string[] = ['## Project Conventions'];

  for (const conv of patterns.conventions.slice(0, 5)) {
    lines.push(`- ${conv}`);
  }

  if (patterns.tech_stack.length > 0) {
    lines.push(`- Tech: ${patterns.tech_stack.join(', ')}`);
  }

  return lines.join('\n');
}

function formatCorrections(corrections: Array<{ pattern: string; count: number }>): string {
  const lines: string[] = ['## Avoid These Mistakes'];

  for (const c of corrections) {
    lines.push(`- ${c.pattern} (${c.count}x)`);
  }

  return lines.join('\n');
}

function formatAgentNotes(agents: AgentPerformance[]): string {
  const lines: string[] = ['## Agent Notes'];

  for (const agent of agents.slice(0, 3)) {
    lines.push(`- ${agent.agent_name}: struggles with ${agent.weak_areas.join(', ')}`);
  }

  return lines.join('\n');
}

function formatTokenEfficiency(agentPerformance: Record<string, AgentPerformance>): string {
  // Filter agents with sufficient token data
  const agentsWithTokens = Object.values(agentPerformance)
    .filter(a => a.token_efficiency && hasMinimumSamples(a))
    .sort((a, b) => {
      // Sort by efficiency score (higher is better)
      const scoreA = a.token_efficiency?.efficiency_score ?? 0;
      const scoreB = b.token_efficiency?.efficiency_score ?? 0;
      return scoreB - scoreA;
    });

  if (agentsWithTokens.length === 0) {
    return ''; // No token data available
  }

  const lines: string[] = [];
  lines.push('<olympus-efficiency>');
  lines.push('AGENT EFFICIENCY (success%/avg tokens):');

  // Show top 3 most efficient agents
  for (const agent of agentsWithTokens.slice(0, 3)) {
    const successRate = Math.round(agent.success_rate * 100);
    const avgTokens = agent.token_efficiency!.avg_tokens_per_success;
    const avgTokensK = avgTokens >= 1000 ? `${(avgTokens / 1000).toFixed(1)}k` : `${Math.round(avgTokens)}`;

    // Determine if this is the preferred agent
    const isPreferred = agent.success_rate >= 0.9 && agent.token_efficiency!.efficiency_score > 0.8;
    const label = isPreferred ? ' [PREFERRED]' : '';

    lines.push(`- ${agent.agent_name}: ${successRate}%/${avgTokensK}${label}`);
  }

  // Add session budget info
  const baseline = getSessionBaseline();
  const baselineK = baseline >= 1000 ? `${(baseline / 1000).toFixed(0)}k` : baseline.toString();
  const warnThreshold = Math.round(baseline * 1.5);
  const warnK = warnThreshold >= 1000 ? `${(warnThreshold / 1000).toFixed(0)}k` : warnThreshold.toString();

  lines.push('');
  lines.push(`SESSION BUDGET: ~${baselineK} baseline | warn at ${warnK}`);
  lines.push('PATTERNS: Parallel reads save 40%');
  lines.push('');
  lines.push('Quality remains priority. Use efficiency as tiebreaker.');
  lines.push('</olympus-efficiency>');

  return lines.join('\n');
}

/** Format discoveries for injection */
export function formatDiscoveries(discoveries: AgentDiscovery[]): string {
  if (discoveries.length === 0) return '';

  const lines: string[] = ['## Agent Discoveries'];
  lines.push('');
  lines.push('These insights were discovered during previous work:');
  lines.push('');

  for (const d of discoveries.slice(0, 5)) {
    lines.push(`- **${d.category}**: ${d.summary}`);
    lines.push(`  ${d.details.substring(0, 200)}`);
  }

  return lines.join('\n');
}
