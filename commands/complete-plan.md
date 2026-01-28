---
description: Verify and complete a plan after implementation - summon the gods of code
---

[PLAN COMPLETION MODE - VERIFICATION REQUIRED]

$ARGUMENTS

## The Completion Oath

**Summon the gods of code.** A plan is NOT complete until EVERY acceptance criterion is VERIFIED.

This is NOT a rubber stamp. This is a court of judgment.

## Phase 1: Plan Analysis (MANDATORY)

First, read and analyze the plan file:

1. **Locate the Plan**: If no path provided, check `.olympus/plans/` for the most recent plan
2. **Extract All Criteria**: List EVERY acceptance criterion, deliverable, and success metric
3. **Identify Verification Methods**: For each criterion, determine HOW to verify it

## Phase 2: Systematic Verification (MANDATORY)

For EACH criterion, you MUST:

| Step | Action | Required Evidence |
|------|--------|-------------------|
| 1 | Read the relevant code/files | File paths, line numbers |
| 2 | Run verification commands | Test output, build output |
| 3 | Check for edge cases | Error handling, validation |
| 4 | Document the evidence | Screenshots, logs, diffs |

### Verification Commands

```bash
# Tests pass
npm test / pytest / go test

# Build succeeds
npm run build / make / cargo build

# Types check
npm run typecheck / mypy / tsc --noEmit

# Lint passes
npm run lint / ruff / golangci-lint
```

## Phase 3: Judgment

Based on your verification, assign ONE status:

| Status | Meaning | Criteria |
|--------|---------|----------|
| **COMPLETED** | All criteria verified | 100% of acceptance criteria met with evidence |
| **PARTIAL** | Some criteria met | >50% verified, blockers documented |
| **INCOMPLETE** | Significant gaps | <50% verified, major work remaining |
| **ABANDONED** | Plan no longer relevant | Context changed, plan obsolete |

**COMPLETED requires Oracle review**: Before marking COMPLETED, spawn Oracle to review your verification evidence.

## Phase 4: Documentation

Create completion record at `.olympus/completions/{plan-name}-completion.md`:

```markdown
# Plan Completion: {Plan Name}

## Status: {COMPLETED|PARTIAL|INCOMPLETE|ABANDONED}

## Verification Date: {date}

## Criteria Verification

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | {criterion} | ✅/❌ | {file:line, test output, etc} |

## Summary
{What was accomplished, what remains}

## Oracle Review
{Oracle's assessment if COMPLETED}
```

## Phase 5: Archive

If COMPLETED:
1. Move plan to `.olympus/archive/`
2. Update any tracking documents
3. Report completion to user

If NOT COMPLETED:
1. Keep plan in `.olympus/plans/`
2. Document blockers and remaining work
3. Recommend next steps

---

**Remember: Summon the gods of code. Verify everything. Trust nothing without evidence.**
