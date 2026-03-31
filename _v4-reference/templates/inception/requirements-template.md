# Requirements Template

Use this template when creating the functional requirements document during Requirements Analysis.

**Output path**: `aidlc-docs/{intent-id}/inception/requirements/requirements.md`

This is the **functional requirements specification** for the intent. Each requirement gets a unique ID (FR-NNN) that is referenced throughout the workflow -- by units, stories, bolts, and coverage checks. Requirements coverage is enforced: every FR must map to at least one unit and story before Gate 1.

---

## Frontmatter

```yaml
---
type: requirements
intent: "{intent-id}"
status: draft
created: "{YYYY-MM-DDTHH:MM:SSZ}"
updated: "{YYYY-MM-DDTHH:MM:SSZ}"
---
```

## Required Frontmatter Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | YES | Always `requirements` |
| `intent` | string | YES | Parent intent identifier |
| `status` | string | YES | `draft` on creation, `ready` when approved by PO + Tech Lead |
| `created` | string | YES | ISO 8601 timestamp |
| `updated` | string | YES | ISO 8601 timestamp, updated on each change |

---

## Required Body Content

```markdown
# Requirements: {Intent Name}

## Requirements Overview

<!-- Brief context linking back to the intent. What problem do these requirements address? Reference intent.md for full business context. -->

**Intent:** `{intent-id}/intent.md`
**Total requirements:** {N}
**Must-have count:** {N}

{1-2 sentences linking these requirements to the business objective defined in intent.md.}

## Functional Requirements

<!-- Each requirement has a unique ID (FR-NNN), description, priority, and acceptance criteria. IDs are sequential and never reused. Priority uses MoSCoW: Must, Should, Could, Won't. -->

### FR-001: {Requirement Title}

**Description:** {What the system must do. Be specific and testable.}
**Priority:** Must | Should | Could | Won't
**Acceptance Criteria:**
- [ ] {Criterion 1 -- measurable, verifiable}
- [ ] {Criterion 2 -- measurable, verifiable}
- [ ] {Criterion 3 -- measurable, verifiable}
**Related Stories:** {S-NNN references, filled in after story creation}

---

### FR-002: {Requirement Title}

**Description:** {What the system must do.}
**Priority:** Must | Should | Could | Won't
**Acceptance Criteria:**
- [ ] {Criterion 1}
- [ ] {Criterion 2}
**Related Stories:** {S-NNN references, filled in after story creation}

---

### FR-003: {Requirement Title}

**Description:** {What the system must do.}
**Priority:** Must | Should | Could | Won't
**Acceptance Criteria:**
- [ ] {Criterion 1}
- [ ] {Criterion 2}
**Related Stories:** {S-NNN references, filled in after story creation}

---

<!-- Repeat for all requirements. Keep each requirement focused on a single capability. -->

## Requirements Coverage

<!-- This table is populated AFTER unit decomposition and story creation. It maps every FR to the unit and stories that implement it. Any row with "NOT COVERED" is a hard block at Gate 1. -->

| Requirement | Unit | Stories | Status |
|-------------|------|---------|--------|
| FR-001: {title} | UNIT-NNN: {name} | S-NNN, S-NNN | Covered |
| FR-002: {title} | UNIT-NNN: {name} | S-NNN | Covered |
| FR-003: {title} | -- | -- | NOT COVERED |

**Coverage:** {N}/{total} requirements covered ({percentage}%)

## Open Questions

<!-- Questions that need answers before requirements can be finalized. Track owner and resolution. -->

| # | Question | Owner | Due Date | Resolution |
|---|----------|-------|----------|------------|
| 1 | {Question that affects a requirement} | {Person responsible} | {Target date} | {Answer when resolved, or "Pending"} |
| 2 | {Question that affects a requirement} | {Person responsible} | {Target date} | {Answer when resolved, or "Pending"} |

## Assumptions

<!-- Things assumed to be true during requirements gathering. If an assumption is wrong, it may invalidate requirements. -->

| # | Assumption | Risk if Wrong |
|---|------------|---------------|
| 1 | {What is assumed} | {Impact on requirements and plan} |
| 2 | {What is assumed} | {Impact on requirements and plan} |
```

---

## Requirement Writing Guidelines

1. **One capability per FR.** If a requirement says "and", consider splitting it.
2. **Testable acceptance criteria.** Each criterion must be verifiable by QA without ambiguity.
3. **Priority is non-negotiable at Gate 1.** Must-have requirements that lack coverage block approval.
4. **Related Stories is back-filled.** Leave as placeholder during initial creation; populated during User Stories stage.
5. **Coverage table is the contract.** If it shows "NOT COVERED", the mob must either add stories or downgrade the requirement priority.

## Quality Checklist

Before marking requirements as `status: ready`:

- [ ] Every requirement has a unique FR-NNN ID
- [ ] Every requirement has at least one acceptance criterion
- [ ] Priorities are assigned using MoSCoW (Must/Should/Could/Won't)
- [ ] No requirement covers multiple unrelated capabilities
- [ ] Coverage table maps every FR to a unit and stories
- [ ] No Must-have requirements show "NOT COVERED"
- [ ] Open questions have owners and due dates
- [ ] Assumptions list "risk if wrong" consequences
- [ ] Frontmatter fields all populated (no placeholders)
