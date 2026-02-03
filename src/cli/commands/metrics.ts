/**
 * Token Metrics CLI Commands (DEPRECATED)
 *
 * @deprecated This command is deprecated. Use `olympus learn` commands instead:
 * - `olympus learn --show` - View learning data
 * - `olympus learn --efficiency` - View token efficiency metrics
 * - `olympus learn --show-costs` - View cost breakdown
 * - `olympus learn --budget-status` - View session budget
 */

import chalk from 'chalk';

/**
 * Show deprecation message
 */
function showDeprecationMessage(): void {
  console.log(chalk.yellow.bold('\n⚠ DEPRECATED COMMAND\n'));
  console.log(chalk.white('The `olympus metrics` command has been deprecated.'));
  console.log(chalk.white('Token metrics are now integrated into the learning system.\n'));
  console.log(chalk.blue('Use these commands instead:\n'));
  console.log(chalk.cyan('  olympus learn --show') + chalk.gray('          # View learning data and metrics'));
  console.log(chalk.cyan('  olympus learn --efficiency') + chalk.gray('    # View agent efficiency rankings'));
  console.log(chalk.cyan('  olympus learn --show-costs') + chalk.gray('    # View cost breakdown'));
  console.log(chalk.cyan('  olympus learn --budget-status') + chalk.gray('  # View session token budget\n'));
}

/**
 * Show recent token metrics in table format
 * @deprecated Use `olympus learn --show` instead
 */
export async function showMetrics(options: { limit?: number }): Promise<void> {
  showDeprecationMessage();
}

/**
 * Export metrics to file
 * @deprecated Use `olympus learn --export` instead
 */
export async function exportMetrics(options: {
  format?: 'csv' | 'json';
  output?: string;
}): Promise<void> {
  showDeprecationMessage();
}

/**
 * Analyze token metrics and show summary statistics
 * @deprecated Use `olympus learn --efficiency` instead
 */
export async function analyzeMetrics(options: { sessions?: number }): Promise<void> {
  showDeprecationMessage();
}

/**
 * Clean up old metrics
 * @deprecated Use `olympus learn --cleanup` instead
 */
export async function cleanMetrics(options: { days?: number }): Promise<void> {
  showDeprecationMessage();
}
