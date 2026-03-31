# Bolt Spec Template

Use this template when creating bolt spec files during bolt planning (inception) or when the construction executor needs to create express bolts.

**Output path**: `aidlc-docs/{workflowId}/construction/{parent_unit_id}/bolts/{bolt_id}/spec.md`

**Stage artifacts are added to the same directory during construction:**
```text
aidlc-docs/{workflowId}/construction/{parent_unit_id}/bolts/{bolt_id}/
  spec.md              <- Created during bolt planning (this template)
  review.md            <- Created during bolt review stage
```

---

## Frontmatter

```yaml
---
id: BOLT-NNN-slug
title: "Short descriptive title"
parent_unit_id: UNIT-NNN-unit-name
intent: {workflow-id}
sequence: 1
status: planned
created: "{YYYY-MM-DDTHH:MM:SSZ}"
started: null
completed: null
current_stage: null
stages_completed: []
depth_target: 6
express_mode: false
estimated_effort_hours: 4
requirements: ["FR-1", "FR-3"]
stories: ["S-001", "S-002"]
docs_impact: ["none"]
requires_bolts: []
enables_bolts: ["BOLT-002-repository-layer"]
requires_units: []
blocked: false
complexity:
  avg_complexity: 2
  avg_uncertainty: 1
  max_dependencies: 2
  testing_scope: 2
---
```

---

## Required Frontmatter Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | YES | Globally unique bolt ID. Must match `BOLT-NNN-slug` pattern (`^BOLT-\d{3}-[a-z0-9-]+$`). |
| `title` | string | YES | Short human-readable title. |
| `parent_unit_id` | string | YES | ID of the parent construction unit (e.g., `UNIT-001-foundation`). |
| `intent` | string | YES | Parent workflow ID (matches `{workflowId}`). |
| `sequence` | integer | YES | Execution order within the unit (1-based, positive). |
| `status` | string | YES | Always `planned` on creation. Lifecycle: `planned` -> `in_progress` -> `built` -> `in_review` -> `done` or `failed`. |
| `created` | string | YES | ISO 8601 timestamp of spec creation. |
| `started` | string/null | YES | ISO 8601 timestamp when execution began. `null` on creation. |
| `completed` | string/null | YES | ISO 8601 timestamp when all stages finished. `null` on creation. |
| `current_stage` | string/null | YES | Currently executing stage. `null` on creation. |
| `stages_completed` | array | YES | Array of completed stage records. Empty `[]` on creation. |
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
| `complexity` | object | YES | 4-factor complexity assessment block (see below). |

### Complexity Block Fields

| Field | Type | Range | Description |
|-------|------|-------|-------------|
| `avg_complexity` | number | 1-3 | Average complexity score across stories. 1=Low (CRUD), 2=Medium (business rules), 3=High (novel algorithms). |
| `avg_uncertainty` | number | 1-3 | Average uncertainty score. 1=Fully specified, 2=Some ambiguity, 3=Many unknowns. |
| `max_dependencies` | number | 1-3 | Highest dependency score among stories. 1=Self-contained, 2=Internal APIs, 3=External systems. |
| `testing_scope` | number | 1-3 | Required testing depth. 1=Unit tests, 2=Integration tests, 3=E2E + manual. |

---

## Required Body Content

```markdown
# {Bolt Title}

## Scope

{What this bolt implements. Focused description.}

## Stories Included

- [ ] **S-001**: {title} -- Priority: {Must|Should|Could}
- [ ] **S-002**: {title} -- Priority: {Must|Should|Could}

## Acceptance Criteria

- [ ] {Measurable, verifiable criterion 1}
- [ ] {Measurable, verifiable criterion 2}

## Expected Outputs

- {Concrete deliverable 1}
- {Concrete deliverable 2}

## Target Files

- `{path/to/file.ts}` -- {create|modify}: {brief description}

## Stages

- [ ] **1. elaboration**: Pending
- [ ] **2. code_generation**: Pending
- [ ] **3. build_and_test**: Pending
- [ ] **4. review**: Pending

## Dependencies

### Bolt Dependencies (within unit)
- {BOLT-ID} (Required): {status}

### Unit Dependencies (cross-unit)
- {UNIT-ID}: {what is needed} -- {status}

### Enables (bolts waiting on this)
- {BOLT-ID}

## Success Criteria

- [ ] All stories implemented
- [ ] All acceptance criteria met
- [ ] Tests passing
- [ ] Code reviewed and approved

## Traceability

- **Requirements**: {FR-1, FR-2}
- **Stories**: {S-001, S-002}
```

---

## Status Values

- **planned**: Bolt created, not yet started
- **in_progress**: Currently being executed
- **built**: Code generation and build complete, awaiting review
- **in_review**: Under review by reviewer agent
- **done**: All stages complete, review approved
- **failed**: Stage failed after maximum retries
- **blocked**: Cannot proceed due to unresolved dependency

---

## Stage Status Symbols

- `- [ ]` = Pending
- `- ⏳` = In Progress
- `- ✅` = Complete
- `- ⊘` = Skipped (express mode)

---

## Concrete Example: Partially-Executed Bolt

The following shows a bolt that has completed the elaboration stage and is currently in code generation:

```yaml
---
id: BOLT-002-repository-layer
title: "Repository Layer Implementation"
parent_unit_id: UNIT-001-foundation
intent: user-auth-system
sequence: 2
status: in_progress
created: "2025-06-15T10:30:00Z"
started: "2025-06-15T14:00:00Z"
completed: null
current_stage: code_generation
stages_completed:
  - stage: elaboration
    completed_at: "2025-06-15T14:45:00Z"
depth_target: 6
express_mode: false
estimated_effort_hours: 6
requirements: ["FR-1", "FR-3", "FR-5"]
stories: ["S-002", "S-003"]
docs_impact: ["code-comments"]
requires_bolts: ["BOLT-001-data-model"]
enables_bolts: ["BOLT-003-service-layer"]
requires_units: []
blocked: false
complexity:
  avg_complexity: 2
  avg_uncertainty: 1
  max_dependencies: 2
  testing_scope: 2
---
```

```markdown
# Repository Layer Implementation

## Scope

Implement the data access layer for the User entity, providing CRUD operations
and query methods used by the service layer. Builds on the User entity and
migrations defined in BOLT-001-data-model.

## Stories Included

- [x] **S-002**: As a developer, I need a user repository with CRUD operations -- Priority: Must
- [ ] **S-003**: As a developer, I need query methods for user lookup by email -- Priority: Must

## Acceptance Criteria

- [x] UserRepository class implements create, read, update, delete operations
- [ ] findByEmail query method returns User or null
- [ ] All repository methods have unit tests with >80% coverage
- [ ] Repository uses parameterized queries to prevent SQL injection

## Expected Outputs

- UserRepository class with CRUD methods
- Query methods for user lookup
- Unit tests for all repository operations

## Target Files

- `src/repositories/user-repository.ts` -- create: UserRepository class
- `src/repositories/index.ts` -- modify: Export barrel file
- `tests/repositories/user-repository.test.ts` -- create: Unit tests

## Stages

- ✅ **1. elaboration**: Complete (2025-06-15T14:45:00Z)
- ⏳ **2. code_generation**: In Progress
- [ ] **3. build_and_test**: Pending
- [ ] **4. review**: Pending

## Dependencies

### Bolt Dependencies (within unit)
- **BOLT-001-data-model** (Required): Done

### Unit Dependencies (cross-unit)
- None

### Enables (bolts waiting on this)
- BOLT-003-service-layer

## Success Criteria

- [ ] All stories implemented
- [ ] All acceptance criteria met
- [ ] Tests passing
- [ ] Code reviewed and approved

## Traceability

- **Requirements**: FR-1, FR-3, FR-5
- **Stories**: S-002, S-003
```
