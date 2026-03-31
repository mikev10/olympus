# Bolt Planning - Decomposing Units into Bolts

## Overview

The Bolt Planning stage runs after unit design is complete. The BoltPlanner decomposes each construction unit into one or more bolts — scoped execution packages that a code-generation agent can implement in a focused session.

Bolts are the smallest execution loop in the AIDLC construction pipeline. Each bolt has a clear scope, acceptance criteria, and target files. Together, all bolts for a unit must provide >=95% story coverage.

---

## Bolt Spec Artifact

Each bolt is described by a spec file written during this stage.

**Path**: `{workflowId}/construction/{parent_unit_id}/bolts/BOLT-NNN-slug/spec.md`

Example: `{workflowId}/construction/UNIT-001-foundation/bolts/BOLT-001-data-model/spec.md`

### Spec Template

The canonical bolt spec template is defined at:

**Template file**: `resources/templates/construction/bolt-spec-template.md`

When creating bolt specs, agents MUST read this template file and follow its structure exactly. The template defines all required frontmatter fields (including runtime state fields), all required body sections, status values, and stage status symbols.

> **CRITICAL**: Do NOT invent your own spec format. Read and follow the template.

### Required Body Sections

Every bolt spec must contain ALL of the following sections (10 total):

1. **Scope** — What this bolt implements
2. **Stories Included** — Checkbox list of stories with priorities (`- [ ] **S-001**: title -- Priority: Must`)
3. **Acceptance Criteria** — Checkbox list of verifiable criteria (`- [ ] criterion`)
4. **Expected Outputs** — Concrete deliverables this bolt produces
5. **Target Files** — Files to create or modify (backtick-wrapped paths)
6. **Stages** — 4-stage execution checklist (elaboration, code_generation, build_and_test, review)
7. **Dependencies** — Three subsections: Bolt Dependencies (within unit), Unit Dependencies (cross-unit), Enables (bolts waiting on this)
8. **Success Criteria** — Completion checklist (all stories implemented, tests passing, code reviewed)
9. **Traceability** — Requirement and story ID references

---

## Naming Convention

Bolt IDs use global sequential numbering across ALL units — not per-unit numbering.

Format: `BOLT-NNN-slug`

- `NNN` is zero-padded to three digits: `001`, `002`, `003`, ...
- `slug` is a short kebab-case description of the bolt's scope
- Numbers do NOT reset when moving to a new unit

Examples:
- `BOLT-001-data-model`
- `BOLT-002-repository-layer`
- `BOLT-015-admin-dashboard`

---

## Bolt Count Guardrails

| Scope | Limit |
|-------|-------|
| Max bolts per unit | 8 |
| Max bolts total (all units) | 50 |

If a unit's scope exceeds 8 bolts, it must be re-scoped or split into multiple units before bolt planning can proceed.

---

## Traceability Rules

Every bolt MUST satisfy the following traceability requirements:

- **Requirement reference is mandatory**: Every bolt must reference at least one requirement ID in its `requirements` frontmatter field and its `## Traceability` section. Requirement IDs come from `requirements.md` (e.g., `FR-1`, `FR-3`). A bolt with no requirement reference is invalid and must be revised before execution.
- **Story reference is recommended but optional**: Not all bolts map directly to user stories (infrastructure, scaffolding, and cross-cutting bolts often do not). Include story IDs when they exist; leave the `stories` field as an empty array `[]` when none apply.
- **Planner responsibility**: The planner agent is responsible for reading the inception `requirements.md` and `stories.md` artifacts and populating these fields for every bolt it generates. Do not leave them as placeholder values.
- **Coverage check at plan completion**: After all bolts for a unit are planned, a coverage check verifies that every requirement with `must` priority in `requirements.md` is addressed by at least one bolt. Unaddressed `must` requirements must be resolved before bolt execution begins (either by revising an existing bolt's scope or adding a new bolt).

---

## Documentation Impact Assessment

The planner MUST assess `docs_impact` for every bolt based on what the bolt changes. Apply these rules:

- **User-facing features** (new UI, new CLI commands, new API endpoints): include `user-guide`
- **Configuration changes** (new env vars, new settings, new options): include `config-reference`
- **CLI changes** (new commands, new flags, changed usage): include `cli-reference`
- **Breaking changes** (removed features, changed APIs, migration needed): include `migration-guide`
- **README-worthy changes** (new capabilities, changed project setup): include `readme`
- **Architectural changes** (new services, new data flows, new components): include `architecture`
- **Complex internal logic** (non-obvious algorithms, intricate state machines): include `code-comments`
- **Internal-only changes** (refactoring, test fixes, minor tweaks with no user impact): use `none`

A bolt may have multiple `docs_impact` values (e.g., `["user-guide", "config-reference"]`). Only use `none` when the bolt has zero documentation impact.

---

## Coverage Validation

After bolt decomposition, the BoltPlanner validates that the bolt set covers all unit stories and requirements.

| Coverage | Result |
|----------|--------|
| >= 95% | Pass — proceed to execution |
| 80-94% | Warning — user must explicitly acknowledge the gap before proceeding |
| < 80% | Hard block — bolt planning rejected, must revise decomposition |

Story coverage is measured as: (stories with at least one covering bolt) / (total unit stories).

Requirement coverage (must-priority only): all `must`-priority requirements in `requirements.md` must be referenced by at least one bolt. Any uncovered `must` requirement is treated as a hard block regardless of story coverage score.

---

## Bolt Lifecycle States

Each bolt progresses through the following states:

| State | Meaning |
|-------|---------|
| `planned` | Spec written, not yet started |
| `in_progress` | Code generation agent is actively working |
| `built` | Code generation complete, pending review |
| `in_review` | BoltReviewer is evaluating the bolt |
| `done` | Reviewed and accepted |
| `failed` | Review rejected; requires re-scope or split |

---

## Express Bolt Eligibility

A bolt is eligible for express mode (skips the elaboration stage) if either condition is met:

- `depth_target` <= 4 (low-complexity bolt)
- Parent unit's pathway is `bugfix`

Express bolts go directly from `planned` to code generation. The `express_mode: true` flag must be set in the bolt spec frontmatter.

---

## Checkpoint Fields

The workflow checkpoint tracks bolt state under the unit entry:

| Field | Description |
|-------|-------------|
| `construction_bolts` | Map of bolt IDs to `ConstructionBoltProgress` objects |
| `active_bolt_id` | ID of the bolt currently in execution (or `null`) |
| `active_bolt_stage` | Current execution stage of the active bolt |

The `active_bolt_stage` values correspond to execution stages: `elaboration`, `code_generation`, `build_and_test`, `review`.
