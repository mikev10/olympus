# Olympus CLI Reference Guide

The `olympus-ai` command-line tool is your interface to manage the Olympus multi-agent system. This guide covers all available commands, options, and practical workflows.

## Quick Reference Cheatsheet

| Command | Purpose | Example |
|---------|---------|---------|
| `olympus-ai install` | Install Olympus to Claude Code config | `olympus-ai install --force` |
| `olympus-ai init` | Create local configuration file | `olympus-ai init --global` |
| `olympus-ai config` | Show or validate configuration | `olympus-ai config --validate` |
| `olympus-ai info` | Display available agents and features | `olympus-ai info` |
| `olympus-ai learn --show` | View learnings and feedback data | `olympus-ai learn --show` |
| `olympus-ai learn --efficiency` | See agent performance rankings | `olympus-ai learn --efficiency` |
| `olympus-ai learn --show-costs` | Check token costs (last 30 days) | `olympus-ai learn --show-costs` |
| `olympus-ai learn --budget-status` | View current session token usage | `olympus-ai learn --budget-status` |
| `olympus-ai learn --stats` | Learning system statistics | `olympus-ai learn --stats` |
| `olympus-ai discover` | Record a discovery or pattern | `olympus-ai discover "pattern \| summary \| details"` |
| `olympus-ai feedback` | Log preferences or view history | `olympus-ai feedback "always use strict mode"` |
| `olympus-ai update --check` | Check for available updates | `olympus-ai update --check` |
| `olympus-ai update` | Install latest version | `olympus-ai update` |
| `olympus-ai version` | Show version information | `olympus-ai version` |
| `olympus-ai test-prompt` | Preview prompt enhancement | `olympus-ai test-prompt "my prompt"` |
| `olympus-ai learn --sessions` | Show recent session history | `olympus-ai learn --sessions 5` |
| `olympus-ai learn --last-session` | Show last session summary | `olympus-ai learn --last-session` |
| `olympus-ai metrics` | (Deprecated) Redirects to learn | `olympus-ai metrics show` |

## Installation & Setup

### Install Olympus to Claude Code

```bash
olympus-ai install
```

Installs Olympus agents, skills, rules, and hooks to your Claude Code configuration (`~/.claude/`).

**Options:**
- `--force` - Overwrite existing files
- `--quiet` - Suppress output except errors
- `--local` - Install to current project (`./.claude/`) instead of global
- `--skip-claude-check` - Skip Claude Code installation check

**Example:**
```bash
# Force reinstall everything
olympus-ai install --force

# Silent installation
olympus-ai install --quiet

# Install just to this project
olympus-ai install --local
```

After installation, agents and slash commands are available in Claude Code:
- Use `/olympus <task>` to start orchestration mode
- Use `/ultrawork <task>` for maximum performance
- Use `/plan <description>` to plan with Prometheus

### Initialize Configuration

```bash
olympus-ai init
```

Creates a configuration file with agent models, feature toggles, and MCP servers.

**Options:**
- `--global` - Create global user config (`~/.claude/olympus.json`)
- `--force` - Overwrite existing config

**Output:**
- Creates `olympus.json` with agent configurations
- Creates `olympus-schema.json` for editor support
- Creates `AGENTS.md` template with project context

**Example:**
```bash
# Initialize global config
olympus-ai init --global

# Create local project config (overwrite if exists)
olympus-ai init --force
```

### Show Configuration

```bash
olympus-ai config
```

Displays your current configuration. Useful for verifying agent models, features, and MCP servers.

**Options:**
- `--validate` - Check for configuration issues (missing env vars, etc.)
- `--paths` - Show file paths only

**Example:**
```bash
# View full configuration
olympus-ai config

# Check for problems
olympus-ai config --validate

# Just show file locations
olympus-ai config --paths
```

## System Information

### View System & Agent Info

```bash
olympus-ai info
```

Shows available agents, enabled features, MCP servers, and magic keywords in a formatted display.

**Example output:**
```
Available Agents:
  oracle - Architectural analysis and complex debugging
  librarian - Documentation and research
  explore - Fast pattern matching and search
  ... (and more)

Enabled Features:
  Parallel Execution:        enabled
  LSP Tools:                 enabled
  Continuation Enforcement:  enabled
  ...
```

### Check Version Information

```bash
olympus-ai version
```

Displays detailed version information including package version, installation method, and commit hash.

**Example:**
```
Package version:   3.7.1
Installed version: 3.7.1
Install method:    npm global
Installed at:      2025-01-15T10:30:00Z
Commit hash:       a1b2c3d4e5f6...
```

## Learning System Commands

The learning system helps Olympus understand your preferences, track agent performance, and discover project patterns. This is the most powerful feature of the CLI.

### View Current Learnings

```bash
olympus-ai learn --show
```

Displays feedback collected, learned preferences, agent performance metrics, and discoveries.

**Output includes:**
- Total feedback entries collected
- User preferences (verbosity, autonomy, explicit rules)
- Agent performance (success rates and revision counts)
- Project discoveries (patterns, gotchas, insights)

**Example:**
```bash
olympus-ai learn --show
```

### Learning System Statistics

```bash
olympus-ai learn --stats
```

Shows comprehensive statistics about your learning data:
- Total feedback entries
- Time range of collected data
- Agent usage patterns
- Performance trends

**Example:**
```bash
olympus-ai learn --stats
```

### Analyze Patterns & Update Preferences

```bash
olympus-ai learn --analyze
```

Analyzes your feedback log to extract patterns and update user preferences automatically.

**What it does:**
1. Extracts patterns from feedback (revisions, cancellations, successes)
2. Updates your user preferences file
3. Updates agent performance rankings

**Example:**
```bash
olympus-ai learn --analyze
```

### Suggest Prompt Improvements

```bash
olympus-ai learn --suggest
```

Based on agent performance and your preferences, suggests improvements to agent prompts.

**Shows:**
- Pattern-based suggestions
- Confidence levels for each suggestion
- Expected impact

**Example:**
```bash
olympus-ai learn --suggest

# Output shows suggestions like:
# [78%] Preferred agents: oracle, librarian
# [65%] Verbosity preference: detailed
```

### Apply Prompt Improvements

```bash
olympus-ai learn --apply
```

Automatically applies suggested prompt improvements to agent prompts. Creates backups before making changes.

**Actions:**
- Modifies agent prompt files
- Creates backup copies (`.backup.txt`)
- Updates all suggested improvements

**Example:**
```bash
olympus-ai learn --apply
```

### Forget All Learnings

```bash
olympus-ai learn --forget
```

Permanently deletes all learning data. This is irreversible.

**Options:**
- `--project` - Only forget project-specific learnings (keep global learnings)

**Example:**
```bash
# Forget everything
olympus-ai learn --forget

# Forget only project learnings
olympus-ai learn --forget --project
```

### Export & Import Learnings

```bash
# Export all learnings to JSON
olympus-ai learn --export > learnings.json

# Import learnings from file
olympus-ai learn --import learnings.json
```

**Useful for:**
- Backing up your learnings
- Sharing learnings between projects
- Version control of preferences

**Example:**
```bash
# Save before wiping system
olympus-ai learn --export > backup-learnings.json

# Restore from backup
olympus-ai learn --import backup-learnings.json
```

### View Session History

```bash
olympus-ai learn --sessions
```

Shows the last 10 sessions with token usage, duration, and agent activity.

**Options:**
- `--sessions [n]` - Show last N sessions (default: 10)

**Example:**
```bash
# Show last 5 sessions
olympus-ai learn --sessions 5
```

### View Last Session Summary

```bash
olympus-ai learn --last-session
```

Shows a detailed summary of the most recent session including agents used, tokens consumed, and outcomes.

### Clean Up Old Learning Data

```bash
olympus-ai learn --cleanup
```

Removes old feedback entries and archived files to keep learning data manageable.

**Options:**
- `--dry-run` - Preview cleanup without executing (recommended first)
- `--age <days>` - Only delete entries older than N days (default: 180)
- `--remove-archived` - Also remove archived `.old.jsonl` files

**Example:**
```bash
# Preview cleanup first
olympus-ai learn --cleanup --dry-run

# Actually clean up entries older than 90 days
olympus-ai learn --cleanup --age 90

# Also remove archived files
olympus-ai learn --cleanup --remove-archived
```

## Token Efficiency & Cost Tracking

NEW: Advanced token metrics to optimize your agent usage and understand costs.

### View Agent Efficiency Rankings

```bash
olympus-ai learn --efficiency
```

Shows agent performance ranked by efficiency (success rate vs. token usage).

**Output includes:**
- Agent name and success rate
- Average tokens consumed per successful task
- Efficiency score and trend
- Recommendations for which agents to prefer

**Example output:**
```
AGENT EFFICIENCY REPORT
=======================

Agent           Success  Avg Tokens  Efficiency  Trend
oracle          85%      4,500       0.92        improving
librarian       78%      3,200       0.95        stable
explore         92%      2,100       1.05        improving
```

**What the numbers mean:**
- **Success**: Percentage of tasks completed successfully
- **Avg Tokens**: Average tokens used per successful task
- **Efficiency**: Combined score (higher is better)
- **Trend**: Is this agent improving, stable, or declining?

**Use cases:**
- Identify most cost-effective agents
- Spot agents with declining performance
- Make informed decisions about delegation

### Show Cost Breakdown

```bash
olympus-ai learn --show-costs
```

Displays token costs by model and agent for the last 30 days. Helps you understand spending patterns.

**Output includes:**
- Total tokens and estimated cost
- Breakdown by model (Opus, Sonnet, Haiku)
- Breakdown by agent with token/cost per agent
- Current pricing version

**Example output:**
```
COST ANALYSIS (Last 30 days)
============================

Total tokens:    145,320
Estimated cost:  $2.87

By Model:
- claude-opus-4-5-20251101        45k tokens ($2.10)
- claude-sonnet-4-5-20250514      78k tokens ($0.65)
- claude-3-5-haiku-20241022       22k tokens ($0.12)

By Agent:
- oracle                 45k tokens ($2.10)
- librarian              32k tokens ($0.35)
- explore                18k tokens ($0.10)
```

### Check Session Token Budget

```bash
olympus-ai learn --budget-status
```

Shows current session token usage compared to your baseline. Helps catch runaway sessions.

**Output includes:**
- Current session token usage
- Session baseline (typical usage)
- Warning threshold
- Historical comparison
- Status (NORMAL, ELEVATED, WARNING)

**Example output:**
```
SESSION BUDGET STATUS
=====================

Current session:  12,450 tokens
Session baseline: 10,000 tokens
Warning threshold: 15,000 tokens (150% of baseline)

Status: ELEVATED (125% of baseline)

Historical comparison:
- This session is within normal range
- Last 5 sessions averaged: 11,200 tokens
```

**Status meanings:**
- **NORMAL**: Below baseline usage
- **ELEVATED**: Above baseline but below threshold
- **WARNING**: Exceeds warning threshold (typically 150% of baseline)

## Managing Discoveries

Discoveries help you capture project insights so agents can learn about your codebase.

### Record a Discovery

```bash
olympus-ai discover "category | summary | details"
```

Records a discovery for agents to use in future sessions.

**Format options:**

```bash
# Full format: category | summary | details
olympus-ai discover "pattern | Use kebab-case for file names | This codebase consistently uses kebab-case for all non-component files"

# With --category option
olympus-ai discover "Use TypeScript strict mode | Enforced in tsconfig.json" --category pattern

# Shorthand format
olympus-ai discover "gotcha | Database migrations must run in order | Sequential execution required"
```

**Discovery categories:**
- `pattern` - Code patterns or conventions
- `gotcha` - Pitfalls or gotchas to avoid
- `workaround` - Workarounds for known issues
- `performance` - Performance considerations
- `dependency` - Important dependencies or versions
- `configuration` - Configuration details
- `technical_insight` - Deep technical knowledge

**Options:**
- `--category <cat>` - Specify category (can omit from input)
- `--scope <scope>` - `global` or `project` (default: project)
- `--confidence <0-1>` - Confidence level (default: 0.8)
- `--agent <name>` - Recording agent name (default: olympian)

**Example:**
```bash
# Record a pattern discovery
olympus-ai discover "pattern | Always use const by default | var is never used in this project" --scope project

# Record a gotcha with high confidence
olympus-ai discover "gotcha | Import order matters | Component imports must come before utility imports" --confidence 0.95

# Record a global discovery (shared across projects)
olympus-ai discover "configuration | Node version | Project requires Node 20+" --scope global
```

After recording, discoveries appear in `olympus-ai learn --show` and are automatically injected into agent prompts.

### View Discoveries

```bash
olympus-ai learn --show
```

View section includes all discovered patterns, gotchas, workarounds, and insights. Agents use these to make smarter decisions.

## Preferences & Feedback

### Log a Preference

```bash
olympus-ai feedback "your preference here"
```

Manually record a preference or instruction for Olympus to learn.

**Examples:**
```bash
# Instruction
olympus-ai feedback "Always ask before making breaking changes"

# Preference
olympus-ai feedback "Prefer Sonnet over Opus for simple analysis to save costs"

# Convention
olympus-ai feedback "Component files should go in src/components/, not src/"
```

### View Feedback History

```bash
olympus-ai feedback --history
```

Shows the last 20 feedback entries (most recent first).

**Example output:**
```
Feedback History (last 20):

2025-02-04  explicit_preference  Always use const by default
2025-02-03  success              Task completed successfully
2025-02-03  revision             User requested changes to output
```

## Updates & Maintenance

### Check for Updates

```bash
olympus-ai update --check
```

Checks if a newer version is available without installing.

**Output:**
```
Olympus Update

Current version: 3.7.1
Install method: npm global

Checking for updates...
✓ You are running the latest version (3.7.1)
```

### Install Updates

```bash
olympus-ai update
```

Installs the latest version of olympus-ai. Automatically installed from npm.

**Options:**
- `--check` - Only check, don't install
- `--force` - Force reinstall even if up to date
- `--quiet` - Suppress output except errors

**Example:**
```bash
# Update with full output
olympus-ai update

# Force reinstall
olympus-ai update --force

# Silent mode
olympus-ai update --quiet
```

**After updating:**
- Restart Claude Code to use new version
- Run `olympus info` to verify

### Postinstall Hook (Automatic)

```bash
olympus-ai postinstall
```

Automatically runs after `npm install -g olympus-ai`. Creates initial configuration and validates setup.

This is called automatically and doesn't need manual execution.

## Testing & Debugging

### Test Prompt Enhancement

```bash
olympus-ai test-prompt "<your prompt here>"
```

Preview how Olympus will enhance your prompt with magic keywords and learnings.

**Example:**
```bash
$ olympus-ai test-prompt "Please implement an /ultrawork to fix the API"

Original prompt:
Please implement an /ultrawork to fix the API

Detected magic keywords:
ultrawork

Enhanced prompt:
[Full enhanced prompt with skills, context, and instructions injected]
```

**Useful for:**
- Testing custom prompts before use
- Understanding magic keyword detection
- Debugging enhancement pipeline

## Deprecated: Metrics Command

```bash
olympus-ai metrics
```

The `metrics` command is deprecated. All metrics functionality has been consolidated into `olympus-ai learn`:

| Old Command | New Equivalent |
|-------------|---------------|
| `olympus-ai metrics show` | `olympus-ai learn --efficiency` |
| `olympus-ai metrics export` | `olympus-ai learn --export` |
| `olympus-ai metrics analyze` | `olympus-ai learn --show-costs` |
| `olympus-ai metrics clean` | `olympus-ai learn --cleanup` |

## One-Time Utilities

### Migrate Notepads to Learning System

```bash
olympus-ai migrate-notepads
```

One-time utility to migrate content from `.olympus/notepads/` to the modern discovery system.

**Example:**
```bash
olympus-ai migrate-notepads
✓ Migrated 12 discoveries from notepads
Run "olympus-ai learn --show" to see the discoveries.
```

After migration, old notepads can be safely deleted.

## Troubleshooting

### Olympus Not Found

**Problem:** `olympus: command not found`

**Solutions:**
1. Verify installation: `npm list -g olympus-ai`
2. Reinstall: `npm install -g olympus-ai`
3. Check npm permissions: `npm config get prefix`

### Configuration Not Loading

**Problem:** Commands fail with "config not found"

**Solutions:**
```bash
# Initialize config
olympus-ai init

# Validate config
olympus-ai config --validate

# Check paths
olympus-ai config --paths
```

### Agents Not Available

**Problem:** Agents not showing in Claude Code

**Solutions:**
1. Reinstall: `olympus-ai install --force`
2. Verify installation: `olympus-ai info`
3. Check `.claude/` directory exists
4. Restart Claude Code

### Learning Data Issues

**Problem:** `olympus learn` commands show no data

**Solutions:**
```bash
# Check what data exists
olympus-ai learn --show

# View statistics
olympus-ai learn --stats

# Check file sizes
ls -lah ~/.olympus/learning/
```

### Token Metrics Not Available

**Problem:** `--efficiency` or `--show-costs` show "no data"

**Solutions:**
1. These metrics require recent agent usage
2. Use agents normally for a few sessions
3. Feedback data is collected automatically
4. Run `olympus learn --show` to verify feedback is present

### Update Fails

**Problem:** `olympus update` fails or hangs

**Solutions:**
```bash
# Check npm registry
npm config get registry

# Update npm first
npm install -g npm@latest

# Force reinstall
npm install -g olympus-ai@latest --force

# Check for disk space
df -h
```

## Advanced Usage

### Scripting with Olympus CLI

You can use Olympus CLI in shell scripts:

```bash
#!/bin/bash

# Check for updates and install silently
olympus-ai update --quiet

# Log a discovery
olympus-ai discover "pattern | Build process updated | Use npm run build instead of make"

# Export learnings for backup
olympus-ai learn --export > backup-$(date +%Y%m%d).json

# Check efficiency before delegating tasks
olympus-ai learn --efficiency | grep -i "improving"
```

### Integration Examples

**GitHub Actions CI/CD:**
```yaml
- name: Install Olympus
  run: npm install -g olympus-ai

- name: Validate Setup
  run: olympus-ai config --validate

- name: Check Agent Efficiency
  run: olympus-ai learn --efficiency
```

**NPM Postinstall:**
```json
{
  "scripts": {
    "postinstall": "olympus install --local"
  }
}
```

## Configuration File Reference

The configuration file (`olympus.json`) controls agent models, feature toggles, and integrations:

```json
{
  "agents": {
    "oracle": {
      "model": "claude-opus-4-6-20250625",
      "enabled": true
    },
    "librarian": {
      "model": "claude-sonnet-4-6-20250514"
    },
    "explore": {
      "model": "claude-haiku-4-5-20251001"
    }
  },
  "features": {
    "parallelExecution": true,
    "lspTools": true,
    "continuationEnforcement": true,
    "autoContextInjection": true
  },
  "mcpServers": {
    "exa": { "enabled": true },
    "context7": { "enabled": true }
  },
  "permissions": {
    "allowBash": true,
    "allowEdit": true,
    "maxBackgroundTasks": 5
  },
  "magicKeywords": {
    "ultrawork": ["ultrawork", "ulw", "uw"],
    "search": ["search", "find", "locate"]
  }
}
```

## Environment Variables

Olympus respects these environment variables:

| Variable | Purpose | Example |
|----------|---------|---------|
| `ANTHROPIC_API_KEY` | Claude API key (required) | `sk-...` |
| `EXA_API_KEY` | Exa search API key | `...` |
| `OLYMPUS_HOME` | Override config directory | `~/.olympus/` |
| `CLAUDE_SESSION_ID` | Current session ID | Auto-generated |

## Getting Help

### Built-in Help

```bash
# Show help for any command
olympus-ai --help
olympus-ai learn --help
olympus-ai discover --help
```

### Command Examples

```bash
# List all commands
olympus-ai --help

# Get command specific options
olympus-ai learn --help

# Quick reference
olympus-ai info
```

### Common Commands Reference

```bash
# Daily operations
olympus-ai learn --show              # Check what you've learned
olympus-ai learn --efficiency        # See agent performance
olympus-ai discover "..."            # Record a discovery

# Maintenance
olympus-ai learn --cleanup           # Clean up old data
olympus-ai update --check            # Check for updates
olympus-ai config --validate         # Validate setup

# Advanced
olympus-ai learn --suggest           # Get recommendations
olympus-ai learn --apply             # Apply improvements
olympus-ai learn --export            # Backup your learnings
```

## What's Next?

- **Get started:** Run `olympus-ai install` to add agents to Claude Code
- **Learn more:** Read the [Understanding Orchestration System](understanding-orchestration-system.md) guide
- **Configure agents:** See [Configuration Guide](./configuration.md)
- **Workflow examples:** Check out [Workflow Guide](workflow-guide.md)

---

**Version:** 3.7.1 | **Last Updated:** March 2026
