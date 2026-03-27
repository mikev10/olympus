# Units Overview Template

Use this template when creating the `unit-of-work.md` artifact during Units Generation.

**Output path**: `aidlc-docs/{workflowId}/inception/units/unit-of-work.md`

---

## Frontmatter

```yaml
---
intent: "{workflow-id}"
phase: inception
status: units-decomposed
total_units: {N}
created: "{YYYY-MM-DDTHH:MM:SSZ}"
updated: "{YYYY-MM-DDTHH:MM:SSZ}"
---
```

## Required Frontmatter Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `intent` | string | YES | Parent workflow ID |
| `phase` | string | YES | Always `inception` |
| `status` | string | YES | `units-decomposed` when complete |
| `total_units` | number | YES | Total number of units defined |
| `created` | string | YES | ISO 8601 timestamp |
| `updated` | string | YES | ISO 8601 timestamp, updated on each change |

---

## Required Content

~~~markdown
# {Intent Name} - Unit Decomposition

## Decomposition Summary

- **Total units**: {N}
- **Decomposition approach**: {domain-driven | feature-based | layer-based}
- **Cross-unit dependencies**: {count}

## Requirement-to-Unit Mapping

> **CRITICAL**: Every FR from requirements.md MUST be assigned to exactly one unit. Unassigned requirements are a hard block.

| Requirement | Description | Priority | Assigned Unit |
|-------------|-------------|----------|---------------|
| FR-1 | {description} | Must | U-001: {name} |
| FR-2 | {description} | Should | U-001: {name} |
| FR-3 | {description} | Must | U-002: {name} |

## Units

### U-001: {Unit Name}

- **Purpose**: {What this unit does and why it exists}
- **Responsibility**: {Single responsibility description}
- **Scope**: {What is IN this unit}
- **Assigned Requirements**: FR-1, FR-2
- **Assigned Stories**: S-001, S-002, S-003
- **Dependencies**: None | {U-NNN: reason}
- **Estimated Complexity**: S | M | L | XL
- **Estimated Effort**: {hours}
- **Folder**: `UNIT-001-{slug}`

### U-002: {Unit Name}

{Same structure as above}

## Unit Dependency Graph

```text
[U-001: Foundation] --> [U-002: API Layer] --> [U-004: Integration]
         |                     |
         +----------> [U-003: Frontend]
```

## Execution Order

Based on dependency analysis:

1. **Phase 1** (no dependencies): U-001: {name}
2. **Phase 2** (depends on Phase 1): U-002: {name}, U-003: {name} (parallel)
3. **Phase 3** (depends on Phase 2): U-004: {name}

## Independence Validation

| Criterion | U-001 | U-002 | U-003 |
|-----------|-------|-------|-------|
| Single responsibility | Yes | Yes | Yes |
| Clear interfaces | Yes | Yes | Yes |
| No circular deps | Yes | Yes | Yes |
| Independent buildability | Yes | Yes | Yes |
| Deployable independently | Yes | Yes | Partial |
~~~
