# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

```bash
npm run build          # Compile TypeScript to dist/
npm run dev            # Watch mode compilation
npm test               # Run Vitest in watch mode
npm run test:run       # Run tests once
npm run test:coverage  # Run tests with coverage report
npm run lint           # ESLint check
npm run format         # Prettier formatting
```

### CLI Development

```bash
# After building, test the CLI locally
node dist/cli/index.js install --local   # Install to ./.claude/
node dist/cli/index.js config            # Show current config
node dist/cli/index.js info              # Show agents & features
```

## Architecture

Olympus is a multi-agent orchestration system for Claude Code. It installs agents, slash commands, and hooks into the Claude Code configuration directory.

### Key Directories

- **`src/agents/`** - Agent definitions (oracle.ts, prometheus.ts, etc.). Each exports an `AgentConfig` and prompt metadata.
- **`src/features/`** - Core features: magic keywords, background tasks, model routing, continuation enforcement
- **`src/hooks/`** - Claude Code event handlers (keyword detection, persistence loops, context injection)
- **`src/cli/`** - CLI commands (install, config, info, update)
- **`src/installer/`** - Contains all agent/command/hook definitions as embedded constants (AGENT_DEFINITIONS, COMMAND_DEFINITIONS, etc.)

### Agent System

Agents are defined in `src/installer/index.ts` as the `AGENT_DEFINITIONS` constant. Each entry contains:
- Frontmatter (name, description, tools, model)
- Full agent prompt with instructions

Agents support tiered variants for model routing (e.g., `oracle`, `oracle-medium`, `oracle-low`).

### How Installation Works

The CLI's `install` command writes embedded templates from `src/installer/index.ts` to the user's Claude Code config directory:
- Global: `~/.claude/agents/`, `~/.claude/commands/`, etc.
- Local: `./.claude/agents/`, `./.claude/commands/`, etc.

### Configuration

Config files use JSONC format:
- User config: `~/.claude/olympus.jsonc`
- Project config: `./.claude/olympus.jsonc`

Schema defined in `src/shared/types.ts` using Zod.

## Testing

Tests are in `src/__tests__/`. Run a single test file:

```bash
npx vitest run src/__tests__/model-routing.test.ts
```
