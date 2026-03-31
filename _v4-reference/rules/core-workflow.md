# AI-DLC Core Workflow (Olympus Reference)

This document adapts the AWS AI-DLC workflow for Olympus conventions.
Actual workflow execution is driven by the `/plan` command and Olympus agent delegation.

## Adaptive Workflow Principle

**The workflow adapts to the work, not the other way around.**

The AI model intelligently assesses what stages are needed based on:
1. User's stated intent and clarity
2. Existing codebase state (if any)
3. Complexity and scope of change
4. Risk and impact assessment

## MANDATORY: Rule Details Loading

**CRITICAL**: When performing any phase, you MUST read and use relevant content from rule detail files installed at `~/.claude/olympus/rules/`.

**Common Rules**: ALWAYS load common rules at workflow start:
- Load `~/.claude/olympus/rules/common/process-overview.md` for workflow overview
- Load `~/.claude/olympus/rules/common/session-continuity.md` for session resumption guidance
- Load `~/.claude/olympus/rules/common/content-validation.md` for content validation requirements
- Load `~/.claude/olympus/rules/common/markdown-formatting.md` for markdown formatting and markdownlint compliance
- Load `~/.claude/olympus/rules/common/question-format-guide.md` for question formatting rules
- Load `~/.claude/olympus/rules/common/terminology.md` for phase/stage naming conventions
- Load `~/.claude/olympus/rules/common/error-handling.md` for error recovery procedures

## MANDATORY: Content Validation

Before creating ANY file, validate content per `~/.claude/olympus/rules/common/content-validation.md`:
Mermaid syntax, ASCII diagrams, special character escaping, text alternatives.

## MANDATORY: Question File Format

Follow `~/.claude/olympus/rules/common/question-format-guide.md` for multiple choice format, [Answer]: tags, and validation.

## MANDATORY: Custom Welcome Message

At workflow start, load and display `~/.claude/olympus/rules/common/welcome-message.md` once.

---

# INCEPTION PHASE — Determine WHAT to build and WHY

Core decomposition flow: **Intent -> Units -> Stories -> Bolts -> Done**

Each stage: load its rule file BEFORE executing, log all interactions in audit.md, wait for explicit user approval before proceeding (do not auto-advance).

| Stage | Condition | Rule File |
|-------|-----------|-----------|
| Workspace Detection | ALWAYS | `~/.claude/olympus/rules/inception/workspace-detection.md` |
| Reverse Engineering | Brownfield only (no prior artifacts) | `~/.claude/olympus/rules/inception/reverse-engineering.md` |
| Requirements Analysis | ALWAYS (adaptive depth) | `~/.claude/olympus/rules/inception/requirements-analysis.md` |
| Workflow Planning | ALWAYS | `~/.claude/olympus/rules/inception/workflow-planning.md` |
| Units Generation | Conditional (decomposes intent into independent domain units; includes domain analysis — subsumes former Application Design stage) | `~/.claude/olympus/rules/inception/units-generation.md` |
| User Stories | Conditional (creates stories per-unit from each unit's assigned requirements; falls back to requirements-based when units skipped) | `~/.claude/olympus/rules/inception/user-stories.md` |
| Bolt Planning | Conditional (decomposes each unit's stories into executable bolts with dependency tracking) | `~/.claude/olympus/rules/inception/bolt-planning.md` |

---

# CONSTRUCTION PHASE — Determine HOW to build it

Each unit is completed fully (design + code) before moving to the next unit. Construction stages use standardized 2-option completion messages (Request Changes / Continue) — NO emergent 3-option behavior.

**Per-Unit Loop** (for each unit of work):

| Stage | Condition | Rule File |
|-------|-----------|-----------|
| Functional Design | Conditional (new data models, complex business logic) | `~/.claude/olympus/rules/construction/functional-design.md` |
| NFR Requirements | Conditional (performance, security, scalability, tech stack) | `~/.claude/olympus/rules/construction/nfr-requirements.md` |
| NFR Design | Conditional (NFR Requirements was executed) | `~/.claude/olympus/rules/construction/nfr-design.md` |
| Infrastructure Design | Conditional (infra services, deployment arch) | `~/.claude/olympus/rules/construction/infrastructure-design.md` |
| Code Generation | ALWAYS (two-part: plan then generate) | `~/.claude/olympus/rules/construction/code-generation.md` |

**Build and Test** (ALWAYS, after all units): Load `~/.claude/olympus/rules/construction/build-and-test.md`

**Documentation** (ALWAYS, after Build and Test): Load `~/.claude/olympus/rules/construction/documentation.md`

---

# OPERATIONS PHASE — Placeholder for future deployment/monitoring workflows

---

## Key Principles

- **Adaptive Execution**: Only execute stages that add value
- **User Control**: User can request stage inclusion/exclusion
- **Progress Tracking**: Update aidlc-state.md with executed and skipped stages
- **Complete Audit Trail**: Log ALL user inputs and AI responses in audit.md with timestamps
  - Capture user's COMPLETE RAW INPUT exactly as provided (never summarize)
  - Log every interaction, not just approvals
- **Content Validation**: Validate before file creation per content-validation.md rules
- **NO EMERGENT BEHAVIOR**: Construction phases use standardized 2-option completion messages only

## MANDATORY: Plan-Level Checkbox Enforcement

1. NEVER complete any work without updating plan checkboxes
2. IMMEDIATELY mark steps `[x]` in the SAME interaction where work is completed
3. Two-Level tracking: Plan-Level (detailed steps) + Stage-Level (aidlc-state.md)

## Prompts Logging Requirements

- Log EVERY user input with ISO 8601 timestamp in audit.md
- Capture COMPLETE RAW INPUT exactly as provided (never summarize)
- ALWAYS append/edit audit.md — NEVER overwrite

### Audit Log Format:
```markdown
## [Stage Name]
**Timestamp**: [ISO timestamp]
**User Input**: "[Complete raw user input]"
**AI Response**: "[Action taken]"
**Context**: [Stage/decision]

---
```

## Directory Structure

```text
<WORKSPACE-ROOT>/                   # APPLICATION CODE HERE
├── [project-specific structure]
├── aidlc-docs/                     # DOCUMENTATION ONLY
│   ├── inception/
│   │   ├── plans/
│   │   ├── reverse-engineering/    # Brownfield only
│   │   ├── requirements/
│   │   ├── units/
│   │   │   └── {UNIT-NNN-slug}/
│   │   │       ├── unit-brief.md
│   │   │       └── stories/        # Per-unit stories (created during User Stories stage)
│   │   │           ├── S-001-{slug}.md
│   │   │           └── S-002-{slug}.md
│   │   └── user-stories/
│   │       └── personas.md         # Project-wide personas (not per-unit)
│   ├── construction/
│   │   ├── {UNIT-NNN-slug}/
│   │   │   ├── functional-design/
│   │   │   ├── nfr-requirements/
│   │   │   ├── nfr-design/
│   │   │   ├── infrastructure-design/
│   │   │   ├── code/               # Markdown summaries only
│   │   │   └── bolts/              # Per-unit bolt specs (created during Bolt Planning)
│   │   │       └── BOLT-NNN-{slug}/
│   │   │           ├── spec.md
│   │   │           └── review.md
│   │   ├── design/
│   │   ├── build-and-test/
│   │   └── documentation/
│   ├── operations/                 # Placeholder
│   ├── aidlc-state.md
│   └── audit.md
```

Application code: workspace root (NEVER in aidlc-docs/). Documentation: aidlc-docs/ only.

## Canonical Templates

Agents MUST read and follow these template files when creating artifacts:

| Template | Path | Used By |
|----------|------|---------|
| Units overview | `resources/templates/inception/units-template.md` | Units Generation |
| Unit brief | `resources/templates/inception/unit-brief-template.md` | Units Generation |
| Bolt spec | `resources/templates/construction/bolt-spec-template.md` | Bolt Planning |

## Olympus Agent Delegation

| Stage | Agent | Purpose |
|-------|-------|---------|
| Discovery/Reverse Engineering | `explore-medium` | Codebase analysis |
| Intent/Requirements | `prometheus` | Strategic planning with interview |
| Units Generation | `olympian` + `momus` (optional) | Domain decomposition with optional review |
| User Stories | `oracle-medium` | Per-unit story and persona generation |
| Bolt Planning | `olympian` + `momus` (optional) | Bolt decomposition with optional review |
| Functional/NFR/Infrastructure Design | `oracle-medium` | Design decisions |
| Code Generation (backend) | `olympian` or `olympian-high` | Implementation |
| Code Generation (frontend) | `frontend-engineer` or `frontend-engineer-high` | UI implementation |
| Build & Test | `qa-tester` | Testing and verification |
| Documentation | `document-writer` | Documentation draft generation |
| Review | `momus` | Critical evaluation |

## Skill Stacking for AI-DLC

| Combination | Effect |
|-------------|--------|
| `/plan` alone | Structured workflow with agent delegation |
| `/plan` + `/ascent` | Adds persistence — cannot stop until all units complete |
| `/plan` + `/ultrawork` | Adds parallel execution and verification guarantees |
| `/plan` + `/ascent` + `/ultrawork` | Full power: parallel, persistent, verified |

## Extensions

Custom extensions in `.aidlc-rule-details/extensions/` at workspace root take precedence over standard rules.
