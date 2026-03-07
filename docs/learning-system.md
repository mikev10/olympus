# Olympus Learning System

The learning system is a closed-loop feedback pipeline that operates passively in the background. It captures signals from your interactions, extracts patterns, tracks agent performance, and injects learned context into future sessions — all without any LLM calls. The more you use Olympus, the better it understands your workflow.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [1. Passive Feedback Capture](#1-passive-feedback-capture)
- [2. Agent Discovery System](#2-agent-discovery-system)
- [3. Preference Learning & Pattern Extraction](#3-preference-learning--pattern-extraction)
- [4. Token Efficiency & Agent Routing](#4-token-efficiency--agent-routing)
- [5. Context Injection](#5-context-injection)
- [Storage & Data Lifecycle](#storage--data-lifecycle)
- [Configuration](#configuration)
- [CLI Management](#cli-management)
- [How It All Connects](#how-it-all-connects)

---

## Architecture Overview

The system consists of five interconnected subsystems, all driven by Claude Code hooks:

```
Session Start
    |
    v
[Context Injection] ---- reads from ----> [Storage Layer]
    |                                          ^
    v                                          |
User Interaction                               |
    |                                          |
    +---> [Feedback Capture] --- writes to ----+
    |     (revision-detector,                  |
    |      success-detector)                   |
    |                                          |
    +---> [Token Tracking] ---- writes to -----+
    |     (learning-capture hooks)             |
    |                                          |
    v                                          |
Agent Execution                                |
    |                                          |
    +---> [Discovery Capture] -- writes to ----+
    |     (discovery-capture hook)             |
    |                                          |
    v                                          |
Session End (Stop hook)                        |
    |                                          |
    +---> [Aggregation] -------- writes to ----+
    +---> [Pattern Extraction]
    +---> [Preference Learning]
```

**Design principles:**
- Zero LLM calls — purely regex-based detection and statistical analysis
- Silent failure — learning errors never break normal operation
- Append-only storage — JSONL files with automatic rotation
- Dual scope — global learnings (all projects) and project-specific learnings

**Key source files:**

| Component | Source |
|---|---|
| Types & interfaces | `src/learning/types.ts` |
| Storage layer | `src/learning/storage.ts` |
| Session state | `src/learning/session-state.ts` |
| Feedback detection | `src/learning/hooks/revision-detector.ts` |
| Success detection | `src/learning/hooks/success-detector.ts` |
| Discovery system | `src/learning/discovery.ts`, `src/learning/discovery-detector.ts` |
| Pattern extraction | `src/learning/pattern-extractor.ts` |
| Preference learning | `src/learning/preference-learner.ts` |
| Efficiency tracking | `src/learning/efficiency.ts` |
| Smart routing | `src/learning/routing.ts` |
| Context injection | `src/learning/hooks/learned-context.ts` |
| Hook registrations | `src/hooks/registrations/learning-capture.ts`, `src/hooks/registrations/discovery-capture.ts` |
| Cleanup & management | `src/learning/cleanup.ts` |
| Configuration | `src/learning/config.ts` |

---

## 1. Passive Feedback Capture

Every user prompt is scanned by regex-based detectors that classify it into one of six feedback categories. This happens in the `UserPromptSubmit` hook via `revision-detector.ts`.

### Feedback Categories

| Category | Examples | Typical Confidence |
|---|---|---|
| `correction` | "No, that's wrong", "You misunderstood" | 0.85-0.9 |
| `rejection` | "Stop", "Cancel", "Never mind" | 0.8-0.95 |
| `clarification` | "I meant X", "To clarify", "Let me rephrase" | 0.8-0.9 |
| `explicit_preference` | "Always use TypeScript", "Never use class components" | 0.85-0.95 |
| `praise` | "Perfect", "Looks good", "Great job" | 0.5-0.9 |
| `enhancement` | "Also add X", "One more thing" | 0.7-0.75 |

### How Detection Works

1. Code blocks are stripped from the prompt to prevent false positives
2. Each category has a list of regex patterns with associated confidence scores
3. The highest-confidence match wins
4. The detected category is stored in `SessionState.recent_prompts` and as a `FeedbackEntry` in `feedback-log.jsonl`

### Pending Completion Tracking

The system tracks "pending completions" — when an agent finishes a task (detected via the `PreToolUse` hook on the Task tool), the system sets `pending_completion` in session state with the task description and agent name. It then watches the user's next message:

- **Praise** (confidence > 0.7) → Records a `success` event, clears the pending completion
- **Topic change** (Jaccard similarity < 0.2 with original task) → Treats as implicit success
- **Correction/rejection** → Records a `revision` event, links it to the pending agent

This creates a direct feedback loop: agent completes task → user reacts → system records outcome → agent performance updated.

### Example Flow

```
1. User: "/olympus refactor the auth module"
2. Olympus delegates to olympian agent
3. Agent completes → pending_completion = { agent: "olympian", task: "refactor auth module" }
4. User: "Perfect, now add tests"
   → detectFeedbackCategory("Perfect, now add tests")
   → { category: "praise", confidence: 0.9 }
   → Records success for "olympian"
   → Clears pending_completion
```

---

## 2. Agent Discovery System

While passive feedback captures signals from **user reactions**, the discovery system captures insights from **agent work**. Agents can proactively record technical learnings they encounter during task execution.

### Discovery Categories

| Category | Description | Example |
|---|---|---|
| `technical_insight` | API behaviors, implementation details | "This API requires X header format" |
| `workaround` | Non-obvious solutions to problems | "Build fails silently, must check exit code" |
| `pattern` | Codebase conventions | "This codebase uses kebab-case for files" |
| `gotcha` | Surprising behaviors or requirements | "Migration must run before seeding" |
| `performance` | Performance-related findings | "Query N+1 issue in X, use eager loading" |
| `dependency` | Package/library requirements | "Package X requires peer dependency Y" |
| `configuration` | Environment or config requirements | "Environment variable DATABASE_URL must be set" |
| `planning_insight` | Lessons about planning approaches | "Plans need X consideration" |
| `workflow_gate` | Gate rejection/approval lessons | "Review rejected for missing test coverage" |
| `retro_insight` | Retrospective pattern observations | "Rename tasks get skipped when bundled" |

### Discovery Lifecycle

```
Agent discovers something during work
    |
    v
recordDiscovery() called with:
  - category, summary, details
  - agent_name, confidence (0-1)
  - scope: 'global' or 'project'
  - optional: expires_at, files_involved
    |
    v
Stored in discoveries.jsonl
  - id: UUID
  - verified: false (initially)
  - verification_count: 0
  - last_useful: timestamp
    |
    v
Future sessions: getDiscoveriesForInjection()
  - Filters expired discoveries
  - Scores by: (verification_count + 1) * recency_factor * confidence
  - Recency decays over 90 days
  - Returns top N discoveries for context injection
    |
    v
When a discovery proves useful:
  markDiscoveryUseful(id) → increments verification_count
```

### Automatic Discovery Capture

The `discovery-capture` hook (Stop event, priority 92) automatically captures discoveries from successful agent tasks:

1. Checks if auto-discovery is enabled in config
2. Checks volume limits (max 5/session, 20/day by default)
3. Checks for a pending completion from agent-tracking
4. Detects success signal (praise from user or topic change)
5. Extracts discovery from task context (category inferred from keywords)
6. Deduplicates against existing discoveries (exact match + Jaccard similarity > 0.7)
7. Records if all checks pass

### Dual-Scope Storage

- **Global discoveries** (`~/.claude/olympus/learning/discoveries.jsonl`): Cross-project insights that apply everywhere
- **Project discoveries** (`.olympus/learning/discoveries.jsonl`): Project-specific patterns and gotchas

### Volume Limiting

To prevent noise, discovery capture is rate-limited:

| Limit | Default | Configurable |
|---|---|---|
| Per session | 5 | Yes (`maxPerSession`) |
| Per day | 20 | Yes (`maxPerDay`) |
| Minimum confidence | 0.6 | Yes (`minConfidence`) |
| Deduplication window | 7 days | Yes (`deduplicationWindowDays`) |

---

## 3. Preference Learning & Pattern Extraction

The analysis layer processes accumulated feedback to build a user preference model. This runs during the `olympus-ai learn --analyze` CLI command.

### Pattern Extraction

`pattern-extractor.ts` clusters similar feedback entries using Jaccard similarity on n-grams:

1. Filters for corrections, clarifications, and explicit preferences
2. Groups entries where Jaccard similarity >= 0.1 (low threshold to catch related feedback)
3. Requires minimum 3 occurrences to surface a pattern
4. Generates a description using common keywords from the cluster
5. Assigns a category: `style`, `behavior`, `tooling`, or `communication`

**Example:** If you correct Claude three times about using `async/await` vs `.then()`, the system clusters those corrections and extracts a pattern.

### Preference Learning

`preference-learner.ts` builds a `UserPreferences` model from feedback:

**Explicit rules** — Extracted from "always/never" statements:
- "Always use TypeScript" → `Always: use TypeScript`
- "Never use class components" → `Never: use class components`
- These are **never decayed** — user-declared rules persist indefinitely

**Inferred preferences** — Derived from pattern analysis:
- **Verbosity**: Detects "too verbose/long" vs "more detail/too brief" (needs 3+ signals)
- **Autonomy**: Detects "ask me first/confirm" vs "just do it/stop asking" (needs 3+ signals)

**Recurring corrections** — Patterns that appear 3+ times:
- Subject to 30-day decay: corrections not seen in 30 days are pruned
- Examples are preserved for context injection

### Decay Mechanism

To prevent stale learnings from persisting, the system implements time-based decay:

| Data Type | Decay Rule |
|---|---|
| Explicit rules ("always/never") | Never decayed |
| Inferred preferences | Pruned if not backed by current patterns |
| Recurring corrections | 30-day TTL from `last_seen` |
| Discoveries (injection scoring) | 90-day recency factor (gradual decay) |
| Discoveries (expired) | Removed on cleanup if `expires_at` has passed |

---

## 4. Token Efficiency & Agent Routing

### Token Tracking

Three hooks work together to track token usage per session:

| Hook | Event | Priority | What It Does |
|---|---|---|---|
| `learningCapturePrompt` | UserPromptSubmit | 110 | Estimates input tokens from prompt text |
| `learningCaptureTool` | PostToolUse | 70 | Estimates output tokens from tool results |
| `learningCaptureStop` | Stop | 90 | Aggregates session totals, writes summary, resets |

Token estimates use a character-based approximation (not exact API counts). The model identifier is captured from context when available.

At session end, the Stop hook:
1. Creates a `SessionSummary` with total tokens, duration, cost estimate, and agents used
2. Appends it to `session-summaries.jsonl`
3. Prints a summary line to stderr (visible in terminal, not captured by Claude Code)
4. Resets the token budget for the next session

### Session Baselines

The system maintains adaptive baselines for expected token usage:

- **Default**: 10,000 tokens per session (cold start)
- **Project-specific**: Averages by project path after 5+ sessions
- **Task-type-specific**: Averages by inferred task type
- **Warning threshold**: 1.5x baseline (configurable)

When usage exceeds the warning threshold, a budget warning is injected into context.

### Agent Performance Metrics

Each agent's performance is tracked in `agent-performance.json`:

```json
{
  "olympian": {
    "agent_name": "olympian",
    "total_invocations": 47,
    "success_count": 42,
    "revision_count": 3,
    "cancellation_count": 2,
    "success_rate": 0.89,
    "failure_patterns": [...],
    "strong_areas": ["high success rate"],
    "weak_areas": [],
    "token_efficiency": {
      "avg_tokens_per_success": 160700,
      "avg_tokens_per_failure": 245000,
      "total_tokens": 8520000,
      "invocation_count": 47,
      "efficiency_score": 160700,
      "trend": "stable"
    }
  }
}
```

### Efficiency Score

```
efficiency_score = success_rate * min(baseline_tokens / actual_tokens, 2.0)
```

Higher is better. The token factor is capped at 2.0 to prevent unrealistically high scores from very small tasks.

### Trend Detection

With 10+ data points, the system compares the first half vs second half of token history:
- **Improving**: Recent average is 10%+ lower than historical
- **Declining**: Recent average is 10%+ higher than historical
- **Stable**: Within 10% variance

### Smart Agent Routing

`routing.ts` recommends cheaper agent tiers when performance data supports it:

**Agent tier hierarchy:**

| Domain | LOW (Haiku) | MEDIUM (Sonnet) | HIGH (Opus) |
|---|---|---|---|
| Analysis | `oracle-low` | `oracle-medium` | `oracle` |
| Execution | `olympian-low` | `olympian` | `olympian-high` |
| Search | `explore` | `explore-medium` | — |
| Research | `librarian-low` | `librarian` | — |
| Frontend | `frontend-engineer-low` | `frontend-engineer` | `frontend-engineer-high` |

**Routing logic:**

When a higher-tier agent is requested:
1. Look up lower-tier agents in the same family
2. Check if any lower-tier agent has 10+ data points AND 80%+ success rate
3. If yes, recommend the cheaper agent with a contextual note
4. Task pattern matching provides additional specificity (e.g., "especially for simple search tasks")

**Example recommendation:**
> Based on 25 data points, oracle-low handles this type of task with 85% success rate (especially for simple search tasks). Consider using oracle-low instead of oracle to save tokens.

---

## 5. Context Injection

At the start of every session, the `SessionStart` hook calls `generateLearnedContext()` to assemble a `<learned-context>` block that is injected into the conversation. This is how past learnings influence current behavior.

### What Gets Injected

The injected context is capped at approximately 500 tokens (~2000 characters) and includes:

1. **User Preferences** — Verbosity, autonomy, explicit rules (e.g., "Always: wait for me to confirm")
2. **Avoid These Mistakes** — Top 5 recurring corrections with occurrence counts
3. **Agent Efficiency** — Top 3 agents by efficiency score with success rates and avg tokens, plus session budget info
4. **Agent Discoveries** — Top 5 recent discoveries, scored by `(verification_count + 1) * recency_factor * confidence`
5. **Agent Notes** — Weak areas for agents that struggle with certain tasks

### Example Injected Context

```xml
<learned-context>

## User Preferences
- Verbosity: detailed
- Autonomy: ask_first
- Always: wait for me to confirm before making any changes
- Never: auto-commit code changes

## Avoid These Mistakes
- forgot to run build before testing (4x)
- used wrong import path for shared types (3x)

<olympus-efficiency>
AGENT EFFICIENCY (success%/avg tokens):
- oracle-medium: 91%/178.8k [PREFERRED]
- olympian: 100%/160.7k [PREFERRED]
- olympian-high: 89%/328.4k

SESSION BUDGET: ~10k baseline | warn at 15k
PATTERNS: Parallel reads save 40%

Quality remains priority. Use efficiency as tiebreaker.
</olympus-efficiency>

</learned-context>
```

### Discovery Injection

Discoveries are injected separately, scored by a composite formula:

```
score = (verification_count + 1) * recency_factor * confidence
```

Where `recency_factor = max(0.1, 1 - (age_in_days / 90))`, creating a gradual 90-day decay.

Expired discoveries (past their `expires_at` date) are filtered out entirely.

---

## Storage & Data Lifecycle

### File Locations

**Global learning data** (`~/.claude/olympus/learning/`):

| File | Format | Description |
|---|---|---|
| `feedback-log.jsonl` | JSONL | All feedback entries (corrections, praise, preferences) |
| `user-preferences.json` | JSON | Learned user preference model |
| `agent-performance.json` | JSON | Per-agent performance metrics |
| `discoveries.jsonl` | JSONL | Global discoveries (cross-project) |
| `session-summaries.jsonl` | JSONL | Session token/cost summaries |
| `routing-config.json` | JSON | Smart routing thresholds |

**Project-specific learning data** (`.olympus/learning/`):

| File | Format | Description |
|---|---|---|
| `discoveries.jsonl` | JSONL | Project-specific discoveries |
| `patterns.json` | JSON | Project conventions and tech stack |

**Session state** (`.olympus/session-state.json`):

Transient state for the current session — recent prompts, pending completions, token budget, discovery volume counters. Resets after 30 minutes of inactivity.

### Rotation & Archival

JSONL files automatically rotate when they exceed 10,000 lines:
- The current file is renamed with a timestamp: `feedback-log.2026-01-28T14-30-00-000Z.old.jsonl`
- A fresh file is created for new entries
- Old archives are pruned based on retention policy (default: 30 days, max 5 archives per file type)

### Data Integrity

- All writes use `appendFileSync` (atomic per-line)
- JSON files use `writeFileSync` with error handling
- Malformed JSONL lines are preserved during cleanup (never silently dropped)
- All errors are caught and logged — learning failures never break normal operation

---

## Configuration

### Discovery Configuration

Configuration follows a three-tier hierarchy: **defaults < global < project**.

**Global config** (`~/.claude/olympus/config.json`):
```json
{
  "autoDiscovery": {
    "enabled": true,
    "minConfidence": 0.6,
    "maxPerSession": 5,
    "maxPerDay": 20,
    "deduplicationWindowDays": 7
  }
}
```

**Project override** (`.olympus/config.json`):
```json
{
  "autoDiscovery": {
    "maxPerSession": 10,
    "minConfidence": 0.7
  }
}
```

### Configuration Options

| Option | Default | Range | Description |
|---|---|---|---|
| `enabled` | `true` | boolean | Enable/disable auto-discovery capture |
| `minConfidence` | `0.6` | 0.0-1.0 | Minimum confidence threshold for recording discoveries |
| `maxPerSession` | `5` | 1-50 | Maximum discoveries per session |
| `maxPerDay` | `20` | 1-200 | Maximum discoveries per day |
| `deduplicationWindowDays` | `7` | 1-90 | Days to look back for duplicate detection |

### Routing Configuration

Stored at `~/.claude/olympus/learning/routing-config.json`:

```json
{
  "minDataPoints": 10,
  "minSuccessRate": 0.80,
  "preferLowerTier": true,
  "agentTiers": {
    "oracle": ["oracle-low", "oracle-medium", "oracle"],
    "olympian": ["olympian-low", "olympian", "olympian-high"],
    "explore": ["explore", "explore-medium"],
    "librarian": ["librarian-low", "librarian"],
    "frontend-engineer": ["frontend-engineer-low", "frontend-engineer", "frontend-engineer-high"]
  }
}
```

### Archive Retention

| Setting | Default | Description |
|---|---|---|
| `maxAgeInDays` | 30 | Maximum age before archives are pruned |
| `maxArchiveCount` | 5 | Maximum archives to keep per file type |

---

## CLI Management

The `olympus-ai learn` command provides full control over learning data:

### View Statistics

```bash
olympus-ai learn --stats
```

Shows entry counts, storage sizes, and top verified discoveries.

### View Current Learnings

```bash
olympus-ai learn --show
```

Displays current user preferences, explicit rules, recurring corrections, and agent performance.

### Analyze Feedback

```bash
olympus-ai learn --analyze
```

Processes accumulated feedback to update patterns, preferences, and agent performance.

### Cleanup

```bash
# Preview what would be cleaned (dry run)
olympus-ai learn --cleanup --dry-run

# Clean up entries older than 180 days (default)
olympus-ai learn --cleanup

# Clean up with custom age threshold
olympus-ai learn --cleanup --age 90

# Also remove archived (.old.jsonl) files
olympus-ai learn --cleanup --remove-archived
```

### Reset

```bash
# Forget all learnings (irreversible)
olympus-ai learn --forget
```

### Debug Mode

Enable comprehensive hook logging to troubleshoot the learning system:

```bash
OLYMPUS_DEBUG_HOOKS=1 claude
```

Debug logs are written to `~/.claude/olympus/learning/hooks-debug.log` with timestamps and full context details.

---

## How It All Connects

Here is the complete data flow across a typical multi-session usage:

**Session 1 — Cold Start:**
1. No learned context exists yet
2. User works with Claude, delegating to agents
3. Feedback capture detects: "No, use async/await" → records correction
4. Token tracking accumulates usage throughout session
5. On Stop: session summary saved, token budget reset

**Session 2:**
1. User provides same correction again
2. Two occurrences stored — not yet a pattern (minimum 3 required)
3. Agent completes task → user says "Perfect" → success recorded for that agent
4. Discovery capture: agent found a gotcha → recorded in project discoveries

**Session 3:**
1. User corrects async/await usage a third time
2. `olympus-ai learn --analyze` extracts the pattern (3 occurrences, clustered by similarity)
3. Pattern added to recurring corrections in `user-preferences.json`

**Session 4+ — Context Injection Active:**
1. SessionStart hook reads `user-preferences.json` and `discoveries.jsonl`
2. Injects `<learned-context>` block with:
   - "Avoid These Mistakes: use async/await instead of .then() (3x)"
   - Agent efficiency metrics
   - Recent project discoveries
3. Claude now proactively uses async/await without being told

**Ongoing:**
- 30-day decay prunes stale corrections that haven't recurred
- Discovery scoring favors recent, verified, high-confidence entries
- Agent routing recommends cheaper tiers as performance data accumulates
- JSONL files auto-rotate at 10,000 lines to prevent unbounded growth

The system improves behavioral outcomes over time (learns preferences, optimizes routing, accumulates knowledge) while remaining static in mechanism — the detection, analysis, and injection pipeline itself does not change.
