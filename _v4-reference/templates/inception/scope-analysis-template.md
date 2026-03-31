# Scope Analysis Template

Use this template when creating the scoped discovery output during the Discovery stage.

**Output path**: `aidlc-docs/{intent-id}/inception/discovery/scope-analysis.md`

This is the **Layer 2 discovery artifact** -- a focused scan of the code paths affected by this specific intent. AI reads the persistent project context (Layer 1 in `.aidlc/`) first, then produces this scoped analysis. The output should be small and fast to review because AI already has the big picture from Layer 1.

---

## Frontmatter

```yaml
---
type: scope-analysis
intent: "{intent-id}"
status: draft
discovery_depth: "{minimal | standard | full}"
created: "{YYYY-MM-DDTHH:MM:SSZ}"
updated: "{YYYY-MM-DDTHH:MM:SSZ}"
---
```

## Required Frontmatter Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | YES | Always `scope-analysis` |
| `intent` | string | YES | Parent intent identifier |
| `status` | string | YES | `draft` on creation, `ready` when reviewed by mob |
| `discovery_depth` | string | YES | `minimal` (team knows area well), `standard` (moderate familiarity), `full` (nobody knows this area) |
| `created` | string | YES | ISO 8601 timestamp |
| `updated` | string | YES | ISO 8601 timestamp, updated on each change |

---

## Required Body Content

```markdown
# Scope Analysis: {Intent Name}

## Discovery Summary

<!-- What was scanned, what depth level was used, and why that depth was chosen. Reference the technical brief if one was provided. -->

- **Depth:** {minimal | standard | full}
- **Reason for depth:** {e.g., "Senior dev provided technical brief covering key constraints" or "Nobody on the team has touched this module in 2+ years"}
- **Technical brief provided:** Yes/No
- **Areas scanned:** {list of repos, directories, or modules examined}

## Affected Components

<!-- Components that this intent will touch. Be specific -- file paths help squads orient quickly. -->

| Component | File Path | Type | Impact |
|-----------|-----------|------|--------|
| {Component 1} | `{path/to/file}` | Controller/Service/Model/Page/Component | New/Modify/Remove |
| {Component 2} | `{path/to/file}` | Controller/Service/Model/Page/Component | New/Modify/Remove |

## Integration Points

<!-- What this intent connects to. APIs, databases, external services, shared components, message queues, etc. -->

| Integration | Type | Direction | Notes |
|-------------|------|-----------|-------|
| {API/Service/DB} | REST/gRPC/SQL/Event | Inbound/Outbound/Both | {Relevant details} |

## Data Flow

<!-- How data moves through the affected components. Can be brief text description or a simple diagram description. For complex flows, describe the path data takes from user action to persistence and back. -->

{Description of how data flows through the affected area. For simple intents, a few sentences suffice. For complex intents, describe the full path.}

## Identified Risks

<!-- Risks discovered during the codebase scan. These are specific to the code, not general business risks (those go in intent.md). -->

| Risk | Severity | Mitigation |
|------|----------|------------|
| {Risk 1 -- e.g., "Shared service used by 3 other pages"} | High/Medium/Low | {How to mitigate} |
| {Risk 2 -- e.g., "No existing tests for affected module"} | High/Medium/Low | {How to mitigate} |

## Technical Debt

<!-- Pre-existing issues in the affected code that may complicate or block this intent. Surfacing these now prevents surprises during construction. -->

- {Debt item 1 -- e.g., "Legacy stored procedure with undocumented side effects"}
- {Debt item 2 -- e.g., "Inconsistent naming conventions across controllers"}
- {Debt item 3 -- e.g., "No dependency injection, tightly coupled to concrete implementations"}

## Dependencies

<!-- External dependencies, shared libraries, other team's code that is affected. Different from integration points -- these are things that could block or slow down work. -->

| Dependency | Owner | Impact | Risk |
|------------|-------|--------|------|
| {Shared library/package} | {Team or maintainer} | {What depends on it} | Low/Medium/High |
| {Other team's API} | {Team name} | {What we need from them} | Low/Medium/High |

## Recommendations

<!-- Suggestions for how to decompose this intent into units, based on what was discovered. These feed into Units Generation. -->

- {Recommendation 1 -- e.g., "Separate API layer from UI work -- different risk profiles"}
- {Recommendation 2 -- e.g., "Reuse existing LocationService rather than building new"}
- {Recommendation 3 -- e.g., "Address the shared dropdown component first -- 3 units depend on it"}
```

---

## Depth-Level Guidance

| Depth | When to Use | Sections Affected |
|-------|-------------|-------------------|
| **minimal** | Senior dev provided technical brief, team knows the area | Affected Components: key files only. Data Flow: brief text. Tech Debt: known items only. |
| **standard** | Team worked on this area recently, moderate familiarity | All sections at normal detail. AI fills gaps from codebase scan. |
| **full** | Nobody has touched this in years, no technical brief | All sections at maximum detail. AI does deep scan. Mob reviews carefully. |

## Quality Checklist

Before marking a scope analysis as `status: ready`:

- [ ] Discovery depth is justified (not defaulting to full when minimal would suffice)
- [ ] Affected components list is complete with file paths
- [ ] Integration points identified (APIs, databases, external services)
- [ ] Data flow described at appropriate depth for the discovery level
- [ ] Risks are codebase-specific (not duplicating intent.md risks)
- [ ] Technical debt items are actionable (not vague)
- [ ] Dependencies identify owners and risk levels
- [ ] Recommendations are specific enough to guide unit decomposition
- [ ] Frontmatter fields all populated (no placeholders)
