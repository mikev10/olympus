#!/usr/bin/env node

/**
 * Olympus CLI
 *
 * Command-line interface for the Olympus multi-agent system.
 *
 * Commands:
 * - run: Start an interactive session
 * - init: Initialize configuration in current directory
 * - config: Show or edit configuration
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import {
  loadConfig,
  getConfigPaths,
  generateConfigSchema
} from '../config/loader.js';
import { createOlympusSession } from '../index.js';
import {
  checkForUpdates,
  performUpdate,
  formatUpdateNotification,
  getInstalledVersion
} from '../features/auto-update.js';
import {
  install as installOlympus,
  uninstall as uninstallOlympus,
  isInstalled,
  getInstallInfo
} from '../installer/index.js';
import {
  readFeedbackLog,
  readJsonFile,
  getLearningDir,
  writeJsonFile,
  appendFeedback,
  updateAgentPerformance,
  loadSessionSummaries,
  getLastSessionSummary,
  readAgentPerformance,
} from '../learning/storage.js';
import { extractPatterns } from '../learning/pattern-extractor.js';
import { extractPatterns as extractTaskPatterns, computePatternConfidence } from '../learning/pattern-matcher.js';
import { updatePreferences, createDefaultPreferences } from '../learning/preference-learner.js';
import { evaluateAgentPerformance } from '../learning/agent-evaluator.js';
import { generatePromptPatches, previewPatches, applyPromptPatches } from '../learning/prompt-patcher.js';
import { readDiscoveries, getDiscoveriesForInjection, recordDiscovery } from '../learning/discovery.js';
import { migrateNotepads } from '../learning/migrate-notepads.js';
import { generateLearningStats, formatLearningStats } from '../learning/stats.js';
import { cleanupLearning, formatCleanupResult, collectProjectDirStats } from '../learning/cleanup.js';
import { resolveProjectRoot, deriveProjectSlug, getProjectScopedDir } from '../learning/project-resolver.js';
import { getSessionBaseline, getWarningThreshold } from '../learning/baselines.js';
import { calculateCost, DEFAULT_PRICING } from '../learning/pricing.js';
import { getTokenUsage, hasEfficiencyMetrics, safeTokenTotal } from '../learning/utils.js';
import { getSessionStatePath } from '../learning/session-state.js';
import type { UserPreferences, AgentPerformance, SessionSummary, TaskPattern } from '../learning/types.js';
import { randomUUID } from 'crypto';
import { rmSync, appendFileSync, readdirSync, statSync } from 'fs';
import {
  showMetrics,
  exportMetrics,
  analyzeMetrics,
  cleanMetrics
} from './commands/metrics.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Try to load package.json for version
let version = '1.0.0';
try {
  const pkgPath = join(__dirname, '../../package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  version = pkg.version;
} catch {
  // Use default version
}

const program = new Command();

program
  .name('olympus')
  .description('Multi-agent orchestration system for Claude Agent SDK')
  .version(version);

/**
 * Init command - Initialize configuration
 */
program
  .command('init')
  .description('Initialize Olympus configuration in the current directory')
  .option('-g, --global', 'Initialize global user configuration')
  .option('-f, --force', 'Overwrite existing configuration')
  .action(async (options) => {
    const paths = getConfigPaths();
    const targetPath = options.global ? paths.user : paths.project;
    const targetDir = dirname(targetPath);

    console.log(chalk.blue('Olympus Configuration Setup\n'));

    // Check if config already exists
    if (existsSync(targetPath) && !options.force) {
      console.log(chalk.yellow(`Configuration already exists at ${targetPath}`));
      console.log(chalk.gray('Use --force to overwrite'));
      return;
    }

    // Create directory if needed
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
      console.log(chalk.green(`Created directory: ${targetDir}`));
    }

    // Generate config content
    const configContent = `// Olympus Configuration
// See: https://github.com/your-repo/olympus for documentation
{
  "$schema": "./olympus-schema.json",

  // Agent model configurations
  "agents": {
    "olympus": {
      // Main orchestrator - uses the most capable model
      "model": "claude-opus-4-5-20251101"
    },
    "oracle": {
      // Architecture and debugging expert
      "model": "claude-opus-4-5-20251101",
      "enabled": true
    },
    "librarian": {
      // Documentation and codebase analysis
      "model": "claude-sonnet-4-5-20250514"
    },
    "explore": {
      // Fast pattern matching - uses fastest model
      "model": "claude-3-5-haiku-20241022"
    },
    "frontendEngineer": {
      "model": "claude-sonnet-4-5-20250514",
      "enabled": true
    },
    "documentWriter": {
      "model": "claude-3-5-haiku-20241022",
      "enabled": true
    },
    "multimodalLooker": {
      "model": "claude-sonnet-4-5-20250514",
      "enabled": true
    }
  },

  // Feature toggles
  "features": {
    "parallelExecution": true,
    "lspTools": true,
    "astTools": true,
    "continuationEnforcement": true,
    "autoContextInjection": true
  },

  // MCP server integrations
  "mcpServers": {
    "exa": {
      "enabled": true
      // Set EXA_API_KEY environment variable for API key
    },
    "context7": {
      "enabled": true
    },
    "grepApp": {
      "enabled": true
    }
  },

  // Permission settings
  "permissions": {
    "allowBash": true,
    "allowEdit": true,
    "allowWrite": true,
    "maxBackgroundTasks": 5
  },

  // Magic keyword triggers (customize if desired)
  "magicKeywords": {
    "ultrawork": ["ultrawork", "ulw", "uw"],
    "search": ["search", "find", "locate"],
    "analyze": ["analyze", "investigate", "examine"]
  }
}
`;

    writeFileSync(targetPath, configContent);
    console.log(chalk.green(`Created configuration: ${targetPath}`));

    // Also create the JSON schema for editor support
    const schemaPath = join(targetDir, 'olympus-schema.json');
    writeFileSync(schemaPath, JSON.stringify(generateConfigSchema(), null, 2));
    console.log(chalk.green(`Created JSON schema: ${schemaPath}`));

    console.log(chalk.blue('\nSetup complete!'));
    console.log(chalk.gray('Edit the configuration file to customize your setup.'));

    // Create AGENTS.md template if it doesn't exist
    const agentsMdPath = join(process.cwd(), 'AGENTS.md');
    if (!existsSync(agentsMdPath) && !options.global) {
      const agentsMdContent = `# Project Agents Configuration

This file provides context and instructions to AI agents working on this project.

## Project Overview

<!-- Describe your project here -->

## Architecture

<!-- Describe the architecture and key components -->

## Conventions

<!-- List coding conventions, naming patterns, etc. -->

## Important Files

<!-- List key files agents should know about -->

## Common Tasks

<!-- Describe common development tasks and how to perform them -->
`;
      writeFileSync(agentsMdPath, agentsMdContent);
      console.log(chalk.green(`Created AGENTS.md template`));
    }
  });

/**
 * Config command - Show or validate configuration
 */
program
  .command('config')
  .description('Show current configuration')
  .option('-v, --validate', 'Validate configuration')
  .option('-p, --paths', 'Show configuration file paths')
  .action(async (options) => {
    if (options.paths) {
      const paths = getConfigPaths();
      console.log(chalk.blue('Configuration file paths:'));
      console.log(`  User:    ${paths.user}`);
      console.log(`  Project: ${paths.project}`);

      console.log(chalk.blue('\nFile status:'));
      console.log(`  User:    ${existsSync(paths.user) ? chalk.green('exists') : chalk.gray('not found')}`);
      console.log(`  Project: ${existsSync(paths.project) ? chalk.green('exists') : chalk.gray('not found')}`);
      return;
    }

    const config = loadConfig();

    if (options.validate) {
      console.log(chalk.blue('Validating configuration...\n'));

      // Check for required fields
      const warnings: string[] = [];
      const errors: string[] = [];

      if (!process.env.ANTHROPIC_API_KEY) {
        warnings.push('ANTHROPIC_API_KEY environment variable not set');
      }

      if (config.mcpServers?.exa?.enabled && !process.env.EXA_API_KEY && !config.mcpServers.exa.apiKey) {
        warnings.push('Exa is enabled but EXA_API_KEY is not set');
      }

      if (errors.length > 0) {
        console.log(chalk.red('Errors:'));
        errors.forEach(e => console.log(chalk.red(`  - ${e}`)));
      }

      if (warnings.length > 0) {
        console.log(chalk.yellow('Warnings:'));
        warnings.forEach(w => console.log(chalk.yellow(`  - ${w}`)));
      }

      if (errors.length === 0 && warnings.length === 0) {
        console.log(chalk.green('Configuration is valid!'));
      }

      return;
    }

    console.log(chalk.blue('Current configuration:\n'));
    console.log(JSON.stringify(config, null, 2));
  });

/**
 * Info command - Show system information
 */
program
  .command('info')
  .description('Show system and agent information')
  .action(async () => {
    const session = createOlympusSession();

    console.log(chalk.blue.bold('\nOlympus System Information\n'));
    console.log(chalk.gray('━'.repeat(50)));

    console.log(chalk.blue('\nAvailable Agents:'));
    const agents = session.queryOptions.options.agents;
    for (const [name, agent] of Object.entries(agents)) {
      console.log(`  ${chalk.green(name)}`);
      console.log(`    ${chalk.gray(agent.description.split('\n')[0])}`);
    }

    console.log(chalk.blue('\nEnabled Features:'));
    const features = session.config.features;
    if (features) {
      console.log(`  Parallel Execution:      ${features.parallelExecution ? chalk.green('enabled') : chalk.gray('disabled')}`);
      console.log(`  LSP Tools:               ${features.lspTools ? chalk.green('enabled') : chalk.gray('disabled')}`);
      console.log(`  AST Tools:               ${features.astTools ? chalk.green('enabled') : chalk.gray('disabled')}`);
      console.log(`  Continuation Enforcement:${features.continuationEnforcement ? chalk.green('enabled') : chalk.gray('disabled')}`);
      console.log(`  Auto Context Injection:  ${features.autoContextInjection ? chalk.green('enabled') : chalk.gray('disabled')}`);
    }

    console.log(chalk.blue('\nMCP Servers:'));
    const mcpServers = session.queryOptions.options.mcpServers;
    for (const name of Object.keys(mcpServers)) {
      console.log(`  ${chalk.green(name)}`);
    }

    console.log(chalk.blue('\nMagic Keywords:'));
    console.log(`  Ultrawork: ${chalk.cyan(session.config.magicKeywords?.ultrawork?.join(', ') ?? 'ultrawork, ulw, uw')}`);
    console.log(`  Search:    ${chalk.cyan(session.config.magicKeywords?.search?.join(', ') ?? 'search, find, locate')}`);
    console.log(`  Analyze:   ${chalk.cyan(session.config.magicKeywords?.analyze?.join(', ') ?? 'analyze, investigate, examine')}`);

    console.log(chalk.gray('\n━'.repeat(50)));
    console.log(chalk.gray(`Version: ${version}`));
  });

/**
 * Test command - Test prompt enhancement
 */
program
  .command('test-prompt <prompt>')
  .description('Test how a prompt would be enhanced')
  .action(async (prompt: string) => {
    const session = createOlympusSession();

    console.log(chalk.blue('Original prompt:'));
    console.log(chalk.gray(prompt));

    const keywords = session.detectKeywords(prompt);
    if (keywords.length > 0) {
      console.log(chalk.blue('\nDetected magic keywords:'));
      console.log(chalk.yellow(keywords.join(', ')));
    }

    console.log(chalk.blue('\nEnhanced prompt:'));
    console.log(chalk.green(session.processPrompt(prompt)));
  });

/**
 * Update command - Check for and install updates
 */
program
  .command('update')
  .description('Check for and install updates')
  .option('-c, --check', 'Only check for updates, do not install')
  .option('-f, --force', 'Force reinstall even if up to date')
  .option('-q, --quiet', 'Suppress output except for errors')
  .action(async (options) => {
    if (!options.quiet) {
      console.log(chalk.blue('Olympus Update\n'));
    }

    try {
      // Show current version
      const installed = getInstalledVersion();
      if (!options.quiet) {
        console.log(chalk.gray(`Current version: ${installed?.version ?? 'unknown'}`));
        console.log(chalk.gray(`Install method: ${installed?.installMethod ?? 'unknown'}`));
        console.log('');
      }

      // Check for updates
      if (!options.quiet) {
        console.log('Checking for updates...');
      }

      const checkResult = await checkForUpdates();

      if (!checkResult.updateAvailable && !options.force) {
        if (!options.quiet) {
          console.log(chalk.green(`\n✓ You are running the latest version (${checkResult.currentVersion})`));
        }
        return;
      }

      if (!options.quiet) {
        console.log(formatUpdateNotification(checkResult));
      }

      // If check-only mode, stop here
      if (options.check) {
        if (checkResult.updateAvailable) {
          console.log(chalk.yellow('\nRun without --check to install the update.'));
        }
        return;
      }

      // Perform the update
      if (!options.quiet) {
        console.log(chalk.blue('\nStarting update...\n'));
      }

      const result = await performUpdate({ verbose: !options.quiet });

      if (result.success) {
        if (!options.quiet) {
          console.log(chalk.green(`\n✓ ${result.message}`));
          console.log(chalk.gray('\nPlease restart your Claude Code session to use the new version.'));
        }
      } else {
        console.error(chalk.red(`\n✗ ${result.message}`));
        if (result.errors) {
          result.errors.forEach(err => console.error(chalk.red(`  - ${err}`)));
        }
        process.exit(1);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`Update failed: ${message}`));
      process.exit(1);
    }
  });

/**
 * Version command - Show version information
 */
program
  .command('version')
  .description('Show detailed version information')
  .action(async () => {
    const installed = getInstalledVersion();

    console.log(chalk.blue.bold('\nOlympus Version Information\n'));
    console.log(chalk.gray('━'.repeat(50)));

    console.log(`\n  Package version:   ${chalk.green(version)}`);

    if (installed) {
      console.log(`  Installed version: ${chalk.green(installed.version)}`);
      console.log(`  Install method:    ${chalk.cyan(installed.installMethod)}`);
      console.log(`  Installed at:      ${chalk.gray(installed.installedAt)}`);
      if (installed.lastCheckAt) {
        console.log(`  Last update check: ${chalk.gray(installed.lastCheckAt)}`);
      }
      if (installed.commitHash) {
        console.log(`  Commit hash:       ${chalk.gray(installed.commitHash)}`);
      }
    } else {
      console.log(chalk.yellow('  No installation metadata found'));
      console.log(chalk.gray('  (Run the install script to create version metadata)'));
    }

    console.log(chalk.gray('\n━'.repeat(50)));
    console.log(chalk.gray('\nTo check for updates, run: olympus update --check'));
  });

/**
 * Install command - Install agents and commands to ~/.claude/
 */
program
  .command('install')
  .description('Install Olympus agents and commands to Claude Code config')
  .option('-f, --force', 'Overwrite existing files')
  .option('-q, --quiet', 'Suppress output except for errors')
  .option('-l, --local', 'Install to current project (./.claude/) instead of global (~/.claude/)')
  .option('--skip-claude-check', 'Skip checking if Claude Code is installed')
  .action(async (options) => {
    if (!options.quiet) {
      console.log(chalk.blue('╔═══════════════════════════════════════════════════════════╗'));
      console.log(chalk.blue('║         Olympus Installer                                 ║'));
      console.log(chalk.blue('║   Multi-Agent Orchestration for Claude Code               ║'));
      console.log(chalk.blue('╚═══════════════════════════════════════════════════════════╝'));
      console.log('');
      if (options.local) {
        console.log(chalk.yellow('Installing locally to: ./.claude/'));
        console.log(chalk.gray('(Hooks require global installation with: olympus-ai install)'));
        console.log('');
      }
    }

    // Check if already installed
    if (isInstalled() && !options.force) {
      const info = getInstallInfo();
      if (!options.quiet) {
        console.log(chalk.yellow('Olympus is already installed.'));
        if (info) {
          console.log(chalk.gray(`  Version: ${info.version}`));
          console.log(chalk.gray(`  Installed: ${info.installedAt}`));
        }
        console.log(chalk.gray('\nUse --force to reinstall.'));
      }
      return;
    }

    // Run installation
    const result = installOlympus({
      force: options.force,
      verbose: !options.quiet,
      skipClaudeCheck: options.skipClaudeCheck,
      local: options.local
    });

    if (result.success) {
      if (!options.quiet) {
        console.log('');
        console.log(chalk.green('╔═══════════════════════════════════════════════════════════╗'));
        console.log(chalk.green('║         Olympus Installed!                                ║'));
        console.log(chalk.green('╚═══════════════════════════════════════════════════════════╝'));
        console.log('');
        console.log(chalk.gray(`Installed to: ${options.local ? './.claude/' : '~/.claude/'}`));
        if (options.local) {
          console.log(chalk.yellow('\nNote: Hooks are not installed with --local.'));
          console.log(chalk.yellow('For full functionality, also run: olympus-ai install'));
        }
        console.log('');
        console.log(chalk.yellow('Get started:'));
        console.log('  /getting-started         # Guided tour — start here');
        console.log('  /olympus-default         # Set Olympus as your default mode');
        console.log('  /plan <task>             # Start a structured development workflow');
        console.log('  /ultrawork <task>        # Maximum performance mode');
        console.log('');
        console.log(chalk.gray('Run /getting-started in Claude Code for your guided tour.'));
      }
    } else {
      console.error(chalk.red(`Installation failed: ${result.message}`));
      if (result.errors.length > 0) {
        result.errors.forEach(err => console.error(chalk.red(`  - ${err}`)));
      }
      process.exit(1);
    }
  });

program
  .command('uninstall')
  .description('Uninstall Olympus files (only removes Olympus-owned files)')
  .option('--local', 'Uninstall from current project (./.claude/) instead of global (~/.claude/)')
  .option('--dry-run', 'Show what would be removed without actually removing')
  .option('-v, --verbose', 'Show detailed output')
  .action((opts) => {
    const prefix = opts.dryRun ? chalk.yellow('[DRY RUN] ') : '';
    console.log(chalk.blue(`${prefix}Uninstalling Olympus...`));
    console.log('');

    const result = uninstallOlympus({
      local: opts.local,
      dryRun: opts.dryRun,
      verbose: opts.verbose || opts.dryRun
    });

    if (result.errors.length > 0) {
      result.errors.forEach(err => console.error(chalk.red(`  Error: ${err}`)));
      console.log('');
    }

    if (opts.dryRun) {
      console.log(chalk.yellow(`Would remove ${result.removedFiles.length} file(s)/directories.`));
      console.log(chalk.gray('Run without --dry-run to apply.'));
    } else {
      if (result.success) {
        console.log(chalk.green(`Removed ${result.removedFiles.length} file(s)/directories. Olympus has been uninstalled.`));
      } else {
        console.log(chalk.yellow(`Removed ${result.removedFiles.length} file(s)/directories (with ${result.errors.length} error(s)).`));
      }
      console.log('');
      if (opts.local) {
        console.log(chalk.gray('To also remove the npm package: npm uninstall olympus-ai'));
      } else {
        console.log(chalk.gray('To also remove the npm package: npm uninstall -g olympus-ai'));
      }
    }

    if (!result.success) {
      process.exit(1);
    }
  });

program
  .command('postinstall', { hidden: true })
  .description('Run post-install setup (called automatically by npm)')
  .action(async () => {
    // Silent install - only show errors
    const result = installOlympus({
      force: false,
      verbose: false,
      skipClaudeCheck: true
    });

    if (result.success) {
      console.log(chalk.green('✓ Olympus installed successfully!'));
      console.log(chalk.gray('  Run /getting-started in Claude Code for a guided tour.'));
    } else {
      // Don't fail the npm install, just warn
      console.warn(chalk.yellow('⚠ Could not complete Olympus setup:'), result.message);
      console.warn(chalk.gray('  Run "olympus install" manually to complete setup.'));
    }
  });

/**
 * Learn command - View and manage learnings
 */
program
  .command('learn')
  .description('View and manage learned preferences and patterns')
  .option('-s, --show', 'Show current learnings')
  .option('--stats', 'Show learning system statistics')
  .option('--cleanup', 'Clean up old learning data (archives auto-prune at 30 days / 5 max)')
  .option('--dry-run', 'Preview cleanup without executing (use with --cleanup)')
  .option('--age <days>', 'Age threshold in days for cleanup (default: 180)', '180')
  .option('--remove-archived', 'Remove archived .old.jsonl files (use with --cleanup)')
  .option('-a, --analyze', 'Analyze feedback and show insights')
  .option('--suggest', 'Show suggested prompt improvements')
  .option('--apply', 'Apply suggested improvements')
  .option('-f, --forget', 'Forget all learnings')
  .option('-p, --project [slug]', 'Project slug for --forget; omit value to use current project')
  .option('-e, --export [file]', 'Export current project data to file or stdout')
  .option('-i, --import <file>', 'Import learnings from JSON')
  .option('--efficiency', 'Show agent efficiency rankings and token metrics')
  .option('--show-costs', 'Show cost breakdown by model and agent')
  .option('--budget-status', 'Show current session token budget status')
  .option('--last-session', 'Show last session summary')
  .option('--sessions [n]', 'Show last N sessions (default: 10)')
  .option('--global', 'Show global learning data, bypassing project scoping')
  .option('--all-projects', 'List all project directories with stats')
  .option('--confirm', 'Confirm destructive operations (required for --forget)')
  .action(async (options) => {
    const learningDir = getLearningDir();

    function resolveProjectContext(): { projectPath: string | null; isInProject: boolean } {
      if (options.global) {
        return { projectPath: null, isInProject: false };
      }
      try {
        const resolved = resolveProjectRoot(process.cwd());
        const cwd = resolve(process.cwd());
        if (resolved === cwd) {
          return { projectPath: null, isInProject: false };
        }
        return { projectPath: resolved, isInProject: true };
      } catch {
        return { projectPath: null, isInProject: false };
      }
    }

    if (options.allProjects) {
      try {
        const projectsDir = join(getLearningDir(), 'projects');
        const stats = collectProjectDirStats(projectsDir);
        if (stats.length === 0) {
          console.log('No project directories found.');
          return;
        }
        const slugW = 40, dateW = 22, sizeW = 10, feedW = 10, sessW = 8;
        const header = 'Project'.padEnd(slugW) + 'Last Modified'.padEnd(dateW) + 'Size'.padStart(sizeW) + 'Feedback'.padStart(feedW) + 'Sessions'.padStart(sessW);
        const divider = '-'.repeat(slugW + dateW + sizeW + feedW + sessW);
        console.log(header);
        console.log(divider);
        for (const s of stats) {
          const sizeKb = (s.sizeBytes / 1024).toFixed(0) + ' KB';
          const dateStr = s.lastModified.toISOString().replace('T', ' ').substring(0, 16);
          const line = s.slug.substring(0, slugW).padEnd(slugW)
            + dateStr.padEnd(dateW)
            + sizeKb.padStart(sizeW)
            + String(s.feedbackCount).padStart(feedW)
            + String(s.sessionCount).padStart(sessW);
          console.log(line);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[Olympus] Failed to list project directories: ${msg}`);
      }
      return;
    }

    if (options.lastSession) {
      const { projectPath: lsProjectPath } = resolveProjectContext();
      if (!lsProjectPath && !options.global) {
        console.log('Not inside a recognized project directory. Showing global data.');
      }
      const lsSummaries = loadSessionSummaries(lsProjectPath ?? undefined);
      const summary = lsSummaries.length > 0 ? lsSummaries[lsSummaries.length - 1] : null;
      if (!summary) {
        console.log(chalk.yellow('No session summaries recorded yet. Complete a session first.'));
        return;
      }

      console.log(chalk.blue.bold('\nLast Session Summary'));
      console.log(chalk.gray('─────────────────────────────────'));
      console.log(`  Session ID:  ${chalk.white(summary.session_id)}`);
      console.log(`  Project:     ${chalk.white(summary.project_path)}`);
      console.log(`  Started:     ${chalk.white(new Date(summary.started_at).toLocaleString())}`);

      const mins = Math.floor(summary.duration_seconds / 60);
      const secs = summary.duration_seconds % 60;
      const durStr = mins > 0 ? `${mins} minutes ${secs} seconds` : `${secs} seconds`;
      console.log(`  Duration:    ${chalk.white(durStr)}`);

      const agentsStr = summary.agents_used.length > 0
        ? summary.agents_used.join(', ')
        : chalk.gray('(none)');
      console.log(`  Agents Used: ${chalk.white(agentsStr)}`);

      const inTokens = summary.total_input_tokens.toLocaleString();
      const outTokens = summary.total_output_tokens.toLocaleString();
      const totalTokens = summary.total_tokens.toLocaleString();
      console.log(`  Tokens:      ${chalk.white(totalTokens)} (in: ${inTokens} / out: ${outTokens})`);

      const costStr = `$${summary.estimated_cost.toFixed(summary.estimated_cost >= 0.01 ? 2 : 3)}`;
      console.log(`  Est. Cost:   ${chalk.white(costStr)}`);
      console.log(`  Model:       ${chalk.white(summary.model)}`);
      console.log(`  Outcome:     ${chalk.white(summary.outcome)}`);
      console.log('');
      return;
    }

    if (options.sessions !== undefined) {
      const { projectPath: sessProjectPath } = resolveProjectContext();
      if (!sessProjectPath && !options.global) {
        console.log('Not inside a recognized project directory. Showing global data.');
      }
      const n = typeof options.sessions === 'string' ? parseInt(options.sessions) : 10;
      const count = isNaN(n) ? 10 : n;
      const allSummaries = loadSessionSummaries(sessProjectPath ?? undefined);

      if (allSummaries.length === 0) {
        console.log(chalk.yellow('No session summaries recorded yet. Complete a session first.'));
        return;
      }

      const summaries = allSummaries.slice(-count);

      console.log(chalk.blue.bold(`\nRecent Sessions (last ${summaries.length})`));
      console.log(chalk.gray('─────────────────────────────────────────────────────────────────────────'));
      console.log(chalk.gray('Date          Duration  Agents                    Tokens      Cost     Outcome'));
      console.log(chalk.gray('─────────────────────────────────────────────────────────────────────────'));

      let totalDuration = 0;
      let totalTokens = 0;
      let totalCost = 0;
      const allAgents = new Set<string>();

      for (const s of summaries) {
        const date = new Date(s.started_at);
        const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: '2-digit' })
          + ' ' + date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

        const mins = Math.floor(s.duration_seconds / 60);
        const secs = s.duration_seconds % 60;
        const durStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

        let agentsStr: string;
        if (s.agents_used.length === 0) {
          agentsStr = '(none)';
        } else if (s.agents_used.length <= 3) {
          agentsStr = s.agents_used.join(', ');
        } else {
          agentsStr = s.agents_used.slice(0, 2).join(', ') + ` +${s.agents_used.length - 2}`;
        }

        const tokensStr = s.total_tokens.toLocaleString();
        const costStr = `$${s.estimated_cost.toFixed(s.estimated_cost >= 0.01 ? 2 : 3)}`;

        console.log(
          `${dateStr.padEnd(14)}${durStr.padEnd(10)}${agentsStr.padEnd(26)}${tokensStr.padStart(8)}  ${costStr.padStart(8)}  ${s.outcome}`
        );

        totalDuration += s.duration_seconds;
        totalTokens += s.total_tokens;
        totalCost += s.estimated_cost;
        s.agents_used.forEach(a => allAgents.add(a));
      }

      console.log(chalk.gray('─────────────────────────────────────────────────────────────────────────'));

      const totalMins = Math.floor(totalDuration / 60);
      const totalSecs = totalDuration % 60;
      const totalDurStr = totalMins > 0 ? `${totalMins}m ${totalSecs}s` : `${totalSecs}s`;
      const totalTokensStr = totalTokens.toLocaleString();
      const totalCostStr = `$${totalCost.toFixed(totalCost >= 0.01 ? 2 : 3)}`;

      console.log(
        `${'Totals:'.padEnd(14)}${totalDurStr.padEnd(10)}${(allAgents.size + ' unique agents').padEnd(26)}${totalTokensStr.padStart(8)}  ${totalCostStr.padStart(8)}`
      );
      console.log('');
      return;
    }

    if (options.stats) {
      const stats = generateLearningStats(process.cwd());
      console.log(formatLearningStats(stats));

      try {
        const projectsDir = join(getLearningDir(), 'projects');
        const projStats = collectProjectDirStats(projectsDir);
        if (projStats.length > 0) {
          console.log('\nPer-Project Storage:');
          let totalBytes = 0;
          for (const ps of projStats) {
            const sizeKb = (ps.sizeBytes / 1024).toFixed(0) + ' KB';
            console.log(`  ${ps.slug.padEnd(40)} ${sizeKb.padStart(8)}`);
            totalBytes += ps.sizeBytes;
          }
          const totalKb = (totalBytes / 1024).toFixed(0) + ' KB';
          console.log(`  ${'-'.repeat(49)}`);
          console.log(`  Total (${projStats.length} project${projStats.length === 1 ? '' : 's'}):${' '.repeat(Math.max(0, 33 - String(projStats.length).length - 10))} ${totalKb.padStart(8)}`);
          console.log(`\nGlobal learning directory: ${getLearningDir()} (${totalKb})`);
        }
      } catch {}
      return;
    }

    if (options.cleanup) {
      const result = cleanupLearning(process.cwd(), {
        dryRun: options.dryRun,
        ageDays: parseInt(options.age),
        removeArchived: options.removeArchived,
        compactExpired: true,
      });
      console.log(formatCleanupResult(result, options.dryRun));
      return;
    }

    if (options.show) {
      const { projectPath: showProjectPath, isInProject: showIsInProject } = resolveProjectContext();
      if (!showIsInProject && !options.global) {
        console.log('Not inside a recognized project directory. Showing global data.');
      }

      console.log(chalk.blue.bold('\n╭─────────────────────────────────────────────────────────────╮'));
      console.log(chalk.blue.bold('│                  OLYMPUS LEARNING STATUS                    │'));
      console.log(chalk.blue.bold('╰─────────────────────────────────────────────────────────────╯\n'));

      const feedback = readFeedbackLog(showProjectPath ?? undefined);
      const revisions = feedback.filter(f => f.event_type === 'revision').length;
      const cancellations = feedback.filter(f => f.event_type === 'cancellation').length;
      const successes = feedback.filter(f => f.event_type === 'success').length;

      console.log(chalk.white(`📊 Feedback Collected: ${feedback.length} entries`));
      console.log(chalk.gray(`   (${revisions} revisions, ${cancellations} cancellations, ${successes} successes)\n`));

      const prefs = readJsonFile<UserPreferences | null>(
        join(learningDir, 'user-preferences.json'),
        null
      );

      if (prefs) {
        console.log(chalk.white('👤 User Preferences:'));
        if (prefs.verbosity !== 'unknown') console.log(`   • Verbosity: ${prefs.verbosity}`);
        if (prefs.autonomy !== 'unknown') console.log(`   • Autonomy: ${prefs.autonomy}`);
        const filteredRules = (prefs.explicit_rules as unknown[]).filter((r): r is { rule: string; project_path?: string } => {
          if (typeof r === 'object' && r !== null && 'rule' in r) {
            const rObj = r as { rule: string; project_path?: string };
            return !showProjectPath || !rObj.project_path || rObj.project_path === showProjectPath;
          }
          return true;
        });
        for (const rule of filteredRules.slice(0, 3)) {
          const ruleText = typeof rule === 'object' && rule !== null && 'rule' in rule
            ? (rule as { rule: string }).rule
            : String(rule);
          console.log(`   * ${ruleText}`);
        }
        console.log('');
      }

      if (prefs?.recurring_corrections && prefs.recurring_corrections.length > 0) {
        console.log(chalk.white('📝 Recurring Corrections:'));
        for (const c of prefs.recurring_corrections.slice(0, 5)) {
          console.log(`   • "${c.pattern.substring(0, 50)}..." (seen ${c.count}x)`);
        }
        console.log('');
      }

      const agentPerf = readAgentPerformance(showProjectPath ?? undefined);

      if (Object.keys(agentPerf).length > 0) {
        console.log(chalk.white('🤖 Agent Performance:'));
        for (const [name, perf] of Object.entries(agentPerf)) {
          const successPct = (perf.success_rate * 100).toFixed(0);
          console.log(`   • ${name}: ${successPct}% success (${perf.revision_count} revisions)`);
        }
        console.log('');
      }

      const showSummaries = loadSessionSummaries(showProjectPath ?? undefined);
      if (showSummaries.length > 0) {
        console.log(chalk.white('📅 Sessions:'));
        console.log(`   • Total recorded: ${showSummaries.length}`);
        const lastS = showSummaries[showSummaries.length - 1];
        if (lastS) {
          console.log(`   • Last: ${new Date(lastS.started_at).toLocaleString()}`);
        }
        console.log('');
      }

      const discoveries = readDiscoveries(process.cwd());
      if (discoveries.total_discoveries > 0) {
        console.log(chalk.white('💡 Discoveries:'));
        console.log(`   • Total: ${discoveries.total_discoveries}`);
        console.log(`   • Project: ${discoveries.project_discoveries.length}`);
        console.log(`   • Global: ${discoveries.global_discoveries.length}`);
        if (discoveries.most_useful.length > 0) {
          console.log(chalk.gray('   Top discoveries:'));
          for (const d of discoveries.most_useful.slice(0, 3)) {
            console.log(`     - [${d.category}] ${d.summary}`);
          }
        }
        console.log('');
      }

      try {
        const { loadDiscoveryConfig } = await import('../learning/config.js');
        const discoveryConfig = loadDiscoveryConfig(process.cwd());

        console.log(chalk.white('🔍 Auto-Discovery:'));
        console.log(`   • Status: ${discoveryConfig.enabled ? chalk.green('enabled') : chalk.red('disabled')}`);
        console.log(`   • Min Confidence: ${discoveryConfig.minConfidence}`);
        console.log(`   • Limits: ${discoveryConfig.maxPerSession}/session, ${discoveryConfig.maxPerDay}/day`);
        console.log(`   • Dedup Window: ${discoveryConfig.deduplicationWindowDays} days`);

        if (discoveries.total_discoveries > 0) {
          const recentAuto = [...discoveries.project_discoveries]
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
            .slice(0, 5);

          if (recentAuto.length > 0) {
            console.log(chalk.gray('   Recent auto-discoveries:'));
            for (const d of recentAuto) {
              const age = Math.floor((Date.now() - new Date(d.timestamp).getTime()) / (1000 * 60 * 60 * 24));
              const ageStr = age === 0 ? 'today' : `${age}d ago`;
              console.log(`     - [${d.category}] ${d.summary.substring(0, 50)}${d.summary.length > 50 ? '...' : ''} (${(d.confidence * 100).toFixed(0)}%, ${ageStr})`);
            }
          }
        }
        console.log('');
      } catch {
      }

      return;
    }

    if (options.analyze) {
      const { projectPath: analyzeProjectPath } = resolveProjectContext();
      if (!analyzeProjectPath && !options.global) {
        console.log('Not inside a recognized project directory. Showing global data.');
      }
      console.log(chalk.blue('Analyzing feedback...\n'));

      const feedback = readFeedbackLog(analyzeProjectPath ?? undefined);
      const patterns = extractPatterns(feedback, undefined, undefined, analyzeProjectPath ?? undefined);

      console.log(chalk.white(`Found ${patterns.length} patterns:\n`));
      for (const p of patterns) {
        console.log(`  [${(p.confidence * 100).toFixed(0)}%] ${p.pattern.substring(0, 60)}...`);
        console.log(chalk.gray(`       Seen ${p.evidence_count}x, scope: ${p.scope}, category: ${p.category}`));
      }

      const currentPrefs = readJsonFile<UserPreferences>(
        join(learningDir, 'user-preferences.json'),
        createDefaultPreferences()
      );

      const updatedPrefs = updatePreferences(currentPrefs, feedback, patterns, analyzeProjectPath ?? undefined);
      writeJsonFile(join(learningDir, 'user-preferences.json'), updatedPrefs);

      const agentPerf = evaluateAgentPerformance(feedback);
      const agentPerfObj = Object.fromEntries(agentPerf);

      const agentPerfWritePath = analyzeProjectPath
        ? join(getProjectScopedDir(analyzeProjectPath), 'agent-performance.json')
        : join(learningDir, 'agent-performance.json');

      const existingPerf = readJsonFile<Record<string, AgentPerformance>>(agentPerfWritePath, {});

      // Analyze task patterns per agent
      for (const [agentName, perf] of Object.entries(agentPerfObj)) {
        const agentFeedback = feedback.filter(f => f.agent_used === agentName);
        const patternStats: Record<string, { success: number; total: number }> = {};

        for (const entry of agentFeedback) {
          if (!entry.original_task) continue;
          const taskPatterns = extractTaskPatterns(entry.original_task);

          for (const pattern of taskPatterns) {
            if (!patternStats[pattern]) {
              patternStats[pattern] = { success: 0, total: 0 };
            }
            patternStats[pattern].total++;
            if (entry.event_type === 'success') {
              patternStats[pattern].success++;
            }
          }
        }

        // Convert to TaskPattern array
        const taskPatterns: TaskPattern[] = [];
        for (const [pattern, stats] of Object.entries(patternStats)) {
          if (stats.total < 3) continue; // Skip patterns with too few samples
          const successRate = stats.success / stats.total;
          taskPatterns.push({
            pattern,
            successfulAgents: successRate >= 0.7 ? [agentName] : [],
            unsuccessfulAgents: successRate < 0.5 ? [agentName] : [],
            confidence: computePatternConfidence(stats.total),
          });
        }

        if (taskPatterns.length > 0) {
          perf.task_patterns = taskPatterns.slice(0, 10);
        } else if (existingPerf[agentName]?.task_patterns) {
          perf.task_patterns = existingPerf[agentName].task_patterns;
        }
      }

      writeJsonFile(agentPerfWritePath, agentPerfObj);

      const totalPatterns = Object.values(agentPerfObj).reduce(
        (sum, p) => sum + (p.task_patterns?.length || 0), 0
      );
      if (totalPatterns > 0) {
        console.log(chalk.green(`✓ ${totalPatterns} task patterns extracted for routing optimization.`));
      }

      console.log(chalk.green('\n✓ Preferences and performance metrics updated.'));
      return;
    }

    if (options.suggest) {
      const agentPerfRaw = readJsonFile<Record<string, AgentPerformance>>(
        join(learningDir, 'agent-performance.json'),
        {}
      );
      const agentPerf = new Map(Object.entries(agentPerfRaw));

      const prefs = readJsonFile<UserPreferences>(
        join(learningDir, 'user-preferences.json'),
        createDefaultPreferences()
      );

      const patches = generatePromptPatches(agentPerf, prefs);

      if (patches.length === 0) {
        console.log(chalk.yellow('No suggestions available yet. Collect more feedback first.'));
        return;
      }

      console.log(previewPatches(patches));
      console.log(chalk.gray('\nRun with --apply to apply these patches.'));
      return;
    }

    if (options.apply) {
      const agentPerfRaw = readJsonFile<Record<string, AgentPerformance>>(
        join(learningDir, 'agent-performance.json'),
        {}
      );
      const agentPerf = new Map(Object.entries(agentPerfRaw));

      const prefs = readJsonFile<UserPreferences>(
        join(learningDir, 'user-preferences.json'),
        createDefaultPreferences()
      );

      const patches = generatePromptPatches(agentPerf, prefs);

      if (patches.length === 0) {
        console.log(chalk.yellow('No patches to apply.'));
        return;
      }

      console.log(chalk.yellow('Applying patches...'));
      const results = applyPromptPatches(patches);

      for (const r of results) {
        if (r.success) {
          console.log(chalk.green(`✓ ${r.agent_name} patched (backup: ${r.backup_path})`));
        } else {
          console.log(chalk.red(`✗ ${r.agent_name}: ${r.error}`));
        }
      }
      return;
    }

    if (options.forget) {
      if (options.project) {
        try {
          const targetSlug = typeof options.project === 'string'
            ? options.project
            : deriveProjectSlug(resolveProjectRoot(process.cwd()));
          const targetPath = join(getLearningDir(), 'projects', targetSlug);

          if (!options.confirm) {
            if (!existsSync(targetPath)) {
              console.log(`Project directory not found: ${targetSlug}`);
              return;
            }
            const files = readdirSync(targetPath);
            console.log(`Would delete: ${targetPath}`);
            for (const f of files) {
              const fp = join(targetPath, f);
              let sz = 0;
              try { sz = statSync(fp).size; } catch {}
              console.log(`  ${f} (${sz} bytes)`);
            }
            console.log('Run with --confirm to delete.');
          } else {
            if (!existsSync(targetPath)) {
              console.log(`Project directory not found: ${targetSlug}`);
              return;
            }
            const fileCount = readdirSync(targetPath).length;
            rmSync(targetPath, { recursive: true, force: true });
            console.log(chalk.green(`Deleted project data for ${targetSlug} (${fileCount} files removed).`));
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[Olympus] Failed to forget project: ${msg}`);
        }
      } else {
        if (existsSync(learningDir)) {
          rmSync(learningDir, { recursive: true });
          console.log(chalk.green('✓ All learnings forgotten.'));
          console.log(chalk.yellow('⚠  Project-specific learnings remain. Use --forget --project in each project.'));
        } else {
          console.log(chalk.yellow('No learnings found.'));
        }
      }
      return;
    }

    if (options.export !== undefined) {
      try {
        const { projectPath: exportProjectPath, isInProject: exportIsInProject } = resolveProjectContext();
        if (!exportIsInProject) {
          console.log('Not inside a recognized project directory. Showing global data.');
          return;
        }
        const exportProjDir = getProjectScopedDir(exportProjectPath!);
        const readRaw = (file: string): string | null => {
          const p = join(exportProjDir, file);
          return existsSync(p) ? readFileSync(p, 'utf-8') : null;
        };
        const output = JSON.stringify({
          feedback_log: readRaw('feedback-log.jsonl'),
          agent_performance: readRaw('agent-performance.json'),
          session_insights: readRaw('session-insights.json'),
        }, null, 2);
        if (typeof options.export === 'string' && options.export.length > 0) {
          writeFileSync(options.export, output, 'utf-8');
          console.log(chalk.green(`✓ Exported to ${options.export}`));
        } else {
          console.log(output);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[Olympus] Failed to export: ${msg}`);
      }
      return;
    }

    if (options.import) {
      const importFile = options.import;
      if (!existsSync(importFile)) {
        console.error(chalk.red(`File not found: ${importFile}`));
        process.exit(1);
      }

      const data = JSON.parse(readFileSync(importFile, 'utf-8'));

      // Merge feedback
      if (data.feedback) {
        mkdirSync(learningDir, { recursive: true });
        const logPath = join(learningDir, 'feedback-log.jsonl');
        for (const entry of data.feedback) {
          appendFileSync(logPath, JSON.stringify(entry) + '\n');
        }
      }

      // Import preferences
      if (data.preferences) {
        writeJsonFile(join(learningDir, 'user-preferences.json'), data.preferences);
      }

      // Import agent performance
      if (data.agentPerformance) {
        writeJsonFile(join(learningDir, 'agent-performance.json'), data.agentPerformance);
      }

      console.log(chalk.green('✓ Learnings imported.'));
      return;
    }

    if (options.efficiency) {
      const { projectPath: effProjectPath } = resolveProjectContext();
      if (!effProjectPath && !options.global) {
        console.log('Not inside a recognized project directory. Showing global data.');
      }
      const feedback = readFeedbackLog(effProjectPath ?? undefined);
      const agentPerfRaw = readAgentPerformance(effProjectPath ?? undefined);

      const agentPerf: Record<string, AgentPerformance> = {};
      const agentNames = new Set(feedback.filter(f => f.agent_used).map(f => f.agent_used!));

      for (const agentName of agentNames) {
        const perf = updateAgentPerformance(agentName, feedback);
        if (perf) {
          agentPerf[agentName] = perf;
        }
      }

      Object.assign(agentPerf, agentPerfRaw);

      const agents = Object.values(agentPerf).filter(p => hasEfficiencyMetrics(p));

      if (agents.length === 0) {
        console.log(chalk.yellow('No efficiency data available yet. Use agents with token metrics to collect data.'));
        return;
      }

      // Calculate baseline for efficiency score (average tokens across all agents)
      const totalTokens = agents.reduce((sum, a) => sum + (a.token_efficiency?.avg_tokens_per_success || 0), 0);
      const baseline = agents.length > 0 ? totalTokens / agents.length : 4500;

      // Sort by efficiency score (higher is better)
      const sortedAgents = agents.sort((a, b) => {
        const effA = (a.success_rate * (baseline / (a.token_efficiency?.avg_tokens_per_success || baseline)));
        const effB = (b.success_rate * (baseline / (b.token_efficiency?.avg_tokens_per_success || baseline)));
        return effB - effA;
      });

      console.log(chalk.blue.bold('\nAGENT EFFICIENCY REPORT'));
      console.log(chalk.blue.bold('=======================\n'));

      console.log(chalk.white('Agent           Success  Avg Tokens  Efficiency  Trend'));
      console.log(chalk.gray('------------    -------  ----------  ----------  -----'));

      for (const agent of sortedAgents) {
        const successRate = (agent.success_rate * 100).toFixed(0) + '%';
        const avgTokens = Math.round(agent.token_efficiency?.avg_tokens_per_success || 0).toLocaleString();
        const effScore = (agent.success_rate * (baseline / (agent.token_efficiency?.avg_tokens_per_success || baseline))).toFixed(2);
        const trend = agent.token_efficiency?.trend || 'insufficient_data';
        const trendDisplay = trend === 'insufficient_data' ? chalk.gray(trend) :
                             trend === 'improving' ? chalk.green(trend) :
                             trend === 'declining' ? chalk.red(trend) :
                             chalk.yellow(trend);

        const nameCol = agent.agent_name.padEnd(15);
        const successCol = successRate.padStart(7);
        const tokensCol = avgTokens.padStart(10);
        const effCol = effScore.padStart(10);

        console.log(`${nameCol} ${successCol}  ${tokensCol}  ${effCol}  ${trendDisplay}`);
      }

      console.log('');
      console.log(chalk.gray(`Efficiency = success_rate * (baseline / avg_tokens)`));
      console.log(chalk.gray(`Baseline: ${Math.round(baseline).toLocaleString()} tokens\n`));

      // Generate recommendations
      console.log(chalk.white('Recommendations:'));
      const topAgent = sortedAgents[0];
      if (topAgent) {
        const effScore = (topAgent.success_rate * (baseline / (topAgent.token_efficiency?.avg_tokens_per_success || baseline)));
        if (effScore > 1.2) {
          console.log(chalk.green(`- Prefer ${topAgent.agent_name} for similar tasks (high efficiency, good success)`));
        }
      }

      const insufficientData = sortedAgents.filter(a => a.token_efficiency?.trend === 'insufficient_data');
      if (insufficientData.length > 0) {
        console.log(chalk.yellow(`- ${insufficientData.map(a => a.agent_name).join(', ')} ha${insufficientData.length === 1 ? 's' : 've'} insufficient data - consider using more`));
      }

      console.log('');
      return;
    }

    if (options.showCosts) {
      const feedback = readFeedbackLog();
      const feedbackWithTokens = feedback.filter(f => getTokenUsage(f) !== null);

      if (feedbackWithTokens.length === 0) {
        console.log(chalk.yellow('No cost data available yet. Token metrics are not recorded yet.'));
        return;
      }

      // Filter to last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const recent = feedbackWithTokens.filter(f => new Date(f.timestamp) >= thirtyDaysAgo);

      if (recent.length === 0) {
        console.log(chalk.yellow('No cost data from the last 30 days.'));
        return;
      }

      // Calculate totals
      let totalTokens = 0;
      let totalCost = 0;
      const byModel: Record<string, { tokens: number; cost: number; input: number; output: number }> = {};
      const byAgent: Record<string, { tokens: number; cost: number }> = {};

      for (const entry of recent) {
        const tokenUsage = getTokenUsage(entry);
        if (!tokenUsage) continue;

        const tokens = tokenUsage.total_tokens;
        totalTokens += tokens;

        const modelId = tokenUsage.model || 'unknown';
        const cost = calculateCost(tokenUsage.input_tokens, tokenUsage.output_tokens, modelId);
        totalCost += cost.totalCost;

        // By model
        if (!byModel[modelId]) {
          byModel[modelId] = { tokens: 0, cost: 0, input: 0, output: 0 };
        }
        byModel[modelId].tokens += tokens;
        byModel[modelId].cost += cost.totalCost;
        byModel[modelId].input += tokenUsage.input_tokens;
        byModel[modelId].output += tokenUsage.output_tokens;

        // By agent
        const agentName = entry.agent_used || 'unknown';
        if (!byAgent[agentName]) {
          byAgent[agentName] = { tokens: 0, cost: 0 };
        }
        byAgent[agentName].tokens += tokens;
        byAgent[agentName].cost += cost.totalCost;
      }

      console.log(chalk.blue.bold('\nCOST ANALYSIS (Last 30 days)'));
      console.log(chalk.blue.bold('============================\n'));

      console.log(chalk.white(`Total tokens:    ${totalTokens.toLocaleString()}`));
      console.log(chalk.white(`Estimated cost:  $${totalCost.toFixed(2)}\n`));

      if (Object.keys(byModel).length > 0) {
        console.log(chalk.white('By Model:'));
        for (const [model, data] of Object.entries(byModel)) {
          const tokensK = Math.round(data.tokens / 1000) + 'k';
          console.log(`- ${model.padEnd(25)}  ${tokensK.padStart(8)} tokens ($${data.cost.toFixed(2)})`);
        }
        console.log('');
      }

      if (Object.keys(byAgent).length > 0) {
        console.log(chalk.white('By Agent:'));
        const sortedAgents = Object.entries(byAgent).sort((a, b) => b[1].tokens - a[1].tokens);
        for (const [agent, data] of sortedAgents) {
          const tokensK = Math.round(data.tokens / 1000) + 'k';
          console.log(`- ${agent.padEnd(25)}  ${tokensK.padStart(8)} tokens ($${data.cost.toFixed(2)})`);
        }
        console.log('');
      }

      // Get pricing version
      const pricingVersion = DEFAULT_PRICING[0]?.effective_date || '2025-01-01';
      console.log(chalk.gray('Note: Costs are estimates based on list pricing.'));
      console.log(chalk.gray(`Pricing version: ${pricingVersion}\n`));
      return;
    }

    if (options.budgetStatus) {
      const sessionStatePath = getSessionStatePath(process.cwd());

      if (!existsSync(sessionStatePath)) {
        console.log(chalk.yellow('No active session found. Start a session to track budget.'));
        return;
      }

      const sessionState = readJsonFile<any>(sessionStatePath, null);

      if (!sessionState || !sessionState.token_budget) {
        console.log(chalk.yellow('No token budget data available for current session.'));
        return;
      }

      const budget = sessionState.token_budget;
      const baseline = budget.session_baseline || 10000;
      const current = budget.current_usage || 0;
      const threshold = getWarningThreshold(baseline, budget.warning_threshold || 1.5);
      const percentage = baseline > 0 ? ((current / baseline) * 100).toFixed(0) : 0;

      console.log(chalk.blue.bold('\nSESSION BUDGET STATUS'));
      console.log(chalk.blue.bold('=====================\n'));

      console.log(chalk.white(`Current session:  ${current.toLocaleString()} tokens`));
      console.log(chalk.white(`Session baseline: ${baseline.toLocaleString()} tokens`));
      console.log(chalk.white(`Warning threshold: ${Math.round(threshold).toLocaleString()} tokens (${((budget.warning_threshold || 1.5) * 100)}% of baseline)\n`));

      // Determine status
      const status = current > threshold ? chalk.red('WARNING') :
                     current > baseline ? chalk.yellow('ELEVATED') :
                     chalk.green('NORMAL');

      console.log(chalk.white(`Status: ${status} (${percentage}% of baseline)\n`));

      // Historical comparison
      const feedback = readFeedbackLog();
      const recentSessions = feedback
        .filter(f => getTokenUsage(f) !== null)
        .slice(-5);

      if (recentSessions.length > 0) {
        const avgRecent = recentSessions.reduce((sum, f) => sum + safeTokenTotal(f), 0) / recentSessions.length;
        console.log(chalk.white('Historical comparison:'));
        if (current < baseline) {
          console.log(chalk.gray('- This session is below typical usage'));
        } else if (current > threshold) {
          console.log(chalk.red('- This session significantly exceeds typical usage'));
        } else {
          console.log(chalk.gray('- This session is within normal range'));
        }
        console.log(chalk.gray(`- Last ${recentSessions.length} sessions averaged: ${Math.round(avgRecent).toLocaleString()} tokens`));
      }

      console.log('');
      return;
    }

    // Default: show help
    console.log('Usage: olympus learn [options]');
    console.log('');
    console.log('Options:');
    console.log('  -s, --show           Show current learnings');
    console.log('  --stats              Show learning system statistics');
    console.log('  --last-session       Show last session summary');
    console.log('  --sessions [n]       Show last N sessions (default: 10)');
    console.log('  --efficiency         Show agent efficiency rankings and token metrics');
    console.log('  --show-costs         Show cost breakdown by model and agent');
    console.log('  --budget-status      Show current session token budget status');
    console.log('  --cleanup            Clean up old learning data');
    console.log('  --dry-run            Preview cleanup without executing');
    console.log('  --age <days>         Age threshold for cleanup (default: 180)');
    console.log('  --remove-archived    Remove archived .old.jsonl files');
    console.log('  -a, --analyze        Analyze feedback and update patterns');
    console.log('  --suggest            Show suggested prompt improvements');
    console.log('  --apply              Apply suggested improvements');
    console.log('  -f, --forget         Forget all learnings');
    console.log('  -p, --project        Scope to current project (with --forget)');
    console.log('  -e, --export         Export learnings to JSON');
    console.log('  -i, --import <file>  Import learnings from JSON file');
  });

/**
 * Discover command - Record agent discoveries
 */
program
  .command('discover <input>')
  .description('Record a discovery made during work (for agents to use)')
  .option('-c, --category <category>', 'Discovery category (pattern, gotcha, workaround, etc.)')
  .option('-s, --scope <scope>', 'Scope: global or project (default: project)', 'project')
  .option('--confidence <number>', 'Confidence level 0-1 (default: 0.8)', '0.8')
  .option('--agent <name>', 'Agent name making the discovery (default: olympian)', 'olympian')
  .action(async (input, options) => {
    const cwd = process.cwd();

    // Parse input format: "category | summary | details"
    // OR if category option provided: "summary | details"
    const parts = input.split('|').map((s: string) => s.trim());

    let category: string;
    let summary: string;
    let details: string;

    if (options.category) {
      // Category provided via option
      category = options.category;
      summary = parts[0] || '';
      details = parts[1] || parts[0] || '';
    } else if (parts.length >= 3) {
      // Full format: "category | summary | details"
      category = parts[0];
      summary = parts[1];
      details = parts[2];
    } else if (parts.length === 2) {
      // Two parts: "category | summary" (details = summary)
      category = parts[0];
      summary = parts[1];
      details = parts[1];
    } else {
      console.error(chalk.red('Error: Invalid format'));
      console.log('\nUsage:');
      console.log('  olympus discover "category | summary | details"');
      console.log('  olympus discover "summary | details" --category <cat>');
      console.log('\nCategories:');
      console.log('  pattern, gotcha, workaround, performance, dependency, configuration, technical_insight');
      console.log('\nExamples:');
      console.log('  olympus discover "gotcha | Migrations must run first | Database seed fails if..."');
      console.log('  olympus discover "Use kebab-case for files | This codebase consistently..." -c pattern');
      process.exit(1);
    }

    // Validate category
    const validCategories = [
      'technical_insight', 'workaround', 'pattern', 'gotcha',
      'performance', 'dependency', 'configuration'
    ];

    if (!validCategories.includes(category)) {
      console.error(chalk.red(`Error: Invalid category "${category}"`));
      console.log(`Valid categories: ${validCategories.join(', ')}`);
      process.exit(1);
    }

    // Validate confidence
    const confidence = parseFloat(options.confidence);
    if (isNaN(confidence) || confidence < 0 || confidence > 1) {
      console.error(chalk.red('Error: Confidence must be between 0 and 1'));
      process.exit(1);
    }

    // Validate scope
    if (options.scope !== 'global' && options.scope !== 'project') {
      console.error(chalk.red('Error: Scope must be "global" or "project"'));
      process.exit(1);
    }

    try {
      const discovery = recordDiscovery({
        category: category as any,
        summary: summary.substring(0, 100), // Limit to 100 chars
        details: details,
        agent_name: options.agent,
        project_path: cwd,
        confidence: confidence,
        scope: options.scope as any,
        session_id: process.env.CLAUDE_SESSION_ID || 'cli',
      });

      console.log(chalk.green('✓ Discovery recorded successfully'));
      console.log(chalk.gray(`  ID: ${discovery.id}`));
      console.log(chalk.white(`  Category: ${discovery.category}`));
      console.log(chalk.white(`  Summary: ${discovery.summary}`));
      console.log(chalk.gray(`  Scope: ${discovery.scope}`));
      console.log(chalk.gray(`  Location: .olympus/learning/discoveries.jsonl`));
    } catch (error) {
      console.error(chalk.red('Error recording discovery:'), error);
      process.exit(1);
    }
  });

/**
 * Feedback command - Manual preference logging
 */
program
  .command('feedback [preference]')
  .description('Manually log a preference or view feedback history')
  .option('-h, --history', 'View feedback history')
  .action(async (preference, options) => {
    if (options.history) {
      const feedback = readFeedbackLog();

      if (feedback.length === 0) {
        console.log(chalk.yellow('No feedback recorded yet.'));
        return;
      }

      console.log(chalk.blue.bold('\nFeedback History (last 20):\n'));

      for (const entry of feedback.slice(-20).reverse()) {
        const date = new Date(entry.timestamp).toLocaleDateString();
        const type = entry.event_type.padEnd(12);
        const msg = entry.user_message.substring(0, 50);
        console.log(`${chalk.gray(date)} ${chalk.cyan(type)} ${msg}`);
      }
      return;
    }

    if (!preference) {
      console.log('Usage: olympus feedback "always use TypeScript strict mode"');
      console.log('       olympus feedback --history');
      return;
    }

    // Log explicit preference
    appendFeedback({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      session_id: 'manual',
      project_path: process.cwd(),
      event_type: 'explicit_preference',
      user_message: preference,
      feedback_category: 'explicit_preference',
      confidence: 1.0,
    });

    console.log(chalk.green(`✓ Preference logged: "${preference}"`));
  });

/**
 * Migrate-notepads command - One-time migration utility
 */
program
  .command('migrate-notepads')
  .description('Migrate .olympus/notepads/ content to learning system')
  .action(async () => {
    const projectPath = process.cwd();
    console.log(chalk.blue('Migrating notepads to discovery system...\n'));

    const count = await migrateNotepads(projectPath);

    if (count === 0) {
      console.log(chalk.yellow('No notepads found to migrate.'));
    } else {
      console.log(chalk.green(`✓ Migrated ${count} discoveries from notepads`));
      console.log(chalk.gray('Run "olympus learn --show" to see the discoveries.'));
    }
  });

/**
 * Metrics command - View and analyze token metrics
 */
const metricsCommand = program
  .command('metrics')
  .description('View and analyze token usage metrics');

metricsCommand
  .command('show')
  .description('Display recent token metrics in table format')
  .option('-l, --limit <number>', 'Limit number of entries to show (default: 50)', '50')
  .action(async (options) => {
    await showMetrics({ limit: parseInt(options.limit) });
  });

metricsCommand
  .command('export')
  .description('Export metrics to file')
  .option('-f, --format <format>', 'Export format: csv or json (default: json)', 'json')
  .option('-o, --output <file>', 'Output file (default: stdout)')
  .action(async (options) => {
    await exportMetrics({
      format: options.format as 'csv' | 'json',
      output: options.output
    });
  });

metricsCommand
  .command('analyze')
  .description('Show summary statistics and trends')
  .option('-s, --sessions <number>', 'Number of recent sessions to analyze (default: 10)', '10')
  .action(async (options) => {
    await analyzeMetrics({ sessions: parseInt(options.sessions) });
  });

metricsCommand
  .command('clean')
  .description('Archive metrics older than N days')
  .option('-d, --days <number>', 'Age threshold in days (default: 30)', '30')
  .action(async (options) => {
    await cleanMetrics({ days: parseInt(options.days) });
  });

// Parse arguments
program.parse();
