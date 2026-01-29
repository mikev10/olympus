# Olympus Multi-Agent System

Olympus is an orchestration layer for Claude Code that transforms how you work with AI. Instead of a single conversation, Olympus enables Claude to delegate tasks to specialized agents, run work in parallel, and persist through complex multi-step tasks.

## What Problem Does It Solve?

Without Olympus, Claude Code:
- Works sequentially on one thing at a time
- Can lose context on long tasks
- May stop prematurely when work remains
- Treats all tasks the same regardless of complexity

With Olympus:
- Multiple agents work in parallel
- Specialized agents handle what they're best at
- Work continues until truly complete
- Complex tasks get planned before execution

## Core Concepts

### Agents

Olympus provides specialized agents, each optimized for specific tasks:

| Agent | Purpose |
|-------|---------|
| `oracle` | Architecture decisions, debugging complex issues |
| `olympian` | Focused task execution |
| `explore` | Fast codebase search |
| `librarian` | Documentation research |
| `frontend-engineer` | UI/UX implementation |
| `prometheus` | Strategic planning |
| `momus` | Plan review and critique |

### Modes

| Mode | Activation | Behavior |
|------|------------|----------|
| **Olympus** | `/olympus <task>` | Smart delegation with todo tracking |
| **Ultrawork** | `/ultrawork <task>` | Maximum parallelism, aggressive delegation |
| **Ascent** | `/ascent <task>` | Won't stop until verified complete |

### Persistence

Olympus tracks incomplete work and prevents premature stopping. If Claude tries to finish with pending todos, it gets redirected back to work. This ensures complex tasks actually get completed.

## How to Use It

### Quick Start

```
/olympus-default          # Enable Olympus as default behavior
```

Then just work normally. Olympus activates automatically based on task complexity.

### Explicit Activation

```
/olympus refactor the auth module
/ultrawork implement the entire feature
/plan design the new API
```

### Keyword Triggers

Certain words in your prompts automatically enhance Claude's behavior:

- **ultrawork** / **ulw** - Activates parallel execution mode
- **search** / **find** - Launches multiple search agents
- **analyze** / **investigate** - Gathers deep context before acting

## Value Summary

| Without Olympus | With Olympus |
|-----------------|--------------|
| Single-threaded work | Parallel agent execution |
| Generic responses | Specialized agent expertise |
| May stop early | Persists until complete |
| Ad-hoc approach | Structured planning available |
| Context limits | Delegates to preserve context |

## Installation

```bash
npm install -g olympus-ai
olympus-ai install
```

After installation, Olympus configures itself in `~/.claude/` with agents, commands, and automation hooks.

## Learn More

- Repository: https://github.com/mikev10/olympus
- Slash commands: `/olympus`, `/ultrawork`, `/plan`, `/review`, `/ascent`
- Update: `/update` or `olympus-ai update`
