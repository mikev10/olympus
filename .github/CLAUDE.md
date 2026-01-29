# Claude AI Instructions for olympus

This file provides context for Claude when working on this repository via GitHub Actions.

## Repository Overview

olympus is a multi-agent orchestration system for Claude Code.

### Key Features
- **18 specialized agents** with intelligent model routing (Haiku/Sonnet/Opus tiers)
- **13 slash commands** including /olympus, /ultrawork, /plan, /ascent, /prometheus
- **Smart delegation** - automatically routes tasks to appropriate specialist agents
- **Background execution** - runs long-running tasks asynchronously
- **The Ascent** - persistence loop that ensures tasks complete before stopping

### Installation
```bash
npm install -g olympus-ai
olympus-ai install
```

## Code Structure

```
src/
  agents/                # Agent TypeScript definitions
  installer/             # Installation logic
  hooks/                 # Hook system implementations
  features/              # Core features (model routing, background tasks)
commands/                # Slash command definitions (.md)
hooks/                   # Hook scripts (installed to ~/.claude/)
.claude/                 # Olympus system prompt and configs
tests/                   # Test files
```

## When Responding to Issues

### Installation Issues
- Recommend running `/doctor` to diagnose problems
- Check if user installed via correct method: `npm install -g olympus-ai && olympus-ai install`
- Common issues: outdated Claude Code version, missing dependencies, npm permissions

### Bug Reports
- Ask for Claude Code version if not provided
- Request reproduction steps
- Check if issue exists in `agents/` or `skills/` definitions

### Feature Requests
- Acknowledge the request
- Consider if it fits the plugin's philosophy (intelligent delegation, persistence)
- Label appropriately

## When Reviewing PRs

### Agent Definitions
- Verify TypeScript types are correct (src/agents/*.ts)
- Check that agent names match their exported constants
- Ensure model tier is appropriate (haiku for simple, sonnet for medium, opus for complex)
- Verify description matches the agent's purpose

### Skill Definitions
- Check Markdown formatting
- Verify the skill follows existing patterns
- Ensure instructions are clear and complete

### Code Quality
- Follow existing code patterns
- Include tests for new functionality
- Update version numbers if adding features

## Agent Tiers

| Tier | Model | Use For |
|------|-------|---------|
| LOW | Haiku | Simple lookups, fast searches |
| MEDIUM | Sonnet | Standard implementation work |
| HIGH | Opus | Complex reasoning, architecture |

## Common Labels

- `bug` - Something isn't working
- `enhancement` - Feature request
- `question` - User needs help
- `documentation` - Docs improvement
- `installation` - Setup/install issues
- `agents` - Related to agent definitions
- `stale` - No recent activity
- `pinned` - Keep open, don't auto-close
