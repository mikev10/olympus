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
import { join, dirname } from 'path';
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
  isInstalled,
  getInstallInfo
} from '../installer/index.js';
import {
  readFeedbackLog,
  readJsonFile,
  getLearningDir,
  writeJsonFile,
  appendFeedback,
} from '../learning/storage.js';
import { extractPatterns } from '../learning/pattern-extractor.js';
import { updatePreferences, createDefaultPreferences } from '../learning/preference-learner.js';
import { evaluateAgentPerformance } from '../learning/agent-evaluator.js';
import { generatePromptPatches, previewPatches, applyPromptPatches } from '../learning/prompt-patcher.js';
import { readDiscoveries, getDiscoveriesForInjection, recordDiscovery } from '../learning/discovery.js';
import { migrateNotepads } from '../learning/migrate-notepads.js';
import { generateLearningStats, formatLearningStats } from '../learning/stats.js';
import { cleanupLearning, formatCleanupResult } from '../learning/cleanup.js';
import type { UserPreferences, AgentPerformance } from '../learning/types.js';
import { randomUUID } from 'crypto';
import { rmSync, appendFileSync } from 'fs';

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
        console.log(chalk.green('║         Installation Complete!                            ║'));
        console.log(chalk.green('╚═══════════════════════════════════════════════════════════╝'));
        console.log('');
        console.log(chalk.gray(`Installed to: ${options.local ? './.claude/' : '~/.claude/'}`));
        if (options.local) {
          console.log(chalk.yellow('\nNote: Hooks are not installed with --local.'));
          console.log(chalk.yellow('For full functionality, also run: olympus-ai install'));
        }
        console.log('');
        console.log(chalk.yellow('Usage:'));
        console.log('  claude                        # Start Claude Code normally');
        console.log('');
        console.log(chalk.yellow('Slash Commands:'));
        console.log('  /olympus <task>              # Activate Olympus orchestration mode');
        console.log('  /olympus-default             # Set Olympus as default behavior');
        console.log('  /ultrawork <task>             # Maximum performance mode');
        console.log('  /deepsearch <query>           # Thorough codebase search');
        console.log('  /analyze <target>             # Deep analysis mode');
        console.log('  /plan <description>           # Start planning with Prometheus');
        console.log('  /review [plan-path]           # Review plan with Momus');
        console.log('');
        console.log(chalk.yellow('Available Agents (via Task tool):'));
        console.log(chalk.gray('  Base Agents:'));
        console.log('    oracle              - Architecture & debugging (Opus)');
        console.log('    librarian           - Documentation & research (Sonnet)');
        console.log('    explore             - Fast pattern matching (Haiku)');
        console.log('    frontend-engineer   - UI/UX specialist (Sonnet)');
        console.log('    document-writer     - Technical writing (Haiku)');
        console.log('    multimodal-looker   - Visual analysis (Sonnet)');
        console.log('    momus               - Plan review (Opus)');
        console.log('    metis               - Pre-planning analysis (Opus)');
        console.log('    orchestrator-olympus - Todo coordination (Opus)');
        console.log('    olympian     - Focused execution (Sonnet)');
        console.log('    prometheus          - Strategic planning (Opus)');
        console.log('    qa-tester           - Interactive CLI testing (Sonnet)');
        console.log(chalk.gray('  Tiered Variants (for smart routing):'));
        console.log('    oracle-medium       - Simpler analysis (Sonnet)');
        console.log('    oracle-low          - Quick questions (Haiku)');
        console.log('    olympian-high - Complex tasks (Opus)');
        console.log('    olympian-low  - Trivial tasks (Haiku)');
        console.log('    librarian-low       - Quick lookups (Haiku)');
        console.log('    explore-medium      - Thorough search (Sonnet)');
        console.log('    frontend-engineer-high - Design systems (Opus)');
        console.log('    frontend-engineer-low  - Simple styling (Haiku)');
        console.log('');
        console.log(chalk.blue('Quick Start:'));
        console.log('  1. Run \'claude\' to start Claude Code');
        console.log('  2. Type \'/olympus-default\' to enable Olympus permanently');
        console.log('  3. Or use \'/olympus <task>\' for one-time activation');
      }
    } else {
      console.error(chalk.red(`Installation failed: ${result.message}`));
      if (result.errors.length > 0) {
        result.errors.forEach(err => console.error(chalk.red(`  - ${err}`)));
      }
      process.exit(1);
    }
  });

/**
 * Postinstall command - Silent install for npm postinstall hook
 */
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
      console.log(chalk.gray('  Run "olympus info" to see available agents.'));
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
  .option('--cleanup', 'Clean up old learning data')
  .option('--dry-run', 'Preview cleanup without executing (use with --cleanup)')
  .option('--age <days>', 'Age threshold in days for cleanup (default: 180)', '180')
  .option('--remove-archived', 'Remove archived .old.jsonl files (use with --cleanup)')
  .option('-a, --analyze', 'Analyze feedback and show insights')
  .option('--suggest', 'Show suggested prompt improvements')
  .option('--apply', 'Apply suggested improvements')
  .option('-f, --forget', 'Forget all learnings')
  .option('-p, --project', 'Scope to current project (with --forget)')
  .option('-e, --export', 'Export learnings to JSON')
  .option('-i, --import <file>', 'Import learnings from JSON')
  .action(async (options) => {
    const learningDir = getLearningDir();

    if (options.stats) {
      const stats = generateLearningStats(process.cwd());
      console.log(formatLearningStats(stats));
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
      console.log(chalk.blue.bold('\n╭─────────────────────────────────────────────────────────────╮'));
      console.log(chalk.blue.bold('│                  OLYMPUS LEARNING STATUS                    │'));
      console.log(chalk.blue.bold('╰─────────────────────────────────────────────────────────────╯\n'));

      const feedback = readFeedbackLog();
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
        for (const rule of prefs.explicit_rules.slice(0, 3)) {
          console.log(`   • ${rule}`);
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

      const agentPerf = readJsonFile<Record<string, AgentPerformance>>(
        join(learningDir, 'agent-performance.json'),
        {}
      );

      if (Object.keys(agentPerf).length > 0) {
        console.log(chalk.white('🤖 Agent Performance:'));
        for (const [name, perf] of Object.entries(agentPerf)) {
          const successPct = (perf.success_rate * 100).toFixed(0);
          console.log(`   • ${name}: ${successPct}% success (${perf.revision_count} revisions)`);
        }
        console.log('');
      }

      // Show discoveries
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

      return;
    }

    if (options.analyze) {
      console.log(chalk.blue('Analyzing feedback...\n'));

      const feedback = readFeedbackLog();
      const patterns = extractPatterns(feedback);

      console.log(chalk.white(`Found ${patterns.length} patterns:\n`));
      for (const p of patterns) {
        console.log(`  [${(p.confidence * 100).toFixed(0)}%] ${p.pattern.substring(0, 60)}...`);
        console.log(chalk.gray(`       Seen ${p.evidence_count}x, scope: ${p.scope}, category: ${p.category}`));
      }

      // Update preferences
      const currentPrefs = readJsonFile<UserPreferences>(
        join(learningDir, 'user-preferences.json'),
        createDefaultPreferences()
      );

      const updatedPrefs = updatePreferences(currentPrefs, feedback, patterns);
      writeJsonFile(join(learningDir, 'user-preferences.json'), updatedPrefs);

      // Update agent performance
      const agentPerf = evaluateAgentPerformance(feedback);
      writeJsonFile(join(learningDir, 'agent-performance.json'), Object.fromEntries(agentPerf));

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
        const projectDir = join(process.cwd(), '.olympus', 'learning');
        if (existsSync(projectDir)) {
          rmSync(projectDir, { recursive: true });
          console.log(chalk.green('✓ Project learnings forgotten.'));
        } else {
          console.log(chalk.yellow('No project learnings found.'));
        }
      } else {
        if (existsSync(learningDir)) {
          rmSync(learningDir, { recursive: true });
          console.log(chalk.green('✓ All learnings forgotten.'));
        } else {
          console.log(chalk.yellow('No learnings found.'));
        }
      }
      return;
    }

    if (options.export) {
      const data = {
        feedback: readFeedbackLog(),
        preferences: readJsonFile(join(learningDir, 'user-preferences.json'), null),
        agentPerformance: readJsonFile(join(learningDir, 'agent-performance.json'), {}),
        discoveries: readDiscoveries(process.cwd()),
        exportedAt: new Date().toISOString(),
      };
      console.log(JSON.stringify(data, null, 2));
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

    // Default: show help
    console.log('Usage: olympus learn [options]');
    console.log('');
    console.log('Options:');
    console.log('  -s, --show           Show current learnings');
    console.log('  --stats              Show learning system statistics');
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

// Parse arguments
program.parse();
