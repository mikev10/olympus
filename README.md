<div align="center">

# ⚡ Olympus

### Multi-Agent Orchestration for Claude Code

[![Version](https://img.shields.io/badge/version-1.0.1-gold)](https://github.com/mikev10/olympus/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Agents](https://img.shields.io/badge/Agents-19-blue)](https://github.com/mikev10/olympus)

**Only the worthy ascend.**

[Install](#installation) • [Usage](#usage) • [Agents](#available-agents) • [Commands](#slash-commands)

</div>

---

## What is Olympus?

Olympus is a multi-agent orchestration system for [Claude Code](https://docs.anthropic.com/claude-code). It provides:

- **19 Specialized Agents** - Oracle, Prometheus, Olympian, and more
- **11 Slash Commands** - `/olympus`, `/ultrawork`, `/plan`, `/ascent`, etc.
- **Intelligent Model Routing** - Routes tasks to Haiku/Sonnet/Opus based on complexity
- **The Ascent** - Persistence loop that ensures tasks complete before stopping
- **Magic Keywords** - Say "ultrawork" to activate maximum performance mode

---

## Installation

### Via Claude Code Plugin (Recommended)

```bash
# Add the marketplace
/plugin marketplace add mikev10/olympus

# Install the plugin
/plugin install olympus-ai
```

### Via npm

```bash
npm install -g olympus-ai
olympus-ai install
```

### Via npm (Local Project)

```bash
npm install -g olympus-ai
olympus-ai install --local
```

---

## Usage

### Start Claude Code

```bash
claude
```

### Slash Commands

| Command | Description |
|---------|-------------|
| `/olympus <task>` | Activate multi-agent orchestration mode |
| `/olympus-default` | Set Olympus as your permanent default mode |
| `/ultrawork <task>` | Maximum performance mode with parallel agents |
| `/plan <description>` | Start planning session with Prometheus |
| `/prometheus <task>` | Strategic planning with interview workflow |
| `/review [plan-path]` | Review a plan with Momus |
| `/ascent <task>` | Persistence loop until task completion |
| `/cancel-ascent` | Cancel active The Ascent |
| `/deepsearch <query>` | Thorough multi-strategy codebase search |
| `/analyze <target>` | Deep analysis and investigation |
| `/update` | Check for and install updates |

### Examples

```bash
# Activate Olympus for a task
/olympus refactor the authentication module

# Set as default mode (persistent)
/olympus-default

# Use ultrawork for maximum performance
/ultrawork implement user dashboard with charts

# Start planning
/plan build a task management application

# Deep search
/deepsearch API endpoints that handle user data
```

### Magic Keywords

Include these words anywhere in your prompt to activate enhanced modes:

| Keyword | Effect |
|---------|--------|
| `ultrawork`, `ulw`, `uw` | Activates parallel agent orchestration |
| `search`, `find`, `locate` | Enhanced search mode |
| `analyze`, `investigate` | Deep analysis mode |

---

## Available Agents

### Task Execution

| Agent | Model | Best For |
|-------|-------|----------|
| **Oracle** | Opus | Complex debugging, architecture decisions, root cause analysis |
| **Librarian** | Sonnet | Finding documentation, understanding code organization |
| **Explore** | Haiku | Quick file searches, pattern matching, reconnaissance |
| **Frontend Engineer** | Sonnet | UI components, styling, accessibility |
| **Document Writer** | Haiku | README files, API docs, code comments |
| **Multimodal Looker** | Sonnet | Analyzing screenshots, diagrams, mockups |
| **QA Tester** | Sonnet | Interactive CLI/service testing with tmux |
| **Olympian** | Sonnet | Focused task execution, direct implementation |

### Planning & Review

| Agent | Model | Best For |
|-------|-------|----------|
| **Prometheus** | Opus | Strategic planning, work plans, requirement gathering |
| **Momus** | Opus | Critical plan review, feasibility assessment, risk identification |
| **Metis** | Opus | Pre-planning analysis, hidden requirement detection |

### Tiered Variants (Smart Model Routing)

| Domain | LOW (Haiku) | MEDIUM (Sonnet) | HIGH (Opus) |
|--------|-------------|-----------------|-------------|
| **Analysis** | `oracle-low` | `oracle-medium` | `oracle` |
| **Execution** | `olympian-low` | `olympian` | `olympian-high` |
| **Search** | `explore` | `explore-medium` | - |
| **Research** | `librarian-low` | `librarian` | - |
| **Frontend** | `frontend-engineer-low` | `frontend-engineer` | `frontend-engineer-high` |

---

## The Ascent

The Ascent is a persistence loop that binds Claude to your task until verified completion.

```bash
/ascent implement the entire authentication system
```

**How it works:**
1. Creates a todo list for all subtasks
2. Works continuously until all tasks complete
3. Can only exit by outputting `<promise>DONE</promise>` after verification
4. If stopped prematurely, continuation is enforced

**Exit conditions:**
- `<promise>DONE</promise>` - Work verified complete
- `/cancel-ascent` - User cancels the loop
- Max iterations (100) - Safety limit

---

## Planning Workflow

1. **Start planning**: `/plan build a new feature`
2. **Interview**: Prometheus asks clarifying questions
3. **Generate plan**: Say "Create the plan" when ready
4. **Review** (optional): `/review .olympus/plans/my-feature.md`
5. **Execute**: Use `/olympus` or `/ascent` to implement

Plans are saved to `.olympus/plans/` in your project directory.

---

## What Gets Installed

```
~/.claude/
├── agents/                  # 19 agent definitions
│   ├── oracle.md
│   ├── prometheus.md
│   ├── olympian.md
│   └── ...
├── commands/                # 11 slash commands
│   ├── olympus/skill.md
│   ├── ultrawork/skill.md
│   ├── plan.md
│   └── ...
├── hooks/                   # Event handlers
│   ├── keyword-detector.mjs
│   ├── persistent-mode.mjs
│   └── ...
└── CLAUDE.md               # Olympus system prompt
```

---

## Configuration

### Project-Level Config

Create `.claude/CLAUDE.md` in your project for project-specific instructions:

```markdown
# Project Context

This is a TypeScript monorepo using:
- React for frontend
- Node.js backend
- PostgreSQL database

## Conventions
- Use functional components
- All API routes in /src/api
```

---

## Uninstall

```bash
# Remove agents and commands
rm -rf ~/.claude/agents ~/.claude/commands ~/.claude/hooks ~/.claude/CLAUDE.md
```

---

## Requirements

- [Claude Code](https://docs.anthropic.com/claude-code) installed
- Anthropic API key (`ANTHROPIC_API_KEY` environment variable)
- Node.js 20+ (for npm installation)

---

## License

MIT - see [LICENSE](LICENSE)

---

## Credits


---

<div align="center">

**Only the worthy ascend.**

</div>
