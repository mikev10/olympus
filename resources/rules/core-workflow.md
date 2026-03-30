# AI-DLC Core Workflow

This document is the compact reference for the AI-DLC (AI-Driven Development Life Cycle) framework.
It is installed into CLAUDE.md and read by the AI at session start.
Detailed process rules are loaded on demand from `~/.claude/olympus/rules/`.

## Adaptive Workflow Principle

**The workflow adapts to the work, not the other way around.**

The AI assesses what stages are needed based on:
1. User's stated intent and clarity
2. Existing codebase state (greenfield vs brownfield)
3. Complexity and scope of change
4. Team familiarity with the affected area

## MANDATORY: Rule Loading

**CRITICAL**: When performing any stage, you MUST read the relevant rule file from `~/.claude/olympus/rules/` BEFORE executing.

**Common Rules** — ALWAYS load at workflow start:
- `common/process-overview.md` — workflow overview with Mermaid diagrams
- `common/terminology.md` — canonical terms and naming conventions
- `common/gate-enforcement.md` — checkpoint and gate approval rules
- `common/session-continuity.md` — session resumption and checkpoint recovery
- `common/content-validation.md` — content validation before file creation
- `common/markdown-formatting.md` — markdown formatting and markdownlint compliance
- `common/question-format-guide.md` — question formatting for mob/squad interactions
- `common/error-handling.md` — error recovery procedures

## MANDATORY: Content Validation

Before creating ANY artifact, validate per `common/content-validation.md`:
Mermaid syntax, ASCII diagrams, special character escaping, text alternatives.

## MANDATORY: Welcome Message

At workflow start, load and display `common/welcome-message.md` once.

---

## Two-Layer Context Model

AI context comes from two layers:

| Layer | Location | Purpose | Created |
|-------|----------|---------|---------|
| **Persistent Project Context** | `.aidlc/` at repo root | Architecture, patterns, conventions, gotchas | Once, maintained over time |
| **Scoped Discovery** | `{intent-id}/inception/discovery/` | Code paths affected by THIS intent | Per intent, during inception |

The AI reads `.aidlc/project-context.md` first, then does a focused scan of only the affected code. Discovery depth adapts to team familiarity with the area.

---

## Phase Model

Two top-level phases. Construction has two sub-phases per unit.

```
INCEPTION                             CONSTRUCTION (per unit)
(Mob -- decision makers)              (Squad -- implementers)

+-----------------------+            +-----------------------------+
|  Workspace Detection  |            |  +----------+  +---------+ |
|  Scoped Discovery     |            |  |  Design  |->|  Build  | |
|  Requirements Analysis|   GATE 1   |  +----------+  +---------+ |
|  Units Generation     | ---------> |     GATE 2        GATE 3   |
|  User Stories         |  handoff   |                             |
|  Bolt Planning        |            |  Units run in PARALLEL      |
|  Workflow Planning    |            |  Bolts run in SEQUENCE      |
+-----------------------+            +-----------------------------+
```

### Stage Checkpoints

Every stage has a checkpoint -- the AI presents output, pauses, and waits for human approval before advancing. Checkpoints are mandatory and cannot be skipped.

### Gates

Three formal quality gates at phase boundaries:

| Gate | When | Who Approves | What's Checked |
|------|------|--------------|----------------|
| **Gate 1** | After all inception stages | PO + Tech Lead | Requirements covered, units independent, stories approved, bolt outlines reasonable, execution plan reviewed |
| **Gate 2** | After unit design (per unit) | Tech Lead | Functional design sound, bolt specs refined, domain entities documented, QA reviewed for testability |
| **Gate 3** | After all bolts built (per unit) | QA + Reviewer | All bolts pass acceptance criteria, tests pass, no regressions |

Gate 2 and Gate 3 never relax. Per-bolt gates can relax after 2-3 full workflows.

---

# INCEPTION -- Determine WHAT to build and WHY

Core flow: **Intent -> Units -> Stories -> Bolts -> Execution Plan**

Each stage: load its rule file BEFORE executing, log all interactions in audit.md, wait for explicit approval before proceeding.

| Stage | Condition | Rule File |
|-------|-----------|-----------|
| Workspace Detection | ALWAYS | `inception/workspace-detection.md` |
| Scoped Discovery | ALWAYS (adaptive depth) | `inception/scoped-discovery.md` |
| Requirements Analysis | ALWAYS | `inception/requirements-analysis.md` |
| Units Generation | Conditional | `inception/units-generation.md` |
| User Stories | Conditional | `inception/user-stories.md` |
| Bolt Planning | Conditional | `inception/bolt-planning.md` |
| Workflow Planning | ALWAYS | `inception/workflow-planning.md` |

**Pre-inception inputs** (async, before mob session):
- **Intent Brief** -- PO writes what to build and why (~30 min)
- **Technical Brief** -- Senior dev who knows the area writes constraints, patterns, gotchas (~15 min, optional)

---

# CONSTRUCTION -- Determine HOW to build it

Each unit is self-contained: own design, own build, own validation. Units run in parallel (different squads). Bolts run in sequence within a unit.

## Design Sub-Phase (per unit)

Squad reads inception artifacts (unit-brief, stories, units-overview, execution-plan), then creates design artifacts. QA participates from the start.

| Stage | Condition | Rule File |
|-------|-----------|-----------|
| Unit Design (orchestrator) | ALWAYS | `construction/unit-design.md` |
| Functional Design | ALWAYS (depth varies) | `construction/functional-design.md` |
| Business Rules | ALWAYS (depth varies) | `construction/business-rules.md` |
| Domain Entities | ALWAYS (depth varies) | `construction/domain-entities.md` |
| NFR Design | Conditional | `construction/nfr-design.md` |
| Infrastructure Design | Conditional | `construction/infrastructure-design.md` |

**--> GATE 2: Design Approved** (Tech Lead reviews)

## Build Sub-Phase (per unit)

Bolts execute sequentially. Each bolt follows the **Plan -> Code -> Review** lifecycle.

```
+----------------------------------------------------------+
| BOLT-NNN                                                  |
|  Plan ------------> Code ------------> Review             |
|  [human gate]       [automated]        [human gate]       |
|                                                           |
|  AI reads spec      AI generates       Dev reviews code.  |
|  + unit design      code + tests.      QA validates AC.   |
|  -> impl approach   Tests run auto.    -> review.md       |
|  Dev approves.                                            |
+----------------------------------------------------------+
```

**Advancement:** Tests pass + QA validates + human says "continue" -> next bolt.

| Stage | Rule File |
|-------|-----------|
| Bolt Execution | `construction/bolt-execution.md` |
| Test Generation | `construction/test-generation.md` |

## Completion (per unit)

| Stage | Condition | Rule File |
|-------|-----------|-----------|
| Unit Validation | ALWAYS (after all bolts) | `construction/unit-validation.md` |

**--> GATE 3: Unit Complete** (QA validates, reviewer approves PR)

## Post-Construction (after all units)

| Stage | Condition | Rule File |
|-------|-----------|-----------|
| Documentation | ALWAYS | `construction/documentation.md` |

---

# OPERATIONS -- After all units complete

Placeholder for deployment, monitoring, and operational workflows.

---

## Key Principles

- **Adaptive Execution**: Only execute stages that add value; depth scales with complexity
- **Stage Checkpoints**: AI presents output, pauses, waits for approval at EVERY stage
- **Gate Enforcement**: Three gates always enforced -- no exceptions, even solo
- **Per-Unit Independence**: Each unit has own checkpoint, design, validation
- **Global Bolt Numbering**: BOLT-001 through BOLT-NNN across all units (unambiguous)
- **Progress Tracking**: Update aidlc-state.md with executed and skipped stages
- **Complete Audit Trail**: Log ALL user inputs and AI responses in audit.md with timestamps
  - Capture user's COMPLETE RAW INPUT exactly as provided (never summarize)
  - Log every interaction, not just approvals

## MANDATORY: Plan-Level Checkbox Enforcement

1. NEVER complete any work without updating plan checkboxes
2. IMMEDIATELY mark steps `[x]` in the SAME interaction where work is completed
3. Two-Level tracking: Plan-Level (detailed steps) + Stage-Level (aidlc-state.md)

## Audit Log Format

```markdown
## [Stage Name]
**Timestamp**: [ISO timestamp]
**User Input**: "[Complete raw user input]"
**AI Response**: "[Action taken]"
**Context**: [Stage/decision]

---
```

## Folder Structure

```
<repo-root>/
+-- .aidlc/                              # PERSISTENT PROJECT CONTEXT (Layer 1)
|   +-- project-context.md
|   +-- coding-standards.md
|   +-- legacy-notes.md
|   +-- templates/                       # project-level template overrides
|       +-- inception/
|       +-- construction/
|
aidlc-docs/
+-- {intent-id}/
    +-- checkpoint.json                  # global workflow state
    +-- aidlc-state.md                   # human-readable progress
    +-- audit.md                         # full action trail
    +-- intent.md                        # business objective (at root -- all phases reference)
    |
    +-- inception/                       === GATE 1 AT EXIT ===
    |   +-- intent-questions.md              # Q&A + raw notes from mob session
    |   +-- discovery/
    |   |   +-- workspace-scan.json          # machine-generated, machine-consumed
    |   |   +-- scope-analysis.md            # affected code, integration points, risks
    |   +-- requirements/
    |   |   +-- requirements.md              # functional requirements (FR-NNN)
    |   |   +-- nfr.md                       # non-functional requirements
    |   +-- personas.md                      # project-wide user personas
    |   +-- story-map.md                     # PO review: all stories + requirements coverage
    |   +-- units-overview.md                # mob's unit decomposition record
    |   +-- execution-plan.md                # risk matrix, sequencing rationale, scope decisions
    |
    +-- construction/                    === SQUADS OWN FROM HERE ===
    |   +-- UNIT-NNN-slug/
    |   |   +-- unit-brief.md                # mob creates during inception (squad input)
    |   |   +-- stories.md                   # user stories with acceptance criteria
    |   |   +-- unit-checkpoint.json         # squad's own state
    |   |   +-- design/                  = GATE 2 =
    |   |   |   +-- functional-design.md
    |   |   |   +-- business-rules.md
    |   |   |   +-- domain-entities.md
    |   |   +-- bolts/                       # global numbering across all units
    |   |   |   +-- BOLT-NNN-slug/
    |   |   |       +-- spec.md              # outlined by mob, refined by squad
    |   |   |       +-- review.md            # created after bolt build
    |   |   +-- validation/              = GATE 3 =
    |   |       +-- validation-report.md
    |   |       +-- build-summary.md
    |   +-- ...                              # additional units, same structure
    |
    +-- operations/                      === AFTER ALL UNITS ===
        +-- deploy-guide.md
        +-- runbook.md
        +-- release-notes.md
        +-- monitoring.json
```

Application code: workspace root (NEVER in aidlc-docs/). Documentation: aidlc-docs/ only.

## Artifact Templates

Two-tier template system -- Olympus ships defaults, project-level `.aidlc/templates/` overrides.

AI checks `.aidlc/templates/` first, falls back to global Olympus defaults at `~/.claude/olympus/templates/`.

All templates use YAML frontmatter for machine-parseable metadata. See `common/process-overview.md` for the full template inventory.

## Olympus Agent Delegation

| Stage | Agent | Purpose |
|-------|-------|---------|
| Discovery | `explore-medium` | Scoped codebase analysis |
| Intent/Requirements | `prometheus` | Strategic planning with interview |
| Units Generation | `olympian` + `momus` (optional) | Domain decomposition with optional review |
| User Stories | `oracle-medium` | Per-unit story and persona generation |
| Bolt Planning | `olympian` + `momus` (optional) | Bolt decomposition with optional review |
| Unit Design | `oracle-medium` | Design decisions |
| Bolt Execution (backend) | `olympian` or `olympian-high` | Implementation |
| Bolt Execution (frontend) | `frontend-engineer` or `frontend-engineer-high` | UI implementation |
| Unit Validation | `qa-tester` | Testing and verification |
| Documentation | `document-writer` | Documentation generation |
| Review | `momus` | Critical evaluation |

## Skill Stacking

| Combination | Effect |
|-------------|--------|
| `/plan` alone | Structured workflow with agent delegation |
| `/plan` + `/ascent` | Adds persistence -- cannot stop until all units complete |
| `/plan` + `/ultrawork` | Adds parallel execution and verification guarantees |
| `/plan` + `/ascent` + `/ultrawork` | Full power: parallel, persistent, verified |

## Extensions

Custom extensions in `.aidlc/extensions/` at workspace root take precedence over standard rules.
