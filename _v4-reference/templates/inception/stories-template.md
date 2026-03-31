# Stories Template

Use this template when creating per-unit user stories during the User Stories stage.

**Output path**: `aidlc-docs/{intent-id}/construction/{UNIT-NNN-slug}/stories.md`

Each unit gets its own `stories.md` with detailed user stories and acceptance criteria. This is the **squad's working reference** during construction -- devs implement against these stories, QA validates against the acceptance criteria. Story IDs are per-unit (S-001, S-002, etc. -- reset per unit, not global).

---

## Frontmatter

```yaml
---
type: stories
intent: "{intent-id}"
unit: "{UNIT-NNN-slug}"
status: draft
story_count: {N}
created: "{YYYY-MM-DDTHH:MM:SSZ}"
updated: "{YYYY-MM-DDTHH:MM:SSZ}"
---
```

## Required Frontmatter Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | YES | Always `stories` |
| `intent` | string | YES | Parent intent identifier |
| `unit` | string | YES | Parent unit slug (e.g., `UNIT-001-location-setup`) |
| `status` | string | YES | `draft` on creation, `ready` when approved by PO at Gate 1 |
| `story_count` | number | YES | Total number of stories in this file |
| `created` | string | YES | ISO 8601 timestamp |
| `updated` | string | YES | ISO 8601 timestamp, updated on each change |

---

## Required Body Content

```markdown
# User Stories: {UNIT-NNN} {Unit Name}

## Stories Overview

<!-- Brief context for this unit's stories. Reference the unit brief and personas. -->

- **Unit:** {UNIT-NNN}: {Unit Name}
- **Unit brief:** `construction/{UNIT-NNN-slug}/unit-brief.md`
- **Total stories:** {N}
- **Personas referenced:** {Persona 1, Persona 2}

## S-001: {Story Title}

**As** {persona from personas.md}
**I want to** {action -- what the user wants to do}
**So that** {benefit -- why it matters to the user}

### Acceptance Criteria

- [ ] {Criterion 1 -- measurable, verifiable by QA}
- [ ] {Criterion 2 -- measurable, verifiable by QA}
- [ ] {Criterion 3 -- measurable, verifiable by QA}

### Notes

<!-- Edge cases, technical considerations, references to existing behavior, or UI mockup references. Omit this section if there are no relevant notes. -->

{Any edge cases, technical considerations, or references to existing behavior.}

---

## S-002: {Story Title}

**As** {persona from personas.md}
**I want to** {action}
**So that** {benefit}

### Acceptance Criteria

- [ ] {Criterion 1}
- [ ] {Criterion 2}

### Notes

{Notes, if any.}

---

## S-003: {Story Title}

**As** {persona from personas.md}
**I want to** {action}
**So that** {benefit}

### Acceptance Criteria

- [ ] {Criterion 1}
- [ ] {Criterion 2}
- [ ] {Criterion 3}

---

<!-- Repeat for all stories. Use --- between stories for visual separation. -->

## Story Dependencies

<!-- Only include this section if dependencies exist between stories within this unit. Omit entirely if stories are independent. Cross-unit dependencies belong in the unit brief, not here. -->

| Story | Depends On | Type |
|-------|-----------|------|
| S-002 | S-001 | {Data dependency -- S-001 creates the entity S-002 edits} |
| S-003 | S-001 | {UI dependency -- S-003 adds a column to the table S-001 creates} |
```

---

## Story Writing Guidelines

1. **Persona must exist in personas.md.** Every "As a..." clause must reference a defined persona. Don't invent ad-hoc roles.
2. **Acceptance criteria are QA's contract.** Each criterion must be testable without ambiguity. "The page should look good" is not an acceptance criterion. "The table displays columns: Name, Address, Status, Last Modified" is.
3. **One capability per story.** If a story requires "and" in the title, consider splitting it.
4. **Notes are optional but valuable.** Edge cases, gotchas from the technical brief, and references to existing behavior help squads avoid surprises.
5. **Story IDs are per-unit.** S-001 in UNIT-001 is a different story than S-001 in UNIT-002. When referencing cross-unit, always prefix: `UNIT-001/S-001`.
6. **Dependencies are within-unit only.** Cross-unit dependencies are tracked in the unit brief, not in stories.

## Quality Checklist

Before marking stories as `status: ready`:

- [ ] Every story uses "As a / I want to / So that" format
- [ ] Every persona reference exists in `inception/personas.md`
- [ ] Every story has at least 2 acceptance criteria
- [ ] Acceptance criteria are measurable and testable by QA
- [ ] Story IDs are sequential (S-001, S-002, ...) with no gaps
- [ ] Stories collectively cover all requirements assigned to this unit (cross-reference unit brief)
- [ ] Dependencies section is present only if actual dependencies exist
- [ ] Frontmatter story_count matches actual number of stories
- [ ] Frontmatter fields all populated (no placeholders)
