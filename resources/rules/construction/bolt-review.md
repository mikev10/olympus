# Bolt Review - Mandatory Quality Gate

## Overview

The Bolt Review stage is a mandatory quality gate that runs after every bolt's code generation is complete. The BoltReviewer evaluates whether the generated code meets the bolt's acceptance criteria and aligns with the approved spec.

Review is performed by the `momus` agent via a review callback. BoltReviewer returns structured decision objects — it does not interact with users directly. User interaction (acknowledgment prompts, escalation notices) is handled by the orchestrator based on the decision returned.

---

## Two-Tier Alignment Model

The BoltReviewer scores each bolt on a 0-100% alignment scale and maps the score to one of three tiers:

| Score | Tier | Action |
|-------|------|--------|
| >= 70% | Auto-approve | Bolt accepted automatically; no user interaction required |
| 50-69% | Advisory | Bolt proceeds with mandatory user acknowledgment |
| < 50% | Hard block | Bolt rejected; must be re-scoped or split before retrying |

### Auto-Approve (>= 70%)

The bolt is accepted. The orchestrator transitions the bolt state from `in_review` to `done` without prompting the user.

### Advisory (50-69%)

The orchestrator presents the review findings to the user and requires explicit acknowledgment before the bolt proceeds. The user must confirm they understand the concerns and accept the bolt as-is.

Acknowledgment is recorded in the bolt's `ConstructionBoltProgress` entry:
- `acknowledged_by`: identifier of the user who acknowledged
- `acknowledged_at`: ISO 8601 timestamp of acknowledgment

### Hard Block (< 50%)

The bolt is rejected. The orchestrator transitions the bolt state to `failed`. The user must re-scope the bolt (narrow scope, reduce complexity) or split it into smaller bolts before code generation can be retried.

Hard blocks are never overridden, regardless of trust level.

---

## Trust-Based Auto-Approval

When the trust level for the workflow is >= 2, the advisory tier (50-69%) is upgraded to auto-approve. This means:

- Trust level 0-1: advisory tier requires user acknowledgment
- Trust level >= 2: advisory tier auto-approves (treated as >= 70%)
- Hard block (< 50%): **never overridden** by trust level

The trust level is stored in the workflow checkpoint and reflects the user's established confidence in the AI agent for this workflow.

---

## Escalation

If a bolt accumulates 2 consecutive review failures (2 reviews both scoring < 50%), an escalation event is triggered.

The escalation event includes:
- Bolt ID and title
- Failure count
- Recommended actions:
  - **Re-scope**: Narrow the bolt's scope to reduce complexity
  - **Split**: Divide the bolt into two or more smaller bolts with tighter acceptance criteria

The orchestrator surfaces the escalation to the user and halts further attempts on that bolt until the user chooses an action.

---

## Review Artifact

After each review, BoltReviewer writes a structured artifact:

**Path**: `{workflowId}/construction/bolts/{boltId}/review.md`

### Required Sections

**Score** — Numeric alignment score (0-100%) with a brief rationale.

**Decision** — One of: `approved`, `advisory`, `rejected`.

**Feedback** — Specific, actionable observations about the generated code relative to the bolt's acceptance criteria. Each item should reference a specific criterion or target file.

**Concerns** — List of issues that contributed to score reduction. May be empty for approved bolts.

**Recommended Actions** _(escalation only)_ — Present only when 2 consecutive failures have occurred. Lists concrete steps the user should take (re-scope or split).

---

## Acknowledgment Fields

When a bolt is accepted at the advisory tier, the orchestrator records acknowledgment on the bolt's progress entry in the checkpoint:

```json
{
  "acknowledged_by": "user",
  "acknowledged_at": "2026-01-15T10:30:00Z"
}
```

These fields are stored on the `ConstructionBoltProgress` object alongside the bolt's lifecycle state.

---

## BoltReviewer Behavior

BoltReviewer is a decision engine, not an interactive agent. It:

- Reads the bolt spec (`spec.md`) and the generated code in `Target Files`
- Evaluates alignment against each acceptance criterion
- Computes a score and selects a tier
- Writes the `review.md` artifact
- Returns a structured decision object to the orchestrator

All user-facing communication (presenting advisory findings, requesting acknowledgment, surfacing escalations) is the orchestrator's responsibility, not BoltReviewer's.

The `momus` agent is dispatched via the review callback (`reviewCallback`) to perform the evaluation.
