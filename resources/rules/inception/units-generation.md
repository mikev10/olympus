# Units Generation - Detailed Steps

## Overview

This stage decomposes the system into manageable units of work through two integrated parts:
- **Part 1 - Planning**: Perform domain analysis, apply decomposition criteria, create decomposition plan with questions, collect answers, analyze for ambiguities, get approval
- **Part 2 - Generation**: Execute approved plan to generate unit artifacts following canonical templates

**Goal**: Produce a complete, traceable decomposition of all functional requirements into independent units of work, each with clear boundaries, ownership of specific requirements and stories, and sufficient detail for Bolt Planning to begin without re-reading the full requirements.

**DEFINITION**: A unit of work is a logical grouping of stories for development purposes. For microservices, each unit becomes an independently deployable service. For monoliths, the single unit represents the entire application with logical modules.

**Terminology**: Use "Service" for independently deployable components, "Module" for logical groupings within a service, "Unit of Work" for planning context.

---

## Input (Required Artifacts)

The following artifacts MUST be available before Units Generation begins. The agent must read each artifact to extract requirement IDs, story IDs, and design decisions.

| Artifact | Path | Required | Purpose |
|----------|------|----------|---------|
| Requirements | `inception/requirements/requirements.md` | YES | FR-N requirement IDs, priorities, and descriptions |
| User Stories | `inception/user-stories/stories.md` | CONDITIONAL | Story definitions with S-NNN IDs (if User Stories stage ran) |
| Application Design | `inception/application-design/` | CONDITIONAL | Component/service definitions (if Application Design ran) |
| Execution Plan | `inception/plans/execution-plan.md` | YES | Workflow routing and stage decisions |

**Hard block**: If `requirements.md` is missing or contains no FR-N requirement IDs, Units Generation cannot proceed. Abort and direct the user to complete Requirements Analysis first.

---

## Output

This stage produces the following artifacts in `aidlc-docs/{workflowId}/inception/units/`:

| Artifact | Path | Condition | Description |
|----------|------|-----------|-------------|
| Unit overview | `inception/units/unit-of-work.md` | ALWAYS | Unit definitions, requirement mapping, dependency graph |
| Dependency matrix | `inception/units/unit-of-work-dependency.md` | When 2+ units | Cross-unit dependency analysis |
| Story map | `inception/units/unit-of-work-story-map.md` | When stories exist | Story-to-unit assignment mapping |
| Per-unit briefs | `inception/units/{UNIT-NNN-slug}/unit-brief.md` | When 2+ units | Detailed per-unit brief for Bolt Planning |

### Canonical Templates

Agents MUST read and follow these template files exactly when creating artifacts:

- **Units overview**: `resources/templates/inception/units-template.md`
- **Unit briefs**: `resources/templates/inception/unit-brief-template.md`

> **CRITICAL**: Do NOT invent your own artifact format. Read the template files and follow their structure. The templates define all required frontmatter fields, required body sections, and expected content.

---

## Unit Naming Convention (MANDATORY)

All units of work MUST follow a consistent naming scheme:

- **Documentation headings**: Use `## U-NNN: Name` format
  - Example: `## U-001: Foundation`, `## U-002: API Layer`, `## U-003: Frontend`
  - Number is zero-padded to three digits (U-001, U-002, ... U-010, U-011)
- **Construction folder names**: Use `UNIT-NNN-name` kebab-case format
  - Example: `UNIT-001-foundation/`, `UNIT-002-api-layer/`, `UNIT-003-frontend/`
  - This format is automatically enforced by the TypeScript engine via `slugifyUnitName()`
- **AI-generated artifacts** (unit-of-work.md, unit-of-work-dependency.md, unit-of-work-story-map.md) MUST use `## U-NNN: Name` headings — not plain unit names

This convention ensures that construction artifacts are traceable to their inception units and that folder paths are consistent across all workflows.

---

## Skip Pathway: Mandatory Unit Registration

When Workflow Planning (Step 3.3) determines that the full Units Generation stage should be **skipped**, a lightweight **Unit Registration** step MUST still execute. This ensures all units have `U-NNN` IDs and a unit registry exists — even when the full Q&A decomposition process is unnecessary.

The Unit Registration is defined in `workflow-planning.md` (Step 3.5) and executes as part of the Workflow Planning stage itself. It produces:
- `unit-of-work.md` (MANDATORY) — minimal unit definitions (ID, name, description, key deliverables)
- `unit-of-work-dependency.md` (CONDITIONAL) — only when units have actual blocking dependencies
- `unit-of-work-story-map.md` (CONDITIONAL) — only when stories exist and aren't already mapped to units elsewhere

All artifacts are placed in `aidlc-docs/{workflow-id}/inception/units/` and follow the **Unit Naming Convention** defined above.

When the full Units Generation stage executes (PART 1 + PART 2 below), these lightweight artifacts are not needed — the full process produces comprehensive versions instead.

---

## Agent Delegation Strategy

**MANDATORY**: Delegate unit artifact generation (Part 2) to `olympian`. Do NOT generate unit decomposition artifacts directly.

**Execution mode**: Foreground sequential — single coherent decomposition task per workflow.

**Delegation scope**:
- **Orchestrator retains**: Part 1 (Planning) — Steps 1-14. The orchestrator performs domain analysis, applies decomposition criteria, creates the decomposition plan, manages Q&A, resolves ambiguities, and obtains user approval.
- **Delegated to `olympian`**: Part 2 (Generation) — Steps 15-18. The agent executes the approved plan to produce unit-of-work.md, unit-of-work-dependency.md, unit-of-work-story-map.md, and per-unit briefs.

**If an agent task fails**: Follow the Agent Task Failure Recovery procedure in `error-handling.md` — retry the delegation, never silently do the work yourself.

**After agent completes**: The orchestrator reviews the generated artifacts, presents the completion message (Step 19), and manages the approval gate (Steps 20-22).

**Optional quality gate — `momus` review**:
Unit boundaries define the scope of all subsequent design and code generation work. After `olympian` generates the unit artifacts (Part 2), the orchestrator may optionally invoke `momus` to critically evaluate the decomposition before presenting it to the user. This is recommended when multiple units are defined or when unit boundaries involve complex dependencies. Momus evaluates against: unit independence, story coverage completeness, dependency validity, and absence of circular dependencies.

---

# PART 1: PLANNING

## Step 1: Read Input Artifacts

- [ ] Read `inception/requirements/requirements.md` — extract all FR-N IDs, descriptions, and priorities
- [ ] Read `inception/user-stories/stories.md` (if exists) — extract all S-NNN IDs and titles
- [ ] Read `inception/application-design/` artifacts (if exist) — extract component/service definitions
- [ ] Verify `requirements.md` contains at least one FR-N requirement (hard block if missing)

## Step 2: Domain Analysis

Before generating questions or decomposing units, perform domain analysis on the input artifacts. This analysis informs the decomposition approach and ensures questions target real ambiguities rather than generic categories.

- [ ] **Identify bounded contexts**: Group related requirements by domain area (e.g., user management, billing, notifications). Look for natural seams where the language or concerns shift.
- [ ] **Identify aggregates and key entities**: From requirements and stories, list the core domain entities and which context they belong to. Note entities that appear in multiple contexts (shared kernel candidates).
- [ ] **Identify services and operations**: Map each FR to the operations it implies (CRUD, workflows, integrations, transformations). Group operations by the entity or context they primarily serve.
- [ ] **Identify integration points**: Determine where potential units would need to communicate — shared data, event flows, API calls, or file exchanges. These become the interfaces between units.
- [ ] **Document the analysis**: Record the domain analysis findings in the unit-of-work plan (Step 6) so the rationale is preserved.

## Step 3: Apply Decomposition Criteria

For each potential unit identified through domain analysis, verify these criteria BEFORE committing to the decomposition. A unit that fails any criterion must be restructured before proceeding.

- [ ] **Single Responsibility**: Does this unit do one thing well? It should handle one bounded domain area. A unit spanning multiple unrelated domains must be split.
- [ ] **Independence**: Can this unit be built and tested separately from other units? It should not require runtime access to another unit's unbuilt code.
- [ ] **Deployability**: Can this unit be deployed independently? (For monoliths: can it be a logically separate module with clear boundaries?)
- [ ] **Clear Interface**: Are inputs and outputs well-defined? Any cross-unit interaction must be expressible through an explicit interface (API contract, event schema, shared type definition).
- [ ] **Cohesion**: Do the requirements and stories assigned to this unit belong together? High cohesion means the unit's parts are closely related; low cohesion signals a need to split or reorganize.

## Step 4: Requirement-to-Unit Mapping (Draft)

Based on the domain analysis and decomposition criteria, create a draft mapping of every FR from `requirements.md` to a proposed unit.

**CRITICAL**: Each FR must be assigned to exactly one unit. This mapping is the contract for what each unit must deliver.

```text
| Requirement | Description | Priority | Proposed Unit |
|-------------|-------------|----------|---------------|
| FR-1 | ... | Must | U-001: {name} |
| FR-2 | ... | Should | U-001: {name} |
| FR-3 | ... | Must | U-002: {name} |
```

- [ ] Every FR in `requirements.md` appears in the mapping
- [ ] No FR is assigned to more than one unit
- [ ] No FR is unassigned (unassigned FRs = hard block)
- [ ] Must-priority FRs are distributed to ensure no single unit is overloaded

This draft mapping will be refined based on Q&A answers but serves as the baseline decomposition.

## Step 5: Generate Context-Appropriate Questions

**DIRECTIVE**: Analyze the requirements, stories, and application design to generate ONLY questions relevant to THIS specific decomposition problem. Use the categories below as inspiration, NOT as a mandatory checklist. Skip entire categories if not applicable.

- EMBED questions using [Answer]: tag format
- Focus on ambiguities and missing information specific to this context
- Generate questions only where user input is needed for decision-making
- Reference the domain analysis findings when framing questions

**Example question categories** (adapt as needed):
- **Story Grouping** - Only if multiple stories exist and grouping strategy is unclear
- **Dependencies** - Only if multiple units likely and integration approach is ambiguous
- **Team Alignment** - Only if team structure or ownership is unclear
- **Technical Considerations** - Only if scalability/deployment requirements differ across units
- **Business Domain** - Only if domain boundaries or bounded contexts are unclear
- **Code Organization (Greenfield multi-unit only)** - Ask deployment model and directory structure preferences
- **Decomposition Validation** - Questions to validate the draft requirement-to-unit mapping with the user

## Step 6: Store Unit of Work Plan

- Save as `aidlc-docs/inception/plans/unit-of-work-plan.md`
- Include the domain analysis findings (Step 2)
- Include the draft requirement-to-unit mapping (Step 4)
- Include all [Answer]: tags for user input
- Ensure plan covers all aspects of system decomposition

## Step 7: Include Mandatory Unit Artifacts in Plan

**ALWAYS** include these mandatory artifacts in the unit plan (when executing the full stage — if the stage is skipped, the Skip Pathway above handles these):
- [ ] Generate `aidlc-docs/inception/units/unit-of-work.md` with unit definitions and responsibilities — following `resources/templates/inception/units-template.md`
- [ ] Generate `aidlc-docs/inception/units/unit-of-work-dependency.md` with dependency matrix (when 2+ units)
- [ ] Generate `aidlc-docs/inception/units/unit-of-work-story-map.md` mapping stories to units (when stories exist)
- [ ] Generate per-unit briefs in `aidlc-docs/inception/units/{unit-slug}/unit-brief.md` (when 2+ units) — following `resources/templates/inception/unit-brief-template.md`
- [ ] **Greenfield only**: Document code organization strategy in `unit-of-work.md` (see code-generation.md for structure patterns)
- [ ] Validate unit boundaries and dependencies
- [ ] Ensure all requirements are assigned to units (100% coverage)
- [ ] Ensure all stories are assigned to units

## Step 8: Request User Input

- Ask user to fill [Answer]: tags directly in the plan document
- Emphasize importance of decomposition decisions
- Provide clear instructions on completing the [Answer]: tags

## Step 9: Collect Answers

- Wait for user to provide answers to all questions using [Answer]: tags in the document
- Do not proceed until ALL [Answer]: tags are completed
- Review the document to ensure no [Answer]: tags are left blank

## Step 10: ANALYZE ANSWERS (MANDATORY)

Before proceeding, you MUST carefully review all user answers for:
- **Vague or ambiguous responses**: "mix of", "somewhere between", "not sure", "depends"
- **Undefined criteria or terms**: References to concepts without clear definitions
- **Contradictory answers**: Responses that conflict with each other
- **Missing generation details**: Answers that lack specific guidance
- **Answers that combine options**: Responses that merge different approaches without clear decision rules
- **Conflicts with draft mapping**: Answers that invalidate the proposed requirement-to-unit mapping

## Step 11: MANDATORY Follow-up Questions

If the analysis in step 10 reveals ANY ambiguous answers, you MUST:
- Add specific follow-up questions to the plan document using [Answer]: tags
- DO NOT proceed to approval until all ambiguities are resolved
- Examples of required follow-ups:
  - "You mentioned 'mix of A and B' - what specific criteria should determine when to use A vs B?"
  - "You said 'somewhere between A and B' - can you define the exact middle ground approach?"
  - "You indicated 'not sure' - what additional information would help you decide?"
  - "You mentioned 'depends on complexity' - how do you define complexity levels?"

## Step 12: Finalize Requirement-to-Unit Mapping

After Q&A is complete, finalize the requirement-to-unit mapping based on user answers:

- [ ] Update the draft mapping with any changes from user feedback
- [ ] Verify 100% FR coverage — every FR in `requirements.md` is assigned to exactly one unit
- [ ] Verify 100% must-priority coverage — every Must FR is assigned
- [ ] If stories exist, verify every story is assigned to a unit
- [ ] Resolve any mapping conflicts surfaced during Q&A

**Hard block**: If any FR remains unassigned after Q&A, do not proceed to approval. Either assign it to an existing unit or create a new unit.

## Step 13: Request Approval

- Ask: "**Unit of work plan complete. Review the plan in aidlc-docs/inception/plans/unit-of-work-plan.md. Ready to proceed to generation?**"
- DO NOT PROCEED until user confirms

## Step 14: MANDATORY: Update Progress

- Log prompt and response in audit.md with timestamp (ISO 8601)
- Include complete approval prompt text
- **MANDATORY**: Update BOTH state files:
  1. Mark Units Planning complete in `aidlc-docs/{workflow-id}/aidlc-state.md`
  2. Update `aidlc-docs/{workflow-id}/checkpoint.json` current status
- **Do NOT proceed without completing state updates**

---

# PART 2: GENERATION

## Step 15: Load Unit of Work Plan

- [ ] Read the complete plan from `aidlc-docs/inception/plans/unit-of-work-plan.md`
- [ ] Read the canonical templates:
  - `resources/templates/inception/units-template.md`
  - `resources/templates/inception/unit-brief-template.md`
- [ ] Identify the next uncompleted step (first [ ] checkbox)
- [ ] Load the context and requirements for that step

## Step 16: Execute Current Step

- [ ] Perform exactly what the current step describes
- [ ] Generate unit artifacts as specified in the plan, following the canonical templates
- [ ] Follow the approved decomposition approach from Planning
- [ ] Use the criteria and boundaries specified in the plan
- [ ] Ensure the Requirement-to-Unit Mapping table is included in `unit-of-work.md`

## Step 17: MANDATORY: Update Progress

- [ ] Mark the completed step as [x] in the unit of work plan
- [ ] **MANDATORY**: Update `aidlc-docs/{workflow-id}/aidlc-state.md` current status
- [ ] **MANDATORY**: Update `aidlc-docs/{workflow-id}/checkpoint.json` current status
- [ ] Save all generated artifacts
- **Do NOT proceed without completing state updates**

## Step 18: Generate Unit Briefs

**Condition**: Generate unit briefs when the decomposition produces **2 or more units**. If only 1 unit exists, skip to Step 18b.

For each unit defined in `unit-of-work.md`, create a per-unit brief file following the canonical template at `resources/templates/inception/unit-brief-template.md`.

**Path**: `aidlc-docs/{workflowId}/inception/units/{unit-slug}/unit-brief.md`

Where `{unit-slug}` follows the naming convention (e.g., `UNIT-001-foundation`).

The agent MUST read the template file and produce a brief with ALL required sections:
- Frontmatter (unit, unit_slug, intent, complexity, status, created, updated)
- Purpose (one paragraph)
- Scope (In Scope AND Out of Scope)
- Assigned Requirements (table with FR IDs, descriptions, priorities)
- Domain Concepts (Key Entities and Key Operations tables)
- Story Summary and Stories Assigned
- Dependencies (Depends On, Depended On By, External Dependencies)
- Technical Context (Integration Points, Data Storage)
- Constraints
- Success Criteria (Functional, Non-Functional, Quality)
- Bolt Suggestions
- Notes

**Rules**:
- Unit briefs supplement, not replace, `unit-of-work.md` — the overview document remains the single index of all units
- Assigned Requirements must trace back to FRs in `requirements.md` and match the Requirement-to-Unit Mapping
- Dependencies must be consistent with `unit-of-work-dependency.md`
- Every story assigned to this unit must appear in the Stories Assigned table
- Keep domain-level detail appropriate — detailed functional design happens in the Construction phase

## Step 18b: Continue or Complete Generation

- [ ] If more plan steps remain, return to Step 15
- [ ] If all steps complete, verify units are ready for independence validation
- [ ] If unit briefs were generated (Step 18), verify consistency across all briefs
- [ ] Verify Requirement-to-Unit Mapping has 100% coverage

---

# INDEPENDENCE VALIDATION (HARD GATE)

## Step 18c: Unit Independence Validation

**This is a HARD GATE. No unit may proceed to Bolt Planning if it fails any independence criterion.**

Before marking Units Generation complete, verify EACH unit satisfies ALL five independence criteria:

| Criterion | Description | Failure Action |
|-----------|-------------|----------------|
| Single responsibility | The unit handles one bounded domain area. A unit spanning multiple unrelated domains must be split. | Split the unit |
| Clear interfaces | Any cross-unit interaction is expressed through an explicit interface (API contract, event schema, shared type definition). Units must not access each other's internal implementation. | Define explicit interfaces |
| No circular dependencies | The dependency matrix in `unit-of-work-dependency.md` must be a DAG (directed acyclic graph). Circular dependencies are a hard block. | Restructure dependencies |
| Independent buildability | Each unit can be developed and tested by a separate team without requiring runtime access to another unit's unbuilt code. | Decouple the unit |
| Explicit cross-unit deps | Every dependency a unit has on another unit must be documented in `unit-of-work-dependency.md`. Undocumented implicit dependencies are not allowed. | Document or remove dependency |

Validation results:

```text
| Unit | Single Resp | Clear Interfaces | No Circular Deps | Independent Build | Explicit Deps | PASS? |
|------|-------------|------------------|-------------------|-------------------|---------------|-------|
| U-001 | Yes/No | Yes/No | Yes/No | Yes/No | Yes/No | Yes/No |
| U-002 | Yes/No | Yes/No | Yes/No | Yes/No | Yes/No | Yes/No |
```

- If ANY unit fails ANY criterion: revise the decomposition and re-validate. Do NOT proceed.
- If ALL units pass ALL criteria: proceed to the completion message.

---

## Step 19: Present Completion Message

```markdown
# Units Generation Complete

[AI-generated summary of units and decomposition approach]

## Units Created
- U-001: {name} — {n} stories, {n} requirements, complexity: {S/M/L/XL}
- U-002: {name} — {n} stories, {n} requirements, complexity: {S/M/L/XL}

## Dependency Graph
[U-001: {name}] --> [U-002: {name}] --> [U-003: {name}]

## Requirement Coverage
- FR assigned: {n}/{total} (must be 100%)
- Must-priority covered: {n}/{n}
- Story coverage: {n}/{total}

## Independence Validation
All units passed 5/5 independence criteria.

## Artifacts Created
- inception/units/unit-of-work.md
- inception/units/unit-of-work-dependency.md
- inception/units/unit-of-work-story-map.md
- inception/units/UNIT-001-{slug}/unit-brief.md
- inception/units/UNIT-002-{slug}/unit-brief.md

---

**REVIEW REQUIRED**

> Please examine the units generation artifacts at:
> `aidlc-docs/{workflow-id}/inception/units/`

**You may:**
- **Request Changes** — Ask for modifications to the units generation if required
- **Approve & Continue** — Approve units and proceed to **CONSTRUCTION PHASE**
```

## Step 20: Wait for Explicit Approval

- Do not proceed until the user explicitly approves the units generation
- Approval must be clear and unambiguous
- If user requests changes, update the units and repeat the approval process (including independence validation)

## Step 21: Record Approval Response

- Log the user's approval response with timestamp in `aidlc-docs/audit.md`
- Include the exact user response text
- Mark the approval status clearly

## Step 22: MANDATORY: Update State Tracking

- **MANDATORY**: Update BOTH state files in the SAME interaction:
  1. Mark Units Generation stage complete in `aidlc-docs/{workflow-id}/aidlc-state.md`
  2. Update `aidlc-docs/{workflow-id}/checkpoint.json` — set units-generation status to "completed" with completed_at timestamp
- **Do NOT proceed to the next stage without completing this step**

---

## Completion Summary Format

After approval, present the final summary in this structured format:

```text
## Units Generation Complete

### Units Created
- U-001: {name} — {n} stories, {n} requirements, complexity: {S/M/L/XL}
- U-002: {name} — {n} stories, {n} requirements, complexity: {S/M/L/XL}

### Dependency Graph
[U-001] --> [U-002] --> [U-003]

### Requirement Coverage
- FR assigned: {n}/{total} (100%)
- Must-priority covered: {n}/{n}

### Artifacts Created
inception/units/unit-of-work.md
inception/units/unit-of-work-dependency.md
inception/units/unit-of-work-story-map.md
inception/units/UNIT-001-{slug}/unit-brief.md
inception/units/UNIT-002-{slug}/unit-brief.md
```

---

## Test Contract

```yaml
input: Requirements (FR-N IDs), stories (S-N IDs), application design (if available)
output: unit-of-work.md, unit-of-work-dependency.md, unit-of-work-story-map.md, per-unit briefs
constraints:
  requirement_coverage: 100% (every FR assigned to a unit)
  must_requirement_coverage: 100%
  unit_independence: all 5 criteria must pass
  no_circular_dependencies: true
  unit_brief_threshold: 2+ units (always generate briefs when 2 or more units exist)
checkpoints: 0 (part of inception review gate)
```

---

## Critical Rules

### Requirement Mapping Rules
- **REQUIREMENT MAPPING IS MANDATORY**: Every FR from `requirements.md` must be assigned to exactly one unit. Unassigned FRs are a hard block — generation cannot proceed.
- **Must-priority 100% coverage**: Every FR with `Must` priority must be assigned. No exceptions.
- **No duplicate assignment**: Each FR belongs to exactly one unit. If a requirement spans multiple units, decompose the requirement or assign to the unit with primary ownership.

### Template Rules
- **TEMPLATES ARE MANDATORY**: Agents MUST read and follow the canonical templates at `resources/templates/inception/units-template.md` and `resources/templates/inception/unit-brief-template.md`. Do NOT invent custom formats.
- **All required sections**: Every section defined in the template must appear in the generated artifact. Missing sections are a rejection.

### Unit Brief Rules
- **UNIT BRIEFS ALWAYS FOR 2+ UNITS**: Generate per-unit briefs whenever 2 or more units exist. This is NOT conditional on complexity — if there are 2+ units, briefs are mandatory.
- **Brief completeness**: Each brief must contain ALL sections defined in the template (Purpose, Scope, Assigned Requirements, Domain Concepts, Story Summary, Dependencies, Technical Context, Constraints, Success Criteria, Bolt Suggestions, Notes).

### Process Rules
- **DECOMPOSITION BEFORE Q&A**: Domain analysis (Step 2) and decomposition criteria (Step 3) must be applied before generating questions (Step 5). Questions should be informed by the analysis, not generic.
- **INDEPENDENCE IS A HARD GATE**: A unit that fails any independence criterion in Step 18c cannot proceed. This is not advisory — it is a blocking validation.
- Generate ONLY context-relevant questions
- Use [Answer]: tag format for all questions
- Analyze all answers for ambiguities before proceeding
- Resolve ALL ambiguities with follow-up questions
- Get explicit user approval before generation

### Generation Phase Rules
- **NO HARDCODED LOGIC**: Only execute what's written in the unit of work plan
- **FOLLOW PLAN EXACTLY**: Do not deviate from the step sequence
- **UPDATE CHECKBOXES**: Mark [x] immediately after completing each step
- **USE APPROVED APPROACH**: Follow the decomposition methodology from Planning
- **VERIFY COMPLETION**: Ensure all unit artifacts are complete before proceeding

---

## Completion Criteria

- All planning questions answered and ambiguities resolved
- User approval obtained for the plan
- All steps in unit of work plan marked [x]
- All unit artifacts generated according to plan and canonical templates:
  - `unit-of-work.md` with unit definitions and Requirement-to-Unit Mapping
  - `unit-of-work-dependency.md` with dependency matrix (when 2+ units)
  - `unit-of-work-story-map.md` with story mappings (when stories exist)
  - Per-unit briefs (when 2+ units)
- 100% requirement coverage (every FR assigned to a unit)
- 100% must-priority coverage
- All units pass independence validation (5/5 criteria)
- Units verified and ready for bolt planning

---

## Next Stage: Bolt Planning

After units are approved, the workflow proceeds to **Bolt Planning** — a separate inception stage that decomposes each unit's stories into bolt spec files. Bolt creation does NOT happen during Units Generation. The `unit-of-work.md` artifacts and per-unit briefs produced here are the primary inputs to bolt planning.
