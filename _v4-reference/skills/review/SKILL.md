---
description: Review a plan with Momus
---

[DELEGATION REQUIRED]

You must delegate this review to the Momus agent with criteria tailored to the artifact type.

## Artifact Type Detection

Determine the artifact type from the file path provided in `$ARGUMENTS`:

| Path Pattern | Artifact Type |
|-------------|--------------|
| `.olympus/plans/*` | Plan |
| `*/inception/intent.md` | Intent |
| `*/inception/user-stories/*` | User Stories |
| `*/inception/units/unit-of-work*.md` | Unit Decomposition |
| `*/construction/*-code-generation-plan.md` | Code-Generation Plan |
| `*/inception/application-design/components.md` or `*/inception/application-design/services.md` | Design Docs |
| `*/audit.md` | Audit Trail |
| No path provided | Plan (default — review latest plan in `.olympus/plans/`) |
| Unknown path | Generic |

## Per-Artifact Evaluation Criteria

Based on the detected artifact type, use these criteria:

**Plan**: Clarity (80%+ claims cite file/line refs), Testability (90%+ criteria testable), Verification (file refs exist), Specificity (no vague terms without metrics)

**Intent**: Problem clarity, Scope boundaries defined, Measurable success criteria, Constraint completeness, Exclusions defined, Persona coverage

**User Stories**: INVEST compliance, Acceptance criteria testability, Persona coverage, No orphaned stories

**Unit Decomposition**: Unit independence, Story coverage completeness, Dependency validity, No circular deps

**Code-Generation Plan**: Scope fits single unit, Feasibility, Test plan present, Risk identification, Consistency with unit spec

**Design Docs**: Consistency with intent, Component completeness, Interface definitions, Dependency accuracy

**Audit Trail**: Completeness (all decisions recorded), Traceability to requirements, Gate decisions documented

**Generic**: Structure, Completeness, Internal consistency, Actionability

## Dispatch to Momus

**IMMEDIATELY** use the Task tool:

```
Task(
  subagent_type="momus",
  description="Artifact review",
  prompt="""
$ARGUMENTS

Detect the artifact type from the file path and apply the appropriate evaluation criteria listed above.
If no path is provided, review the most recent plan in `.olympus/plans/`.

Provide one of these verdicts:
- **APPROVED** - Artifact meets all criteria
- **REVISE** - Issues found (provide specific feedback)
- **REJECT** - Fundamental problems

After your review, save the review output as a sibling file:
- Name it `{artifact-name}-review.md` in the same directory as the reviewed file
- Include metadata at the top: reviewer (momus), trigger (manual), trust level (from .olympus/trust-state.json), verdict
- Example: reviewing `intent.md` → save review to `intent-review.md`
  """
)
```

**DO NOT** attempt to review the artifact yourself - you must spawn the Momus agent.