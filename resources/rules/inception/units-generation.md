# Units Generation - Detailed Steps

## Overview
This stage decomposes the system into manageable units of work through two integrated parts:
- **Part 1 - Planning**: Create decomposition plan with questions, collect answers, analyze for ambiguities, get approval
- **Part 2 - Generation**: Execute approved plan to generate unit artifacts

**DEFINITION**: A unit of work is a logical grouping of stories for development purposes. For microservices, each unit becomes an independently deployable service. For monoliths, the single unit represents the entire application with logical modules.

**Terminology**: Use "Service" for independently deployable components, "Module" for logical groupings within a service, "Unit of Work" for planning context.

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

## Skip Pathway: Mandatory Unit Registration

When Workflow Planning (Step 3.3) determines that the full Units Generation stage should be **skipped**, a lightweight **Unit Registration** step MUST still execute. This ensures all units have `U-NNN` IDs and a unit registry exists — even when the full Q&A decomposition process is unnecessary.

The Unit Registration is defined in `workflow-planning.md` (Step 3.5) and executes as part of the Workflow Planning stage itself. It produces:
- `unit-of-work.md` (MANDATORY) — minimal unit definitions (ID, name, description, key deliverables)
- `unit-of-work-dependency.md` (CONDITIONAL) — only when units have actual blocking dependencies
- `unit-of-work-story-map.md` (CONDITIONAL) — only when stories exist and aren't already mapped to units elsewhere

All artifacts are placed in `aidlc-docs/{workflow-id}/inception/application-design/` and follow the **Unit Naming Convention** defined below.

When the full Units Generation stage executes (PART 1 + PART 2 below), these lightweight artifacts are not needed — the full process produces comprehensive versions instead.

## Prerequisites
- Context Assessment must be complete
- Requirements Assessment recommended (provides functional scope)
- Story Development recommended (stories map to units)
- Application Design recommended (determines components, methods, and services); not required when units are already well-defined in requirements
- Execution plan must indicate Units Generation stage should execute (if skipped, see Skip Pathway above)

## Agent Delegation Strategy

**MANDATORY**: Delegate unit artifact generation (Part 2) to `olympian`. Do NOT generate unit decomposition artifacts directly.

**Execution mode**: Foreground sequential — single coherent decomposition task per workflow.

**Delegation scope**:
- **Orchestrator retains**: Part 1 (Planning) — Steps 1-11. The orchestrator creates the decomposition plan, manages Q&A, resolves ambiguities, and obtains user approval.
- **Delegated to `olympian`**: Part 2 (Generation) — Steps 12-15. The agent executes the approved plan to produce unit-of-work.md, unit-of-work-dependency.md, and unit-of-work-story-map.md.

**If an agent task fails**: Follow the Agent Task Failure Recovery procedure in `error-handling.md` — retry the delegation, never silently do the work yourself.

**After agent completes**: The orchestrator reviews the generated artifacts, presents the completion message (Step 16), and manages the approval gate (Steps 17-19).

**Optional quality gate — `momus` review**:
Unit boundaries define the scope of all subsequent design and code generation work. After `olympian` generates the unit artifacts (Part 2), the orchestrator may optionally invoke `momus` to critically evaluate the decomposition before presenting it to the user. This is recommended when multiple units are defined or when unit boundaries involve complex dependencies. Momus evaluates against: unit independence, story coverage completeness, dependency validity, and absence of circular dependencies.

---

# PART 1: PLANNING

## Step 1: Create Unit of Work Plan
- Generate plan with checkboxes [] for decomposing system into units of work
- Focus on breaking down the system into manageable development units
- Each step and sub-step should have a checkbox []

## Step 2: Include Mandatory Unit Artifacts in Plan
**ALWAYS** include these mandatory artifacts in the unit plan (when executing the full stage — if the stage is skipped, the Skip Pathway above handles these):
- [ ] Generate `aidlc-docs/inception/application-design/unit-of-work.md` with unit definitions and responsibilities
- [ ] Generate `aidlc-docs/inception/application-design/unit-of-work-dependency.md` with dependency matrix
- [ ] Generate `aidlc-docs/inception/application-design/unit-of-work-story-map.md` mapping stories to units
- [ ] **Conditional** (complexity >= moderate AND units >= 3): Generate per-unit briefs in `aidlc-docs/inception/application-design/units/{unit-slug}/unit-brief.md`
- [ ] **Greenfield only**: Document code organization strategy in `unit-of-work.md` (see code-generation.md for structure patterns)
- [ ] Validate unit boundaries and dependencies
- [ ] Ensure all stories are assigned to units

## Step 3: Generate Context-Appropriate Questions
**DIRECTIVE**: Analyze the requirements, stories, and application design to generate ONLY questions relevant to THIS specific decomposition problem. Use the categories below as inspiration, NOT as a mandatory checklist. Skip entire categories if not applicable.

- EMBED questions using [Answer]: tag format
- Focus on ambiguities and missing information specific to this context
- Generate questions only where user input is needed for decision-making

**Example question categories** (adapt as needed):
- **Story Grouping** - Only if multiple stories exist and grouping strategy is unclear
- **Dependencies** - Only if multiple units likely and integration approach is ambiguous
- **Team Alignment** - Only if team structure or ownership is unclear
- **Technical Considerations** - Only if scalability/deployment requirements differ across units
- **Business Domain** - Only if domain boundaries or bounded contexts are unclear
- **Code Organization (Greenfield multi-unit only)** - Ask deployment model and directory structure preferences

## Step 4: Store UOW Plan
- Save as `aidlc-docs/inception/plans/unit-of-work-plan.md`
- Include all [Answer]: tags for user input
- Ensure plan covers all aspects of system decomposition

## Step 5: Request User Input
- Ask user to fill [Answer]: tags directly in the plan document
- Emphasize importance of decomposition decisions
- Provide clear instructions on completing the [Answer]: tags

## Step 6: Collect Answers
- Wait for user to provide answers to all questions using [Answer]: tags in the document
- Do not proceed until ALL [Answer]: tags are completed
- Review the document to ensure no [Answer]: tags are left blank

## Step 7: ANALYZE ANSWERS (MANDATORY)
Before proceeding, you MUST carefully review all user answers for:
- **Vague or ambiguous responses**: "mix of", "somewhere between", "not sure", "depends"
- **Undefined criteria or terms**: References to concepts without clear definitions
- **Contradictory answers**: Responses that conflict with each other
- **Missing generation details**: Answers that lack specific guidance
- **Answers that combine options**: Responses that merge different approaches without clear decision rules

## Step 8: MANDATORY Follow-up Questions
If the analysis in step 7 reveals ANY ambiguous answers, you MUST:
- Add specific follow-up questions to the plan document using [Answer]: tags
- DO NOT proceed to approval until all ambiguities are resolved
- Examples of required follow-ups:
  - "You mentioned 'mix of A and B' - what specific criteria should determine when to use A vs B?"
  - "You said 'somewhere between A and B' - can you define the exact middle ground approach?"
  - "You indicated 'not sure' - what additional information would help you decide?"
  - "You mentioned 'depends on complexity' - how do you define complexity levels?"

## Step 9: Request Approval
- Ask: "**Unit of work plan complete. Review the plan in aidlc-docs/inception/plans/unit-of-work-plan.md. Ready to proceed to generation?**"
- DO NOT PROCEED until user confirms

## Step 10: Log Approval
- Log prompt and response in audit.md with timestamp
- Use ISO 8601 timestamp format
- Include complete approval prompt text

## Step 11: MANDATORY: Update Progress
- **MANDATORY**: Update BOTH state files:
  1. Mark Units Planning complete in `aidlc-docs/{workflow-id}/aidlc-state.md`
  2. Update `aidlc-docs/{workflow-id}/checkpoint.json` current status
- **Do NOT proceed without completing state updates**

---

# PART 2: GENERATION

## Step 12: Load Unit of Work Plan
- [ ] Read the complete plan from `aidlc-docs/inception/plans/unit-of-work-plan.md`
- [ ] Identify the next uncompleted step (first [ ] checkbox)
- [ ] Load the context and requirements for that step

## Step 13: Execute Current Step
- [ ] Perform exactly what the current step describes
- [ ] Generate unit artifacts as specified in the plan
- [ ] Follow the approved decomposition approach from Planning
- [ ] Use the criteria and boundaries specified in the plan

## Step 14: MANDATORY: Update Progress
- [ ] Mark the completed step as [x] in the unit of work plan
- [ ] **MANDATORY**: Update `aidlc-docs/{workflow-id}/aidlc-state.md` current status
- [ ] **MANDATORY**: Update `aidlc-docs/{workflow-id}/checkpoint.json` current status
- [ ] Save all generated artifacts
- **Do NOT proceed without completing state updates**

## Step 14b: Generate Unit Briefs (CONDITIONAL)

**Condition**: Generate unit briefs when complexity is `moderate` or `complex` AND the decomposition produced 3 or more units. If the condition is not met, skip to Step 15.

For each unit defined in `unit-of-work.md`, create a per-unit brief file:

**Path**: `aidlc-docs/{workflowId}/inception/application-design/units/{unit-slug}/unit-brief.md`

Where `{unit-slug}` follows the existing convention (e.g., `UNIT-001-foundation`).

```markdown
---
unit: "U-NNN"
intent: "{workflow-id}"
complexity: "{S|M|L|XL}"
status: draft
created: "{ISO-8601}"
---

# Unit Brief: U-NNN — {Name}

## Purpose and Scope
{What this unit handles. Explicit boundary — what is IN vs OUT of this unit relative to other units.}

## Requirements Mapping
| Requirement | Description | Coverage |
|-------------|-------------|----------|
| FR-1 | {description} | Covered / Partial |

## Key Domain Entities
| Entity | Description | Owned by this unit? |
|--------|-------------|---------------------|
| {Entity} | {description} | Yes / Shared with U-NNN |

## Technical Context
{Tech stack, integration points, data storage, and APIs relevant to this unit.
Reference existing system components if brownfield.}

## Dependencies
- **Depends on**: {list units this unit requires to be built first, or "None"}
- **Depended on by**: {list units that require this unit, or "None"}

## Success Criteria
- [ ] {Verifiable outcome specific to this unit}
- [ ] {Verifiable outcome specific to this unit}
```

**Rules**:
- Unit briefs supplement, not replace, `unit-of-work.md` — the overview document remains the single index of all units
- Requirements Mapping must trace back to FRs in `requirements.md`
- Dependencies must be consistent with `unit-of-work-dependency.md`
- Keep briefs concise — detailed functional design happens in the Construction phase

## Step 15: Continue or Complete
- [ ] If more steps remain, return to Step 12
- [ ] If all steps complete, verify units are ready for design stages
- [ ] If unit briefs were generated (Step 14b), verify consistency across all briefs
- [ ] Mark Units Generation stage as complete

## Step 16: Present Completion Message

```markdown
# 🔧 Units Generation Complete

[AI-generated summary of units and decomposition created in bullet points]

---

⚠️ **REVIEW REQUIRED**

> Please examine the units generation artifacts at:
> `aidlc-docs/{workflow-id}/inception/application-design/`

**You may:**
- 🔧 **Request Changes** — Ask for modifications to the units generation if required
- ➕ **Add Skipped Stage** — Include a previously excluded stage in the workflow
- ✅ **Approve & Continue** — Approve units and proceed to **CONSTRUCTION PHASE**
```

## Step 17: Wait for Explicit Approval
- Do not proceed until the user explicitly approves the units generation
- Approval must be clear and unambiguous
- If user requests changes, update the units and repeat the approval process

## Step 18: Record Approval Response
- Log the user's approval response with timestamp in `aidlc-docs/audit.md`
- Include the exact user response text
- Mark the approval status clearly

## Step 19: MANDATORY: Update State Tracking
- **MANDATORY**: Update BOTH state files in the SAME interaction:
  1. Mark Units Generation stage complete in `aidlc-docs/{workflow-id}/aidlc-state.md`
  2. Update `aidlc-docs/{workflow-id}/checkpoint.json` — set units-generation status to "completed" with completed_at timestamp
- **Do NOT proceed to the next stage without completing this step**

---

## Critical Rules

### Planning Phase Rules
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

## Completion Criteria
- All planning questions answered and ambiguities resolved
- User approval obtained for the plan
- All steps in unit of work plan marked [x]
- All unit artifacts generated according to plan:
  - `unit-of-work.md` with unit definitions
  - `unit-of-work-dependency.md` with dependency matrix
  - `unit-of-work-story-map.md` with story mappings
- Units verified and ready for per-unit design stages
