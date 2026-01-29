# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.1] - 2026-01-28

### Added

**Learning System Sustainability Improvements (P0)**

- **JSONL Auto-Rotation** - Prevents unbounded file growth
  - Automatically rotates `feedback-log.jsonl` and `discoveries.jsonl` when they exceed 10,000 lines
  - Archived files saved with timestamps (e.g., `feedback-log.2026-01-28T22-00-00.old.jsonl`)
  - Graceful error handling - rotation failures don't block new entries

- **Learning Data Management CLI** - New `olympus-ai learn` commands
  - `--stats` - View learning statistics (feedback count, discoveries, storage usage, top findings)
  - `--cleanup` - Remove old learning data with configurable age threshold
  - `--dry-run` - Preview cleanup changes without executing
  - `--age <days>` - Custom age threshold for cleanup (default: 180 days)
  - `--remove-archived` - Delete archived `.old.jsonl` files
  - Full data lifecycle control with user visibility

- **Performance Optimization**
  - Limited pattern extraction to recent 1000 entries (configurable via `maxEntries` parameter)
  - Prevents O(n²) performance degradation with large datasets
  - ~10x faster pattern analysis at scale

### Changed
- **Documentation Updates**
  - Updated README with "Managing Learning Data" section
  - Added CLI command examples and output samples
  - Updated storage locations to show auto-rotation feature
  - Created `docs/LEARNING_P0_IMPLEMENTATION.md` with full implementation details

### Technical Details
- New files: `src/learning/cleanup.ts`, `src/learning/stats.ts`
- Modified files: `src/learning/storage.ts`, `src/learning/discovery.ts`, `src/learning/pattern-extractor.ts`, `src/cli/index.ts`
- Test coverage: `src/__tests__/learning/storage.test.ts`, `src/__tests__/learning/cleanup.test.ts`
- All tests passing, no breaking changes, backwards compatible

**Impact:**
- Capped JSONL file sizes at 10k lines max before rotation
- User control over data lifecycle (view stats, cleanup old data)
- 10x faster pattern extraction when feedback exceeds 1000 entries
- Learning System now sustainable for 3+ years of moderate use

---

## [3.0.0] - 2026-01-27

### 🎉 Official Release: Olympus v3.0.0

**"Summon the gods of code"**

Olympus is a powerful multi-agent orchestration system for Claude Code, providing intelligent task delegation, smart model routing, and automated workflow management.

#### Core Features

- **20+ Specialized Agents** - Oracle (architecture), Prometheus (planning), Olympian (execution), Librarian (research), Frontend Engineer (UI/UX), and more
- **Smart Model Routing** - Automatic tier selection (Haiku/Sonnet/Opus) based on task complexity to optimize cost and performance
- **Todo List Management** - Automatic task tracking with real-time progress updates
- **Background Execution** - Long-running operations (builds, tests, installations) run async with notifications
- **Continuation Enforcement** - Never stops until all tasks are complete
- **Slash Commands** - `/ultrawork`, `/plan`, `/analyze`, `/deepsearch`, `/ascent`, and more
- **Planning Workflow** - Prometheus for strategic planning, Momus for critical review, `/complete-plan` for verification

#### Slash Commands

- `/ultrawork` - Maximum performance mode with aggressive parallelization
- `/plan` - Start planning session with Prometheus
- `/review` - Critical plan evaluation with Momus
- `/analyze` - Deep analysis and investigation
- `/deepsearch` - Thorough codebase search
- `/ascent` - Self-referential loop until task completion
- `/complete-plan` - Verify and complete implemented plans

#### Installation

```bash
npm install -g olympus-ai
olympus-ai install
```

Or use the install script:
```bash
curl -fsSL https://raw.githubusercontent.com/mikev10/olympus/main/scripts/install.sh | bash
```

#### Getting Started

After installation, Olympus operates automatically as your default mode in Claude Code:
- Creates todos before non-trivial tasks
- Delegates complex work to specialized agents
- Runs independent tasks in parallel
- Continues until all tasks are complete

For complex projects, use `/plan` to create a strategic plan before implementation.

#### Self-Learning System

**New in v3.0.0:** Olympus now learns from your interactions and evolves over time.

**Features:**
- **Passive Feedback Capture** - Automatically detects corrections, preferences, and patterns from your interactions
- **Pattern Extraction** - Identifies recurring feedback using Jaccard similarity (minimum 3 occurrences)
- **Preference Learning** - Infers verbosity level (concise vs. detailed), autonomy preference (ask first vs. just do it), and style preferences
- **Agent Performance Tracking** - Monitors success/failure rates per agent with 30-day decay for outdated patterns
- **Discovery Storage** - Agents record technical insights about your codebase (gotchas, workarounds, patterns, dependencies)
- **Context Injection** - Learned preferences automatically applied in new sessions (~500 token limit to avoid context bloat)

**Storage Locations:**
- **Global:** `~/.claude/olympus/learning/`
- **Project:** `.olympus/learning/`

**Files:**
- `feedback-log.jsonl` - All feedback entries (append-only)
- `user-preferences.json` - Learned user preferences
- `agent-performance.json` - Per-agent performance metrics
- `discoveries.jsonl` - Technical insights (global & project-specific)
- `session-state.json` - Current session state
- `patterns.json` - Project-specific patterns

**How It Works:**
1. Session 1: You correct Claude → Olympus records feedback
2. Session 2-3: Pattern emerges (3+ similar corrections)
3. Session 4+: Preference auto-injected → Claude applies it proactively

The learning system operates silently in the background with zero configuration required.

---

## [2.7.4] - 2026-01-27

### Changed
- **Branding update** - Updated tagline from "Only the worthy ascend" to "Summon the gods of code" across all documentation, commands, and plugin metadata
  - Updated `/complete-plan` command tagline and completion oath
  - Updated plugin descriptions in marketplace.json and plugin.json
  - Updated README and documentation

### Fixed
- **TypeScript build on Windows** - Changed build scripts to use direct `node` invocation instead of `npx` to work around npm shim issues on Windows/Git Bash
  - Build script: `"build": "node node_modules/typescript/bin/tsc"`
  - This ensures reliable compilation across all Windows shell environments (PowerShell, CMD, Git Bash)
  - No impact on end users - only affects development builds

---

## [2.3.1] - 2026-01-15

### Added
- **`/complete-plan` command** - Verification-first plan completion workflow
  - 5-phase verification: Plan Analysis → Systematic Verification → Judgment → Documentation → Archive
  - Status hierarchy: COMPLETED (100% verified) → PARTIAL → INCOMPLETE → ABANDONED
  - Oracle review required for COMPLETED status
  - Creates completion records at `.olympus/completions/`
  - Motto: "Summon the gods of code" - all criteria must be verified with evidence

### Changed
- **Planning workflow** updated to include step 6: `/complete-plan` for closing the loop
- **Prometheus agent** updated with principle 6: "Close the Loop"

---

## [2.0.1] - 2026-01-13

### Added
- **Vitest test framework** with comprehensive test suite (231 tests)
  - Model routing tests (100 tests)
  - Hook system tests (78 tests)
  - Skill activation tests (15 tests)
  - Installer validation tests (28 tests)
- **Windows native support improvements**
  - Cross-platform command detection (which → where on Windows)
  - Platform-aware auto-update with graceful Windows handling
  - Fixed Unix-only shell redirects

### Changed
- Synced shell script installer with TypeScript installer
- Removed deprecated orchestrator command from shell script
- Removed separate skills directory (now via commands only)

### Fixed
- Cross-platform `which` command replaced with platform-aware detection
- Auto-update now handles Windows gracefully with helpful error message
- Shell script command count matches TypeScript installer (11 commands)
- **Agent frontmatter** - Added missing `name` and `description` fields to all 11 agents
  - Per Claude Code sub-agent specification requirements

---

## [2.0.0-beta.2] - 2026-01-13

### 🧪 New: QA-Tester Agent for Interactive Testing

**Added tmux-based interactive testing capabilities for CLI/service verification.**

### Added
- **QA-Tester Agent** (`src/agents/qa-tester.ts`)
  - Interactive CLI testing using tmux sessions
  - Prerequisite checking (tmux availability, server connections)
  - Structured test execution workflow
  - Oracle → QA-Tester diagnostic loop pattern

- **Smart Gating for qa-tester** in ultrawork/skills
  - Prefer standard test suites over qa-tester when available
  - Use qa-tester only when interactive testing is truly needed
  - Token-efficient verification decisions

- **Adaptive Routing for qa-tester**
  - Simple verification → Haiku
  - Interactive testing → Sonnet
  - Complex integration → Opus

### Changed
- Updated ultrawork skill with verification protocol and qa-tester gating
- Updated ascent and orchestrator with qa-tester integration
- Updated olympus command with Agent Combinations section

### Refactored
- **Merged olympus+orchestrator+ultrawork into default mode** - 80% behavior overlap consolidated
  - Default mode is now an intelligent orchestrator
  - `/orchestrator` command deprecated (use default mode or `/ultrawork`)
  - Skill composition replaces agent swapping
- **Removed deprecated orchestrator command** - Deleted `commands/orchestrator.md` and `orchestratorSkill` (1352 lines)
- **Established Olympus as independent multi-agent orchestration system** - Complete architectural divergence from origins

### Fixed
- **Migrated to ESLint v9 flat config** - Created `eslint.config.js` for modern ESLint
- **Resolved all 50 lint warnings** - Removed unused imports, fixed prefer-const, updated re-exports
- Synced installer COMMAND_DEFINITIONS with updated skills
- Handle malformed settings.json gracefully in install.sh

---

## [2.0.0-beta.1] - 2026-01-13

### 🚀 Revolutionary: Intelligent Model Routing

**This is a major release introducing adaptive model routing for all agents.**

The orchestrator (Opus) now analyzes task complexity BEFORE delegation and routes to the appropriate model tier (Haiku/Sonnet/Opus). This dramatically improves efficiency - simple tasks use faster, cheaper models while complex tasks get the full power of Opus.

### Added
- **Intelligent Model Routing System** (`src/features/model-routing/`)
  - `types.ts`: Core types for routing (ComplexityTier, RoutingDecision, etc.)
  - `signals.ts`: Complexity signal extraction (lexical, structural, context)
  - `scorer.ts`: Weighted scoring system for complexity calculation
  - `rules.ts`: Priority-based routing rules engine
  - `router.ts`: Main routing logic with `getModelForTask()` API
  - `prompts/`: Tier-specific prompt adaptations (opus.ts, sonnet.ts, haiku.ts)

- **Adaptive Routing for ALL Agents**
  - Only orchestrators are fixed to Opus (they analyze and delegate)
  - All other agents adapt based on task complexity:
    - `oracle`: lookup → Haiku, tracing → Sonnet, debugging → Opus
    - `prometheus`: breakdown → Haiku, planning → Sonnet, strategic → Opus
    - `momus`: checklist → Haiku, gap analysis → Sonnet, adversarial → Opus
    - `metis`: impact → Haiku, deps → Sonnet, risk analysis → Opus
    - `explore`: simple search → Haiku, complex → Sonnet
    - `document-writer`: simple docs → Haiku, complex → Sonnet
    - `olympian`: simple fix → Haiku, module work → Sonnet, risky → Opus

- **Complexity Signal Detection**
  - Lexical: word count, keywords (architecture, debugging, risk, simple)
  - Structural: subtask count, cross-file deps, impact scope, reversibility
  - Context: previous failures, conversation depth, plan complexity

- **Tiered Prompt Adaptations**
  - Haiku: Concise, direct prompts for speed
  - Sonnet: Balanced prompts for efficiency
  - Opus: Deep reasoning prompts with thinking mode

### Changed
- **Orchestrator Prompts** updated with intelligent routing guidance
- **Configuration** (`src/config/loader.ts`) now includes routing options
- **Types** (`src/shared/types.ts`) extended with routing configuration

### Breaking Changes
- Routing is now proactive (orchestrator decides upfront) instead of reactive
- Deprecated `routeWithEscalation()` - use `getModelForTask()` instead

### Migration Guide
No action needed - the system automatically routes based on complexity. To override:
```typescript
Task(subagent_type="oracle", model="opus", prompt="Force Opus for this task")
```

---

## [1.11.0] - 2026-01-13

### Added
- **Enhanced Hook Enforcement System** - Stronger Olympus behavior enforcement beyond CLAUDE.md
  - `pre-tool-enforcer.sh`: PreToolUse hook that injects contextual Olympus reminders before every tool execution
  - `post-tool-verifier.sh`: PostToolUse hook for verification after tools, with failure detection
  - Enhanced `persistent-mode.sh`: Stop hook now includes build/test/git/background task verification
  - `claude-olympus.sh`: CLI wrapper that uses `--append-system-prompt` for direct system prompt injection
  - `olympus-aliases.sh`: Shell aliases (`claude-s`, `claudew`) for easy activation

### Changed
- **Stop Hook** now enforces additional verification requirements:
  - Build verification (if build scripts exist)
  - Test verification (if tests exist)
  - Git status check (warns on uncommitted changes)
  - Background task completion check
  - All previous checks (The Ascent, Ultrawork, Todo completion)

- **Hook Configuration** - Added PreToolUse and PostToolUse to `hooks.json`

### Technical Details
- PreToolUse hook provides tool-specific reminders (Bash, Task, Edit, Write, Read, Grep/Glob)
- PostToolUse hook tracks session statistics in `~/.claude/.session-stats.json`
- Stop hook returns `continue: false` until ALL verification requirements are met
- CLI wrapper appends core Olympus rules directly to Claude's system prompt

### Enforcement Hierarchy
1. **Stop Hook** with `continue: false` - Blocks ALL stopping until verified
2. **PreToolUse** - Injects reminders BEFORE every tool
3. **PostToolUse** - Verifies AFTER every tool
4. **CLI Wrapper** - Appends rules to system prompt

## [1.10.0] - 2026-01-11

### Added
- **Persistent Mode System** - Enhanced hook system for auto-continuation
  - `ultrawork-state` module: Manages persistent ultrawork mode state across sessions
  - `persistent-mode` hook: Unified Stop handler for ultrawork, ascent, and todo continuation
  - `session-start` hook: Restores persistent mode states when a new session starts
  - Three-layer priority enforcement: The Ascent > Ultrawork > Todo Continuation

- **Claude Code Native Hooks Integration**
  - SessionStart hook for mode restoration on session resume
  - Enhanced Stop hook with persistent mode detection
  - Cross-platform support (Bash for Unix, Node.js for Windows)

- **Popular Plugin Patterns Module** (`plugin-patterns`)
  - Auto-format support for multiple languages (TypeScript, Python, Go, Rust)
  - Lint validation with language-specific linters
  - Conventional commit message validation
  - TypeScript type checking integration
  - Test runner detection and execution
  - Pre-commit validation workflow

### Changed
- **Bridge Module** - Added persistent-mode and session-start hook handlers
- **Keyword Detector** - Now activates ultrawork state when ultrawork keyword is detected
- **Settings Configuration** - Added SessionStart hook configuration for both Bash and Node.js

### Technical Details
- New hooks: `persistent-mode.sh/.mjs`, `session-start.sh/.mjs`
- State files: `.olympus/ultrawork-state.json`, `~/.claude/ultrawork-state.json`
- Ultrawork mode now persists across stop attempts when todos remain incomplete
- Ascent-loop continues with iteration tracking and reinforcement messages

## [1.9.0] - 2026-01-10

### Changed
- **Updated all builtin skills with latest implementations**
  - Updated `orchestrator` skill (1302 lines) with complete orchestrator-olympus.ts template
  - Updated `olympus` skill (362 lines) with complete olympus.ts template
  - Updated `ultrawork` skill (97 lines) - refined keyword-triggered maximum performance mode
  - Updated `ascent` skill (11 lines) from ascent hook
  - Updated `git-master` skill with 1131-line comprehensive template
  - Updated `frontend-ui-ux` skill with enhanced Work Principles section

### Fixed
- **Installer improvements**
  - Fixed skill path format from `'skill-name.md'` to `'skill-name/skill.md'`
  - Fixed agent path for prometheus from `'prometheus/skill.md'` to `'prometheus.md'`
  - Added directory creation for both commands and skills to prevent ENOENT errors
  - Fixed ultrawork skill to remove JavaScript wrapper code (clean prompt only)

- **Template escaping**
  - Properly escaped backticks, template literals (`${}`), and backslashes in all skill templates
  - Fixed TypeScript compilation errors due to improper template string escaping

- **SDK adaptation**
  - Updated all patterns to Claude Code SDK:
    - Using `Task(subagent_type=...)` for delegation
    - Using `TaskOutput()` for background task results
    - Olympus-specific implementations

### Verified
- All 6 builtin skills install correctly to `~/.claude/skills/`
- Orchestrator skill properly delegates with `Task(subagent_type=...)`
- Ultrawork skill contains clean verification guarantees and zero-tolerance failures
- Build completes without TypeScript errors
- Installation completes successfully

## [1.8.0] - 2026-01-10

### Added
- Intelligent Skill Composition with task-type routing
- Architecture comparison documentation (Multi-agent patterns vs Claude Code)
- Intelligent Skill Activation section to README

### Changed
- Merged feature/auto-skill-routing branch

## [1.7.0] - Previous Release

### Added
- Windows support with Node.js hooks
- ESM import for tmpdir

---

[1.11.0]: https://github.com/mikev10/olympus/compare/v1.10.0...v1.11.0
[1.10.0]: https://github.com/mikev10/olympus/compare/v1.9.0...v1.10.0
[1.9.0]: https://github.com/mikev10/olympus/compare/v1.8.0...v1.9.0
[1.8.0]: https://github.com/mikev10/olympus/compare/v1.7.0...v1.8.0
[1.7.0]: https://github.com/mikev10/olympus/releases/tag/v1.7.0
