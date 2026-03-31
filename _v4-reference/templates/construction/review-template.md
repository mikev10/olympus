# Review Template

Use this template when creating per-bolt review artifacts after the build step completes. The AI drafts the review from build output and test results. QA enriches it with validation notes. The review is the audit trail and handoff record for each bolt.

**Output path**: `aidlc-docs/{workflowId}/construction/{UNIT-NNN-slug}/bolts/{BOLT-NNN-slug}/review.md`

**Input artifacts**: Bolt spec (`spec.md`), build output (test results, lint results), code diff, functional design, business rules.

---

## Frontmatter

```yaml
---
type: review
intent: {intent-id}
unit: {UNIT-NNN-slug}
bolt: {BOLT-NNN-slug}
status: passed
reviewer: {name}
qa_validator: {name}
created: "{YYYY-MM-DDTHH:MM:SSZ}"
---
```

---

## Required Frontmatter Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | YES | Always `review`. |
| `intent` | string | YES | Parent workflow ID (matches `{workflowId}`). |
| `unit` | string | YES | Unit slug this bolt belongs to (e.g., `UNIT-001-location-setup`). |
| `bolt` | string | YES | Bolt ID being reviewed (e.g., `BOLT-001-api-endpoints`). |
| `status` | string | YES | Review outcome: `passed`, `failed`, or `needs_changes`. |
| `reviewer` | string | YES | Name of the reviewer (dev name or `"AI-reviewed"` in solo mode). |
| `qa_validator` | string | YES | Name of the QA validator (QA name or `"AI-validated"` in solo mode). |
| `created` | string | YES | ISO 8601 timestamp of review creation. |

### Status Values

| Status | Meaning | Next Action |
|--------|---------|-------------|
| `passed` | All acceptance criteria met, code quality acceptable, tests passing | Advance to next bolt |
| `needs_changes` | Minor issues found, fixable without re-planning | Fix issues, re-review |
| `failed` | Significant problems, may require re-planning or spec revision | Return to plan step or revise spec |

---

## Required Body Content

```markdown
# Review: {BOLT-NNN-slug}

## Review Summary

<!-- Status (passed/failed/needs_changes) and a 1-2 sentence summary.
     What was built, whether it meets expectations, any notable observations. -->

**Status:** {passed | failed | needs_changes}

{1-2 sentence summary of the review outcome. E.g., "All acceptance criteria met.
API endpoints follow existing patterns and test coverage exceeds 80%."}

## Acceptance Criteria

<!-- Copy the acceptance criteria from the bolt spec.
     Check off criteria that are satisfied. Leave unchecked any that failed,
     with an explanation of why. -->

- [x] {Criterion 1 -- satisfied}
- [x] {Criterion 2 -- satisfied}
- [ ] {Criterion 3 -- NOT satisfied: explanation of what failed or is missing}

## Tests

<!-- Summary of test results from the build step.
     Include counts and pass/fail status.
     Note any tests that were skipped or are pending. -->

{N} unit tests (all passing), {N} integration tests (all passing)

<!-- For more complex results: -->
<!-- | Test Suite | Count | Passing | Failing | Skipped |
     |------------|-------|---------|---------|---------|
     | Unit       | {N}   | {N}     | {N}     | {N}     |
     | Integration| {N}   | {N}     | {N}     | {N}     | -->

## Code Quality

<!-- Brief assessment of code quality: patterns followed, consistency with
     codebase conventions, any deviations from established patterns.
     Note if the code follows the patterns referenced in the bolt spec. -->

- {Assessment of pattern adherence}
- {Note on consistency with existing codebase}
- {Any code quality concerns or commendations}

## QA Validation

<!-- Who validated, method (manual/automated/both), observations.
     In solo/AI mode: "AI-validated against acceptance criteria."
     In team mode: QA name, manual testing notes, edge cases verified. -->

- **Validated by:** {QA name or "AI-validated"}
- **Method:** {Manual / Automated / Both}
- **Notes:** {Observations, edge cases tested, UX feedback}

## Deviations from Spec

<!-- Any changes made during implementation that differ from the bolt spec.
     This is not inherently negative -- some deviations are improvements.
     "None" if implementation exactly matched the spec. -->

{Description of deviations, or "None."}

<!-- Examples of acceptable deviations:
     - "Added input sanitization not in spec -- flagged in functional-design.md for future bolts."
     - "Used shared utility instead of creating new helper as spec suggested -- reduces duplication."
     - "Added rate limiting not in spec -- discussed with tech lead, approved." -->

## Issues Found

<!-- Any bugs, concerns, or tech debt introduced during this bolt.
     "None" if no issues.
     Issues should be triaged: fixed in this bolt, deferred to a future bolt, or accepted as-is. -->

| Issue | Severity | Status | Notes |
|-------|----------|--------|-------|
| {Issue description} | Low / Medium / High / Critical | Fixed / Deferred / Accepted | {Context, e.g., "Deferred to BOLT-005"} |

<!-- For clean builds with no issues: -->
<!-- None. -->
```

---

## Concrete Example: Passed Review

```yaml
---
type: review
intent: facility-management
unit: UNIT-001-location-setup
bolt: BOLT-001-api-endpoints
status: passed
reviewer: "Senior Dev"
qa_validator: "QA Lead"
created: "2025-07-10T16:30:00Z"
---
```

```markdown
# Review: BOLT-001-api-endpoints

## Review Summary

**Status:** passed

All CRUD endpoints implemented for the Location entity. API follows existing controller
patterns and test coverage is at 92%.

## Acceptance Criteria

- [x] GET /api/locations returns paginated list
- [x] POST /api/locations validates against business rules (BR-001 through BR-005)
- [x] PUT /api/locations/:id enforces ownership check
- [x] DELETE /api/locations/:id is soft-delete (sets IsActive = false)
- [x] Standard error envelope on all failure responses
- [x] Auth checks return 401/403/422 as appropriate

## Tests

12 unit tests (all passing), 6 integration tests (all passing)

## Code Quality

- Controller follows the pattern established in CompanyController
- Repository uses parameterized queries consistently
- DTOs separate API contract from domain model
- No direct Entity Framework usage in controllers -- all via repository

## QA Validation

- **Validated by:** QA Lead
- **Method:** Manual + Automated
- **Notes:** Tested all CRUD operations via Postman. Verified soft-delete does not
  return deleted records in list endpoint. Confirmed 403 response for non-admin users.

## Deviations from Spec

None.

## Issues Found

| Issue | Severity | Status | Notes |
|-------|----------|--------|-------|
| Pagination defaults to 100 items (spec said 50) | Low | Fixed | Updated default page size to 50 |
```

---

## Quality Checklist

Before finalizing a review:

- [ ] Status accurately reflects the review outcome (passed/failed/needs_changes)
- [ ] Review summary is concise (1-2 sentences)
- [ ] All acceptance criteria from the bolt spec are listed and checked/unchecked
- [ ] Failed criteria have clear explanations
- [ ] Test results include counts and pass/fail status
- [ ] Code quality assessment references codebase patterns
- [ ] QA validation identifies who validated and how
- [ ] Deviations from spec are documented (or explicitly "None")
- [ ] Issues are triaged with severity and status
- [ ] Frontmatter fields all populated (no placeholders)
