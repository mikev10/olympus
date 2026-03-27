# Bolt Planning - Inception Stage

## Overview

Bolt Planning is the final inception stage. It decomposes each unit of work into **bolts** — scoped execution packages that a code-generation agent can implement in a focused session. The goal is to produce human-reviewable bolt specs alongside requirements, stories, and unit definitions so that construction starts with pre-planned, dependency-ordered bolts rather than ad-hoc decomposition.

**When this stage runs**: After Units Generation completes and all unit stories are defined.

**When this stage is skipped**: Single shallow unit with `depth_score <= 4` AND pathway is not `bugfix`. Set `inception_stages["bolt-planning"].status = "skipped"` with an appropriate skip reason.

---

## Input (Required Artifacts)

Before bolt planning can begin, ALL of the following must exist and be loaded:

| Artifact | Location | Purpose |
|----------|----------|---------|
| **Unit definitions** | `inception/units/unit-of-work.md` | Unit IDs, titles, acceptance criteria |
| **Unit briefs** | `inception/units/{unit-slug}/unit-brief.md` | Detailed scope per unit |
| **Story-to-unit map** | `inception/units/unit-of-work-story-map.md` | Which stories belong to which unit |
| **Stories** | `inception/user-stories/stories.md` | Full story definitions with IDs and priorities |
| **Requirements** | `inception/requirements/requirements.md` | FR-N requirement IDs and priorities |

All paths are relative to `aidlc-docs/{workflowId}/`.

> **CRITICAL**: Do NOT begin bolt planning if any required artifact is missing. Surface the gap to the user and halt.

---

## Output (What This Stage Produces)

```
aidlc-docs/{workflowId}/construction/{UNIT-NNN-slug}/bolts/
  BOLT-001-{slug}/spec.md
  BOLT-002-{slug}/spec.md
  BOLT-003-{slug}/spec.md
```

> **WARNING**: DO NOT CREATE:
> - `bolt-plan.md` (summary doc) -- the individual `spec.md` files ARE the plan
> - `README.md` files in bolt directories
> - Flat files like `BOLT-001.md` (must be in a directory as `spec.md`)
> - Flat `construction/bolts/` paths (bolts MUST be nested under their parent unit)

---

## Test Contract

```yaml
input: Units with assigned stories from inception
output: Bolt spec.md files nested under construction/{unit}/bolts/{bolt}/
constraints:
  max_per_unit: 8
  max_total: 50
  coverage_threshold: 95%
  must_requirements: 100%
checkpoints: 0 (part of inception review gate)
```

---

## Bolt Naming Convention (MANDATORY)

Bolt IDs use **global sequential numbering across ALL units** -- numbering does NOT reset per unit.

Format: `BOLT-NNN-slug`

- `NNN` is zero-padded to three digits: `001`, `002`, `003`, ...
- `slug` is a short kebab-case description of the bolt's scope (lowercase, alphanumeric + hyphens only)
- Numbers are assigned in creation order across all units
- The regex pattern enforced by the TypeScript validator is: `^BOLT-\d{3}-[a-z0-9-]+$`

Examples:

```
BOLT-001-data-model        (Unit 1, bolt 1)
BOLT-002-repository-layer  (Unit 1, bolt 2)
BOLT-003-api-endpoints     (Unit 1, bolt 3)
BOLT-004-dashboard-ui      (Unit 2, bolt 1 -- numbering continues globally)
```

> **CRITICAL**: Never reset numbering per unit. Bolt 4 in unit 2 is `BOLT-004`, not `BOLT-001`.

---

## Directory Structure

Bolt specs are nested under their parent unit:

```
aidlc-docs/{workflowId}/construction/{UNIT-NNN-slug}/bolts/
  BOLT-001-{slug}/spec.md
  BOLT-002-{slug}/spec.md
  BOLT-003-{slug}/spec.md
```

Full path examples:

```
aidlc-docs/{workflowId}/construction/UNIT-001-foundation/bolts/BOLT-001-data-model/spec.md
aidlc-docs/{workflowId}/construction/UNIT-001-foundation/bolts/BOLT-002-repository-layer/spec.md
aidlc-docs/{workflowId}/construction/UNIT-002-frontend/bolts/BOLT-003-dashboard-ui/spec.md
```

---

## Process (Strict Sequential Steps)

### Step 1: Load and Validate Inputs

For each unit defined in `inception/units/unit-of-work.md`:

1. Read the unit definition (ID, title, acceptance criteria, estimated effort)
2. Read the unit brief at `inception/units/{unit-slug}/unit-brief.md`
3. Read the assigned stories from `inception/units/unit-of-work-story-map.md`
4. Resolve each story's full definition from `inception/user-stories/stories.md`
5. Resolve each story's requirement references from `inception/requirements/requirements.md`
6. Confirm every story has an ID (`S-NNN`), a priority (`Must`, `Should`, `Could`), and at least one requirement reference (`FR-N`)

> **HARD BLOCK**: If any unit has zero assigned stories, halt and surface the issue. Every unit must have at least one story assigned.

### Step 2: Assess Story Complexity (4-Factor Analysis)

For **each story** in every unit, assess complexity using all four factors:

| Factor | Question | Low (1) | Medium (2) | High (3) |
|--------|----------|---------|------------|----------|
| **Complexity** | How intricate is the logic? | CRUD, known patterns | Business rules, validation | Novel algorithms, state machines |
| **Uncertainty** | How clear are requirements? | Fully specified | Some ambiguity | Many unknowns |
| **Dependencies** | What external things needed? | Self-contained | Internal APIs/units | External systems, third-party |
| **Testing** | What validation needed? | Unit tests only | Integration tests | E2E + manual testing |

Record the 4-factor scores for each story. These scores drive grouping decisions in Step 3.

> **WARNING**: Any story with Uncertainty = High (3) MUST be flagged. Consider creating a **spike bolt** to reduce uncertainty before the implementation bolt.

### Step 3: Group Stories into Bolts

For each unit, group its stories into cohesive bolts using these **explicit rules** (in priority order):

1. **Cohesion**: Stories operating on the same domain entity or bounded context belong in the same bolt
2. **Dependencies**: If Story A requires Story B's output, they go in the same bolt OR Story B's bolt must be sequenced before Story A's bolt
3. **Balance**: Mix high-complexity and low-complexity stories within a bolt to avoid creating "monster bolts"
4. **Limit**: Target 5-6 stories per bolt. Hard maximum is 8 stories per bolt (enforced by TypeScript validator: `MAX_BOLTS_PER_UNIT = 8` bolts per unit)
5. **Risk**: Any story with Uncertainty = High (3) goes into a dedicated spike bolt that is sequenced FIRST

**Grouping by architectural layer** (typical ordering within a unit):

| Layer | Scope | Typical Bolt Slug |
|-------|-------|-------------------|
| Data models and schema migrations | Entity definitions, DB schema | `data-model` |
| Repository / data access layer | CRUD operations, queries | `repo-layer` |
| Business logic / service layer | Domain rules, validation | `service-layer` |
| API endpoints | Controllers, routes, DTOs | `api-endpoints` |
| UI components | Screens, forms, interactions | `ui-components` |
| Infrastructure | Auth, logging, config, middleware | `infrastructure` |

> **HARD CONSTRAINT**: Maximum **8 bolts per unit**, **50 bolts total** across all units. If a unit's scope exceeds 8 bolts, halt and flag it for re-scoping before proceeding.

### Step 4: Assign Express Mode

For each bolt, determine whether express mode applies:

- `express_mode: true` if `depth_target <= 4` OR the parent workflow pathway is `bugfix`
- Express bolts skip the elaboration stage during construction and go directly to code generation
- All bolts within a given depth/pathway context receive the same express mode value

The express mode determination is handled programmatically by `isExpressBoltEligible()` in `express-bolt-factory.ts`.

### Step 5: Analyze Dependencies (3-Level Analysis)

Dependency analysis operates at three distinct levels. All three MUST be performed.

#### 5a. Story Dependencies (within a bolt)

Within each bolt, identify ordering constraints between stories:

- If Story A's implementation depends on Story B's artifacts, Story B must appear first in the bolt's story list
- Document internal story ordering in the bolt's Scope section

#### 5b. Bolt Dependencies (within a unit)

For each unit, identify which bolts must complete before others can begin:

- Populate `requires_bolts`: array of bolt IDs this bolt depends on
- Populate `enables_bolts`: array of bolt IDs that depend on this bolt (reverse, informational)
- Typical ordering: data model -> repository -> service -> API -> UI

Output format for each bolt's dependency analysis:

```markdown
#### Bolt Dependencies (within unit)
- **BOLT-001-data-model** (Required): Planned
- **BOLT-002-repo-layer** (Required): Planned
#### Enables (bolts waiting on this)
- BOLT-004-api-endpoints
```

#### 5c. Unit Dependencies (cross-unit)

Identify whether any bolt requires work from a different unit:

- Populate `requires_units` with unit IDs (e.g., `["UNIT-001-foundation"]`)
- Cross-unit dependencies MUST be explicit and minimal -- prefer loose coupling
- Flag any unit that depends on 3 or more other units for mandatory review

Output format:

```markdown
#### Unit Dependencies (cross-unit)
- **UNIT-001-foundation** (Required): Database schemas must exist
```

#### Dependency Warnings

After completing all three levels, output a warnings section:

```markdown
### Dependency Warnings
- BOLT-003-api-endpoints depends on 3 bolts (high fan-in -- consider splitting)
- UNIT-002-frontend has cross-unit dependency on UNIT-001-foundation (verify interface contract exists)
- No circular dependencies detected
```

#### Validate No Circular Dependencies

Before proceeding to spec creation:

- **Within a unit**: Ensure the `requires_bolts` graph is a DAG (no cycles). The TypeScript validator `BoltSpecValidator.validateNoCycles()` enforces this.
- **Across units**: Ensure no two units mutually depend on each other via `requires_units`
- If circular dependencies are found, **halt and re-scope bolts to break the cycle before continuing**

### Step 6: Generate Bolt Sequence Visualization

Before creating specs, produce an ASCII dependency graph showing bolt execution order:

```
[BOLT-001-data-model] --> [BOLT-002-repo-layer] --> [BOLT-003-service-layer]
                                                          |
                                                          v
                          [BOLT-004-api-endpoints] --> [BOLT-005-ui-components]
```

For multi-unit workflows, show unit boundaries:

```
UNIT-001-foundation:
  [BOLT-001-data-model] --> [BOLT-002-repo-layer] --> [BOLT-003-api]

UNIT-002-frontend:
  [BOLT-004-dashboard] --> [BOLT-005-settings]
       |
       +-- requires UNIT-001-foundation
```

Present this visualization to the user before proceeding to spec file creation.

### Step 7: Create Bolt Spec Files

For each bolt, create the directory and write the spec file:

```
aidlc-docs/{workflowId}/construction/{parent_unit_id}/bolts/{bolt_id}/spec.md
```

Populate ALL frontmatter fields and ALL required body sections. Do NOT leave template placeholders -- fill every field from the unit artifacts.

See the **Bolt Spec Format** section below for the complete template.

### Step 8: Validate Frontmatter (Per-Bolt Checklist)

For EACH bolt spec created, verify the following checklist. Every item MUST pass:

- [ ] `id` -- present, matches `BOLT-NNN-slug` format (`^BOLT-\d{3}-[a-z0-9-]+$`)
- [ ] `title` -- present, non-empty string
- [ ] `parent_unit_id` -- present, matches an existing unit ID
- [ ] `sequence` -- positive integer (>= 1)
- [ ] `status` -- set to `planned`
- [ ] `created` -- ISO 8601 timestamp
- [ ] `intent` -- set to the workflow ID
- [ ] `depth_target` -- number on 1-11 scale
- [ ] `express_mode` -- boolean, correctly derived from depth_target/pathway
- [ ] `estimated_effort_hours` -- positive number
- [ ] `requirements` -- array with at least one FR-N ID
- [ ] `stories` -- array of story IDs (in both frontmatter AND body)
- [ ] `docs_impact` -- array of valid values (see Frontmatter Field Reference)
- [ ] `requires_bolts` -- array present (can be empty `[]`)
- [ ] `enables_bolts` -- array present (can be empty `[]`)
- [ ] `requires_units` -- array present (can be empty `[]`)
- [ ] `blocked` -- boolean, set to `false` on creation
- [ ] `complexity` -- block with all 4 fields (`avg_complexity`, `avg_uncertainty`, `max_dependencies`, `testing_scope`)

> **CRITICAL**: A bolt that fails ANY frontmatter check is invalid. Fix it before proceeding.

### Step 9: Validate Coverage

After all bolts for each unit are written, validate story and requirement coverage:

#### Story Coverage

| Coverage | Result |
|----------|--------|
| >= 95% of unit stories assigned to bolts | **Pass** -- proceed |
| 80-94% covered | **Warning** -- user MUST explicitly acknowledge the gap before continuing |
| < 80% covered | **Hard block** -- revise bolt decomposition, do NOT continue |

Coverage formula: `(stories assigned to at least one bolt) / (total stories in unit) * 100`

#### Requirement Coverage

Every `Must`-priority requirement in `requirements.md` that is referenced by any story in the unit MUST be referenced by at least one bolt's `requirements` field. Any uncovered `Must` requirement is a **hard block** regardless of percentage score.

#### Content Validation Checklist

After coverage passes, verify these content-level constraints:

- [ ] All stories assigned to bolts (100% target, 95% minimum)
- [ ] All `Must`-priority requirements covered (100%, no exceptions)
- [ ] Dependencies respected (bolt-to-bolt AND unit-to-unit)
- [ ] Each bolt has clear Expected Outputs
- [ ] No bolt exceeds 8 stories (target 5-6)
- [ ] No circular dependencies (within-unit or cross-unit)
- [ ] Cross-unit dependencies are explicit and minimal
- [ ] Every bolt has at least one acceptance criterion
- [ ] Every bolt has at least one target file

### Step 10: Validate Unit Independence

After all bolts for all units are planned, verify unit-level independence:

- **Single responsibility**: Each unit handles one bounded domain area
- **Clear interfaces**: Cross-unit interactions go through explicit interfaces (APIs, events, contracts)
- **No circular unit dependencies**: The `requires_units` graph across all bolts must be a DAG
- **Independent buildability**: Each unit can be developed and tested by a separate agent without requiring internal access to other units' implementation details
- **Minimal cross-unit deps**: Flag any unit that depends on 3 or more other units for mandatory review

If validation fails, surface the specific issue and require resolution before marking bolt-planning complete.

### Step 11: Register Bolts in Checkpoint

After all validations pass, register bolts in the workflow checkpoint:

- Call `registerBoltsInCheckpoint(bolts, checkpoint)` for each unit's bolts
- This creates `ConstructionBoltProgress` entries with `status: 'planned'` and all four stage progress records initialized to `not_started`
- Update `inception_stages["bolt-planning"].status = "completed"`

---

## Bolt Spec Format

The canonical bolt spec template is defined at:

**Template file**: `resources/templates/construction/bolt-spec-template.md`

When creating bolt specs, agents MUST read this template file and follow its structure exactly. The template defines:

- All required frontmatter fields (including runtime state fields: `started`, `completed`, `current_stage`, `stages_completed`)
- All required body sections (Scope, Stories Included, Acceptance Criteria, Expected Outputs, Target Files, Stages, Dependencies, Success Criteria, Traceability)
- Status values and stage status symbols
- A concrete example of a bolt spec

> **CRITICAL**: Do NOT invent your own spec format. Read and follow the template.

### Frontmatter Field Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | YES | Globally unique bolt ID. Must match `BOLT-NNN-slug` pattern. |
| `title` | string | YES | Short human-readable title. |
| `parent_unit_id` | string | YES | ID of the parent construction unit (e.g., `UNIT-001-foundation`). |
| `sequence` | integer | YES | Execution order within the unit (1-based, positive). |
| `status` | string | YES | Always `planned` on creation. Lifecycle: `planned` -> `in_progress` -> `built` -> `in_review` -> `done` or `failed`. |
| `created` | string | YES | ISO 8601 timestamp of spec creation. |
| `intent` | string | YES | Parent workflow ID (matches `{workflowId}`). |
| `depth_target` | number | YES | Reasoning depth (1-11 scale). Express mode threshold: <= 4. |
| `express_mode` | boolean | YES | `true` if eligible for express execution (skips elaboration). Derived from `depth_target <= 4 OR pathway == 'bugfix'`. |
| `estimated_effort_hours` | number | YES | Rough hours estimate for human review. |
| `requirements` | string[] | YES | Requirement IDs from `requirements.md` this bolt satisfies (e.g., `["FR-1", "FR-3"]`). **Minimum 1 required.** |
| `stories` | string[] | YES | Story IDs from `stories.md` this bolt addresses (e.g., `["S-001"]`). |
| `docs_impact` | string[] | YES | Documentation types this bolt impacts. Valid values: `none`, `readme`, `user-guide`, `config-reference`, `cli-reference`, `migration-guide`, `architecture`, `code-comments`. |
| `requires_bolts` | string[] | YES | Bolt IDs that must complete before this bolt begins (within-unit). Empty array `[]` if none. |
| `enables_bolts` | string[] | YES | Bolt IDs that depend on this bolt completing (reverse deps, informational). Empty array `[]` if none. |
| `requires_units` | string[] | YES | Unit IDs that must be fully built before this bolt begins (cross-unit). Empty array `[]` if none. |
| `blocked` | boolean | YES | Always `false` on creation. Set to `true` by executor when a dependency is incomplete. |
| `started` | string/null | YES | ISO 8601 timestamp when execution began. `null` on creation. |
| `completed` | string/null | YES | ISO 8601 timestamp when all stages finished. `null` on creation. |
| `current_stage` | string/null | YES | Currently executing stage. `null` on creation. |
| `stages_completed` | array | YES | Array of completed stage records. Empty `[]` on creation. |
| `complexity` | object | YES | 4-factor complexity assessment block (see below). |

#### Complexity Block Fields

| Field | Type | Range | Description |
|-------|------|-------|-------------|
| `avg_complexity` | number | 1-3 | Average complexity score across stories. 1=Low (CRUD), 2=Medium (business rules), 3=High (novel algorithms). |
| `avg_uncertainty` | number | 1-3 | Average uncertainty score. 1=Fully specified, 2=Some ambiguity, 3=Many unknowns. |
| `max_dependencies` | number | 1-3 | Highest dependency score among stories. 1=Self-contained, 2=Internal APIs, 3=External systems. |
| `testing_scope` | number | 1-3 | Required testing depth. 1=Unit tests, 2=Integration tests, 3=E2E + manual. |

### Required Body Sections

Every bolt spec MUST contain ALL of the following sections. No section may be omitted.

```markdown
# {Bolt Title}

## Scope

{What this bolt implements. A focused description of the functionality delivered
by this bolt alone. Include internal story ordering if relevant.}

## Stories Included

- [ ] **S-001**: User can register -- Priority: Must
- [ ] **S-002**: User can login -- Priority: Must

## Acceptance Criteria

- [ ] {Measurable, verifiable criterion 1}
- [ ] {Measurable, verifiable criterion 2}

## Expected Outputs

- User entity and migration
- Registration API endpoint
- Unit tests for registration flow

## Target Files

- `src/models/user.ts` -- create: User entity definition
- `src/services/auth.ts` -- create: Authentication service
- `src/routes/auth.ts` -- create: Auth API routes

## Dependencies

### Bolt Dependencies (within unit)
- **BOLT-001-data-model** (Required): Planned

### Unit Dependencies (cross-unit)
- None

### Enables (bolts waiting on this)
- BOLT-003-api-endpoints

## Stages

- [ ] **1. elaboration**: Pending
- [ ] **2. code_generation**: Pending
- [ ] **3. build_and_test**: Pending
- [ ] **4. review**: Pending

## Success Criteria

- [ ] All stories implemented
- [ ] All acceptance criteria met
- [ ] Tests passing
- [ ] Code reviewed and approved

## Traceability

- **Requirements**: FR-1, FR-2
- **Stories**: S-001, S-002
```

> **CRITICAL**: The body must use checkbox syntax (`- [ ]`) for Stories Included, Acceptance Criteria, Stages, and Success Criteria. These checkboxes are tracked during construction execution.

---

## Critical Rules

> **WARNING**: Violation of any rule in this section produces an invalid bolt plan. The agent MUST NOT proceed past validation if any rule is broken.

### Naming and Structure

- **GLOBAL BOLT NUMBERING**: `BOLT-NNN` numbers are assigned globally across all units. Never reset per unit.
- **NESTED PATHS ONLY**: Bolt specs always live at `construction/{unit-id}/bolts/{bolt-id}/spec.md`. No flat `construction/bolts/` paths.
- **NO BOLT-PLAN.MD**: Do not create a `bolt-plan.md` summary document. The individual `spec.md` files ARE the plan.
- **NO README FILES**: Do not create `README.md` in bolt directories.

### Frontmatter Integrity

- **ALL FIELDS MANDATORY**: Every frontmatter field listed in the Field Reference must be present with a valid value. No template placeholders.
- **DEPENDENCY FIELDS ARE MANDATORY**: Every spec must include `requires_bolts`, `enables_bolts`, `requires_units`, and `blocked` in frontmatter -- even if the values are empty arrays and `false`.
- **REQUIREMENT REFERENCE IS MANDATORY**: Every bolt must reference at least one `FR-N` requirement ID. A bolt with an empty `requirements` array is invalid.
- **STATUS ALWAYS PLANNED**: On creation, `status` must be `planned`. Never set to `in_progress` or any other value during bolt planning.
- **COMPLEXITY BLOCK MANDATORY**: Every bolt must include the 4-field `complexity` block derived from Step 2 analysis.

### Coverage and Completeness

- **95% STORY COVERAGE MINIMUM**: At least 95% of unit stories must be assigned to bolts. Below 80% is a hard block.
- **100% MUST-REQUIREMENT COVERAGE**: Every `Must`-priority requirement must appear in at least one bolt. No exceptions.
- **NO ORPHAN STORIES**: Every story in the unit should appear in exactly one bolt. Duplicate assignment across bolts is acceptable only when justified (shared infrastructure stories).

### Dependency Safety

- **NO SELF-REFERENCES**: A bolt cannot list itself in `requires_bolts`.
- **NO PARENT UNIT REFERENCES**: A bolt cannot list its own parent unit in `requires_units`.
- **NO CIRCULAR DEPENDENCIES**: The dependency graph must be a DAG at both bolt and unit levels. Enforced by `BoltSpecValidator.validateNoCycles()`.
- **CROSS-UNIT MINIMIZATION**: Flag any unit with 3+ cross-unit dependencies for mandatory review.

### Size Constraints

- **MAX 8 BOLTS PER UNIT**: Enforced by `BoltSpecValidator` (`MAX_BOLTS_PER_UNIT = 8`). Target 5-6.
- **MAX 50 BOLTS TOTAL**: Enforced by `BoltSpecValidator` (`MAX_BOLTS_TOTAL = 50`).
- **TARGET 5-6 STORIES PER BOLT**: Hard maximum 8 stories. If a bolt exceeds 6 stories, provide written justification.

---

## Agent Delegation Strategy

**MANDATORY**: Delegate bolt spec file generation to `olympian`. Do NOT generate multi-bolt, multi-unit spec files directly from the orchestrator.

**Execution mode**: Foreground sequential -- one coherent bolt planning pass per workflow.

**Delegation scope**:

| Steps | Owner | Rationale |
|-------|-------|-----------|
| 1-3 (Load inputs, assess complexity, group stories) | **Orchestrator** | Requires reading multiple artifacts and making decomposition decisions |
| 4-7 (Express mode, dependency analysis, visualization, spec creation) | **Delegated to `olympian`** | Writes spec.md files to disk, performs dependency analysis |
| 8-11 (Frontmatter validation, coverage, unit independence, checkpoint) | **Orchestrator** | Final validation gates and checkpoint registration |

**After agent completes**: The orchestrator validates coverage and unit independence (Steps 8-11), then presents the completion summary and approval gate.

**Optional quality gate -- `momus` review**: When multiple units exist (3+) or cross-unit dependencies are present, invoke `momus` to critically evaluate the bolt decomposition before presenting to the user.

---

## Completion Summary Format

After all validation passes, present the following summary to the user:

```markdown
## Bolt Plan Complete: {unit-name}

### Bolts Created
- [ ] **BOLT-001-data-model** (express: false): S-001, S-002
- [ ] **BOLT-002-repo-layer** (express: false): S-003, S-004

### Dependency Graph
BOLT-001-data-model --> BOLT-002-repo-layer --> BOLT-003-api

### Directories Created
  `construction/UNIT-001-foundation/bolts/BOLT-001-data-model/spec.md`
  `construction/UNIT-001-foundation/bolts/BOLT-002-repo-layer/spec.md`

### Coverage
- Stories covered: 6/6 (100%)
- Requirements covered: FR-1, FR-2, FR-3 (3/3)
- Must-requirements covered: 3/3 (100%)

### Complexity Summary
- Average complexity across all bolts: 2.1
- Highest uncertainty bolt: BOLT-003-api (avg_uncertainty: 2)
- Spike bolts: 0

### Total
- {n} bolts created
- {n} stories covered
- {n} cross-unit dependencies
- {n} express bolts
```

---

## Completion Criteria

ALL of the following must be true before bolt planning is marked complete:

- [ ] All bolt specs created at `construction/{UNIT-NNN-slug}/bolts/{BOLT-NNN-slug}/spec.md`
- [ ] No `bolt-plan.md` summary document created (specs ARE the plan)
- [ ] All required body sections present in every spec (Scope, Stories Included, Acceptance Criteria, Expected Outputs, Target Files, Stages, Dependencies, Success Criteria, Traceability)
- [ ] All frontmatter fields populated with valid values (no template placeholders)
- [ ] Frontmatter validation checklist (Step 8) passes for every bolt
- [ ] `status: planned` set on every bolt
- [ ] `created` timestamp set on every bolt
- [ ] `intent` set to workflow ID on every bolt
- [ ] `complexity` block with all 4 fields present on every bolt
- [ ] All `requires_bolts`, `enables_bolts`, `requires_units`, and `blocked` fields set
- [ ] Story coverage >= 95% for all units (or gap explicitly acknowledged for 80-94%)
- [ ] All `Must`-priority requirements referenced by at least one bolt (100%, no exceptions)
- [ ] No circular dependencies within or across units
- [ ] Unit independence validated
- [ ] Bolts registered in checkpoint via `registerBoltsInCheckpoint()`
- [ ] `inception_stages["bolt-planning"].status` set to `"completed"`
- [ ] Completion summary presented to user
- [ ] User has approved the bolt plan before proceeding to construction
