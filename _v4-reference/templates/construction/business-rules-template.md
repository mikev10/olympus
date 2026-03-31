# Business Rules Template

Use this template when creating business rules artifacts during the Construction Design sub-phase. Every unit gets a business rules file, but depth scales with complexity -- simple CRUD units may have only a few validation rules, while complex units get a full rule catalog.

**Output path**: `aidlc-docs/{workflowId}/construction/{UNIT-NNN-slug}/design/business-rules.md`

**Input artifacts**: Functional design (`functional-design.md`), unit brief (`unit-brief.md`), requirements, existing codebase (brownfield).

---

## Frontmatter

```yaml
---
type: business-rules
intent: {intent-id}
unit: {UNIT-NNN-slug}
status: draft
created: "{YYYY-MM-DDTHH:MM:SSZ}"
updated: "{YYYY-MM-DDTHH:MM:SSZ}"
---
```

---

## Required Frontmatter Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | YES | Always `business-rules`. |
| `intent` | string | YES | Parent workflow ID (matches `{workflowId}`). |
| `unit` | string | YES | Unit slug this artifact belongs to (e.g., `UNIT-001-location-setup`). |
| `status` | string | YES | `draft` on creation, `ready` when approved at Gate 2. |
| `created` | string | YES | ISO 8601 timestamp of initial creation. |
| `updated` | string | YES | ISO 8601 timestamp of last modification. |

---

## Required Body Content

```markdown
# Business Rules: {UNIT-NNN} - {Unit Name}

## Rules Overview

<!-- Brief description of the business domain for this unit.
     For simple units: "Standard CRUD operations on {entity}. No complex business logic."
     For complex units: describe the domain context, key business processes,
     and any regulatory or compliance considerations. -->

{Description of the business domain and the nature of the rules in this unit.}

## Validation Rules

<!-- Table of all validation rules for this unit.
     Rule IDs use BR-NNN format (sequential within the unit).
     Include both field-level and entity-level validations.
     For brownfield: note which rules replicate existing legacy behavior. -->

| Rule | Field / Entity | Description | Error Message |
|------|----------------|-------------|---------------|
| BR-001 | {field name} | {Validation rule description} | "{User-facing error message}" |
| BR-002 | {field name} | {Validation rule description} | "{User-facing error message}" |

## State Transitions

<!-- If entities have lifecycle states (e.g., active/inactive, draft/published/archived),
     document the valid transitions.
     For simple units: "No state transitions -- standard CRUD." -->

<!-- Option A: Simple unit -->
<!-- No state transitions -- standard CRUD. -->

<!-- Option B: Complex unit with state machine -->
<!-- | From State | To State | Trigger | Conditions | Side Effects |
     |------------|----------|---------|------------|--------------|
     | {state}    | {state}  | {action}| {guards}   | {what happens}| -->

{State transition documentation or "No state transitions -- standard CRUD."}

## Conditional Logic

<!-- Visibility rules, field dependencies, feature flags, and conditional behavior.
     E.g., "Tax fields only visible when tax module is enabled."
     For simple units: "None." -->

- {Condition and resulting behavior}

## Edge Cases

<!-- Scenarios that need special handling: concurrent edits, boundary values,
     empty states, migration-period quirks, legacy data inconsistencies.
     For simple units: "None identified." -->

| Scenario | Expected Behavior | Notes |
|----------|-------------------|-------|
| {Edge case scenario} | {What the system should do} | {Additional context} |

## Authorization Rules

<!-- Who can do what. Map actions to roles and any additional conditions.
     For brownfield: note if these replicate or change existing role checks. -->

| Action | Required Role | Additional Conditions |
|--------|---------------|----------------------|
| {Action (e.g., Create, Read, Update, Delete)} | {Role name} | {Any extra conditions, e.g., "own records only"} |
```

---

## Depth Guidance

For **simple CRUD units**, this file may be very short. Every section is still present but can be a single line:

```markdown
# Business Rules: UNIT-003 - Coupons Page

## Rules Overview
Standard CRUD operations on Coupon entity. No complex business logic.

## Validation Rules
| Rule | Field / Entity | Description | Error Message |
|------|----------------|-------------|---------------|
| BR-001 | Name | Required, max 100 chars | "Coupon name is required" |
| BR-002 | Code | Required, unique, alphanumeric, max 20 chars | "Coupon code is required and must be unique" |

## State Transitions
No state transitions -- standard CRUD.

## Conditional Logic
None.

## Edge Cases
None identified.

## Authorization Rules
| Action | Required Role | Additional Conditions |
|--------|---------------|----------------------|
| All CRUD | Facility Admin | Standard role check |
```

For **complex units**, expand each section: full rule catalog with dozens of BRs, multi-state lifecycle diagrams, feature-flag-driven conditional logic, and detailed edge case analysis.

---

## Brownfield Considerations

When working in a brownfield codebase (iframe migrations, legacy rewrites):

- **Document which rules replicate existing legacy behavior** -- this helps reviewers confirm parity.
- **Flag any rules that intentionally differ from legacy** -- new validation, changed authorization, etc.
- **Note legacy data quirks** in Edge Cases -- e.g., "Historical records may have null `CreatedDate` due to legacy import. Handle gracefully."
- **Reference existing code** where rules were previously enforced -- e.g., "Currently enforced in `LocationValidator.vb`, lines 45-80."

---

## Quality Checklist

Before marking business rules as `status: ready`:

- [ ] Rules Overview describes the business domain clearly
- [ ] All validation rules have unique BR-NNN IDs
- [ ] Every validation rule has a user-facing error message
- [ ] State transitions are documented or explicitly noted as "none"
- [ ] Conditional logic (visibility, dependencies, flags) is captured
- [ ] Edge cases are identified (or explicitly "none identified")
- [ ] Authorization rules map actions to roles
- [ ] Brownfield rules note parity with or deviation from legacy behavior (if applicable)
- [ ] Frontmatter fields all populated (no placeholders)
