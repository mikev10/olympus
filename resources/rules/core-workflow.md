# AI-DLC Core Workflow

This document is the execution guide for the AI-DLC (AI-Driven Development Life Cycle) framework.
It is installed into CLAUDE.md and read by the AI at session start.
Detailed stage rules are loaded on demand from `~/.claude/olympus/rules/`.

## Adaptive Workflow Principle

**The workflow adapts to the work, not the other way around.**

The AI intelligently assesses what stages are needed based on:
1. User's stated intent and clarity
2. Existing codebase state (greenfield vs brownfield)
3. Complexity and scope of change
4. Team familiarity with the affected area

## MANDATORY: Rule Loading

**CRITICAL**: When performing any stage, you MUST read and use relevant content from rule detail files at `~/.claude/olympus/rules/`.

**Common Rules** — ALWAYS load at workflow start:
- Load `common/process-overview.md` for workflow overview
- Load `common/terminology.md` for canonical terms and naming conventions
- Load `common/gate-enforcement.md` for checkpoint and gate rules
- Load `common/session-continuity.md` for session resumption guidance
- Load `common/content-validation.md` for content validation requirements
- Load `common/markdown-formatting.md` for markdown formatting compliance
- Load `common/question-format-guide.md` for question formatting rules
- Load `common/error-handling.md` for error recovery procedures
- Reference these throughout the workflow execution

## MANDATORY: Content Validation

**CRITICAL**: Before creating ANY artifact, you MUST validate content according to `common/content-validation.md` rules:
- Validate Mermaid diagram syntax
- Validate ASCII art diagrams (see `common/ascii-diagram-standards.md`)
- Escape special characters properly
- Provide text alternatives for complex visual content

## MANDATORY: Question File Format

**CRITICAL**: When asking questions at any stage, you MUST follow `common/question-format-guide.md` for:
- Multiple choice format
- [Answer]: tag usage
- Answer validation

## MANDATORY: Welcome Message

**CRITICAL**: When starting ANY AI-DLC workflow, you MUST display the welcome message.

**How to Display Welcome Message**:
1. Load the welcome message from `common/welcome-message.md`
2. Display the **complete** message to the user — do NOT summarize, paraphrase, or omit any part of it
3. Display it **exactly as written** — preserve all formatting, headers, and structure
4. This should only be done ONCE at the start of a new workflow
5. Do NOT reload this file in subsequent interactions to save context space
6. Do NOT generate your own welcome message — use ONLY the content from the file

---

# INCEPTION PHASE

**Purpose**: Planning, requirements gathering, and architectural decisions
**Focus**: Determine WHAT to build and WHY
**Actors**: PO + Tech Lead + senior devs. See `common/process-overview.md` for actor model.

**Pre-inception inputs** (async, before inception session):
- **Intent Brief** — PO writes what to build and why, success criteria, scope (~30 min)
- **Technical Brief** — Senior dev who knows the area writes constraints, patterns, gotchas (~15 min, optional — skip if nobody knows the area)

**Stages in INCEPTION PHASE**:
- Workspace Detection (ALWAYS)
- Scoped Discovery (ALWAYS — adaptive depth)
- Requirements Analysis (ALWAYS — adaptive depth)
- Units Generation (ALWAYS — skip only for bug fixes or trivial changes)
- User Stories (CONDITIONAL)
- Bolt Planning (CONDITIONAL)
- Workflow Planning (ALWAYS)

**Gate 1 at phase exit**: See `common/gate-enforcement.md` for gate criteria.

---

## Workspace Detection (ALWAYS EXECUTE)

1. **MANDATORY**: Log initial user request in audit.md with complete raw input
2. Load all steps from `inception/workspace-detection.md`
3. Execute workspace detection:
   - Check for existing aidlc-state.md (resume if found)
   - Check for `.aidlc/` persistent project context (Layer 1)
   - Scan workspace for existing code
   - Determine if brownfield or greenfield
   - Determine scoped discovery depth based on team familiarity
4. **MANDATORY**: Log findings in audit.md
5. Present completion message to user (see workspace-detection.md for format)
6. **Wait for Explicit Approval**: Team confirms greenfield/brownfield assessment and discovery depth — DO NOT PROCEED until user confirms
7. **MANDATORY**: Log user's response in audit.md with complete raw input

## Scoped Discovery (ALWAYS EXECUTE — Adaptive Depth)

**Always executes** but depth varies based on team familiarity with the affected area:
- **Minimal**: Senior dev knows the area cold — technical brief + confirmation scan
- **Standard**: Someone worked on it recently — brief notes + scoped discovery fills gaps
- **Full**: Nobody's touched this in years — comprehensive discovery

**Execution**:
1. **MANDATORY**: Log any user input during this stage in audit.md
2. Load all steps from `inception/scoped-discovery.md`
3. Read `.aidlc/project-context.md` (persistent project context, if it exists)
4. Read technical brief (if provided)
5. Execute scoped discovery at determined depth:
   - Scan ONLY code paths affected by this specific intent
   - Generate `workspace-scan.json` (machine-consumed)
   - Generate `scope-analysis.md` (human review — affected code, integration points, risks)
6. **MANDATORY**: Validate all content before file creation per content-validation.md rules
7. **Wait for Explicit Approval**: Team reviews scope-analysis.md, flags gaps or corrections — DO NOT PROCEED until user confirms
8. **MANDATORY**: Log user's response in audit.md with complete raw input

## Requirements Analysis (ALWAYS EXECUTE — Adaptive Depth)

**Always executes** but depth varies based on request clarity and complexity:
- **Minimal**: Simple, clear request — document intent analysis
- **Standard**: Normal complexity — gather functional and non-functional requirements
- **Comprehensive**: Complex, high-risk — detailed requirements with traceability

**Execution**:
1. **MANDATORY**: Log any user input during this stage in audit.md
2. Load all steps from `inception/requirements-analysis.md`
3. Load inputs:
   - Intent brief (from PO)
   - Technical brief (if provided)
   - Scoped discovery artifacts
4. Execute requirements analysis:
   - Analyze user request (intent analysis)
   - Determine requirements depth needed
   - Ask clarifying questions (if needed)
   - Generate `intent.md` (at intent folder root — all phases reference it)
   - Generate `requirements/requirements.md` (FR-NNN format)
   - Generate `requirements/nfr.md` (non-functional requirements)
5. **Wait for Explicit Approval**: PO validates requirements and NFRs — DO NOT PROCEED until user confirms
6. **MANDATORY**: Log user's response in audit.md with complete raw input

## Units Generation (ALWAYS — skip only for bug fixes or trivial changes)

**Always executes** — unit decomposition is the default. Even single-component work benefits from a named unit with a brief, stories, and bolt specs.

**Skip ONLY IF** (all must be true):
- Pure bug fix with clear, isolated scope
- Trivial change (config update, typo fix, single-file edit)
- No decomposition, design, or story tracking needed

**Execution**:
1. **MANDATORY**: Log any user input during this stage in audit.md
2. Load all steps from `inception/units-generation.md`
3. Load inception artifacts (intent.md, requirements, scoped discovery)
4. Execute unit decomposition:
   - Identify bounded contexts and domain boundaries
   - Identify cross-unit dependencies (dependency matrix + dependency diagram)
   - Determine execution order: maximize parallelism, sequence where dependencies require it
   - Generate `inception/units-overview.md` (combined record — WHY these boundaries, cross-unit deps, dependency diagram, sequencing rationale)
   - Generate per-unit `construction/UNIT-NNN-slug/unit-brief.md` (squad input — includes dependencies on other units)
5. **Wait for Explicit Approval**: Team validates unit boundaries, dependency matrix, and sequencing rationale — DO NOT PROCEED until user confirms
6. **MANDATORY**: Log user's response in audit.md with complete raw input

## User Stories (CONDITIONAL)

**INTELLIGENT ASSESSMENT**: Use multi-factor analysis to determine if user stories add value:

**ALWAYS Execute IF** (High Priority Indicators):
- New user-facing features or functionality
- Changes affecting user workflows or interactions
- Multiple user types or personas involved
- Complex business requirements with acceptance criteria needs
- Cross-functional team collaboration required
- Customer-facing API or service changes

**LIKELY Execute IF** (Medium Priority — Assess Complexity):
- Modifications to existing user-facing features
- Backend changes that indirectly affect user experience
- Integration work that impacts user workflows
- Performance improvements with user-visible benefits
- Data model changes affecting user data or reports

**COMPLEXITY-BASED ASSESSMENT**: For medium priority cases, execute user stories if:
- Request involves multiple components or services
- Changes span multiple user touchpoints
- Business logic is complex or has multiple scenarios
- Requirements have ambiguity that stories could clarify
- Change has significant business impact or risk

**SKIP ONLY IF** (All must be true):
- Pure internal refactoring with zero user impact
- Simple bug fixes with clear, isolated scope
- Infrastructure changes with no user-facing effects
- Documentation-only updates
- Developer tooling or build process improvements

**When in doubt, favor inclusion** — the cost of unnecessary stories is low, the cost of missing acceptance criteria is high.

**Note**: If Units Generation executed, stories are created per-unit. If skipped, stories are created from requirements directly.

**Execution**:
1. **MANDATORY**: Log any user input during this stage in audit.md
2. Load all steps from `inception/user-stories.md`
3. If requirements exist, reference them when creating stories
4. Execute story generation:
   - Generate `inception/personas.md` (project-wide user personas)
   - Generate per-unit `construction/UNIT-NNN-slug/stories.md` (acceptance criteria as checkboxes)
   - Generate `inception/story-map.md` (PO review: all stories + requirements coverage)
5. **Wait for Explicit Approval**: PO reviews story-map for coverage, QA reviews acceptance criteria for testability — DO NOT PROCEED until user confirms
6. **MANDATORY**: Log user's response in audit.md with complete raw input

## Bolt Planning (CONDITIONAL)

**Execute IF**:
- Units have been generated
- Units need decomposition into smaller executable bolts
- Complex units with multiple implementation steps

**Skip IF**:
- Single simple unit that IS the bolt
- No further decomposition needed

**Execution**:
1. **MANDATORY**: Log any user input during this stage in audit.md
2. Load all steps from `inception/bolt-planning.md`
3. Load inception artifacts (units-overview, per-unit stories)
4. Execute bolt decomposition:
   - Create bolt outlines with global sequential numbering (BOLT-001 through BOLT-NNN across ALL units)
   - Generate `construction/UNIT-NNN-slug/bolts/BOLT-NNN-slug/spec.md` with `status: outlined`
   - Verify story-to-bolt coverage (every story covered by at least one bolt)
5. **Wait for Explicit Approval**: Tech Lead reviews bolt outlines and story coverage — DO NOT PROCEED until user confirms
6. **MANDATORY**: Log user's response in audit.md with complete raw input

## Workflow Planning (ALWAYS EXECUTE)

1. **MANDATORY**: Log any user input during this stage in audit.md
2. Load all steps from `inception/workflow-planning.md`
3. **MANDATORY**: Load content validation rules from `common/content-validation.md`
4. Load all prior inception artifacts
5. Execute workflow planning:
   - Determine which construction stages to execute per unit
   - Create risk matrix and sequencing rationale
   - Generate `inception/execution-plan.md` (risk matrix, sequencing rationale, scope decisions, pre/post checklists)
6. **MANDATORY**: Validate all content before file creation per content-validation.md rules
7. **Wait for Explicit Approval**: Present execution plan recommendations, emphasizing user control to override stage inclusion/exclusion — DO NOT PROCEED until user confirms
8. **MANDATORY**: Log user's response in audit.md with complete raw input

**=== GATE 1: Inception Complete ===**

Gate 1 check (see `common/gate-enforcement.md` for full criteria):
- PO approves intent + stories (via story-map)
- Tech Lead approves unit boundaries + bolt outlines
- Requirements covered, units independent, execution plan reviewed
- **DO NOT proceed to Construction until Gate 1 passes**

---

# CONSTRUCTION PHASE

**Purpose**: Detailed design, implementation, and validation
**Focus**: Determine HOW to build it
**Actors**: Squad (dev + QA per unit). See `common/process-overview.md` for actor model.

Each unit is self-contained: own design, own build, own validation.
Units **MUST** be independent and run in **parallel** — this is a hard requirement on unit decomposition. If a unit cannot proceed without another unit's output (e.g., API must exist before UI can integrate), the dependency **MUST** be explicitly documented and justified in `units-overview.md` (dependency matrix + diagram). Dependencies are exceptions, not the default — if most units have dependencies, the decomposition is wrong. Execution order in `execution-plan.md` respects documented dependencies while maximizing parallelism.

Bolts run in **sequence** within a unit.

**Stages in CONSTRUCTION PHASE**:
- Per-Unit Stages (executes for each unit, in sequence):
  - Functional Design (ALWAYS — depth varies, produces functional-design.md + business-rules.md + domain-entities.md)
  - NFR Design (CONDITIONAL)
  - Infrastructure Design (CONDITIONAL)
  - Bolt Spec Refinement (ALWAYS)
  - **GATE 2: Design Approved**
  - Bolt Execution (ALWAYS, per bolt: Plan -> Code -> Review)
  - Unit Validation (ALWAYS)
  - **GATE 3: Unit Complete**
- Cross-Unit Integration Testing (CONDITIONAL — after all units, multiple units only)
- Documentation (ALWAYS — after all units)

---

## Per-Unit Stages (Executes for Each Unit)

**For each unit, execute the following stages in sequence.** Squad reads inception artifacts (unit-brief, stories, units-overview, execution-plan) before starting. QA participates from the start — reviews for testability and edge cases.

**MANDATORY**: At each stage completion, present ONLY the checkpoint format defined in `common/gate-enforcement.md`. DO NOT create emergent completion menus, numbered option lists, or custom navigation patterns. If the stage's rule file defines a specific completion message, use it exactly as written.

Load `construction/unit-design.md` for design stage orchestration.

### Functional Design (ALWAYS — depth varies by complexity)

**Always executes** for each unit. Produces three design artifacts — depth scales from lightweight (simple units) to comprehensive (complex units):
- `design/functional-design.md` — what the unit does, key interactions, data models, business logic flows
- `design/business-rules.md` — validation rules, edge cases, state transitions, error handling
- `design/domain-entities.md` — entities, relationships, constraints, lifecycle states

**Execution**:
1. **MANDATORY**: Log any user input during this stage in audit.md
2. Load `construction/unit-design.md` for orchestration
3. Load `construction/functional-design.md` for functional design guidance
4. Load `construction/business-rules.md` for business rules guidance
5. Load `construction/domain-entities.md` for entity modeling guidance
6. Execute functional design for this unit — produce all three artifacts
7. **MANDATORY**: Present ONLY the checkpoint format defined in `common/gate-enforcement.md` — DO NOT use emergent completion menus or navigation patterns
8. **Wait for Explicit Approval**: Squad + QA review the complete design package (all three artifacts together) — DO NOT PROCEED until user confirms
9. **MANDATORY**: Log user's response in audit.md with complete raw input

### NFR Design (CONDITIONAL, per unit)

**Execute IF**:
- Unit has performance, security, or scalability requirements from `requirements/nfr.md`
- Unit requires caching, encryption, or other NFR implementation decisions
- Tech stack selection or evaluation required for this unit
- Accessibility, observability, or compliance constraints apply

**Skip IF**:
- No NFR requirements apply to this unit
- Tech stack already determined and no NFR concerns
- Simple unit with no non-functional constraints

**Execution**:
1. **MANDATORY**: Log any user input during this stage in audit.md
2. Load all steps from `construction/nfr-design.md`
3. Execute NFR design for this unit (HOW to meet NFR requirements)
4. **MANDATORY**: Present ONLY the checkpoint format defined in `common/gate-enforcement.md` — DO NOT use emergent completion menus or navigation patterns
5. **Wait for Explicit Approval**: Squad reviews NFR design decisions — DO NOT PROCEED until user confirms
6. **MANDATORY**: Log user's response in audit.md with complete raw input

### Infrastructure Design (CONDITIONAL, per unit)

**Execute IF**:
- New infrastructure services needed
- Deployment architecture required
- Cloud resources need specification

**Skip IF**:
- No infrastructure changes
- Infrastructure already defined

**Execution**:
1. **MANDATORY**: Log any user input during this stage in audit.md
2. Load all steps from `construction/infrastructure-design.md`
3. Execute infrastructure design for this unit
4. **MANDATORY**: Present ONLY the checkpoint format defined in `common/gate-enforcement.md` — DO NOT use emergent completion menus or navigation patterns
5. **Wait for Explicit Approval**: Squad reviews infrastructure design — DO NOT PROCEED until user confirms
6. **MANDATORY**: Log user's response in audit.md with complete raw input

### Bolt Spec Refinement (ALWAYS — after design artifacts complete)

AI enriches outlined bolt specs from `status: outlined` to `status: refined` using unit design artifacts. Squad reviews the enriched specs at the checkpoint.

**Execution**:
1. For each bolt in this unit, AI refines `spec.md`:
   - Add detailed implementation acceptance criteria (Given/When/Then format) — derived from story acceptance criteria and design artifacts, NOT duplicating them. Story AC = what the user sees; bolt AC = what the code must do.
   - Add target files and implementation approach
   - Add test strategy and dependencies
   - Update `status: refined` in frontmatter
2. **MANDATORY**: Present ONLY the checkpoint format defined in `common/gate-enforcement.md` — DO NOT use emergent completion menus or navigation patterns
3. **Wait for Explicit Approval**: Squad reviews enriched specs — DO NOT PROCEED until user confirms
4. **MANDATORY**: Log user's response in audit.md with complete raw input

**=== GATE 2: Design Approved (per unit) ===**

Gate 2 check (see `common/gate-enforcement.md` for full criteria):
- Tech Lead reviews design (PR or walkthrough)
- Functional design sound, bolt specs refined, domain entities documented
- QA has reviewed for testability
- **DO NOT proceed to Bolt Execution until Gate 2 passes**

---

### Bolt Execution (ALWAYS, per bolt — sequential within unit)

Bolts execute sequentially within a unit. Each bolt follows the **Plan -> Code -> Review** lifecycle.

**Each bolt goes through three steps:**

| Step       | What Happens                                                              | Gate Type                                          |
|------------|---------------------------------------------------------------------------|----------------------------------------------------|
| **Plan**   | AI reads refined spec.md + unit design -> creates implementation approach | **Human gate** — dev approves before code starts   |
| **Code**   | AI generates code + tests. Tests run automatically.                       | **Automated** — tests pass/fail determines outcome |
| **Review** | Dev reviews code quality. QA validates acceptance criteria.               | **Human gate** — both approve, review.md created   |

**Advancement**: Tests pass + QA validates + human says "continue" -> next bolt. All three required.

**Execution per bolt**:
1. **MANDATORY**: Log bolt start in audit.md
2. Load all steps from `construction/bolt-execution.md`
3. **PLAN STEP**: AI reads spec.md + design/ artifacts -> creates detailed implementation plan with explicit numbered steps and checkboxes
4. Save plan as `bolts/BOLT-NNN-slug/plan.md` (single source of truth for this bolt's code generation)
5. **Wait for Explicit Approval**: Dev approves implementation plan — DO NOT generate code until user confirms
6. **MANDATORY**: Log user's approval in audit.md
7. **CODE STEP**: AI executes the approved plan step by step, marking checkboxes `[x]` in plan.md as each step completes. Tests run automatically. (See `construction/test-generation.md` for test standards.)
8. **REVIEW STEP**: Present code for review. Generate `review.md` for this bolt (acceptance criteria checklist + test results + QA notes). QA validates against acceptance criteria in spec.md.
9. **MANDATORY**: Present ONLY the checkpoint format defined in `common/gate-enforcement.md` — DO NOT use emergent completion menus or navigation patterns
10. **Wait for Explicit Approval**: Dev + QA approve — DO NOT advance to next bolt until user confirms
11. **MANDATORY**: Log completion and user's response in audit.md
12. **ONLY after approval**: Advance to next bolt (repeat steps 1-11). DO NOT auto-advance.

### Unit Validation (ALWAYS — after all bolts in unit)

1. **MANDATORY**: Log start of validation in audit.md
2. Load all steps from `construction/unit-validation.md`
3. QA performs full validation:
   - Regression testing across all bolts
   - Integration testing
   - Edge case validation
4. Generate `validation/validation-report.md` + `validation/build-summary.md`
5. **MANDATORY**: Present ONLY the checkpoint format defined in `common/gate-enforcement.md` — DO NOT use emergent completion menus or navigation patterns
6. **Wait for Explicit Approval**: QA validates, reviewer approves PR — DO NOT mark unit complete until user confirms
7. **MANDATORY**: Log Gate 3 sign-off in audit.md

**=== GATE 3: Unit Complete (per unit) ===**

Gate 3 check (see `common/gate-enforcement.md` for full criteria):
- All bolts pass acceptance criteria
- Tests pass, no regressions
- QA validates, reviewer approves PR
- **Unit is complete. Proceed to next unit or post-construction.**

---

## Cross-Unit Integration Testing (CONDITIONAL — after all units complete)

**Execute IF**:
- Multiple units exist in this intent
- Units have documented cross-unit dependencies in `units-overview.md`
- Units share APIs, databases, or UI flows that need end-to-end verification

**Skip IF**:
- Single unit (nothing to integrate)
- No cross-unit interactions exist

**Execution**:
1. **MANDATORY**: Log any user input during this stage in audit.md
2. Load all steps from `construction/integration-testing.md`
3. Review `units-overview.md` dependency matrix for known cross-unit interactions
4. Generate integration test plan:
   - Cross-unit API contract verification
   - Shared data flow testing
   - End-to-end user journey testing across unit boundaries
   - Regression testing for documented dependencies
5. Execute integration tests
6. Generate `construction/integration-test-results.md` (test plan + results + issues found)
7. **MANDATORY**: Present ONLY the checkpoint format defined in `common/gate-enforcement.md` — DO NOT use emergent completion menus or navigation patterns
8. **Wait for Explicit Approval**: QA + Tech Lead review integration test results — DO NOT PROCEED until user confirms
9. **MANDATORY**: Log user's response in audit.md with complete raw input

---

## Documentation (ALWAYS — after all units complete)

1. **MANDATORY**: Log any user input in audit.md
2. Load all steps from `construction/documentation.md`
3. Generate documentation artifacts:

   **ALWAYS generate:**
   - `operations/release-notes.md` — what changed, what's new, breaking changes

   **CONDITIONAL — generate if applicable:**
   - `operations/api-documentation.md` — consolidated API reference across all units (if new/changed APIs)
   - `operations/user-guide.md` — end-user documentation for new/changed features (if user-facing changes)
   - `operations/deploy-guide.md` — how to deploy, environment setup, configuration (if deployment changes)
   - `operations/runbook.md` — operational procedures, monitoring, troubleshooting (if operations changes)
   - `operations/migration-guide.md` — how to migrate from old to new behavior (if breaking changes)

4. Update `.aidlc/project-context.md` if architecture, patterns, or conventions changed during this intent (keep Layer 1 current for future intents) - User MUST approve update before file change.
5. **MANDATORY**: Present ONLY the checkpoint format defined in `common/gate-enforcement.md` — DO NOT use emergent completion menus or navigation patterns
6. **Wait for Explicit Approval**: Review generated documentation artifacts for accuracy and completeness — DO NOT PROCEED until user confirms
7. **MANDATORY**: Log user's response in audit.md

---

# OPERATIONS PHASE (PLACEHOLDER)

**Purpose**: Placeholder for future deployment and monitoring workflows
**Focus**: How to DEPLOY and RUN it (future expansion)

The Operations phase will eventually include:
- Deployment planning and execution
- Monitoring and observability setup
- Production readiness checklists

**Current State**: Operations artifacts (deploy guide, runbook, release notes) are generated during post-construction documentation.

---

## Key Principles

- **Adaptive Execution**: Only execute stages that add value
- **Transparent Planning**: Always show execution plan before starting construction
- **Stage Checkpoints**: AI presents output, pauses, waits for approval at EVERY stage
- **Gate Enforcement**: Three gates always enforced — no exceptions, even solo
- **Per-Unit Independence**: Each unit has own checkpoint, design, validation
- **Global Bolt Numbering**: BOLT-001 through BOLT-NNN across all units (unambiguous)
- **User Control**: User can request stage inclusion/exclusion
- **Progress Tracking**: Update aidlc-state.md with executed and skipped stages
- **Complete Audit Trail**: Log ALL user inputs and AI responses in audit.md with timestamps
  - **CRITICAL**: Capture user's COMPLETE RAW INPUT exactly as provided
  - **CRITICAL**: Never summarize or paraphrase user input in audit log
  - **CRITICAL**: Log every interaction, not just approvals
- **Quality Focus**: Complex changes get full treatment, simple changes stay efficient
- **Content Validation**: Always validate content before file creation per content-validation.md rules
- **NO EMERGENT BEHAVIOR**: At stage completion, present ONLY the checkpoint or gate format defined in `common/gate-enforcement.md`. DO NOT invent your own completion menus, navigation options, numbered choice lists, or stage transition messages. If a stage's rule file (loaded in step 2 of each stage's execution) defines a specific completion format, use it exactly. If no format is defined, present the output and wait silently for user direction.

## MANDATORY: Plan-Level Checkbox Enforcement

### MANDATORY RULES FOR PLAN EXECUTION
1. **NEVER** complete any work without updating plan checkboxes
2. **IMMEDIATELY** after completing ANY step described in a plan file, mark that step `[x]`
3. This must happen in the **SAME interaction** where the work is completed
4. **NO EXCEPTIONS**: Every plan step completion MUST be tracked with checkbox updates

### Two-Level Checkbox Tracking System
- **Plan-Level**: Track detailed execution progress within plan files:
  - Per-bolt `plan.md` — mark implementation steps as they complete
  - Stage rule files — mark numbered steps as they execute
- **Stage-Level**: Track overall workflow progress in `aidlc-state.md`:
  - Which stages have been executed, skipped, or are in progress
  - Which units are complete, which are pending
- **Update immediately**: All progress updates in the SAME interaction where work is completed

## Prompts Logging Requirements

- **MANDATORY**: Log EVERY user input (prompts, questions, responses) with timestamp in audit.md
- **MANDATORY**: Capture user's COMPLETE RAW INPUT exactly as provided (never summarize)
- **MANDATORY**: Log every approval prompt with timestamp BEFORE asking the user
- **MANDATORY**: Record every user response with timestamp AFTER receiving it
- **CRITICAL**: ALWAYS append changes to audit.md — NEVER use tools or commands that completely overwrite its contents
- Use ISO 8601 format for timestamps (YYYY-MM-DDTHH:MM:SSZ)
- Include stage context for each entry

## Audit Log Format

```markdown
## [Stage Name]
**Timestamp**: [ISO timestamp]
**User Input**: "[Complete raw user input — never summarized]"
**AI Response**: "[AI's response or action taken]"
**Context**: [Stage, action, or decision made]

---
```

**CRITICAL**: ALWAYS append/edit audit.md — NEVER overwrite its contents.

### Correct Tool Usage for audit.md

**✅ CORRECT**:

1. Read the existing audit.md file
2. Append new entries to the end of the file (edit/insert, NOT full rewrite)

**❌ WRONG**:

1. Read the existing audit.md file
2. Rewrite the entire file with old contents plus new entries (this risks data loss and duplication)

## Directory Structure

```text
<repo-root>/
├── .aidlc/                              # PERSISTENT PROJECT CONTEXT (Layer 1)
│   ├── project-context.md
│   ├── coding-standards.md
│   ├── legacy-notes.md
│   └── templates/                       # project-level template overrides
│       ├── inception/
│       └── construction/
│
aidlc-docs/
└── {intent-id}/
    ├── checkpoint.json                  # global workflow state
    ├── aidlc-state.md                   # human-readable progress
    ├── audit.md                         # full action trail
    ├── intent.md                        # business objective (at root — all phases reference)
    │
    ├── inception/                       === GATE 1 AT EXIT ===
    │   ├── intent-questions.md              # Q&A + raw notes from inception session
    │   ├── discovery/
    │   │   ├── workspace-scan.json          # machine-generated, machine-consumed
    │   │   └── scope-analysis.md            # affected code, integration points, risks
    │   ├── requirements/
    │   │   ├── requirements.md              # functional requirements (FR-NNN)
    │   │   └── nfr.md                       # non-functional requirements
    │   ├── personas.md                      # project-wide user personas
    │   ├── story-map.md                     # PO review: all stories + requirements coverage
    │   ├── units-overview.md                # unit decomposition record
    │   └── execution-plan.md                # risk matrix, sequencing rationale
    │
    ├── construction/                    === SQUADS OWN FROM HERE ===
    │   ├── UNIT-NNN-slug/
    │   │   ├── unit-brief.md                # created during inception (squad input)
    │   │   ├── stories.md                   # user stories with acceptance criteria
    │   │   ├── unit-checkpoint.json         # squad's own state
    │   │   ├── design/                  = GATE 2 =
    │   │   │   ├── functional-design.md
    │   │   │   ├── business-rules.md
    │   │   │   └── domain-entities.md
    │   │   ├── bolts/                       # global numbering across all units
    │   │   │   └── BOLT-NNN-slug/
    │   │   │       ├── spec.md              # outlined during inception, refined during design
    │   │   │       ├── plan.md              # implementation plan (approved before code)
    │   │   │       └── review.md            # created after bolt build
    │   │   └── validation/              = GATE 3 =
    │   │       ├── validation-report.md
    │   │       └── build-summary.md
    │   ├── ...                              # additional units, same structure
    │   └── integration-test-results.md  # cross-unit testing (if multiple units)
    │
    └── operations/                      === AFTER ALL UNITS ===
        ├── release-notes.md                 # ALWAYS
        ├── api-documentation.md             # if new/changed APIs
        ├── user-guide.md                    # if user-facing changes
        ├── deploy-guide.md                  # if deployment changes
        ├── runbook.md                       # if operations changes
        └── migration-guide.md               # if breaking changes
```

Application code: workspace root (NEVER in aidlc-docs/). Documentation: aidlc-docs/ only.

## Artifact Templates

Two-tier template system — Olympus ships defaults, project `.aidlc/templates/` overrides.
AI checks `.aidlc/templates/` first, falls back to `~/.claude/olympus/templates/`.
All templates use YAML frontmatter. See `common/process-overview.md` for the full template inventory.

## Olympus Agent Delegation

| Stage                     | Agent                                           | Purpose                                   |
|---------------------------|-------------------------------------------------|-------------------------------------------|
| Discovery                 | `explore-medium`                                | Scoped codebase analysis                  |
| Intent/Requirements       | `prometheus`                                    | Strategic planning with interview         |
| Units Generation          | `olympian` + `momus` (optional)                 | Domain decomposition with optional review |
| User Stories              | `oracle-medium`                                 | Per-unit story and persona generation     |
| Bolt Planning             | `olympian` + `momus` (optional)                 | Bolt decomposition with optional review   |
| Unit Design               | `oracle-medium`                                 | Design decisions                          |
| Bolt Execution (backend)  | `olympian` or `olympian-high`                   | Implementation                            |
| Bolt Execution (frontend) | `frontend-engineer` or `frontend-engineer-high` | UI implementation                         |
| Unit Validation           | `qa-tester`                                     | Testing and verification                  |
| Documentation             | `document-writer`                               | Documentation generation                  |
| Review                    | `momus`                                         | Critical evaluation                       |

## Skill Stacking

| Combination                        | Effect                                                  |
|------------------------------------|---------------------------------------------------------|
| `/plan` alone                      | Structured workflow with agent delegation               |
| `/plan` + `/ascent`                | Adds persistence — cannot stop until all units complete |
| `/plan` + `/ultrawork`             | Adds parallel execution and verification guarantees     |
| `/plan` + `/ascent` + `/ultrawork` | Full power: parallel, persistent, verified              |
