# Personas Template

Use this template when creating the project-wide user personas document during the User Stories stage.

**Output path**: `aidlc-docs/{intent-id}/inception/personas.md`

Personas are **project-wide and shared across all units**. Multiple units reference the same personas (e.g., "Facility Admin", "End User"). Each user story's "As a..." clause references a persona defined here. Created during inception, read-only after Gate 1.

---

## Frontmatter

```yaml
---
type: personas
intent: "{intent-id}"
status: draft
created: "{YYYY-MM-DDTHH:MM:SSZ}"
updated: "{YYYY-MM-DDTHH:MM:SSZ}"
---
```

## Required Frontmatter Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | YES | Always `personas` |
| `intent` | string | YES | Parent intent identifier |
| `status` | string | YES | `draft` on creation, `ready` when approved by PO |
| `created` | string | YES | ISO 8601 timestamp |
| `updated` | string | YES | ISO 8601 timestamp, updated on each change |

---

## Required Body Content

```markdown
# Personas: {Intent Name}

## Personas Overview

<!-- Brief description of who uses the system and how personas were identified. Reference existing user roles in the application where applicable. For brownfield work, personas often map directly to existing application roles. -->

{Brief description of the user base for this intent. How many distinct personas exist and why they are distinct.}

## Persona Definitions

<!-- Repeat this block for each persona. Keep descriptions concise -- focus on what's relevant to THIS intent, not a full user profile. -->

### {Persona Name}

**Role:** {Role description -- what they do in the organization}
**Goals:** {What they are trying to accomplish when using the features in this intent}
**Pain Points:** {Current frustrations relevant to this intent -- what's broken or slow today}
**Key Scenarios:**
- {Scenario 1 -- a specific task they perform related to this intent}
- {Scenario 2 -- another task or workflow}
- {Scenario 3 -- edge case or less common but important scenario}
**Access Level:** {Permissions or role in the system -- e.g., "Admin role with full CRUD", "Read-only viewer"}

---

### {Persona Name}

**Role:** {Role description}
**Goals:** {What they are trying to accomplish}
**Pain Points:** {Current frustrations relevant to this intent}
**Key Scenarios:**
- {Scenario 1}
- {Scenario 2}
**Access Level:** {Permissions or role in the system}

---

<!-- Add more personas as needed. Typical intents have 2-4 personas. -->

## Persona-Unit Mapping

<!-- Which personas are affected by which units. This helps squads understand who they're building for. Populated after unit decomposition. -->

| Persona | Units Affected | Primary Interaction |
|---------|---------------|---------------------|
| {Persona 1} | UNIT-NNN: {name}, UNIT-NNN: {name} | {e.g., "CRUD operations on locations"} |
| {Persona 2} | UNIT-NNN: {name} | {e.g., "Read-only dashboard view"} |
```

---

## Persona Writing Guidelines

1. **Keep it relevant.** Only describe goals, pain points, and scenarios that relate to THIS intent. Don't write generic user profiles.
2. **Map to existing roles.** For brownfield applications, personas often correspond to existing application roles (Admin, Manager, User). Use those names if they already exist.
3. **2-4 personas is typical.** If you have more than 5, consider whether some are really the same persona with different scenarios.
4. **Scenarios drive stories.** Each key scenario should map to at least one user story. If a scenario doesn't produce a story, question whether it belongs.
5. **Access level matters.** Different access levels often mean different acceptance criteria in stories (e.g., admin can delete, user cannot).

## Quality Checklist

Before marking personas as `status: ready`:

- [ ] Each persona has a clear, distinct role
- [ ] Goals are specific to this intent (not generic)
- [ ] Pain points describe current problems (not future wishlist)
- [ ] Key scenarios are concrete and actionable
- [ ] Access levels are specified for each persona
- [ ] Persona-Unit mapping is populated (after unit decomposition)
- [ ] No duplicate personas (same role described twice under different names)
- [ ] Every persona is referenced by at least one user story's "As a..." clause
- [ ] Frontmatter fields all populated (no placeholders)
