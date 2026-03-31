# Unit Brief Template

Use this template when creating per-unit brief files during Units Generation.

**Output path**: `aidlc-docs/{workflowId}/inception/units/{UNIT-NNN-slug}/unit-brief.md`

This brief is the **primary input for Bolt Planning and Construction**. It must contain sufficient detail for a construction agent to decompose the unit into bolts and begin implementation without needing to re-read the full requirements.

---

## Frontmatter

```yaml
---
unit: "U-NNN"
unit_slug: "UNIT-NNN-slug"
intent: "{workflow-id}"
complexity: "S|M|L|XL"
status: draft
created: "{YYYY-MM-DDTHH:MM:SSZ}"
updated: "{YYYY-MM-DDTHH:MM:SSZ}"
---
```

## Required Frontmatter Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `unit` | string | YES | Unit ID in documentation format (e.g., `U-001`) |
| `unit_slug` | string | YES | Unit folder name (e.g., `UNIT-001-foundation`) |
| `intent` | string | YES | Parent workflow ID |
| `complexity` | string | YES | Estimated complexity: `S` (small), `M` (medium), `L` (large), `XL` (extra-large) |
| `status` | string | YES | `draft` on creation, `ready` when approved |
| `created` | string | YES | ISO 8601 timestamp |
| `updated` | string | YES | ISO 8601 timestamp |

---

## Required Body Content

```markdown
# Unit Brief: U-NNN - {Unit Name}

## Purpose

{Clear, concise statement of what this unit does and why it exists. One paragraph maximum.}

## Scope

### In Scope
- {What this unit IS responsible for}
- {Specific functionality, domain areas, or features owned by this unit}

### Out of Scope
- {What this unit is NOT responsible for}
- {What neighboring units handle — prevents scope creep}

## Assigned Requirements

> Every FR assigned to this unit from the Requirement-to-Unit Mapping. This table is the contract for what this unit must deliver.

| Requirement | Description | Priority |
|-------------|-------------|----------|
| FR-1 | {description from requirements.md} | Must |
| FR-2 | {description from requirements.md} | Should |

## Domain Concepts

### Key Entities

| Entity | Description | Key Attributes | Owned by This Unit? |
|--------|-------------|----------------|---------------------|
| {Entity 1} | {What it represents} | {Key properties} | Yes |
| {Entity 2} | {What it represents} | {Key properties} | Shared with U-NNN |

### Key Operations

| Operation | Description | Inputs | Outputs |
|-----------|-------------|--------|---------|
| {Operation 1} | {What it does} | {Input data} | {Output data} |
| {Operation 2} | {What it does} | {Input data} | {Output data} |

## Story Summary

| Metric | Count |
|--------|-------|
| Total Stories | {n} |
| Must Have | {n} |
| Should Have | {n} |
| Could Have | {n} |

### Stories Assigned

> **Note**: This section is initially created with placeholder content during Units Generation. It is populated with actual story data when the User Stories stage runs after units are defined. Stories for this unit are stored at `inception/units/{UNIT-NNN-slug}/stories/`. Each story is an individual markdown file following the per-unit story template.

| Story ID | Title | Priority | Status | File |
|----------|-------|----------|--------|------|
| S-001 | {Title} | Must | Planned | `stories/S-001-{slug}.md` |
| S-002 | {Title} | Should | Planned | `stories/S-002-{slug}.md` |

## Dependencies

### Depends On

| Unit | Reason | Blocking? |
|------|--------|-----------|
| U-NNN: {name} | {Why this dependency exists} | Yes/No |

### Depended On By

| Unit | Reason |
|------|--------|
| U-NNN: {name} | {Why they depend on this unit} |

### External Dependencies

| System/Service | Purpose | Risk |
|----------------|---------|------|
| {External system} | {Why needed} | Low/Medium/High |

## Technical Context

### Integration Points

| Integration | Type | Protocol | Notes |
|-------------|------|----------|-------|
| {System/Unit} | API/Event/DB | REST/GraphQL/gRPC | {Notes} |

### Data Storage

| Data | Type | Volume | Retention |
|------|------|--------|-----------|
| {Data type} | SQL/NoSQL/Cache/File | {Estimate} | {Policy} |

## Constraints

- {Technical constraint specific to this unit}
- {Business constraint specific to this unit}
- {Performance or scalability constraint}

## Success Criteria

### Functional
- [ ] {Verifiable functional outcome 1}
- [ ] {Verifiable functional outcome 2}

### Non-Functional
- [ ] {Performance target, e.g., response time < 200ms}
- [ ] {Security requirement, e.g., all inputs validated}

### Quality
- [ ] Code coverage > 80%
- [ ] All acceptance criteria from assigned stories met
- [ ] Code reviewed and approved
- [ ] No critical security findings

## Bolt Suggestions

> Preliminary bolt decomposition guidance for the Bolt Planning stage. These are suggestions, not final — Bolt Planning makes the definitive decomposition.

| Suggested Bolt | Stories | Scope |
|----------------|---------|-------|
| {slug}-data-model | S-001, S-002 | Entity definitions, migrations |
| {slug}-service-layer | S-003 | Business logic, validation |
| {slug}-api | S-004, S-005 | API endpoints, DTOs |

## Notes

{Any additional context, risks, open questions, or considerations for Construction. Reference brownfield discovery artifacts if applicable.}
```

---

## Quality Checklist

Before marking a unit brief as `status: ready`:

- [ ] Purpose is clear and specific (one paragraph)
- [ ] Scope boundaries defined (In Scope AND Out of Scope)
- [ ] All assigned requirements listed with priorities
- [ ] Key entities identified with ownership
- [ ] Key operations defined with inputs/outputs
- [ ] All stories assigned to this unit listed
- [ ] Dependencies mapped (depends on, depended on by, external)
- [ ] Technical context documented (integrations, data storage)
- [ ] Success criteria are measurable and verifiable
- [ ] Bolt suggestions provided
- [ ] Frontmatter fields all populated (no placeholders)
