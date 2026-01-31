# Olympus Overview

A multi-agent orchestration plugin that transforms Claude Code from a single assistant into a coordinated team of specialized experts.

---

## What is Olympus?

Olympus is a **plugin system** for [Claude Code](https://docs.anthropic.com/claude-code) - Anthropic's official CLI tool. It enhances Claude with:

- **20+ Specialized Agents** that Claude can spawn for specific tasks
- **13+ Slash Commands** for activating skills and workflows
- **Learning System** that improves from your corrections over time
- **Smart Hooks** that add persistence, keyword detection, and context injection

**Key Insight:** Claude Code provides one agent. Olympus multiplies that agent into a team.

---

## Quick Start

Install Olympus in 3 commands:

```bash
npm install -g olympus-ai
olympus-ai install
claude
```

Try your first orchestrated task:

```bash
> /olympus implement user authentication
```

Claude will:
1. Create a todo list
2. Delegate subtasks to specialized agents (Oracle for architecture, Olympian for implementation)
3. Track progress in real-time
4. Learn from any corrections you make
5. Continue until everything is verified complete

---

## The Three Pillars

### 1. Agents (Specialized Experts)

Agents are sub-agents that Claude spawns via the `Task` tool. Each has a specific purpose and model tier:

**Architecture & Planning**
- **Oracle** (Opus) - Complex debugging, root cause analysis, architectural decisions
- **Prometheus** (Opus) - Strategic planning with interview workflow
- **Momus** (Opus) - Critical plan review and risk assessment
- **Metis** (Opus) - Pre-planning consultant, hidden requirement detection

**Execution**
- **Olympian** (Sonnet) - Focused task execution, cannot delegate
- **Olympian-High** (Opus) - Complex multi-file changes
- **Olympian-Low** (Haiku) - Trivial single-file changes

**Research & Search**
- **Librarian** (Sonnet) - Documentation research, understanding code
- **Explore** (Haiku) - Fast codebase search and pattern matching
- **Explore-Medium** (Sonnet) - Thorough search with reasoning

**Specialized**
- **Frontend Engineer** (Sonnet) - UI components, styling, design
- **Document Writer** (Haiku) - READMEs, API docs, technical writing
- **Multimodal Looker** (Sonnet) - Screenshot and diagram analysis
- **QA Tester** (Sonnet) - Interactive CLI testing with tmux

**Model Routing:** Olympus automatically selects agent tiers (Low/Medium/High) based on complexity to optimize cost.

### 2. Skills & Commands (Behavior Modifiers)

Skills are activated via slash commands and modify how Claude behaves:

**Execution Skills**
- `/olympus <task>` - Multi-agent orchestration mode (default behavior)
- `/plan <task>` - Strategic planning with Prometheus interview

**Enhancement Skills**
- `/ultrawork <task>` - Maximum intensity, parallel everything, never wait
- `/git-master` - Atomic commits with style detection (auto-activates for multi-file changes)
- `/frontend-ui-ux` - Design-first approach (auto-activates for UI work)

**Guarantee Skills**
- `/ascent <task>` - Cannot stop until verified complete (The Ascent Never Ends)

**Utility Commands**
- `/deepsearch <query>` - Thorough multi-strategy codebase search
- `/analyze <target>` - Deep analysis and investigation
- `/review [plan]` - Review a plan with Momus
- `/complete-plan` - Verify plan implementation
- `/doctor` - Diagnose installation issues
- `/update` - Check for updates

**Skills Stack:** You can combine skills for powerful workflows:
```bash
/ultrawork refactor API    # Activates: olympus + ultrawork + git-master
```

### 3. Learning System (Gets Better Over Time)

Olympus learns from your corrections automatically:

**What It Learns:**
- Coding preferences (async/await vs .then, interfaces vs types)
- Communication style (concise vs detailed, ask first vs just do it)
- Project conventions (file naming, imports, patterns)
- Mistake patterns (things you've corrected 3+ times)
- Agent performance (which agents succeed/fail for specific tasks)

**How It Works:**
1. You correct Claude: "No, use TypeScript interfaces"
2. Feedback logged to `~/.claude/olympus/learning/feedback-log.jsonl`
3. After 3+ similar corrections, pattern detected
4. Preference stored in `user-preferences.json`
5. Next session: Claude automatically uses interfaces

**Storage:**
```
~/.claude/olympus/learning/     # Global learnings
├── feedback-log.jsonl          # All corrections
├── user-preferences.json       # Extracted preferences
├── agent-performance.json      # Success/failure rates
└── discoveries.jsonl           # Agent discoveries

.olympus/learning/              # Project-specific
├── session-state.json
├── patterns.json
└── discoveries.jsonl
```

**Manage learnings:**
```bash
olympus-ai learn --show      # View what Olympus learned
olympus-ai learn --stats     # Statistics
olympus-ai learn --cleanup   # Clean old data
olympus-ai learn --forget    # Fresh start
```

---

## How Olympus Works

### The Delegation Pattern

When you give Claude a complex task with Olympus active:

```bash
> /olympus refactor authentication module
```

**What happens:**

1. **Analysis** - Claude analyzes task complexity
2. **Todo Creation** - Breaks down into subtasks: [1. Analyze architecture, 2-4. Implement changes, 5. Verify]
3. **Delegation** - Spawns Oracle for architecture analysis
4. **Parallel Execution** - Spawns multiple Olympian agents for implementation (if ultrawork active)
5. **Verification** - Runs lsp_diagnostics, tests, checks
6. **Learning** - Records discoveries and patterns
7. **Completion** - Marks all todos complete

### The Continuation Guarantee

With `/ascent`, Claude **cannot stop** until verified complete:

```bash
> /ascent fix all TypeScript errors
```

**Enforcement:**
- Creates comprehensive todo list
- Marks each complete only after verification
- System reminder if attempting to stop early
- Only exits via `<promise>DONE</promise>` or `/cancel-ascent`

This is **The Ascent** - like climbing Mount Olympus, the journey continues until the summit is reached.

### Skills vs. Vanilla Claude

| Behavior | Vanilla Claude | With `/olympus` | With `/ultrawork` |
|----------|----------------|-----------------|-------------------|
| **Multi-step** | Does sequentially | Creates todos, tracks progress | Parallel execution |
| **Complex work** | Does it alone | Delegates to specialists | Delegates + parallelize |
| **Learning** | Forgets mistakes | Learns from corrections | Learns + adapts |
| **Stopping** | Stops when asked | Continues until complete | Never stops until done |
| **Verification** | Optional | Always verifies | Parallel verification |

---

## Common Workflows

### Feature Implementation

```bash
# Standard approach
> /olympus add user authentication with JWT

# Maximum speed
> /ultrawork add user authentication with JWT

# Must-complete (won't stop)
> /ascent add user authentication with JWT
```

### Strategic Planning

```bash
# Start planning session
> /plan build real-time chat application

# Prometheus interviews you about requirements
[Answer questions]

# Execute the plan
> /olympus
```

### Debugging & Analysis

```bash
# Deep analysis
> /analyze why is the auth flow failing?

# Search codebase
> /deepsearch all API endpoints that handle user data

# Architecture review
> /olympus [spawns Oracle for root cause analysis]
```

### UI/Frontend Work

```bash
# Olympus auto-detects UI work and activates frontend-engineer agent
> /olympus build dashboard with charts

# Explicit with design focus
> /olympus design user profile page with animations
```

---

## Key Concepts

### Agents vs. Skills

**Agents** = Who does the work (Oracle, Olympian, Librarian, etc.)
**Skills** = How you work (/olympus, /ultrawork, /ascent, etc.)

Skills modify Claude's behavior and determine which agents get spawned.

### Model Tiers

Agents come in three tiers to optimize cost:

- **LOW (Haiku)** - Simple lookups, quick searches
- **MEDIUM (Sonnet)** - Standard work, balanced performance
- **HIGH (Opus)** - Complex reasoning, architectural decisions

Olympus routes automatically based on task complexity.

### Discoveries

Agents can record discoveries during work:

```bash
olympus discover "gotcha | Migrations before seeding | Database seed fails if..."
olympus discover "pattern | Use kebab-case for files | This codebase consistently..."
```

Future sessions benefit from these discoveries automatically.

### Magic Keywords

Include these words in prompts for auto-activation:

- `ultrawork`, `ulw`, `uw` → Activates /ultrawork mode
- `search`, `find`, `locate` → Enhanced search
- `analyze`, `investigate` → Deep analysis mode

```bash
> ultrawork refactor entire API layer
# Same as: /ultrawork refactor entire API layer
```

---

## Configuration

### Project-Specific Instructions

Create `.claude/CLAUDE.md` in your project:

```markdown
# Project Context

TypeScript monorepo using:
- React 18 frontend
- Node.js + Express backend
- PostgreSQL + Prisma ORM

## Conventions
- Functional components with hooks
- API routes in /src/api
- Colocated tests
- kebab-case filenames
```

### Set as Default

Make Olympus your default Claude behavior:

```bash
> /olympus-default
```

Every session now starts with Olympus active.

### Advanced Config

Edit `~/.claude/olympus.jsonc` to customize agent models, background task limits, and feature toggles. Most users don't need to touch this.

See [Installation Guide](./installation.md#customize-configuration-advanced) for full config options.

---

## Olympus vs. Plain Claude Code

| Feature | Plain Claude Code | Olympus |
|---------|-------------------|---------|
| **Agents** | 1 (you) | 20+ specialized experts |
| **Commands** | Built-in only | 13+ skills & workflows |
| **Learning** | Per-session only | Persistent, cross-session |
| **Delegation** | Manual (you spawn agents) | Automatic + intelligent |
| **Persistence** | Stops when asked | Continues until verified |
| **Parallelization** | Sequential | Concurrent (with /ultrawork) |
| **Model Routing** | Manual | Automatic cost optimization |
| **Todo Management** | Manual | Automatic tracking |

---

## Getting Started

### Installation

```bash
npm install -g olympus-ai
olympus-ai install
claude
```

Full instructions: [Installation Guide](./installation.md)

### Your First Task

```bash
> /olympus hello world
```

Watch Olympus:
1. Create todos
2. Execute the task
3. Track progress
4. Verify completion

### Next Steps

1. Try `/ultrawork` for a more intense workflow
2. Use `/plan` for a complex feature
3. Let Olympus learn from your corrections
4. Explore the [full orchestration guide](./understanding-orchestration-system.md)

---

## Philosophy

**Default Claude Code:** One brilliant generalist

**Olympus:** A pantheon of specialized gods working in harmony

**The Result:**
- Faster (parallel execution)
- Smarter (learning system)
- More reliable (verification at every step)
- Never incomplete (continuation enforcement)

---

## Further Reading

- **[Installation Guide](./installation.md)** - Step-by-step setup
- **[Understanding Orchestration](./understanding-orchestration-system.md)** - Deep dive into how it works
- **[Agent Reference](../AGENTS.md)** - Complete agent documentation
- **[Architecture](../ARCHITECTURE.md)** - Technical details

---

**Olympus doesn't replace Claude Code. It multiplies it.**

Summon the gods of code.
