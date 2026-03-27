# Bolt Planning - Inception Stage

## Overview

Bolt Planning is the final inception stage. It decomposes each unit of work into bolts — scoped execution packages that a code-generation agent can implement in a focused session — so that teams can review scope and dependencies before construction begins.

Running bolt planning during inception means bolt specs are human-reviewable artifacts produced alongside requirements, stories, and unit definitions. Construction starts with pre-planned bolts rather than creating them on the fly.

**When this stage runs**: After Units Generation completes and all unit stories are defined.

**When this stage is skipped**: Single shallow unit with `depth_score <= 4` AND pathway is not `bugfix`. Set `inception_stages["bolt-planning"].status = "skipped"` with an appropriate skip reason.

---

## Bolt Naming Convention (MANDATORY)

Bolt IDs use **global sequential numbering across ALL units** — numbering does NOT reset per unit.

Format: `BOLT-NNN-slug`

- `NNN` is zero-padded to three digits: `001`, `002`, `003`, ...
- `slug` is a short kebab-case description of the bolt's scope
- Numbers are assigned in the order bolts are created across all units

Examples:
- `BOLT-001-data-model` (Unit 1, bolt 1)
- `BOLT-002-repository-layer` (Unit 1, bolt 2)
- `BOLT-003-api-endpoints` (Unit 1, bolt 3)
- `BOLT-004-dashboard-ui` (Unit 2, bolt 1 — numbering continues globally)

---

## Directory Structure

Bolt specs are nested under their parent unit:

```
aidlc-docs/{workflowId}/construction/{UNIT-NNN-slug}/bolts/
├── BOLT-001-{slug}/spec.md
├── BOLT-002-{slug}/spec.md
└── BOLT-003-{slug}/spec.md
```

Full path example:
```
aidlc-docs/{workflowId}/construction/UNIT-001-foundation/bolts/BOLT-001-data-model/spec.md
aidlc-docs/{workflowId}/construction/UNIT-001-foundation/bolts/BOLT-002-repository-layer/spec.md
aidlc-docs/{workflowId}/construction/UNIT-002-frontend/bolts/BOLT-003-dashboard-ui/spec.md
```

**No bolt-plan.md summary document is created.** The individual `spec.md` files are the plan.

---

## Bolt Spec Format

Each bolt is described by a `spec.md` file with this structure:

### Frontmatter

```yaml
---
id: BOLT-NNN-slug
title: "Short descriptive title"
parent_unit_id: UNIT-NNN-unit-name
sequence: 1
depth_target: 6
express_mode: false
estimated_effort_hours: 4
requirements: ["FR-1", "FR-3"]
stories: ["S-001"]
docs_impact: ["none"]
requires_bolts: []
enables_bolts: ["BOLT-002-repository-layer"]
requires_units: []
blocked: false
---
```

| Field | Description |
|-------|-------------|
| `id` | Globally unique bolt identifier (see Naming Convention) |
| `title` | Short human-readable title |
| `parent_unit_id` | ID of the parent construction unit (e.g., `UNIT-001-foundation`) |
| `sequence` | Execution order within the unit (1-based) |
| `depth_target` | Reasoning depth (1-10). Express mode threshold: <= 4 |
| `express_mode` | `true` if eligible for express execution (skips elaboration) |
| `estimated_effort_hours` | Rough hours estimate for human review |
| `requirements` | Requirement IDs from `requirements.md` this bolt satisfies (e.g., `["FR-1", "FR-3"]`) |
| `stories` | Story IDs from `stories.md` this bolt addresses (e.g., `["S-001"]`). Optional but recommended. |
| `docs_impact` | Documentation types this bolt impacts: `none`, `readme`, `user-guide`, `config-reference`, `cli-reference`, `migration-guide`, `architecture`, `code-comments` |
| `requires_bolts` | Bolt IDs that must complete before this bolt begins (within-unit dependencies) |
| `enables_bolts` | Bolt IDs that depend on this bolt completing (within-unit reverse deps, informational) |
| `requires_units` | Unit IDs that must be fully built before this bolt begins (cross-unit dependencies) |
| `blocked` | `true` if this bolt cannot proceed because a dependency is not yet resolved |

### Required Body Sections

Every bolt spec must contain all five sections:

```markdown
## Scope

{What this bolt implements. A focused description of the functionality delivered by this bolt alone.}

## Acceptance Criteria

- [ ] {Measurable, verifiable criterion 1}
- [ ] {Measurable, verifiable criterion 2}

## Target Files

- `{path/to/file.ts}` — {create|modify}: {brief description}

## Dependencies

{Other bolt IDs that must complete before this bolt begins, or "None".}

## Traceability

- **Requirements**: {comma-separated requirement IDs from requirements.md}
- **Stories**: {comma-separated story IDs from stories.md, or "None"}
```

---

## Process

### Step 1: Review Units and Stories

For each unit defined in `inception/units/unit-of-work.md`:
- Read the assigned stories from `inception/units/unit-of-work-story-map.md`
- Read the unit brief at `inception/units/{unit-slug}/unit-brief.md` if it exists
- Identify the unit's requirements (FR-N IDs) and estimate complexity

### Step 2: Group Stories into Bolts

For each unit, group its stories into cohesive bolts:

- Each bolt should deliver a coherent slice of functionality
- Bolts within a unit execute sequentially (respect data layer → logic → API → UI ordering)
- Maximum **8 bolts per unit**, **50 bolts total** across all units
- If a unit's scope exceeds 8 bolts, flag it for re-scoping before proceeding

**Grouping heuristics**:
- Data models and schema migrations → single bolt
- Repository/data access layer → single bolt
- Business logic / service layer → one or more bolts by domain area
- API endpoints → one bolt per logical group
- UI components → one bolt per screen or feature area
- Infrastructure (auth, logging, config) → single bolt

### Step 3: Assign Bolt Type

For each bolt, determine whether express mode applies:

- `express_mode: true` if `depth_target <= 4` OR the parent unit's pathway is `bugfix`
- Express bolts skip the elaboration stage during construction and go directly to code generation

### Step 4: Analyze Dependencies

#### Within-Unit Dependencies (bolt-to-bolt)

For each unit, identify which bolts must complete before others can begin. Populate:
- `requires_bolts`: list of bolt IDs this bolt depends on
- `enables_bolts`: list of bolt IDs that depend on this bolt (reverse, informational)

Typical within-unit ordering: data model bolt → repository bolt → service bolt → API bolt → UI bolt.

#### Cross-Unit Dependencies (bolt-to-unit)

Identify whether any bolt requires work from a different unit to be complete first:
- Populate `requires_units` with unit IDs (e.g., `["UNIT-001-foundation"]`)
- Cross-unit dependencies must be explicit and minimal — prefer loose coupling

#### Validate No Circular Dependencies

Before proceeding:
- Within a unit: ensure the `requires_bolts` graph is a DAG (no cycles)
- Across units: ensure no two units mutually depend on each other via `requires_units`

If circular dependencies are found, re-scope bolts to break the cycle before continuing.

### Step 5: Create Bolt Spec Files

For each bolt, create the directory and write the spec:

```
aidlc-docs/{workflowId}/construction/{parent_unit_id}/bolts/{bolt_id}/spec.md
```

Populate all frontmatter fields and all five required body sections. Do not leave template placeholders — fill every field from the unit artifacts.

**Requirement reference is mandatory**: Every bolt must reference at least one requirement ID. A bolt with no requirement reference is invalid.

### Step 6: Validate Coverage

After all bolts for each unit are written:

| Coverage | Result |
|----------|--------|
| >= 95% of unit acceptance criteria covered | Pass — proceed |
| 80-94% covered | Warning — user must explicitly acknowledge the gap |
| < 80% covered | Hard block — revise bolt decomposition before continuing |

Coverage is measured as: (unit acceptance criteria addressed by at least one bolt) / (total unit acceptance criteria).

Additionally: every `must`-priority requirement in `requirements.md` must be referenced by at least one bolt. Any uncovered `must` requirement is a hard block regardless of percentage score.

### Step 7: Validate Unit Independence

After all bolts for all units are planned, verify unit-level independence:

- **Single responsibility**: Each unit handles one bounded domain area
- **Clear interfaces**: Cross-unit interactions go through explicit interfaces (APIs, events, contracts)
- **No circular unit dependencies**: The `requires_units` graph across all bolts must be a DAG
- **Independent buildability**: Each unit can be developed and tested by a separate team without requiring internal access to other units' implementation details
- **Minimal cross-unit deps**: Cross-unit dependencies (`requires_units`) should be minimized; flag any unit that depends on 3 or more other units for review

If validation fails, surface the specific issue and require resolution before marking bolt-planning complete.

---

## Agent Delegation Strategy

**MANDATORY**: Delegate bolt spec file generation to `olympian`. Do NOT generate multi-bolt, multi-unit spec files directly.

**Execution mode**: Foreground sequential — one coherent bolt planning pass per workflow.

**Delegation scope**:
- **Orchestrator retains**: Steps 1-3 (unit review, story grouping, type assignment) and final validation (Steps 6-7). The orchestrator reads unit artifacts and produces the decomposition plan.
- **Delegated to `olympian`**: Steps 4-5 (dependency analysis and spec file creation). The agent writes the spec.md files to disk.

**After agent completes**: The orchestrator validates coverage and unit independence, then presents the completion message and approval gate.

**Optional quality gate — `momus` review**: When multiple units exist (3+) or cross-unit dependencies are present, optionally invoke `momus` to critically evaluate the bolt decomposition before presenting to the user.

---

## Completion Criteria

- All bolt specs created at `construction/{UNIT-NNN-slug}/bolts/{BOLT-NNN-slug}/spec.md`
- No `bolt-plan.md` summary document (specs ARE the plan)
- All five required sections present in every spec
- All frontmatter fields populated (no template placeholders)
- All `requires_bolts`, `enables_bolts`, `requires_units`, and `blocked` fields set
- Coverage >= 95% for all units (or gap acknowledged for 80-94%)
- All `must`-priority requirements referenced by at least one bolt
- No circular dependencies within or across units
- Unit independence validated

## Critical Rules

- **GLOBAL BOLT NUMBERING**: BOLT-NNN numbers are assigned globally across all units. Never reset per unit.
- **NESTED PATHS ONLY**: Bolt specs always live at `construction/{unit-id}/bolts/{bolt-id}/spec.md`. No flat `construction/bolts/` paths.
- **NO BOLT-PLAN.MD**: Do not create a bolt-plan.md summary. The spec files are the plan.
- **DEPENDENCY FIELDS ARE MANDATORY**: Every spec must include `requires_bolts`, `enables_bolts`, `requires_units`, and `blocked` in frontmatter — even if the values are empty arrays and `false`.
- **REQUIREMENT REFERENCE IS MANDATORY**: Every bolt must reference at least one FR-N requirement ID.
