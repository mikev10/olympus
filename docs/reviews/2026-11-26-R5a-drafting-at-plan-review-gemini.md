# External review of R5a, gemini, 2026-11-26

R5a (drafting at `plan`), reviewed from the bundle alone. The triage of this reply
and Codex's is `2026-11-26-R5a-drafting-at-plan-triage.md`.

## Source

- **Reviewer:** gemini-3.1-pro-preview. Family: gemini. A direct `generateContent`
  API call to `gemini-3.1-pro-preview`, offering no tools. `cleanRoom` is `null`
  because an API call loads no local configuration. This is the family's third
  run: the first two were `FAILED`, each an HTTP 402 from Google for depleted
  prepaid credit before any reply, and are kept as `.attempt-1` and `.attempt-2`.
- **Cross-family agreement:** none. Neither of its two findings (the costliest
  role chosen by per-call ceiling; the review seat offered grants its contract
  drops) was raised by Codex, and it did not raise Codex's one.
- **Date:** 2026-11-26
- **Bundle:** `2026-11-26-R5a-drafting-at-plan-review-bundle.txt`, SHA-256
  `754837ca862f486d2c06d9c26b740c359f5c355f19609ad2dadf410d4917caa1`, base `e3e851c`
  (`reviewed/R58`), head `be7353a` (R5a's tip before the review files). It held 52
  changed files: R5a's, and the one change merged since R58's review (the
  local-check tooling, #250). `docs/decisions.md`, `docs/reviews/`, `docs/plan/` and
  `pnpm-lock.yaml` were excluded. Prompt:
  `2026-11-26-R5a-drafting-at-plan-review-prompt.txt`.
- **Prior context and lookups:** it said it had no prior context and made no
  external lookups. This is a self-report and cannot be verified independently.
- **Coverage, and any gap:** it raised two findings, one of which it filed under
  item 5. Items 2, 3, 4, 6 and 7 were not answered: it named no tautological
  check, no fail-open path, no language escape hatch, assessed no mechanism as
  sound beyond one general sentence, and said nothing on whether the framing was
  right. Silence is not an endorsement.
- **Citations:** line numbers are positions in the bundle's diffs, not in the
  repository. Each was treated as a hint to the function it names.

---

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