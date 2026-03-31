# Domain Entities Template

Use this template when creating domain entity artifacts during the Construction Design sub-phase. Every unit gets a domain entities file. For units with no new entities, the file documents which existing entities are consumed and confirms no schema changes are needed.

**Output path**: `aidlc-docs/{workflowId}/construction/{UNIT-NNN-slug}/design/domain-entities.md`

**Input artifacts**: Functional design (`functional-design.md`), unit brief (`unit-brief.md`), requirements, existing database schema (brownfield).

---

## Frontmatter

```yaml
---
type: domain-entities
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
| `type` | string | YES | Always `domain-entities`. |
| `intent` | string | YES | Parent workflow ID (matches `{workflowId}`). |
| `unit` | string | YES | Unit slug this artifact belongs to (e.g., `UNIT-001-location-setup`). |
| `status` | string | YES | `draft` on creation, `ready` when approved at Gate 2. |
| `created` | string | YES | ISO 8601 timestamp of initial creation. |
| `updated` | string | YES | ISO 8601 timestamp of last modification. |

---

## Required Body Content

```markdown
# Domain Entities: {UNIT-NNN} - {Unit Name}

## Entities Overview

<!-- List of entities in this unit's domain.
     For each, note whether it is new, modified, or read-only.
     For units with no new entities: "This unit uses existing entities only. No new data models." -->

| Entity | Source | Description |
|--------|--------|-------------|
| {Entity Name} | New / Existing (modify) / Existing (read-only) | {Brief description} |

## {Entity Name}

<!-- Repeat this section for each entity listed in the overview.
     For existing read-only entities, a brief reference is sufficient. -->

**Source:** New | Existing (modify) | Existing (read-only)

<!-- For new or modified entities, provide the full field table.
     For existing read-only entities: "Uses existing {Entity} from {module}. No modifications." -->

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| {field_name} | {string / number / boolean / date / uuid / enum / FK} | Yes / No | {default or null} | {What this field represents} |

**Relationships:**

<!-- List relationships to other entities using natural language.
     E.g., "Belongs to Company (many-to-one, FK: company_id)"
     E.g., "Has many LocationSettings (one-to-many)" -->

- {relationship description}

**Constraints:**

<!-- Uniqueness, check constraints, composite keys, cascading behavior.
     E.g., "Name must be unique within Company (composite: company_id + name)"
     E.g., "ON DELETE CASCADE from parent Company" -->

- {constraint description}

## Entity Relationship Summary

<!-- Brief text description of how entities relate to each other.
     No need for a full ERD -- just natural language.
     E.g., "Location belongs to Company. Location has many LocationSettings.
     LocationSetting has a SettingType enum." -->

{Relationship summary in plain text.}

## Migration Notes

<!-- For brownfield: what existing tables/models are affected, any schema changes needed,
     data migration considerations.
     For greenfield: "New schema -- no migration needed." -->

<!-- Option A: Brownfield -->
<!-- ### Schema Changes
     - {Table name}: {change description (add column, modify type, add index, etc.)}

     ### Data Migration
     - {Any data transformation needed for existing records}

     ### Backward Compatibility
     - {Can old and new code coexist during rollout?} -->

<!-- Option B: Greenfield -->
<!-- New schema -- no migration needed. -->

{Migration documentation appropriate to the project context.}
```

---

## Depth Guidance

For **simple units with no new entities**, the file confirms this explicitly:

```markdown
# Domain Entities: UNIT-003 - Coupons Page

## Entities Overview
This unit uses existing entities only. No new data models.

### Coupon
**Source:** Existing (read-only)

Uses existing Coupon entity from the billing module. No modifications.

## Entity Relationship Summary
Coupon belongs to Company. No relationships modified by this unit.

## Migration Notes
No schema changes. Existing tables used as-is.
```

For **complex units with new or modified entities**, provide full field tables, explicit relationship descriptions, constraint documentation, and detailed migration notes including backward compatibility considerations.

---

## Brownfield Considerations

When working with existing databases and legacy schemas:

- **Document the existing table name** alongside the entity name if they differ (e.g., "Entity: Location, Table: `tbl_Locations`").
- **Note legacy column naming conventions** and whether new fields follow the old convention or a new one.
- **Schema changes require migration scripts** -- note whether EF migrations, raw SQL scripts, or a different migration tool is used.
- **Flag nullable legacy columns** that the new code treats as required -- these need data cleanup or default values.
- **Reference the legacy ORM mappings** if they exist (e.g., "Currently mapped in `LocationEntity.cs` via Entity Framework").

---

## Quality Checklist

Before marking domain entities as `status: ready`:

- [ ] All entities listed in overview with source (new/modify/read-only)
- [ ] New and modified entities have complete field tables
- [ ] Field types are specific (not just "string" -- include length constraints where relevant)
- [ ] Relationships are documented for every entity
- [ ] Constraints (uniqueness, cascading, composite keys) are explicit
- [ ] Entity relationship summary is written in plain text
- [ ] Migration notes address schema changes, data migration, and backward compatibility (brownfield)
- [ ] Legacy table/column names are noted where they differ from entity names (brownfield)
- [ ] Frontmatter fields all populated (no placeholders)
