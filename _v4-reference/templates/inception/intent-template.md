# Intent Template

Use this template when creating the root intent document during Requirements Analysis.

**Output path**: `aidlc-docs/{intent-id}/intent.md`

This is the **root business document** for the entire workflow. Every phase — inception, construction, operations — references this file. It captures WHAT we're building and WHY, not HOW.

---

## Frontmatter

```yaml
---
type: intent
intent: "{intent-id}"
status: draft
created: "{YYYY-MM-DDTHH:MM:SSZ}"
updated: "{YYYY-MM-DDTHH:MM:SSZ}"
author: "{name}"
---
```

## Required Frontmatter Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | YES | Always `intent` |
| `intent` | string | YES | Intent identifier (used as folder name) |
| `status` | string | YES | `draft` on creation, `ready` when approved at Gate 1 |
| `created` | string | YES | ISO 8601 timestamp |
| `updated` | string | YES | ISO 8601 timestamp, updated on each change |
| `author` | string | YES | Who drafted this intent (PO, BA, or facilitator name) |

---

## Required Body Content

```markdown
# Intent: {Intent Name}

## Intent Statement

<!-- 1-2 sentence summary of what we're building and why. This is the elevator pitch. -->
<!-- Example: "Migrate the Location Setup page from legacy VB.NET iframe to native Angular, enabling full UI consistency and removing iframe bridge dependencies." -->

{What we are building and why, in 1-2 sentences.}

## Business Objective

<!-- What business outcome does this achieve? Think in terms of value delivered to the organization, not technical implementation. -->

{The business outcome this intent delivers.}

## Success Criteria

<!-- Measurable outcomes that determine whether this intent succeeded. Each criterion should be specific and verifiable. -->

- {Measurable outcome 1}
- {Measurable outcome 2}
- {Measurable outcome 3}

## User Personas

<!-- Reference the project-wide personas file and list which personas are affected by this intent. Personas are defined in inception/personas.md. -->

**Personas file:** `inception/personas.md`

**Affected personas:**
- {Persona 1} -- {how they are affected}
- {Persona 2} -- {how they are affected}

## Scope

### In Scope

- {What IS included in this intent}
- {Specific functionality, pages, features, or domains}
- {Be explicit to prevent scope creep}

### Out of Scope

- {What is explicitly NOT included}
- {Adjacent features that will NOT be touched}
- {Future work that is deferred}

## Business Constraints

<!-- Timeline, budget, compliance, dependencies on other teams, or organizational constraints that affect delivery. -->

| Constraint | Detail |
|------------|--------|
| Timeline | {deadline or sprint target} |
| Budget | {budget constraints, if any} |
| Compliance | {regulatory or legal requirements} |
| Team dependencies | {other teams that must deliver something for this to succeed} |
| Release constraints | {deployment windows, feature flags, rollback plan} |

## Technical Context

<!-- Brief technical context. This is NOT the full architecture (that lives in .aidlc/project-context.md). Just enough to orient readers on what code/repos/stack is involved. -->

- **Affected repos:** {repo names}
- **Tech stack:** {languages, frameworks involved}
- **Pathway:** {brownfield-enhancement | brownfield-migration | greenfield}
- **Key integration points:** {APIs, services, or external systems touched}

## Risks & Assumptions

### Risks

<!-- Known risks specific to this intent. Not general project risks. -->

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| {Risk 1} | High/Medium/Low | High/Medium/Low | {How to mitigate} |
| {Risk 2} | High/Medium/Low | High/Medium/Low | {How to mitigate} |

### Assumptions

<!-- Things we believe to be true that, if wrong, would change the plan. -->

| Assumption | If Wrong |
|------------|----------|
| {Assumption 1} | {Impact and response if this assumption is invalid} |
| {Assumption 2} | {Impact and response if this assumption is invalid} |
```

---

## Quality Checklist

Before marking an intent as `status: ready`:

- [ ] Intent statement is clear and specific (1-2 sentences)
- [ ] Business objective describes value, not implementation
- [ ] Success criteria are measurable and verifiable
- [ ] Affected personas listed with impact description
- [ ] Scope boundaries defined (In Scope AND Out of Scope)
- [ ] Business constraints documented (timeline, compliance, dependencies)
- [ ] Technical context provides orientation without duplicating project-context.md
- [ ] Risks have impact, likelihood, and mitigation
- [ ] Assumptions have "if wrong" consequences
- [ ] Frontmatter fields all populated (no placeholders)
