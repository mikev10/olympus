# Functional Design Template

Use this template when creating functional design artifacts during the Construction Design sub-phase. Every unit gets a functional design, but depth scales with complexity -- simple units get lightweight files, complex units get comprehensive ones.

**Output path**: `aidlc-docs/{workflowId}/construction/{UNIT-NNN-slug}/design/functional-design.md`

**Input artifacts**: Unit brief (`unit-brief.md`), requirements (`requirements.md`), scope analysis, reverse engineering findings (brownfield).

---

## Frontmatter

```yaml
---
type: functional-design
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
| `type` | string | YES | Always `functional-design`. |
| `intent` | string | YES | Parent workflow ID (matches `{workflowId}`). |
| `unit` | string | YES | Unit slug this design belongs to (e.g., `UNIT-001-location-setup`). |
| `status` | string | YES | `draft` on creation, `ready` when approved at Gate 2. |
| `created` | string | YES | ISO 8601 timestamp of initial creation. |
| `updated` | string | YES | ISO 8601 timestamp of last modification. |

---

## Required Body Content

```markdown
# Functional Design: {UNIT-NNN} - {Unit Name}

## Overview

<!-- What this unit does and how it fits in the broader system.
     Simple units: 2-3 sentences. Complex units: a full paragraph.
     Reference the unit brief for context. -->

{Brief description of the unit's purpose, its role in the system, and any relevant
brownfield context (e.g., "Replaces the legacy VB.NET location management iframe
with an Angular component served from the new .NET API").}

## Key Interactions

<!-- How users interact with this unit.
     UI units: describe the page flow (load -> action -> result).
     API units: summarize endpoints and their consumers.
     For simple units, a bullet list suffices. For complex units, describe the
     full interaction flow including navigation, form submissions, and feedback. -->

- {User action 1} -> {system response}
- {User action 2} -> {system response}

## Data Models

<!-- Entities this unit creates or modifies.
     For units with no new data models: "Uses existing {Entity} -- no new data models."
     For full details, reference domain-entities.md. -->

| Entity | Key Fields | Source | Notes |
|--------|------------|--------|-------|
| {Entity} | {field1, field2, ...} | New / Existing (modify) / Existing (read-only) | {Brief note} |

<!-- For simple units with no new models: -->
<!-- Uses existing {Entity} from {module} -- no new data models. See domain-entities.md for field details. -->

## Business Logic

<!-- Processing rules, calculations, transformations, conditional behavior.
     Reference business-rules.md for the full rule catalog.
     For simple CRUD units: "Standard CRUD operations. See business-rules.md for validation rules." -->

- {Rule or processing step 1}
- {Rule or processing step 2}

> Full rule catalog: see `design/business-rules.md`

## Integration Points

<!-- What this unit connects to: other units, external APIs, shared services, legacy systems.
     For iframe migration work: note the legacy system being replaced and any
     coexistence requirements (e.g., both old and new routes active during rollout). -->

| System | Direction | Data | Protocol |
|--------|-----------|------|----------|
| {System or Unit} | Inbound / Outbound / Bidirectional | {What data flows} | REST / gRPC / Event / DB |

## Error Handling

<!-- How errors are surfaced to users. Key error scenarios and expected behavior.
     For UI units: toast messages, inline validation, error pages.
     For API units: error envelope format, HTTP status codes. -->

| Scenario | User Impact | Handling |
|----------|-------------|----------|
| {Error scenario 1} | {What user sees} | {How the system responds} |
| {Error scenario 2} | {What user sees} | {How the system responds} |

## Dependencies

<!-- What must exist before this unit can function.
     Reference the unit-brief.md dependency section.
     Include both technical dependencies (shared services, databases) and
     unit dependencies (other units that must be built first). -->

### Unit Dependencies
- {UNIT-NNN}: {what is needed and why}

### Technical Dependencies
- {Service, library, or infrastructure component}: {why needed}
```

---

## Depth Guidance

For **simple units** (basic CRUD, single page, no new data models), sections can be very brief -- 1-2 lines each is fine. The point is that each section has been consciously considered, not that every section is exhaustive.

**Example -- lightweight functional design for a simple CRUD page:**

```markdown
# Functional Design: UNIT-003 - Coupons Page

## Overview
Read-only list page displaying coupons from the existing `/api/coupons` endpoint.
No new data models. No business logic beyond display formatting.

## Key Interactions
- Page loads -> calls GET /api/coupons -> renders table
- Pagination via existing shared pagination component
- No create/edit/delete in this unit (future work)

## Data Models
Uses existing Coupon entity -- no new data models.

## Business Logic
Standard CRUD operations. See business-rules.md for validation rules.

## Integration Points
| System | Direction | Data | Protocol |
|--------|-----------|------|----------|
| CouponService | Outbound | Coupon list | REST (existing) |

## Error Handling
| Scenario | User Impact | Handling |
|----------|-------------|----------|
| API unavailable | "Unable to load coupons" toast | Retry button shown |

## Dependencies
### Unit Dependencies
None.

### Technical Dependencies
- Existing CouponService (no changes needed)
- Shared TableComponent for rendering
```

For **complex units** (multi-page admin, complex business rules, multiple integrations), expand each section with full detail: sequence diagrams in Key Interactions, complete entity tables in Data Models, multi-step processing pipelines in Business Logic.

---

## Quality Checklist

Before marking a functional design as `status: ready`:

- [ ] Overview clearly explains what the unit does and its role in the system
- [ ] Key interactions cover the primary user flows (happy path at minimum)
- [ ] Data models are listed or explicitly noted as "no new models"
- [ ] Business logic references `business-rules.md` for full rule details
- [ ] Integration points identify all connected systems with direction and protocol
- [ ] Error handling covers key failure scenarios the user may encounter
- [ ] Dependencies are documented (unit and technical)
- [ ] Brownfield context is noted (if applicable -- legacy system being replaced, coexistence requirements)
- [ ] Frontmatter fields all populated (no placeholders)
