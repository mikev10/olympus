---
title: "Installation"
sidebar_label: "Installation"
sidebar_position: 2
---

# Installation Guide

Complete setup instructions for Olympus, the multi-agent orchestration system for Claude Code.

---

## Prerequisites

Before installing Olympus, ensure you have:

### Required

- **[Claude Code](https://docs.anthropic.com/claude-code)** - The official Anthropic CLI (handles all authentication)
- **Node.js 20+** - For npm package installation

### Recommended

- **Claude Pro subscription** - For access to Claude Opus (highest tier models)
- **Git** - For version control features
- **Terminal with Unicode support** - For proper emoji rendering

**Important:** Olympus works directly with Claude Code. Claude Code handles all Anthropic authentication - you don't need to set up API keys separately.

---

## Quick Installation

For most users, this is all you need:

```bash
# 1. Install Olympus CLI
npm install -g olympus-ai

# 2. Install agents, skills, rules, and hooks
olympus-ai install

# 3. Start Claude Code
claude

# 4. Try it out
/olympus hello world
```

That's it! Olympus is now active.

---

## Detailed Installation Steps

### Step 1: Install Claude Code

If you haven't already installed Claude Code:

```bash
# Visit https://docs.anthropic.com/claude-code for installation instructions

# Verify installation
claude --version
```

**Claude Code handles all authentication.** Once Claude Code is set up, Olympus will work automatically.

### Step 2: Install Olympus CLI

Install the Olympus command-line interface globally:

```bash
npm install -g olympus-ai

# Verify installation
olympus-ai --version
```

**Note:** You need Node.js 20 or later. Check your version:

```bash
node --version  # Should be v20.0.0 or higher
```

### Step 3: Install Olympus Agents & Skills

Run the installer to copy agents, skills, rules, and hooks to your Claude Code configuration:

```bash
olympus-ai install
```

**What this installs:**

```
~/.claude/
├── agents/                  # 19 agent definitions
│   ├── oracle.md
│   ├── prometheus.md
│   ├── olympian.md
│   ├── librarian.md
│   ├── explore.md
│   ├── frontend-engineer.md
│   ├── document-writer.md
│   ├── multimodal-looker.md
│   ├── qa-tester.md
│   ├── momus.md
│   ├── metis.md
│   └── ... (+ tiered variants)
├── commands/                # 19 slash command skills
│   ├── olympus/SKILL.md
│   ├── ultrawork/SKILL.md
│   ├── plan/SKILL.md
│   ├── continue/SKILL.md
│   ├── prometheus/SKILL.md
│   ├── ascent/SKILL.md
│   ├── review/SKILL.md
│   ├── deepsearch/SKILL.md
│   ├── analyze/SKILL.md
│   ├── complete-plan/SKILL.md
│   ├── doctor/SKILL.md
│   ├── retro/SKILL.md
│   └── ... (+ more)
├── hooks/                   # Bundled event handler
│   └── olympus-hooks.cjs
├── olympus/
│   ├── rules/               # 26 AIDLC workflow rule files
│   │   ├── core-workflow.md
│   │   ├── common/          # Shared rules (terminology, validation, etc.)
│   │   ├── inception/       # Inception phase rules
│   │   └── construction/    # Construction phase rules
│   ├── learning/            # Learning system data
│   └── config.jsonc         # Global configuration
└── CLAUDE.md               # Olympus system prompt
```

### Step 4: Verify Installation

Start Claude Code and verify Olympus is working:

```bash
claude

# Try a simple command
> /olympus hello world

# Check learning system
> olympus-ai learn --stats
```

If you see Olympus responding and creating todos, installation is successful!

---

## Installation Options

### Global vs. Local Installation

**Global Installation** (Recommended)

Installs to `~/.claude/` - available across all projects:

```bash
olympus-ai install
```

**Benefits:**
- Works in all projects
- Consistent behavior everywhere
- Learning data shared across projects

**Local Installation**

Installs to `./.claude/` in current directory - project-specific:

```bash
olympus-ai install --local
```

**Benefits:**
- Project-specific configuration
- Doesn't affect other projects
- Can commit to version control

**When to use local:**
- Team projects where everyone uses Olympus
- Project-specific agent configurations
- When you want project-isolated learning data

### Installation Flags

The `install` command supports these options:

```bash
# Overwrite existing files (useful for updates)
olympus-ai install --force

# Suppress output except errors
olympus-ai install --quiet

# Install to current project instead of global
olympus-ai install --local

# Skip checking if Claude Code is installed
olympus-ai install --skip-claude-check
```

---

## Post-Installation Configuration

### Set Olympus as Default Mode

Make Olympus your default operating mode for Claude Code:

```bash
claude
> /olympus-default
```

Now every session starts with Olympus active automatically.

**To revert:**
Edit `~/.claude/CLAUDE.md` and remove the Olympus system prompt.

### Configure Project-Specific Behavior

Create `.claude/CLAUDE.md` in your project root:

```markdown
# Project Context

This is a [Your Framework] application using:
- [Tech stack details]
- [Important libraries]
- [Database/services]

## Conventions

- [Coding style preferences]
- [File organization]
- [Naming conventions]
- [Testing approach]

## Agent Preferences

- Oracle: Use for architecture decisions
- Olympian: Use for standard implementations
- Frontend Engineer: Use for all UI work
```

### Customize Configuration (Advanced)

Most users don't need this - the defaults work well.

Edit `~/.claude/olympus/config.jsonc` (created automatically by `olympus-ai init --global`):

```jsonc
{
  "$schema": "./olympus-schema.json",

  // Agent model configurations
  "agents": {
    "oracle": {
      "model": "claude-opus-4-6-20250625",  // Override to specific model
      "enabled": true                        // Enable/disable agent
    },
    "olympian": {
      "model": "claude-sonnet-4-6-20250514"
    },
    "explore": {
      "model": "claude-haiku-4-5-20251001"
    }
  },

  // Feature toggles
  "features": {
    "parallelExecution": true,          // Enable parallel agent execution
    "lspTools": true,                   // Enable LSP diagnostics
    "astTools": true,                   // Enable AST tools
    "continuationEnforcement": true,    // Enable todo continuation
    "autoContextInjection": true        // Enable learning system
  },

  // Permission settings
  "permissions": {
    "allowBash": true,
    "allowEdit": true,
    "allowWrite": true,
    "maxBackgroundTasks": 5             // Max concurrent background tasks
  },

  // Magic keyword triggers (customize if desired)
  "magicKeywords": {
    "ultrawork": ["ultrawork", "ulw", "uw"],
    "search": ["search", "find", "locate"],
    "analyze": ["analyze", "investigate", "examine"]
  }
}
```

**Common customizations:**

```jsonc
// Always use Opus for Oracle (expensive but powerful)
"agents": {
  "oracle": {
    "model": "claude-opus-4-6-20250625"
  }
}

// Disable specific agents
"agents": {
  "prometheus": {
    "enabled": false  // Disable planning agent
  }
}

// Reduce parallel tasks for slower machines
"permissions": {
  "maxBackgroundTasks": 3  // Lower from default 5
}

// Disable specific features
"features": {
  "parallelExecution": false  // Disable parallel agents
}
```

---

## Verification Checklist

After installation, verify these work:

- [ ] **Basic activation**: `/olympus hello world` creates todos and completes task
- [ ] **Agent delegation**: Complex tasks spawn sub-agents (check for Task tool usage)
- [ ] **Todo tracking**: Multi-step tasks show progress with checkboxes
- [ ] **Learning system**: `olympus-ai learn --stats` shows learning data directory
- [ ] **Slash commands**: `/ultrawork`, `/plan`, `/ascent` are recognized
- [ ] **Skills**: Using "ultrawork" keyword activates parallel mode
- [ ] **Hooks**: Context injection happens at session start (check for learned preferences)

---

## Troubleshooting

### Problem: `command not found: olympus-ai`

**Solution:**

```bash
# Check npm global bin path
npm config get prefix

# If it's not in your PATH, add it:
# Linux/macOS - Add to ~/.bashrc or ~/.zshrc
export PATH="$PATH:$(npm config get prefix)/bin"

# Windows - Add to PATH environment variable
# %APPDATA%\npm
```

### Problem: Claude Code not installed

**Solution:**

```bash
# Install Claude Code first
# Visit https://docs.anthropic.com/claude-code

# Or check if it's installed but not in PATH
where claude   # Windows
which claude   # Linux/macOS
```

### Problem: Agents not found when delegating

**Solution:**

```bash
# Re-run installation
olympus-ai install

# Or install with force flag to overwrite
olympus-ai install --force

# Verify agents were installed
ls ~/.claude/agents/
```

### Problem: Learning system not working

**Solution:**

```bash
# Check learning directory exists
ls ~/.claude/olympus/learning/

# If missing, create it manually
mkdir -p ~/.claude/olympus/learning/

# Or reinstall with learning enabled
olympus-ai install --force
```

### Problem: Slash commands not recognized

**Solution:**

```bash
# Verify skills directory
ls ~/.claude/commands/

# Reinstall with force
olympus-ai install --force

# Restart Claude Code
claude
```

### Problem: Skills not activating automatically

**Solution:**

Check that the hook bundle is installed:

```bash
ls ~/.claude/hooks/

# Should see:
# - olympus-hooks.cjs

# If missing:
olympus-ai install --force
```

### Problem: Performance issues or slowness

**Solution:**

```bash
# Clean up old learning data
olympus-ai learn --cleanup --age 90

# Reduce background task limit in config
# Edit ~/.claude/olympus/config.jsonc:
{
  "permissions": {
    "maxBackgroundTasks": 3  // Lower from default 5
  }
}
```

### Use the Doctor Command

For automatic diagnostics:

```bash
claude
> /doctor

# The doctor will:
# - Check installation completeness
# - Verify configuration
# - Test agent availability
# - Check learning system
# - Provide fix suggestions
```

---

## Updating Olympus

### Check for Updates

```bash
# Via CLI
olympus-ai update

# Or via slash command
claude
> /update
```

### Manual Update

```bash
# Update the npm package
npm update -g olympus-ai

# Reinstall agents and skills
olympus-ai install --force
```

### Update Learning Data Schema

If the learning data format changes between versions:

```bash
# Backup existing data
cp -r ~/.claude/olympus/learning ~/.claude/olympus/learning.backup

# Analyze and re-process existing data
olympus-ai learn --analyze

# Or start fresh
olympus-ai learn --forget
```

---

## Uninstallation

### Remove Olympus Completely

```bash
# 1. Remove npm package
npm uninstall -g olympus-ai

# 2. Remove agents, skills, hooks, and rules
rm -rf ~/.claude/agents
rm -rf ~/.claude/commands
rm -rf ~/.claude/hooks
rm -rf ~/.claude/olympus/rules
rm ~/.claude/CLAUDE.md

# 3. Remove learning data (optional)
rm -rf ~/.claude/olympus/

# 4. Remove project-specific installations (if any)
rm -rf .claude/
rm -rf .olympus/
```

### Keep Learning Data

If you want to keep your learned preferences for future reinstallation:

```bash
# Remove everything except learning data
rm -rf ~/.claude/agents
rm -rf ~/.claude/commands
rm -rf ~/.claude/hooks
rm -rf ~/.claude/olympus/rules
rm ~/.claude/CLAUDE.md

# Keep: ~/.claude/olympus/learning/
```

When you reinstall, Olympus will use the existing learning data.

---

## Advanced Installation

### Install from Source

For contributors or users who want to modify Olympus:

```bash
# Clone the repository
git clone https://github.com/mikev10/olympus.git
cd olympus

# Install dependencies
npm install

# Build from source
npm run build:all

# Install locally
node dist/cli/index.js install --local

# Or link globally
npm link
olympus-ai install
```

### Custom Agent Installation

Install only specific agents:

```bash
# Create custom agents directory
mkdir -p ~/.claude/agents/custom

# Copy agent definitions
cp my-custom-agent.md ~/.claude/agents/custom/

# Agent will be available via Task tool
# subagent_type: "custom/my-custom-agent"
```

### Environment-Specific Installation

For CI/CD or automated environments:

```bash
# Silent installation (no interactive prompts)
olympus-ai install --quiet --force

# Skip Claude Code check (useful in CI)
olympus-ai install --skip-claude-check --force

# Local project installation for CI
olympus-ai install --local --force --quiet
```

---

## Platform-Specific Notes

### macOS

```bash
# Install via npm
npm install -g olympus-ai
```

**Note:** macOS may require sudo for global npm installs:

```bash
sudo npm install -g olympus-ai
```

### Linux

```bash
# Ubuntu/Debian - Install Node.js 20+
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Then install Olympus
npm install -g olympus-ai
olympus-ai install
```

### Windows

```powershell
# Install via npm (requires Node.js 20+)
npm install -g olympus-ai

# Install Olympus
olympus-ai install

# Note: Use PowerShell or Windows Terminal for best experience
# Git Bash may have rendering issues with some characters
```

**Windows-specific issues:**
- Use `\` instead of `/` in paths when troubleshooting
- Learning data location: `%USERPROFILE%\.claude\olympus\learning\`
- Some emojis may not render in older terminals

---

## How Olympus Works with Claude Code

Olympus is a **plugin system** for Claude Code that adds:

1. **Agents** - Specialized sub-agents Claude can spawn via the `Task` tool
2. **Skills** - Slash commands like `/olympus`, `/ultrawork`, `/plan`
3. **Hooks** - Event handlers that enhance Claude's behavior (keyword detection, learning, persistence)
4. **Learning System** - Automatic preference capture and context injection

**All authentication is handled by Claude Code.** When you run `claude`, you're already authenticated. Olympus piggybacks on that authentication - no separate API keys or configuration needed.

---

## Next Steps

After successful installation:

1. **[Read the Overview](./overview)** - Understand what Olympus can do
2. **[Understand Orchestration](../core-concepts/orchestration)** - Learn how it works
3. **Try the examples** - Start with simple tasks like `/olympus hello world`
4. **Let it learn** - Use Claude naturally and let Olympus learn your preferences

---

## Getting Help

If you encounter issues during installation:

1. **Run the doctor**: `/doctor` in Claude Code
2. **Check GitHub Issues**: [github.com/mikev10/olympus/issues](https://github.com/mikev10/olympus/issues)
3. **View logs**: Check `~/.claude/olympus/logs/` for error messages
4. **Ask the community**: GitHub Discussions

---

## Installation Summary

**For most users:**

```bash
# Three commands, that's it
npm install -g olympus-ai
olympus-ai install
claude
```

**Verification:**

```bash
# In Claude Code session
> /olympus hello world
> olympus-ai learn --stats
```

**Next:**
- [Overview](./overview) - Quick start guide
- [Understanding Orchestration](../core-concepts/orchestration) - How it works

---

Welcome to Olympus. Summon the gods of code.
