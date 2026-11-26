# External review of R58, gemini, 2026-11-25

R58 (a refused run says so, and a spent budget parks at once), reviewed from the
bundle alone. The triage of this reply and Codex's is
`2026-11-25-R58-refused-and-budget-spent-triage.md`.

## Source

- **Reviewer:** gemini-3.1-pro-preview. Family: gemini. A direct `generateContent`
  API call to `gemini-3.1-pro-preview`, offering no tools. `cleanRoom` is `null`
  because an API call loads no local configuration.
- **Cross-family agreement:** its one finding (a call that succeeds after its budget
  is spent is not parked) is the first construction of Codex's finding 1.
- **Date:** 2026-11-25
- **Bundle:** `2026-11-25-R58-refused-and-budget-spent-review-bundle.txt`, SHA-256
  `f0d29340414dd7c0fd8e45519713b02d981d19b3565d412231013f313ecbf091`, base `df9a614`
  (`reviewed/R57`), head `d6eb183` (R58's tip before the review files). It held 30
  changed files: R58's, and the changes merged since R57's review (A-R28-02 and the
  local-check tooling). `docs/decisions.md`, `docs/reviews/`, `docs/plan/` and
  `pnpm-lock.yaml` were excluded. Prompt:
  `2026-11-25-R58-refused-and-budget-spent-review-prompt.txt`.
- **Prior context and lookups:** it disclosed nothing, though the prompt asked.
- **Coverage, and any gap:** one finding, under item 1. Items 2, 3, 4, 5, 6 and 7
  came back empty, including whether the framing was right. Its silence on them is
  not an endorsement.
- **Citations:** the line number refers to a position in the bundle's diff, not
  located in the repository; the finding was checked against the construct it names.

---

BASE: reviewed/R57
HEAD: d6eb183
FILE: scripts/test/local-check.test.ts
LAST LINE: 161cd26ba5992b1fa0f086c1bd59d43c

packages/api/src/line.ts:1196 — factually wrong — high — A model whose budget is spent can bypass the `budget-spent` park and gain another attempt with a fresh budget by ending its driver call with a successful/valid output instead of throwing an error. In `runTask`, the budget exhaustion check uses `!outcome.ok`. If the model detects a refusal (e.g. from a parallel subagent or retry) but forces the main request to return a valid output, `outcome.ok` is true, completely suppressing the `budgetSpent` refusal. The task completes the station successfully and proceeds to verification. Since the model likely returned an incomplete output, verification fails, which sends the task back to `build` for a new iteration. Because each iteration provisions a fresh relay with the full budget again, the model successfully gets another attempt started and continues spending money after the relay reported the budget spent, violating the "Default deny" property. — Remove the `!outcome.ok` condition so that a spent budget and a refused request always supersede the driver's outcome. If the relay meter is exhausted and a request was refused, `runTask` should return `{ ok: false, error: new Error('budget spent'), budgetSpent: ... }` regardless of whether the driver considered the call successful.