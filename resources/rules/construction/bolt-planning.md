# Bolt Planning - Decomposing Units into Bolts

## Overview

The Bolt Planning stage runs after unit design is complete. The BoltPlanner decomposes each construction unit into one or more bolts — scoped execution packages that a code-generation agent can implement in a focused session.

Bolts are the smallest execution loop in the AIDLC construction pipeline. Each bolt has a clear scope, acceptance criteria, and target files. Together, all bolts for a unit must provide >=95% story coverage.

---

## Bolt Spec Artifact

Each bolt is described by a spec file written during this stage.

**Path**: `{workflowId}/construction/bolts/BOLT-NNN-slug/spec.md`

### Frontmatter Fields

```yaml
---
id: BOLT-NNN-slug
title: "Short descriptive title"
parent_unit_id: UNIT-NNN-unit-name
sequence: 1
depth_target: 6
express_mode: false
estimated_effort_hours: 4
---
```

| Field | Description |
|-------|-------------|
| `id` | Globally unique bolt identifier (see Naming Convention) |
| `title` | Short human-readable title |
| `parent_unit_id` | ID of the parent construction unit |
| `sequence` | Execution order within the unit (1-based) |
| `depth_target` | Reasoning depth (1-10). Express mode threshold: <= 4 |
| `express_mode` | `true` if eligible for express execution (skips elaboration) |
| `estimated_effort_hours` | Rough hours estimate for human review |

### Required Sections

Every bolt spec must contain all four sections:

**Scope** — What this bolt implements. A focused description of the functionality delivered by this bolt alone.

**Acceptance Criteria** — At least one measurable criterion. Each criterion must be verifiable (observable output, passing test, or explicit behavior).

**Target Files** — List of files to be created or modified. Paths are relative to the project root.

**Dependencies** — Other bolts that must complete before this bolt can begin. Use bolt IDs (e.g., `BOLT-001-data-model`). Leave empty if no dependencies.

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

## Coverage Validation

After bolt decomposition, the BoltPlanner validates that the bolt set covers all unit stories.

| Coverage | Result |
|----------|--------|
| >= 95% | Pass — proceed to execution |
| 80-94% | Warning — user must explicitly acknowledge the gap before proceeding |
| < 80% | Hard block — bolt planning rejected, must revise decomposition |

Coverage is measured as: (stories with at least one covering bolt) / (total unit stories).

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

## Bolt Plan Summary Artifact

After decomposing all bolts for a unit, the BoltPlanner writes a summary artifact:

**Path**: `{workflowId}/construction/plans/{unitId}-bolt-plan.md`

This file lists all bolts for the unit, their sequence, estimated effort, express mode status, and inter-bolt dependencies. It serves as the human-readable plan approved before execution begins.

---

## Checkpoint Fields

The workflow checkpoint tracks bolt state under the unit entry:

| Field | Description |
|-------|-------------|
| `construction_bolts` | Map of bolt IDs to `ConstructionBoltProgress` objects |
| `active_bolt_id` | ID of the bolt currently in execution (or `null`) |
| `active_bolt_stage` | Current execution stage of the active bolt |

The `active_bolt_stage` values correspond to execution stages: `elaboration`, `code_generation`, `build_and_test`, `review`.
