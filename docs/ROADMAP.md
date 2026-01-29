# Olympus Roadmap: Workflow Gaps & Proposed Improvements

This document identifies gaps in the current Olympus workflow and proposes new commands to create a complete development lifecycle.

## Current State

### Existing Commands

| Category | Commands | Purpose |
|----------|----------|---------|
| **Task Execution** | `/olympus`, `/ascent`, `/ultrawork` | Start and run tasks |
| **Planning** | `/plan`, `/prometheus`, `/review`, `/complete-plan` | Plan before coding |
| **Search** | `/deepsearch`, `/analyze` | Find and understand code |
| **Control** | `/cancel-ascent`, `/update`, `/olympus-default` | System management |

### Existing Agents

| Agent | Model | Purpose |
|-------|-------|---------|
| `oracle` (+ medium, low) | Opus/Sonnet/Haiku | Architecture & debugging |
| `librarian` (+ low) | Sonnet/Haiku | Documentation research |
| `explore` (+ medium) | Haiku/Sonnet | Fast codebase search |
| `frontend-engineer` (+ low, high) | Haiku/Sonnet/Opus | UI/UX development |
| `document-writer` | Haiku | Technical documentation |
| `multimodal-looker` | Sonnet | Image/diagram analysis |
| `momus` | Opus | Plan review & critique |
| `metis` | Opus | Pre-planning analysis |
| `olympian` (+ low, high) | Haiku/Sonnet/Opus | Focused task execution |
| `prometheus` | Opus | Strategic planning |
| `qa-tester` | Sonnet | Interactive CLI testing |

---

## Identified Gaps

The current workflow focuses heavily on the "execute task" phase but neglects other parts of the development lifecycle:

```
[PLAN] → [EXECUTE] → [???] → [???] → [???]
   ✅        ✅        ❌       ❌       ❌
```

### Gap 1: Git Workflow Integration

**Problem:** No branch management. Users work on whatever branch they're on, risking changes to main.

**Impact:**
- Accidental commits to main branch
- No clean separation of features
- Manual branch/commit/PR workflow

### Gap 2: Post-Execution Iteration

**Problem:** After `/ascent` completes, there's no streamlined way to handle small fixes, tweaks, or iterations.

**Impact:**
- Users must re-invoke full `/olympus` for small tweaks
- No lightweight "fix this one thing" command
- Unclear how to iterate on "completed" work

### Gap 3: Testing Workflow

**Problem:** `qa-tester` agent exists but no easy command to invoke it. No dedicated test-fixing workflow.

**Impact:**
- Testing is embedded in `/ascent` verification but not standalone
- No quick "run tests and fix failures" command

### Gap 4: Debugging Workflow

**Problem:** `/analyze` is generic. No dedicated debugging flow for tracking down and fixing bugs.

**Impact:**
- Bug fixing requires manual orchestration
- No structured debug → trace → fix workflow

### Gap 5: Workflow Continuity

**Problem:** No way to see status of current work, resume previous tasks, or rollback mistakes.

**Impact:**
- Context lost between sessions
- No visibility into in-progress work
- No safety net for bad changes

---

## Proposed Commands

### High Priority

| Command | Purpose | Description |
|---------|---------|-------------|
| `/fix <issue>` | Post-execution debugging | Debug and fix a specific issue. Lightweight alternative to full `/olympus` for bug fixes. |
| `/branch <name>` | Git workflow | Create and switch to a feature branch before starting work. Could also be `--branch` flag on `/olympus`, `/ascent`. |
| `/commit` | Git workflow | Smart commit with conventional commit message based on changes made. |
| `/tweak <description>` | Quick adjustments | Small adjustment (padding, styling, minor behavior). Minimal overhead. |

### Medium Priority

| Command | Purpose | Description |
|---------|---------|-------------|
| `/test` | Testing | Run test suite, analyze failures, fix them. |
| `/pr` | Git workflow | Create pull request with smart description based on commits/changes. |
| `/debug <symptom>` | Debugging | Structured debugging: investigate symptom, trace through code, identify root cause, fix. |

### Lower Priority

| Command | Purpose | Description |
|---------|---------|-------------|
| `/status` | Workflow continuity | Show current task state, pending todos, recent changes. |
| `/resume` | Workflow continuity | Pick up where you left off from a previous session. |
| `/rollback` | Workflow continuity | Undo recent changes if something went wrong. |
| `/verify` | Testing | Full verification pass on recent changes without the persistence of `/ascent`. |

---

## Proposed Complete Workflow

```
┌─────────────────────────────────────────────────────────────────┐
│                        FULL LIFECYCLE                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  [START]                                                        │
│     │                                                           │
│     ▼                                                           │
│  /branch feature/my-feature    ← Create feature branch          │
│     │                                                           │
│     ▼                                                           │
│  /plan "add user auth"         ← Strategic planning             │
│     │                                                           │
│     ▼                                                           │
│  /review                       ← Critique the plan              │
│     │                                                           │
│     ▼                                                           │
│  /ascent "implement the plan"  ← Execute until done             │
│     │                                                           │
│     ▼                                                           │
│  /test                         ← Run & fix tests                │
│     │                                                           │
│     ▼                                                           │
│  /tweak "fix padding on modal" ← Small adjustments              │
│     │                                                           │
│     ▼                                                           │
│  /fix "dropdown not closing"   ← Fix specific bugs              │
│     │                                                           │
│     ▼                                                           │
│  /commit                       ← Smart commit                   │
│     │                                                           │
│     ▼                                                           │
│  /pr                           ← Create pull request            │
│     │                                                           │
│  [DONE]                                                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Implementation Notes

### Command Design Principles

1. **Lightweight by default** - `/fix` and `/tweak` should be fast, not invoke full orchestration
2. **Progressive complexity** - Simple commands for simple tasks, full orchestration when needed
3. **Git-aware** - Commands should understand git state and act appropriately
4. **Composable** - Commands can be chained or combined

### Potential Flags

Consider adding flags to existing commands:

| Flag | Commands | Purpose |
|------|----------|---------|
| `--branch <name>` | `/olympus`, `/ascent` | Create feature branch before starting |
| `--commit` | `/olympus`, `/ascent`, `/fix` | Auto-commit on completion |
| `--pr` | `/olympus`, `/ascent` | Create PR on completion |
| `--no-verify` | `/fix`, `/tweak` | Skip verification step for speed |

### Agent Considerations

New commands may need new agents or leverage existing ones:

| Command | Primary Agent | Notes |
|---------|---------------|-------|
| `/fix` | `oracle` → `olympian` | Diagnose then fix |
| `/debug` | `oracle` | Deep investigation |
| `/test` | `qa-tester` or direct | Depends on test type |
| `/tweak` | `olympian-low` | Fast, simple changes |
| `/commit`, `/pr`, `/branch` | Direct (no agent) | Git operations |

---

## Open Questions

1. **Flag vs Command:** Should git operations be flags (`/olympus --branch`) or separate commands (`/branch`)?
2. **Persistence:** Should `/fix` have the same persistence as `/ascent` or be interruptible?
3. **Scope:** Should `/tweak` be limited to single-file changes?
4. **Integration:** Should `/commit` and `/pr` detect what changed automatically or require explicit input?

---

## References

- Current commands defined in: `src/installer/index.ts` (COMMAND_DEFINITIONS)
- Current agents defined in: `src/installer/index.ts` (AGENT_DEFINITIONS)
- Hook system: `src/installer/hooks.ts`
