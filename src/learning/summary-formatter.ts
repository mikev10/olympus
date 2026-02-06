/**
 * Format SessionSummary into terminal output strings
 *
 * Provides utilities for displaying session summaries to users via stderr.
 * These outputs are NOT captured by Claude Code's JSON protocol and appear
 * directly in the terminal.
 */

import type { SessionSummary } from './types.js';

/**
 * Format a SessionSummary into a one-line string for terminal output.
 * Hard cap: 200 characters max.
 * If >4 agents, show first 3 + "..."
 *
 * @param summary - The session summary to format
 * @returns A formatted string suitable for terminal output (max 200 chars)
 *
 * @example
 * ```typescript
 * const summary = {
 *   session_id: '123',
 *   project_path: '/path/to/project',
 *   started_at: '2026-02-05T10:00:00.000Z',
 *   ended_at: '2026-02-05T10:05:00.000Z',
 *   duration_seconds: 300,
 *   agents_used: ['oracle', 'explore', 'olympian'],
 *   total_input_tokens: 5000,
 *   total_output_tokens: 8000,
 *   total_tokens: 13000,
 *   estimated_cost: 0.04,
 *   model: 'claude-sonnet-4-5',
 *   outcome: 'success'
 * };
 *
 * formatSessionSummaryLine(summary);
 * // => "[Olympus] Session: 3 agents (oracle, explore, olympian) | 13,000 tokens | $0.04 | 5m 0s"
 * ```
 */
export function formatSessionSummaryLine(summary: SessionSummary): string {
  // Format agents
  let agentsStr: string;
  if (summary.agents_used.length === 0) {
    agentsStr = '(none)';
  } else if (summary.agents_used.length <= 4) {
    agentsStr = summary.agents_used.join(', ');
  } else {
    agentsStr = summary.agents_used.slice(0, 3).join(', ') + ', ...';
  }

  // Format duration
  const totalSeconds = summary.duration_seconds;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  let durationStr: string;
  if (minutes > 0) {
    durationStr = `${minutes}m ${seconds}s`;
  } else {
    durationStr = `${seconds}s`;
  }

  // Format tokens (with commas for readability)
  const tokensStr = summary.total_tokens.toLocaleString('en-US');

  // Format cost (3 decimals for small amounts, 2 for larger)
  const costStr = `$${summary.estimated_cost.toFixed(summary.estimated_cost >= 0.01 ? 2 : 3)}`;

  // Build the agent count prefix
  const agentCount = summary.agents_used.length;
  const agentLabel = agentCount === 1 ? 'agent' : 'agents';

  // Assemble line
  let line = `[Olympus] Session: ${agentCount} ${agentLabel} (${agentsStr}) | ${tokensStr} tokens | ${costStr} | ${durationStr}`;

  // Hard cap at 200 chars
  if (line.length > 200) {
    line = line.substring(0, 197) + '...';
  }

  return line;
}
