# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`/archive` skill** — New slash command to archive completed AI-DLC workflows to `aidlc-docs/completed/` with support for `--all` and individual workflow IDs

## [4.3.0] - 2026-03-11

### Added

- **Metis recommendations** — Metis agent now generates actionable recommendations and summary in analysis framework
- **Workflow archival** — Completed workflows are automatically archived to `aidlc-docs/completed/`

### Changed

- **`.gitignore`** — Updated to include `.vscode` and `metrics-export.json`
- **Markdownlint** — Corrected MD033 configuration to allow specific HTML elements

### Removed

- **`metrics-export.json`** — Removed from repository

## [4.2.0] - 2026-03-11

### Added

- **Project-scoped learning** — Learning data (metrics, discoveries, preferences) is now stored per-project instead of globally, enabling isolated analytics per workspace
- **Project resolver** — Git-based project root detection with filesystem-safe slug derivation (`{basename}-{sha256hash8}`)
- **One-time migration** — Automatic migration of existing global learning data to project-scoped directories on first run
- **Session insights** — Rolling 20-session analytics window with high-token detection and per-agent usage tracking
- **Cold-start blending** — New projects blend project metrics with global baselines using `min(1.0, invocations/5)` weighting
- **CLI project flags** — `--global`, `--all-projects`, and `--confirm` flags for all `learn` subcommands
- **Project directory pruning** — Age-based and count-based cleanup thresholds for stale project learning data
- **85 new tests** across 6 test files for full project-scoped learning coverage

### Changed

- **Agent routing** — `resolveBlendedSuccessRate()` now uses project→global→fallback resolution chain
- **Pattern extraction** — Jaccard similarity threshold lowered to 0.4 for better pattern clustering
- **Learned context hook** — Explicit rules filtered by `project_path`; agent performance merges project + global data
- **Baselines** — Removed `by_project` field from `SessionBaseline`; project scoping handled at storage layer

## [4.1.1] - 2026-03-10

### Added

- **Unit naming convention** — `slugifyUnitName()` now prepends a `u-NNN-` prefix to all unit IDs (e.g., `u-001-foundation`), making construction folder names directly correlate with unit numbers
- **Skill prompt updates** — `/plan` and `/continue` skills and `units-generation` rule updated with mandatory naming convention documentation

### Changed

- **`slugifyUnitName()` signature** — The `index` parameter is now 1-based; empty titles fall back to `u-NNN-untitled`

## [4.1.0] - 2026-03-10

### Added

- **`olympus-ai uninstall` command** — New CLI command to cleanly remove Olympus installations with `--local`, `--dry-run`, and `--verbose` flags
- **`preuninstall` npm lifecycle hook** — Automatically runs cleanup when users run `npm uninstall -g olympus-ai`, leaving no orphaned files in `~/.claude/`
- **Hooks and settings in local installs** — `olympus-ai install --local` now includes hooks and settings files (previously only global installs received them)
- **Workflow engine archival** — Completed workflows are archived to a timestamped subdirectory, keeping the workspace clean for new runs
- **Metis agent enhancements** — Added pre-planning guidance and hidden requirements discovery capabilities

### Changed

- **README Installation section** — Rewrote with clear global vs. local installation instructions and explicit Node.js ≥20 prerequisite
- **README Uninstall section** — Rewrote with safe uninstall workflow showing the recommended `olympus-ai uninstall` → `npm uninstall` sequence
- **Learning storage** — Refactored discovery and preference storage with improved session-state backward compatibility and JSONL rotation
- **Workflow engine phase types** — Extended phase type definitions to support archival and additional workflow states
- **`user-prompt-submit` hook** — Added context injection for active workflow state on prompt submission
- **`continue` and `plan` skills** — Minor refinements to routing and resumption guidance

### Fixed

- **Learning preference detection** — Reduced false positives in feedback signals; session-state fields now initialized consistently in both `createSessionState()` and `loadSessionState()`
- **Discovery integration** — Corrected category handling so new `DiscoveryCategory` values are registered in both the type union and the `readDiscoveries()` categories record

## [4.0.4] - 2026-03-09

### Fixed

- **Workflow engine** — Aligned inception artifact paths to nested subdirectory convention

## [4.0.3] - 2026-03-08

### Fixed

- **Learning system noise reduction** — Removed topic-change detection from success-detector (~91% false positive rate), keeping only explicit praise feedback
- **Storage bloat prevention** — Truncate evidence examples to 150 chars in pattern-extractor; separate rotation limit (500 lines) for session summaries

### Changed

- **Enhanced frontend-engineer agents** — Merged designer agent into frontend-engineer with structured `<Agent_Prompt>` XML format, investigation protocol, success criteria, output format, and failure modes
- **Enhanced frontend-engineer-high agent** — Upgraded from minimal 6-line prompt to full structured agent with architecture-focused guidance, aesthetic principles, and design system support

## [4.0.2] - 2026-03-07

### Fixed

- **CLAUDE.md duplication and bloat** — Global `~/.claude/CLAUDE.md` exceeded 40k char performance threshold
  - Trimmed `core-workflow.md` from 567 → 168 lines (concise stage tables referencing rule files instead of duplicating content)
  - Trimmed `getAidlcRulesContent()` to workflow identity only (removed 7 sections that duplicated core-workflow.md)
  - Global installs no longer inject core-workflow.md into project `.claude/CLAUDE.md` (already in `~/.claude/CLAUDE.md`)
  - Global CLAUDE.md: 40.1k → 21.2k chars (47% reduction)
  - Project CLAUDE.md: ~30k → ~3.5k chars (88% reduction)

## [4.0.1] - 2026-03-07

### Changed

- Version bump and metadata updates

## [4.0.0] - 2026-03-07

### Added

- **AI-DLC Workflow** — Full AWS AI-DLC (AI-Driven Development Life Cycle) integration
  - 3-phase pipeline: Inception (what/why) → Construction (how) → Operations (deploy)
  - 7 inception stages: Workspace Detection, Reverse Engineering, Requirements Analysis, User Stories, Workflow Planning, Application Design, Units Generation
  - Per-unit construction loop: Functional Design, NFR Requirements/Design, Infrastructure Design, Code Generation, Build & Test
  - Checkpoint-based persistence for resumable workflows across sessions
  - Dual state tracking (checkpoint.json + aidlc-state.md)
  - Append-only audit.md with complete interaction logging
  - `/continue` command for workflow resumption from last checkpoint
  - `/retro` command for guardrail retrospectives
- **Orchestrator verification and skill stacking** for AI-DLC construction phase
- **Olympus agent delegation** strategies mapped to all AI-DLC workflow stages
- **CLAUDE.md sentinel merger** for idempotent, non-destructive rule injection
- **Brownfield detection and reverse engineering** pipeline
- **Content validation rules** (Mermaid diagrams, ASCII art, special characters)
- **Question format guide** with multiple choice and [Answer]: tag support
- **Session continuity rules** for workflow resumption guidance

### Changed

- Renamed ODLC → AIDLC terminology across entire codebase
- Renamed forge/ → construction/ and summit/ → operations/ directories
- Migrated commands to skills architecture
- Extracted embedded installer content to runtime `resources/` directory
- Rule detail files installed to `~/.claude/olympus/rules/` for on-demand loading

## [3.7.0] - 2026-02-06

### Added

**Automated Discovery Capture** - Intelligent learning from agent task completions

- **Automatic Task Discovery Extraction** - Captures learnings when agents complete tasks successfully
  - Hooks into task completion events to analyze agent work
  - Extracts discoveries about patterns, gotchas, workarounds, and technical insights
  - Zero manual intervention - discoveries captured automatically from successful task execution
  - Respects user privacy - only captures technical insights, not sensitive data

- **Two-Tier Deduplication System** - Prevents redundant discovery storage
  - **Tier 1**: Exact task description match within configurable window (default: 7 days)
  - **Tier 2**: Jaccard similarity > 0.7 on summary text prevents near-duplicate discoveries
  - Ensures learning data remains high-signal without unbounded growth

- **Configurable Volume Control** - Fine-grained control over discovery capture behavior
  - Global config at `~/.claude/olympus/config.json`, project override at `.olympus/config.json`
  - `autoDiscovery.enabled` (default: true) - Enable/disable auto-capture per project
  - `autoDiscovery.minConfidence` (default: 0.6) - Quality threshold for captured discoveries
  - `autoDiscovery.maxPerSession` (default: 5) / `maxPerDay` (default: 20) - Volume limits
  - `autoDiscovery.deduplicationWindowDays` (default: 7) - Deduplication lookback window

- **Plan Lifecycle Tracking** - Discoveries linked to plan context
  - Captures plan name and phase during structured workflow execution
  - Enables plan-specific discovery retrieval and analysis
  - Helps track technical learnings across multi-phase implementations
  - Supports retrospectives on completed plans

### Changed

- **Session State Extended** - Added `discovery_volume` tracking for volume limiting
  - Backward compatible (optional field, initialized on first use)
  - Tracks session count, daily count, and daily reset timestamp

- **DiscoveryCategory Extended** - Added `planning_insight` category for plan learnings
  - Updated `readDiscoveries()` categories record

- **CLI `learn --show` Enhanced** - Auto-discovery status section in learning status output
  - Shows enabled/disabled status, confidence threshold, volume limits
  - Displays recent auto-discoveries with confidence scores and age

### Technical Details

**New Files:**
- `src/learning/config.ts` - Discovery configuration with global/project override hierarchy
- `src/learning/discovery-detector.ts` - Discovery extraction, two-tier deduplication, category inference
- `src/learning/plan-tracker.ts` - Plan lifecycle monitoring, Momus review parsing, learnings formatting
- `src/hooks/registrations/discovery-capture.ts` - Stop event hook (priority 92) for auto-discovery
- `src/hooks/registrations/plan-lifecycle.ts` - Plan file monitoring, review tracking, Prometheus injection

**Test Coverage:**
- 56 new tests across 4 test files
- Unit tests for discovery detection, category inference, deduplication, volume limits
- Integration tests for end-to-end discovery capture flow (6 scenarios)
- Plan lifecycle tracking tests (18 scenarios)

**Performance:**
- Discovery extraction: <5ms per task completion
- Deduplication check: <10ms (O(n) on recent discoveries within window)
- Total Stop hook addition: <50ms
- No impact on task execution latency (runs at session end)

## [3.6.2] - 2026-02-04

### Fixed
- **Learning System Deployment**: Fixed hooks build output path to enable learning capture system
  - Changed build script to output bundled hooks to `dist/hooks/` instead of `scripts/dist/hooks/`
  - Resolved path mismatch where installer couldn't find bundled hooks file
  - Learning capture hooks (feedback log, token tracking) now properly deployed to all users
  - Affects all npm installations - users will receive learning capture on next update

## [3.6.1] - 2026-02-04

### Fixed
- **Plan Command Workflow**: Restructured `/plan` command to prevent redundant questions
  - Added explicit 3-step workflow: Scoping (2-3 questions) → Research → Detailed questions (3-5 max)
  - Implemented anti-redundancy mechanisms with mandatory review checkpoints
  - Added quality gate: 7 question maximum across all steps, no duplicates allowed
  - Fixed issue where research agents were launched mid-interview, causing duplicate questions

## [3.6.0] - 2026-02-04

### Added - Enhanced Plan Workflow Implementation Complete

**Phase 2: Real Artifact Generation** (commit 4783d3a)
- Implemented real IDEA artifact generation in executeIdeaStage()
  - Generates YAML frontmatter with workflow metadata
  - Creates 6 comprehensive sections: Problem Statement, Business Context, Success Metrics, Constraints, Solution Approach, Risk Assessment
  - 100% validation coverage (replaced previous mock implementations)
- Implemented real PRD artifact generation in executePrdStage()
  - Generates user stories (US-001 through US-005) with acceptance criteria
  - Creates requirement coverage table mapping PRD requirements to IDEA constraints
  - Includes dependencies and risk analysis
  - 100% validation coverage

**Phase 3: SPEC & INTENTS Generation** (commit c518a40)
- Implemented executeSpecStage() with comprehensive technical specifications
  - Generates 4 component types with detailed specifications
  - Database schema with tables, fields, and relationships
  - API endpoints with request/response formats
  - Authentication/Authorization strategy
  - Error Handling patterns
  - Performance Considerations
  - PRD Coverage table (≥95% coverage requirement)
- Implemented executeIntentsStage() with execution-ready tasks
  - Generates 7 individual INTENT files (INTENT-001.md through INTENT-007.md)
  - Each INTENT includes: frontmatter (id, dependencies, effort), Goal, Component, Acceptance Criteria, Implementation Steps
  - Creates dependency-graph.json in adjacency list format
  - 100% SPEC coverage validation
  - Circular dependency detection using DFS

**Complete Workflow Pipeline**
- End-to-end workflow: IDEA → PRD → SPEC → INTENTS
- All 5 phases of Enhanced Plan Workflow Implementation verified complete
- Comprehensive validation at each stage with coverage requirements
- Dependency graph generation with topological ordering (Kahn's algorithm)
- All 843 tests passing

### Changed
- Enhanced workflow engine with real artifact generation (no more stubs or TODOs)
- Updated validation.ts with comprehensive coverage checks for SPEC and INTENTS
- Improved console output with stage-specific success messages

## [3.5.0] - 2026-02-04

### Added - Phase 4: Execution Integration
- Task status tracking with execution.ts module
- Progress updates to master plan showing completion percentage
- `/ascent` workflow integration for executing structured workflows
- `/olympus next {feature}` command to get next ready task
- Execution order calculation with topological sort
- Blocked task detection and dependency management

### Added - Phase 5: Manual Commands & Polish
- `/idea {feature}` - Manual IDEA generation using idea-intake agent
- `/prd {feature}` - Manual PRD generation using prd-writer agent
- `/spec {feature}` - Manual SPEC generation using spec-writer agent
- `/intents {feature}` - Manual INTENTS generation using intent-generator agent
- `/workflow-status` - View all active structured workflows
- Prometheus structured workflow opt-in after plan generation
- Comprehensive error handling (disk full, corrupt checkpoint, permissions)
- Performance optimization with caching (10-100x faster checkpoints)
- User documentation: comprehensive workflow-guide.md (1,466 lines)
- 31 end-to-end tests for workflow system
- 16 performance benchmark tests

### Fixed
- Test directory cleanup (no more leftover .test-* directories)
- Learning-capture integration test (pre-initialize tokenizer)
- Hook timeout issues in test suite

### Performance
- Checkpoint save: 0.5-3ms (was targeting <50ms)
- Checkpoint load: 0.7ms cold, 0.01ms warm
- Memory usage: <10MB for 100 workflows

## [3.4.1] - 2026-02-03

### Fixed

**Token Metrics: Accurate Input/Output Split and Model Tracking**

- **Fixed token split tracking** - Input and output tokens now tracked separately instead of being set to 0
  - Added `input_tokens` and `output_tokens` fields to `TokenBudget` interface
  - UserPromptSubmit hook now accumulates to `input_tokens` field
  - PostToolUse hook now accumulates to `output_tokens` field
  - Stop hook uses actual split values in FeedbackEntry
  - Maintains backward compatibility with existing session states

- **Fixed model identifier tracking** - Real model ID captured instead of "unknown"
  - Added `current_model` field to session state
  - UserPromptSubmit hook captures model from `ctx.message.model`
  - Stop hook uses captured model ID in FeedbackEntry
  - Enables accurate per-model cost estimation

**Impact**: Cost estimates are now accurate and reflect actual input/output token usage per model. The learning system can now properly calculate model-specific pricing and track efficiency metrics.

## [3.4.1] - 2026-02-03

### Fixed

**Critical UX: /plan questions now visible immediately**

- **Fixed hidden questions in `/plan` command** - Questions from Prometheus are now displayed immediately instead of being trapped in agent subprocess
  - Updated `/plan` command to execute planning workflow directly in main conversation
  - Added explicit instruction: "Ask questions DIRECTLY to the user via normal message output"
  - Updated Prometheus agent to never use AskUserQuestion tool when delegated
  - Questions now appear as regular text output, ensuring immediate visibility

- **Added interactive workflow documentation** - Created `docs/interactive-workflows.md` explaining when to execute directly vs delegate to agents
  - Documents the pattern for interactive commands that require real-time user interaction
  - Provides implementation checklist for future command development
  - Prevents similar UX issues in other interactive workflows

**Impact**: Users no longer need to ask "are you done?" to see questions. Planning sessions now feel natural and responsive.

## [3.4.0] - 2026-02-03

### Added

**Token Efficiency Tracking** - Intelligent cost optimization without sacrificing quality

- **Automatic Token Tracking** - Zero-overhead token usage capture via hooks
  - UserPromptSubmit hook captures input tokens automatically
  - PostToolUse hook captures output tokens automatically
  - Stop hook aggregates session totals and updates metrics
  - One FeedbackEntry per session (not per-prompt) for efficient storage

- **Agent Efficiency Scoring** - Data-driven agent selection
  - Efficiency score: `success_rate * (baseline / avg_tokens)`
  - Historical baselines with trend detection (improving/stable/declining)
  - Minimum 5 samples required before recommendations
  - Smart model routing based on efficiency data

- **Budget Awareness** - Configurable session budget tracking
  - Default baseline: 10,000 tokens per session
  - Warning threshold: 1.5x baseline (15,000 tokens)
  - Non-blocking informational warnings
  - SessionStart injection with efficiency guidance (<500 token cap)

- **CLI Inspection Tools** (Optional) - Power user visibility
  - `olympus-ai learn --efficiency` - Agent efficiency rankings
  - `olympus-ai learn --show-costs` - Cost breakdown by model and agent
  - `olympus-ai learn --budget-status` - Current session budget status

- **Configuration Support** - Fully customizable behavior
  - `learning.tokenMetrics.enabled` (default: true)
  - `learning.tokenMetrics.warningThreshold` (default: 1.5)
  - `learning.tokenMetrics.minimumSamples` (default: 5)
  - `learning.tokenMetrics.injectionTokenBudget` (default: 150)
  - Pricing configuration support for cost estimation

### Changed

- **Learning System Integration** - Token metrics fully integrated into existing learning system
  - Extended FeedbackEntry with `token_usage` and `cost_estimate` fields
  - Extended AgentPerformance with `token_efficiency` metrics
  - Extended SessionState with `token_budget` tracking
  - All new fields are optional for backward compatibility

- **Documentation Updates** - Comprehensive documentation coverage
  - Updated README.md with token efficiency feature
  - Updated docs/guide/understanding-orchestration-system.md with Token Efficiency Learning section
  - Updated docs/guide/overview.md with efficiency mention
  - Added docs/configuration.md with token metrics configuration
  - Updated installer CLAUDE_MD_CONTENT with efficiency awareness

### Removed

- **Deprecated Token Metrics Module** - Clean migration to integrated system
  - Removed `src/features/token-metrics/` directory
  - Removed `src/hooks/registrations/token-metrics.ts`
  - Migrated token estimation to `src/learning/token-estimator.ts`
  - Old CLI commands show deprecation warnings with migration guidance

### Technical Details

**New Files:**
- `src/learning/pricing.ts` - Configurable pricing system
- `src/learning/utils.ts` - Type guards and safe accessors
- `src/learning/efficiency.ts` - Efficiency score calculation
- `src/learning/baselines.ts` - Session baseline tracking
- `src/learning/anomaly.ts` - Anomaly detection
- `src/learning/aggregation.ts` - Running averages and metrics
- `src/learning/token-estimator.ts` - Token estimation (migrated)
- `src/hooks/registrations/learning-capture.ts` - Token capture hooks
- `src/hooks/registrations/budget-warning.ts` - Budget warning logic

**Test Coverage:**
- 595/595 tests passing (7 new test files added)
- Zero regressions
- Comprehensive integration tests
- Backward compatibility verified

**Performance:**
- Zero LLM calls in collection/aggregation path
- No noticeable slowdown in hook execution
- Efficient two-tier storage architecture

**Impact:**
- Claude automatically considers efficiency when delegating to agents
- Users get cost-aware recommendations without manual intervention
- Optional CLI tools provide visibility into efficiency data
- Fully automatic operation - no user action required

## [3.3.0] - 2026-02-02

### Added

**File Placement Enforcement**

- **Agent Prompt Updates** - All Olympus agents now actively enforce file placement policies
  - Updated `olympian`, `olympian-high`, `olympian-low` with File Placement Policy sections
  - Updated `document-writer` with comprehensive documentation routing guidance
  - Updated `frontend-engineer`, `frontend-engineer-high`, `frontend-engineer-low` with file placement rules
  - All agents now explicitly prohibit creating files in project root
  - Clear routing: documentation → `docs/`, learnings → `olympus discover` command
  - Prevents documentation pollution in project root directories

### Technical Details
- Modified files: `src/agents/olympian.ts`, `src/agents/definitions.ts`, `src/agents/document-writer.ts`, `src/agents/frontend-engineer.ts`
- 10 agent definitions updated with file placement guidance
- Backward compatible, no breaking changes
- All 519 tests passing

**Impact:**
- Agents will no longer create arbitrary markdown files in project root
- Consistent file organization across all Olympus-managed projects
- Better project hygiene and structure

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
