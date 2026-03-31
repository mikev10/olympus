# Story Map Template

Use this template when creating the story map review artifact during the User Stories stage.

**Output path**: `aidlc-docs/{intent-id}/inception/story-map.md`

The story map is the **PO's review artifact** -- a single-page view of all stories across all units with requirements coverage mapping. It is generated from the per-unit stories files. The PO reviews this at Gate 1 to confirm all requirements are covered and story scope is appropriate.

---

## Frontmatter

```yaml
---
type: story-map
intent: "{intent-id}"
status: draft
total_stories: {N}
total_units: {N}
created: "{YYYY-MM-DDTHH:MM:SSZ}"
updated: "{YYYY-MM-DDTHH:MM:SSZ}"
---
```

## Required Frontmatter Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | YES | Always `story-map` |
| `intent` | string | YES | Parent intent identifier |
| `status` | string | YES | `draft` on creation, `ready` when PO approves at Gate 1 |
| `total_stories` | number | YES | Total story count across all units |
| `total_units` | number | YES | Total number of units |
| `created` | string | YES | ISO 8601 timestamp |
| `updated` | string | YES | ISO 8601 timestamp, updated on each change |

---

## Required Body Content

```markdown
# Story Map: {Intent Name}

## Story Map Overview

<!-- High-level summary for PO review. Total counts and a brief statement about coverage. -->

- **Total units:** {N}
- **Total stories:** {N}
- **Requirements coverage:** {N}/{total} FRs covered ({percentage}%)

{1-2 sentence summary of the story decomposition.}

## Stories by Unit

<!-- List every unit and its stories. This gives the PO a single view across the entire intent. Story IDs are per-unit (S-001, S-002, etc. -- reset per unit). -->

## UNIT-001: {Unit Name} ({N} stories)

- S-001: {Story title}
- S-002: {Story title}
- S-003: {Story title}

## UNIT-002: {Unit Name} ({N} stories)

- S-001: {Story title}
- S-002: {Story title}

<!-- Repeat for all units. -->

## Requirements Coverage

<!-- Maps every functional requirement (FR-NNN) to the stories that implement it. This is the primary validation artifact -- any requirement showing "NOT COVERED" is a hard block at Gate 1. -->

| Requirement | Stories | Status |
|-------------|---------|--------|
| FR-001: {title} | UNIT-001/S-001, UNIT-001/S-002 | Covered |
| FR-002: {title} | UNIT-002/S-001 | Covered |
| FR-003: {title} | -- | NOT COVERED |

## Coverage Summary

<!-- Quantitative summary of requirements coverage. -->

| Metric | Count |
|--------|-------|
| Total functional requirements | {N} |
| Requirements covered by stories | {N} |
| Requirements NOT covered | {N} |
| Coverage percentage | {N}% |

## PO Sign-Off

<!-- PO checks these boxes during Gate 1 review. All must be checked for Gate 1 approval. -->

- [ ] All Must-have requirements are covered by stories
- [ ] Story scope is appropriate (not too broad, not too granular)
- [ ] Acceptance criteria are testable by QA
- [ ] Personas are correctly referenced in stories
- [ ] No critical gaps in coverage
```

---

## Story Map vs. Per-Unit Stories

| Aspect | Story Map (`inception/story-map.md`) | Per-Unit Stories (`construction/UNIT-NNN/stories.md`) |
|--------|--------------------------------------|------------------------------------------------------|
| **Purpose** | PO review -- single-page overview | Squad reference -- detailed acceptance criteria |
| **Audience** | PO, BA, Tech Lead (mob) | Dev + QA (squad) |
| **Detail level** | Title only per story | Full story with "As a.../I want.../So that..." + acceptance criteria |
| **When created** | After all per-unit stories are written | During User Stories stage |
| **Maintained by** | Auto-generated from per-unit stories | Squad (read-only after Gate 1) |

## Quality Checklist

Before marking a story map as `status: ready`:

- [ ] Every unit is listed with correct story count
- [ ] Every story from per-unit stories files appears in the map
- [ ] Requirements coverage table includes ALL functional requirements
- [ ] No Must-have requirements show "NOT COVERED"
- [ ] Coverage summary numbers are accurate
- [ ] Story titles match the titles in per-unit stories files
- [ ] PO sign-off checkboxes are present (unchecked -- PO checks them)
- [ ] Frontmatter total_stories and total_units match actual counts
- [ ] Frontmatter fields all populated (no placeholders)
