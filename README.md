<div align="center">

# ⚡ Olympus

### Multi-Agent Orchestration for Claude Code

[![npm version](https://img.shields.io/npm/v/olympus-ai.svg)](https://www.npmjs.com/package/olympus-ai)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Agents](https://img.shields.io/badge/Agents-20+-blue)](https://github.com/mikev10/olympus)
[![Build Status](https://img.shields.io/github/actions/workflow/status/mikev10/olympus/claude.yml)](https://github.com/mikev10/olympus/actions)

**Summon the gods of code.**

[Why Olympus?](#why-olympus) • [Quick Start](#quick-start) • [AI-DLC Workflow](#ai-dlc-workflow) • [Self-Learning](#self-learning-system) • [Use Cases](#use-cases) • [Agents](#available-agents) • [Docs](#documentation)

</div>

---

## What is Olympus?

Olympus is a multi-agent orchestration system for [Claude Code](https://docs.anthropic.com/claude-code). It provides:

- 🧠 **Self-Learning System** - Learns your preferences, patterns, and codebase over time
- 🤖 **20+ Specialized Agents** - Oracle, Prometheus, Olympian, Librarian, and more
- ⚡ **Smart Model Routing** - Auto-selects Haiku/Sonnet/Opus based on task complexity
- 📋 **Todo Management** - Tracks progress with real-time updates
- 🔄 **Background Execution** - Long-running tasks run async with notifications
- 🎯 **Continuation Enforcement** - Never stops until all tasks are complete
- 💬 **19 Slash Commands** - `/ultrawork`, `/plan`, `/ascent`, `/continue`, `/review`, and more
- 🔮 **AI-DLC Workflow** - Inception → Construction → Operations pipeline for structured development
- 🌐 **Language Agnostic** - Works with any tech stack: Python, .NET, Go, Rust, Java, and more
- 🔮 **Magic Keywords** - Natural language triggers for enhanced modes

---

## Why Olympus?

Olympus transforms Claude Code from a single agent into a **pantheon of specialized experts** that work together seamlessly.

### 🧠 Self-Learning System

**Olympus learns from your preferences and evolves over time.**

- **Active Agent Learning** - Agents proactively record patterns, gotchas, and workarounds they discover during work
- **Passive Feedback Capture** - Automatically detects corrections, preferences, and patterns from your interactions
- **Pattern Extraction** - Identifies recurring feedback and adapts behavior accordingly
- **Preference Learning** - Infers your communication style (concise vs. detailed, autonomous vs. collaborative)
- **Agent Performance Tracking** - Monitors which agents succeed or fail for specific tasks
- **Token Efficiency Tracking** - Automatically tracks token usage per agent to optimize cost without manual intervention
- **Discovery Storage** - Structured JSONL storage with verification tracking and confidence scoring
- **Context Injection** - Learned preferences and discoveries are automatically applied in new sessions

**The more you use Olympus, the better it understands your workflow.**

### ⚡ Intelligent Orchestration

- **Smart Delegation** - Routes tasks to specialized agents based on complexity
- **Model Routing** - Automatically selects Haiku/Sonnet/Opus to optimize cost and performance
- **Parallel Execution** - Runs independent tasks concurrently for maximum throughput

### 🎯 Continuous Delivery

- **Todo Management** - Tracks progress across complex multi-step tasks
- **Continuation Enforcement** - Never stops until all tasks are verified complete
- **Background Operations** - Long-running builds, tests, and installs run async with notifications

### 🔧 Developer Experience

- **Zero Configuration** - Works out-of-the-box with sensible defaults
- **Works Everywhere** - Not tied to any language or framework — orchestrates across .NET, Python, Go, Rust, Java, and any codebase
- **Slash Commands** - 19 slash commands (`/ultrawork`, `/plan`, `/ascent`, `/continue`)
- **Magic Keywords** - Natural language triggers for enhanced modes

### 📊 Olympus vs. Manual Claude Usage

| Feature | Manual Claude | Olympus |
|---------|---------------|---------|
| **Multi-Step Tasks** | Sequential, manual tracking | Automatic todo management |
| **Parallel Execution** | One task at a time | 3-5x faster with concurrent agents |
| **Learning** | Repeats mistakes | Learns from corrections automatically |
| **Model Selection** | Manual switching | Smart routing (cost optimized) |
| **Task Persistence** | Stops when asked | Continues until verified complete |
| **Background Tasks** | Blocks waiting | Runs async with notifications |
| **Agent Specialization** | Generic responses | 20+ experts for specific domains |
| **Token Awareness** | Manual tracking | Automatic efficiency guidance |

---

## Quick Start

Get started in under 60 seconds:

```bash
# Install globally
npm install -g olympus-ai

# Initialize Olympus
olympus-ai install

# Start Claude Code
claude

# Try it out
/olympus implement a REST API for user management
```

**That's it.** Olympus is now active and learning from your interactions.

---

## Installation

### Prerequisites

- [Claude Code](https://docs.anthropic.com/claude-code) installed
- Node.js 20+ (`node -v` to check)

### Global Installation (Recommended)

Install Olympus globally to enable it across all your projects:

```bash
npm install -g olympus-ai
olympus-ai install
```

This installs agents, skills, rules, and hooks to `~/.claude/` so every Claude Code session has access to Olympus.

### Local Project Installation

Install Olympus as a dev dependency for a specific project. This is useful for teams that want Olympus pinned to a specific version in their repo:

```bash
# Install as a dev dependency
npm install --save-dev olympus-ai

# Run the installer for this project only
npx olympus-ai install --local
```

This installs agents, skills, rules, hooks, and settings to `./.claude/` in your current project directory.

> **Note:** You can use both. A global install provides Olympus across all projects, while a local install scopes everything to the current project. Local files take precedence over global ones.

---

## Usage

### Start Claude Code

```bash
claude
```

### Slash Commands

| Command                 | Description                                                            |
| ----------------------- | ---------------------------------------------------------------------- |
| `/olympus <task>`       | Activate multi-agent orchestration mode                                |
| `/olympus-default`      | Set Olympus as your permanent default mode                             |
| `/ultrawork <task>`     | Maximum performance mode with parallel agents                          |
| `/plan <description>`   | Start planning session with Prometheus                                 |
| `/prometheus <task>`    | Strategic planning with interview workflow                             |
| `/review [plan-path]`   | Review a plan with Momus                                               |
| `/ascent <task>`        | Persistence loop until task completion                                 |
| `/cancel-ascent`        | Cancel active The Ascent                                               |
| `/deepsearch <query>`   | Thorough multi-strategy codebase search                                |
| `/analyze <target>`     | Deep analysis and investigation                                        |
| `/complete-plan [path]` | Verify and complete a plan after implementation                        |
| `/continue`             | Resume an active AI-DLC workflow from last checkpoint                  |
| `/retro`                | Run a guardrail retrospective on the current AI-DLC workflow           |
| `/workflow-status`      | View all active structured workflows and their status                  |
| `/olympus next`         | Get the next ready task from current workflow                          |
| `/doctor`               | Diagnose and fix olympus installation issues                           |
| `/deepinit`             | Deep codebase initialization with hierarchical AGENTS.md documentation |
| `/update`               | Check for and install updates                                          |

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

| Keyword                    | Effect                                 |
| -------------------------- | -------------------------------------- |
| `ultrawork`, `ulw`, `uw`   | Activates parallel agent orchestration |
| `search`, `find`, `locate` | Enhanced search mode                   |
| `analyze`, `investigate`   | Deep analysis mode                     |

---

## Use Cases

### 🏗️ Complex Refactoring

```bash
/ascent refactor the entire authentication module to use OAuth 2.0
```

**What happens:**
- Creates todo list for all subtasks
- Delegates to specialized agents (Oracle for architecture, Olympian for execution)
- Runs tests in background
- Continues until all tasks verified complete

### 📊 Multi-Agent Research

```bash
/ultrawork research and document all API endpoints in the codebase
```

**What happens:**
- Spawns multiple agents in parallel (Explore for search, Librarian for docs)
- Aggregates findings
- Generates comprehensive documentation
- ~3x faster than sequential execution

### 📋 Strategic Planning

```bash
/plan build a real-time chat application with WebSocket support
```

**What happens:**
- Starts an AI-DLC workflow with full Inception phase
- Prometheus interviews you about requirements
- Generates requirements, user stories, and application design
- Creates a construction plan with units of work
- Each unit goes through design, code generation, and testing
- All artifacts saved to `aidlc-docs/` with full audit trail

### 🧠 Learning Your Workflow

**Automatic - no command needed**

You: "No, use TypeScript interfaces instead of types"
→ Olympus records this preference

You: "Use functional components, not class components"
→ Olympus learns your React style

**Next session:** Claude automatically applies these preferences without being told.

---

## Architecture

Olympus operates as a three-tier orchestration system with a continuous learning loop:

```mermaid
graph TD
    A[User Request] --> B[Orchestrator]
    B --> C{Task Analysis}
    C -->|Simple| D[Haiku Agent]
    C -->|Standard| E[Sonnet Agent]
    C -->|Complex| F[Opus Agent]
    D --> G[Learning System]
    E --> G
    F --> G
    G --> H[Feedback Storage]
    H -.->|Next Session| B
    B --> I[Todo Manager]
    I --> J[Background Executor]
    J --> K[Result]
```

### How It Works

**Current Session Flow:**
1. **User Request** → Arrives with learned context already injected at SessionStart
2. **Orchestrator** → Analyzes task complexity and delegates to appropriate agents
3. **Model Router** → Selects Haiku (simple), Sonnet (standard), or Opus (complex)
4. **Agents Execute** → Specialized agents complete their tasks
5. **Learning System** → Passively captures feedback from corrections, preferences, and patterns
6. **Feedback Storage** → Stores learned preferences, agent performance, and discoveries
7. **Result** → User sees the completed work

**Learning & Context Injection (Between Sessions):**

The learning system operates across session boundaries:

- **During Session**: Captures feedback from user corrections ("No, use async/await"), preferences ("Always use TypeScript"), and agent discoveries (gotchas, workarounds)
- **Storage**: Writes to `~/.claude/olympus/learning/` (global) and `.olympus/learning/` (project-specific)
- **Next Session Start**: SessionStart hook automatically injects learned context into the initial prompt
- **Context Types Injected**:
  - User preferences (verbosity, autonomy, explicit rules)
  - Recurring corrections (mistakes to avoid)
  - Project conventions (tech stack, patterns)
  - Agent performance notes (weak areas to watch)
  - Recent discoveries (technical insights about your codebase)

**Key Insight:** Context injection happens at the **beginning** of each session (via SessionStart hook), not in the result. This means every new conversation starts with Claude already aware of your preferences and past learnings.

**Key Components:**
- **Orchestrator** - Delegates tasks to specialized agents based on complexity
- **Model Router** - Selects optimal tier (Haiku/Sonnet/Opus) to balance cost and capability
- **Learning System** - Captures feedback passively and builds preference models
- **Todo Manager** - Tracks multi-step task progress with real-time status updates
- **Background Executor** - Runs long-running operations (builds, tests, installs) async with notifications
- **Feedback Storage** - Persists learned preferences, patterns, and discoveries across sessions

---

## Available Agents

### Task Execution

| Agent                 | Model  | Best For                                                       |
| --------------------- | ------ | -------------------------------------------------------------- |
| **Oracle**            | Opus   | Complex debugging, architecture decisions, root cause analysis |
| **Librarian**         | Sonnet | Finding documentation, understanding code organization         |
| **Explore**           | Haiku  | Quick file searches, pattern matching, reconnaissance          |
| **Frontend Engineer** | Sonnet | UI components, styling, accessibility                          |
| **Document Writer**   | Haiku  | README files, API docs, code comments                          |
| **Multimodal Looker** | Sonnet | Analyzing screenshots, diagrams, mockups                       |
| **QA Tester**         | Sonnet | Interactive CLI/service testing with tmux                      |
| **Olympian**          | Sonnet | Focused task execution, direct implementation                  |

### Planning & Review

| Agent          | Model | Best For                                                          |
| -------------- | ----- | ----------------------------------------------------------------- |
| **Prometheus** | Opus  | Strategic planning, work plans, requirement gathering             |
| **Momus**      | Opus  | Critical plan review, feasibility assessment, risk identification |
| **Metis**      | Opus  | Pre-planning analysis, hidden requirement detection               |

### Tiered Variants (Smart Model Routing)

| Domain        | LOW (Haiku)             | MEDIUM (Sonnet)     | HIGH (Opus)              |
| ------------- | ----------------------- | ------------------- | ------------------------ |
| **Analysis**  | `oracle-low`            | `oracle-medium`     | `oracle`                 |
| **Execution** | `olympian-low`          | `olympian`          | `olympian-high`          |
| **Search**    | `explore`               | `explore-medium`    | -                        |
| **Research**  | `librarian-low`         | `librarian`         | -                        |
| **Frontend**  | `frontend-engineer-low` | `frontend-engineer` | `frontend-engineer-high` |

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

1. **Start AI-DLC workflow**: `/plan build a new feature`
2. **Inception phase**: Prometheus interviews you about requirements, generates user stories, and plans the architecture
3. **Workflow planning**: Determines which stages to execute based on project needs
4. **Construction phase**: Per-unit functional design, NFR assessment, and code generation
5. **Resume if interrupted**: `/continue` picks up from the last checkpoint
6. **Review at any gate**: `/review` to evaluate plans before proceeding

Plans and artifacts are saved to `aidlc-docs/` in your project directory.

---

## AI-DLC Workflow

Olympus includes a structured development workflow inspired by [AWS AI-DLC](https://github.com/awslabs/aidlc-workflows) (AI-Driven Development Life Cycle). It guides you through three phases -- **Inception** (what and why), **Construction** (how), and **Operations** (deploy, placeholder) -- with human approval gates at every stage. The workflow adapts to your project: stages are conditionally executed based on complexity, scope, and whether you are working on a greenfield or brownfield codebase.

### Phases and Stages

**Inception** -- determine what to build and why:
- Workspace Detection (always) -- scans for existing code, resumes prior workflows
- Reverse Engineering (brownfield only) -- analyzes existing codebase
- Requirements Analysis (always) -- gathers functional and non-functional requirements
- User Stories (conditional) -- generates personas and acceptance criteria
- Workflow Planning (always) -- determines which construction stages to execute
- Application Design (conditional) -- component and service design
- Units Generation (conditional) -- decomposes work into implementable units

**Construction** -- determine how to build it:
- Per-unit loop (for each unit of work):
  - Functional Design, NFR Requirements, NFR Design, Infrastructure Design (all conditional)
  - Code Generation (always)
- Build and Test (always) -- after all units complete

**Operations** -- placeholder for future deployment and monitoring workflows.

### How to Use

```bash
# Start a new AI-DLC workflow
/plan build a user authentication system

# Resume an interrupted workflow
/continue

# Review at any gate
/review
```

State is tracked in `aidlc-docs/aidlc-state.md` and `aidlc-docs/checkpoint.json`. Use `/continue` to resume from exactly where you left off, even across sessions.

**Skill stacking**: Combine `/plan` with `/ascent` for persistent execution that never stops, or with `/ultrawork` for maximum parallelism across units.

---

## Self-Learning System

Olympus continuously learns from your interactions to provide increasingly personalized assistance.

### How It Works

**Phase 1: Passive Feedback Capture**
- Detects corrections: "No, that's wrong"
- Identifies rejections: "Stop", "Cancel"
- Recognizes clarifications: "I meant X"
- Captures enhancements: "Also add Y"
- Records praise: "Perfect", "Thanks"
- Extracts explicit preferences: "Always use X"

**Phase 2: Pattern Extraction**
- Clusters similar feedback using Jaccard similarity
- Identifies recurring corrections (minimum 3 occurrences)
- Categorizes patterns: style, behavior, tooling, communication

**Phase 3: Preference Learning**
- Infers verbosity level (concise vs. detailed)
- Determines autonomy preference (ask first vs. just do it)
- Tracks agent-specific performance
- Implements 30-day decay for outdated patterns

**Phase 4: Context Injection**
- Automatically applies learned preferences at session start
- Injects relevant discoveries about your codebase
- Limits injection to ~500 tokens to avoid context bloat

**Phase 5: Agent Discovery**
- Agents record technical insights about your project
- Discoveries include: gotchas, workarounds, patterns, dependencies
- Validated and deduplicated before storage
- Retrieved contextually in future sessions

### Storage Locations

**Global Learning:**
```
~/.claude/olympus/learning/
├── feedback-log.jsonl          # All feedback entries (auto-rotates at 10k lines)
├── user-preferences.json        # Learned preferences
├── agent-performance.json       # Per-agent metrics
└── discoveries.jsonl            # Global discoveries (auto-rotates at 10k lines)
```

**Project-Specific Learning:**
```
.olympus/learning/
├── session-state.json           # Current session state
├── patterns.json                # Project patterns
└── discoveries.jsonl            # Project discoveries (auto-rotates at 10k lines)
```

**Data Lifecycle:**
- JSONL files automatically rotate when they exceed 10,000 lines
- Archived files are saved with timestamps (e.g., `feedback-log.2026-01-28.old.jsonl`)
- Manual cleanup available via CLI (see Managing Learning Data below)

### Managing Learning Data

View learning statistics and manage stored data using the CLI:

```bash
# View learning statistics
olympus-ai learn --stats

# Preview cleanup (dry run)
olympus-ai learn --cleanup --dry-run

# Clean up entries older than 180 days (default)
olympus-ai learn --cleanup

# Clean up with custom age threshold
olympus-ai learn --cleanup --age 90

# Remove archived files
olympus-ai learn --cleanup --remove-archived

# View current learnings
olympus-ai learn --show

# Analyze feedback and update patterns
olympus-ai learn --analyze

# Forget all learnings
olympus-ai learn --forget
```

**Example output:**
```
Learning System Statistics
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Feedback Entries:    1247 (1.2 MB)
Discoveries:         123
Total Storage:       1.5 MB

Top Verified Discoveries:
  1. Prisma migrations must run before seeding (8×)
  2. This codebase uses kebab-case for files (6×)
  3. Environment variable DATABASE_URL required (5×)
```

### Example

**Session 1:** You tell Claude "No, use async/await instead of .then()"
→ Olympus records this as a correction

**Session 2:** Similar situation arises
→ You provide the same feedback

**Session 3:** Olympus detects the pattern (3+ occurrences)
→ Learns your preference: "Use async/await over Promise chains"

**Session 4+:** This preference is automatically injected
→ Claude proactively uses async/await without being told

**The learning happens silently in the background. No configuration required.**

---

## What Gets Installed

```
~/.claude/
├── agents/                  # 19 agent definitions (tiered variants)
│   ├── oracle.md
│   ├── prometheus.md
│   ├── olympian.md
│   └── ...
├── skills/                  # 19 slash commands
│   ├── olympus/SKILL.md
│   ├── ultrawork/SKILL.md
│   ├── plan/SKILL.md
│   ├── continue/SKILL.md
│   └── ...
├── hooks/                   # Event handlers
│   ├── keyword-detector.mjs
│   ├── persistent-mode.mjs
│   └── ...
├── olympus/
│   ├── rules/              # AI-DLC workflow rules
│   │   ├── common/
│   │   ├── inception/
│   │   └── construction/
│   └── learning/           # Global learning data
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

Olympus provides a safe uninstall that **only removes Olympus-owned files** — your own Claude Code agents, skills, hooks, and CLAUDE.md content are preserved.

### Quick Uninstall (One Command)

For global installations, a single npm command handles everything — the `preuninstall` hook automatically cleans up Olympus config files before removing the package:

```bash
npm uninstall -g olympus-ai
```

For local project installations:

```bash
npm uninstall olympus-ai
```

> **Note:** Local `npm uninstall` removes the package dependency but does not clean up `.claude/` config files. Run `npx olympus-ai uninstall --local` first if you need to remove those, or see the manual steps below.

### Manual Uninstall

If you prefer more control, or need to remove config files without uninstalling the package:

```bash
# Remove Olympus config files from ~/.claude/ (global)
olympus-ai uninstall

# Remove Olympus config files from ./.claude/ (current project)
olympus-ai uninstall --local

# Preview what would be removed without deleting anything
olympus-ai uninstall --dry-run
```

Then remove the npm package:

```bash
# Global
npm uninstall -g olympus-ai

# Local
npm uninstall olympus-ai
```

### What Gets Removed

The uninstall command removes only files that Olympus installed:
- Olympus agent definitions from `agents/` (e.g., `oracle.md`, `prometheus.md`)
- Olympus skill directories from `skills/` (e.g., `ultrawork/`, `plan/`)
- The `olympus/` directory (rules, learning data)
- Olympus hook scripts from `hooks/`
- Olympus hook entries from `settings.json`
- The Olympus section from `CLAUDE.md` (user content is preserved)
- The `.olympus-version.json` metadata file
- The Olympus plugin registration

Any custom agents, skills, hooks, or CLAUDE.md content you added yourself will **not** be touched.

---

## Requirements

- [Claude Code](https://docs.anthropic.com/claude-code) installed and configured
- Node.js 20+ (for npm installation)

---

## Contributing

We welcome contributions! Here's how to get started:

### Development Setup

```bash
# Clone the repository
git clone https://github.com/mikev10/olympus.git
cd olympus

# Install dependencies
npm install

# Build the project
npm run build

# Test locally
node dist/cli/index.js install --local
```

### Running Tests

```bash
npm test              # Run tests in watch mode
npm run test:run      # Run tests once
npm run test:coverage # Generate coverage report
```

### Project Structure

```
olympus/
├── src/
│   ├── cli/          # CLI entry point (olympus-ai command)
│   ├── installer/    # Installation logic
│   ├── hooks/        # Event handlers (session, tools, learning)
│   ├── learning/     # Self-learning system
│   ├── features/     # Core features
│   │   └── workflow-engine/  # AI-DLC workflow engine
│   ├── config/       # Configuration management
│   ├── shared/       # Shared types and utilities
│   └── __tests__/    # Test suite (3100+ tests)
├── resources/
│   ├── agents/       # Agent markdown definitions
│   ├── skills/       # Slash command definitions
│   └── rules/        # AI-DLC workflow rules
├── dist/             # Build output
├── docs/             # Documentation
└── scripts/          # Build scripts
```

---

## Documentation

- 📖 [Getting Started Guide](docs/guide/overview.md)
- 💻 [CLI Reference](docs/guide/cli-reference.md)
- 🔄 [Workflow Guide](docs/guide/workflow-guide.md) — AI-DLC workflow for structured development
- 🏗️ [Brownfield Projects](docs/guide/brownfield-projects.md) — Working with existing codebases
- 🧠 [Learning System](docs/learning-system.md) — How Olympus learns from your interactions
- 📋 [Changelog](CHANGELOG.md)

---

## License

MIT - see [LICENSE](LICENSE)

---

## Credits

---

<div align="center">

**Summon the gods of code.**

</div>

