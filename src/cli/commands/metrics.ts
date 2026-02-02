/**
 * Token Metrics CLI Commands
 *
 * Commands for viewing and analyzing token usage metrics.
 */

import chalk from 'chalk';
import { readTokenMetrics, readAllTokenMetrics, cleanupOldMetrics } from '../../features/token-metrics/storage.js';
import type { TokenMetricsEntry } from '../../features/token-metrics/types.js';
import { writeFileSync } from 'fs';

/**
 * Group metrics by session ID
 */
function groupBySession(entries: TokenMetricsEntry[]): Map<string, TokenMetricsEntry[]> {
  const sessionMap = new Map<string, TokenMetricsEntry[]>();

  for (const entry of entries) {
    const sessionEntries = sessionMap.get(entry.session_id) || [];
    sessionEntries.push(entry);
    sessionMap.set(entry.session_id, sessionEntries);
  }

  return sessionMap;
}

/**
 * Calculate session totals
 */
function calculateSessionTotals(entries: TokenMetricsEntry[]): {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  eventCount: number;
} {
  let inputTokens = 0;
  let outputTokens = 0;

  for (const entry of entries) {
    inputTokens += entry.input_tokens || 0;
    outputTokens += entry.output_tokens || 0;
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    eventCount: entries.length
  };
}

/**
 * Format token count with thousands separator
 */
function formatTokens(tokens: number): string {
  return tokens.toLocaleString();
}

/**
 * Show recent token metrics in table format
 */
export async function showMetrics(options: { limit?: number }): Promise<void> {
  const limit = options.limit || 50;
  const entries = await readTokenMetrics(process.cwd(), limit);

  if (entries.length === 0) {
    console.log(chalk.yellow('No token metrics found.'));
    console.log(chalk.gray('Metrics are automatically collected during agent sessions.'));
    return;
  }

  console.log(chalk.blue.bold('\n╭─────────────────────────────────────────────────────────────╮'));
  console.log(chalk.blue.bold('│              TOKEN METRICS                                  │'));
  console.log(chalk.blue.bold('╰─────────────────────────────────────────────────────────────╯\n'));

  // Group by session
  const sessionMap = groupBySession(entries);

  console.log(chalk.white(`Showing last ${entries.length} entries (${sessionMap.size} sessions):\n`));

  for (const [sessionId, sessionEntries] of sessionMap) {
    const totals = calculateSessionTotals(sessionEntries);
    const firstEntry = sessionEntries[0];
    const timestamp = new Date(firstEntry.timestamp).toLocaleString();

    console.log(chalk.cyan(`Session: ${sessionId.substring(0, 8)}...`));
    console.log(chalk.gray(`  Started: ${timestamp}`));
    console.log(chalk.white(`  Input:   ${formatTokens(totals.inputTokens)} tokens`));
    console.log(chalk.white(`  Output:  ${formatTokens(totals.outputTokens)} tokens`));
    console.log(chalk.green(`  Total:   ${formatTokens(totals.totalTokens)} tokens`));
    console.log(chalk.gray(`  Events:  ${totals.eventCount}`));

    if (firstEntry.model) {
      console.log(chalk.gray(`  Model:   ${firstEntry.model}`));
    }

    console.log('');
  }

  // Overall totals
  const allTotals = calculateSessionTotals(entries);
  console.log(chalk.blue.bold('Overall Totals:'));
  console.log(chalk.white(`  Input:   ${formatTokens(allTotals.inputTokens)} tokens`));
  console.log(chalk.white(`  Output:  ${formatTokens(allTotals.outputTokens)} tokens`));
  console.log(chalk.green.bold(`  Total:   ${formatTokens(allTotals.totalTokens)} tokens`));
  console.log('');
}

/**
 * Export metrics to file
 */
export async function exportMetrics(options: {
  format?: 'csv' | 'json';
  output?: string;
}): Promise<void> {
  const format = options.format || 'json';
  const entries = await readAllTokenMetrics(process.cwd());

  if (entries.length === 0) {
    console.log(chalk.yellow('No token metrics to export.'));
    return;
  }

  let content: string;

  if (format === 'csv') {
    // CSV export
    const headers = [
      'timestamp',
      'session_id',
      'event_type',
      'input_tokens',
      'output_tokens',
      'model',
      'tool_name',
      'context_size',
      'project_path'
    ];

    const rows = entries.map(entry => [
      entry.timestamp,
      entry.session_id,
      entry.event_type,
      entry.input_tokens || '',
      entry.output_tokens || '',
      entry.model || '',
      entry.tool_name || '',
      entry.context_size || '',
      entry.project_path || ''
    ]);

    content = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');
  } else {
    // JSON export
    content = JSON.stringify(entries, null, 2);
  }

  if (options.output) {
    // Write to file
    writeFileSync(options.output, content, 'utf-8');
    console.log(chalk.green(`✓ Exported ${entries.length} entries to ${options.output}`));
  } else {
    // Output to stdout
    console.log(content);
  }
}

/**
 * Analyze token metrics and show summary statistics
 */
export async function analyzeMetrics(options: { sessions?: number }): Promise<void> {
  const entries = await readAllTokenMetrics(process.cwd());

  if (entries.length === 0) {
    console.log(chalk.yellow('No token metrics to analyze.'));
    return;
  }

  console.log(chalk.blue.bold('\n╭─────────────────────────────────────────────────────────────╮'));
  console.log(chalk.blue.bold('│           TOKEN METRICS ANALYSIS                            │'));
  console.log(chalk.blue.bold('╰─────────────────────────────────────────────────────────────╯\n'));

  // Group by session
  const sessionMap = groupBySession(entries);
  const sessionLimit = options.sessions || 10;

  // Calculate session statistics
  const sessionStats: Array<{
    sessionId: string;
    timestamp: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    eventCount: number;
    model?: string;
  }> = [];

  for (const [sessionId, sessionEntries] of sessionMap) {
    const totals = calculateSessionTotals(sessionEntries);
    sessionStats.push({
      sessionId,
      timestamp: sessionEntries[0].timestamp,
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      totalTokens: totals.totalTokens,
      eventCount: totals.eventCount,
      model: sessionEntries[0].model
    });
  }

  // Sort by total tokens (descending)
  sessionStats.sort((a, b) => b.totalTokens - a.totalTokens);

  // Limit to recent sessions
  const recentSessions = sessionStats.slice(0, sessionLimit);

  // Calculate averages
  const avgInputTokens = recentSessions.reduce((sum, s) => sum + s.inputTokens, 0) / recentSessions.length;
  const avgOutputTokens = recentSessions.reduce((sum, s) => sum + s.outputTokens, 0) / recentSessions.length;
  const avgTotalTokens = recentSessions.reduce((sum, s) => sum + s.totalTokens, 0) / recentSessions.length;

  console.log(chalk.white.bold('Summary Statistics:'));
  console.log(chalk.white(`  Total sessions analyzed: ${sessionStats.length}`));
  console.log(chalk.white(`  Total events recorded:   ${entries.length}`));
  console.log(chalk.white(`  Avg input per session:   ${formatTokens(Math.round(avgInputTokens))} tokens`));
  console.log(chalk.white(`  Avg output per session:  ${formatTokens(Math.round(avgOutputTokens))} tokens`));
  console.log(chalk.green(`  Avg total per session:   ${formatTokens(Math.round(avgTotalTokens))} tokens`));
  console.log('');

  // Most expensive sessions
  console.log(chalk.white.bold(`Most Expensive Sessions (top ${recentSessions.length}):`));
  console.log('');

  for (let i = 0; i < recentSessions.length; i++) {
    const session = recentSessions[i];
    const timestamp = new Date(session.timestamp).toLocaleString();

    console.log(chalk.cyan(`${i + 1}. Session ${session.sessionId.substring(0, 8)}...`));
    console.log(chalk.gray(`   Date:    ${timestamp}`));
    console.log(chalk.white(`   Input:   ${formatTokens(session.inputTokens)} tokens`));
    console.log(chalk.white(`   Output:  ${formatTokens(session.outputTokens)} tokens`));
    console.log(chalk.green(`   Total:   ${formatTokens(session.totalTokens)} tokens`));
    console.log(chalk.gray(`   Events:  ${session.eventCount}`));

    if (session.model) {
      console.log(chalk.gray(`   Model:   ${session.model}`));
    }

    console.log('');
  }

  // Event type breakdown
  const eventTypeMap = new Map<string, { input: number; output: number; count: number }>();

  for (const entry of entries) {
    const stats = eventTypeMap.get(entry.event_type) || { input: 0, output: 0, count: 0 };
    stats.input += entry.input_tokens || 0;
    stats.output += entry.output_tokens || 0;
    stats.count += 1;
    eventTypeMap.set(entry.event_type, stats);
  }

  console.log(chalk.white.bold('By Event Type:'));
  for (const [eventType, stats] of eventTypeMap) {
    const total = stats.input + stats.output;
    console.log(chalk.cyan(`  ${eventType}:`));
    console.log(chalk.white(`    Input:  ${formatTokens(stats.input)} tokens`));
    console.log(chalk.white(`    Output: ${formatTokens(stats.output)} tokens`));
    console.log(chalk.green(`    Total:  ${formatTokens(total)} tokens`));
    console.log(chalk.gray(`    Count:  ${stats.count} events`));
  }
  console.log('');

  // Model breakdown
  const modelMap = new Map<string, { input: number; output: number; count: number }>();

  for (const entry of entries) {
    if (!entry.model) continue;

    const stats = modelMap.get(entry.model) || { input: 0, output: 0, count: 0 };
    stats.input += entry.input_tokens || 0;
    stats.output += entry.output_tokens || 0;
    stats.count += 1;
    modelMap.set(entry.model, stats);
  }

  if (modelMap.size > 0) {
    console.log(chalk.white.bold('By Model:'));
    for (const [model, stats] of modelMap) {
      const total = stats.input + stats.output;
      console.log(chalk.cyan(`  ${model}:`));
      console.log(chalk.white(`    Input:  ${formatTokens(stats.input)} tokens`));
      console.log(chalk.white(`    Output: ${formatTokens(stats.output)} tokens`));
      console.log(chalk.green(`    Total:  ${formatTokens(total)} tokens`));
      console.log(chalk.gray(`    Count:  ${stats.count} events`));
    }
    console.log('');
  }

  // Token usage trends
  console.log(chalk.white.bold('Usage Trends:'));

  if (sessionStats.length >= 2) {
    const oldestSession = sessionStats[sessionStats.length - 1];
    const newestSession = sessionStats[0];
    const trend = newestSession.totalTokens > oldestSession.totalTokens ? 'increasing' : 'decreasing';
    const trendColor = trend === 'increasing' ? chalk.yellow : chalk.green;

    console.log(trendColor(`  Token usage is ${trend}`));
    console.log(chalk.gray(`  Oldest session: ${formatTokens(oldestSession.totalTokens)} tokens`));
    console.log(chalk.gray(`  Newest session: ${formatTokens(newestSession.totalTokens)} tokens`));
  } else {
    console.log(chalk.gray('  Insufficient data for trend analysis'));
  }

  console.log('');
}

/**
 * Clean up old metrics
 */
export async function cleanMetrics(options: { days?: number }): Promise<void> {
  const days = options.days || 30;

  console.log(chalk.blue(`Cleaning up metrics older than ${days} days...\n`));

  await cleanupOldMetrics(days, process.cwd());

  console.log(chalk.green('✓ Cleanup complete'));
}
