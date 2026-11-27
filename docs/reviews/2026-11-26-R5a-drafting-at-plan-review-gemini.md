BASE: reviewed/R58
HEAD: be7353a
scripts/test/local-check.test.ts
7a919b4984e35f27d118c217e250f51f

I have reviewed the provided code. I had no prior context and performed no external lookups. The codebase's invariant enforcement (especially around parsing graphs, bounds checking, and handling draft states) is exceptionally thorough. I found two issues:

file:packages/api/src/planning.ts:73
type: a tradeoff I would have made differently
severity: medium
the concrete bypass or issue: `boundGraph` identifies the `costliest` role by comparing `resolved.scope.budget.maxCostUsd`. However, the actual cost (calculated by `worstCaseCost`) also factors in tier pricing and escalation costs. A role with a lower base `maxCostUsd` but a much higher escalation ceiling will not be chosen as `costliest`, leading to an underestimated `approved` figure at admission. If the planner subsequently drafts a graph using that highly-escalated role, the draft parses cleanly and passes approval. When `lockApproved` runs, `graphWithinBound` correctly detects `own > approved` and throws a generic `Error`. While this fails closed by preventing the lock, it causes an unhandled exception that wedges the run and crashes the line drive, rather than cleanly sending the draft back or refusing the approval.
what would resolve it: In `boundGraph`, calculate the full `worstCaseCost` for each role to accurately determine the true costliest role. Alternatively, check the draft's worst-case cost against the bound inside `readGraphDraft` so it cleanly fails the `shape` condition, rather than throwing during the lock phase.

file:packages/api/src/line.ts:2066
type: ways the configuration can be satisfied without doing what it appears to do
severity: low
the concrete bypass or issue: In the `review` function, the `offered` object is populated with `plan: JSON.stringify(graphOf(ctx).tasks)` and `'author-narrative'`. However, neither `plan` nor `author-narrative` is included in `STATION_CONTRACTS.review.allowedContext` (defined in `packages/core/src/station/contracts.ts`). Because they are missing from the `allowedContext`, `grantedContext` silently strips both fields out, and they never reach the reviewer's prompt. This fails closed (the reviewer gets less context, preventing the author's objective from leaking), but the code explicitly attempts to grant context that it does not actually deliver.
what would resolve it: Either add `plan` and `author-narrative` to `STATION_CONTRACTS.review.allowedContext` if the reviewer is intended to receive them, or remove them from the `offered` object in `line.ts` to reflect the actual grants.