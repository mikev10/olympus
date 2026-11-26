# External review of R58, codex, 2026-11-25

R58 (a refused run says so, and a spent budget parks at once), reviewed from the
bundle alone. The triage of this reply and Gemini's is
`2026-11-25-R58-refused-and-budget-spent-triage.md`.

## Source

- **Reviewer:** gpt-6-astra. Family: codex. A headless `codex exec` run under a
  read-only sandbox, with recorded approval policy `never`, in an empty scratch
  working directory and a scratch config home holding only `auth.json`, with an
  environment of `CODEX_HOME` alone. The pre-run listing of both is the manifest's
  `cleanRoom`.
- **Cross-family agreement:** the first construction of finding 1 (a call that
  succeeds after its budget is spent is not parked) is Gemini's only finding too.
  The second construction of finding 1, and findings 2, 3 and 4, Codex raised alone.
- **Date:** 2026-11-25
- **Bundle:** `2026-11-25-R58-refused-and-budget-spent-review-bundle.txt`, SHA-256
  `f0d29340414dd7c0fd8e45519713b02d981d19b3565d412231013f313ecbf091`, base `df9a614`
  (`reviewed/R57`), head `d6eb183` (R58's tip before the review files). It held 30
  changed files: R58's, and the changes merged since R57's review (A-R28-02 and the
  local-check tooling). `docs/decisions.md`, `docs/reviews/`, `docs/plan/` and
  `pnpm-lock.yaml` were excluded. Prompt:
  `2026-11-25-R58-refused-and-budget-spent-review-prompt.txt`.
- **Prior context and lookups:** it said it had no prior project context and made
  no external lookups, and that a local directory read was blocked. A self-report,
  not independently verifiable.
- **Coverage, and any gap:** items 1, 3, 6 and 7 were answered. Item 2 was answered
  in the negative (the new tests are not tautologies), item 4 in the negative, and
  item 5 through findings 2 and 3. Nothing was left empty.
- **Citations:** line numbers refer to positions in the bundle's diffs, not located
  in the repository; each finding was checked against the construct it names.

---

BASE: reviewed/R57  
HEAD: d6eb183  
scripts/test/local-check.test.ts  
161cd26ba5992b1fa0f086c1bd59d43c

I have no prior project context. I reviewed the supplied text without external lookups. A local directory-read attempt was blocked; I did not execute tests or verify the file’s SHA-256.

1. **packages/api/src/line.ts:1211 — factually wrong — high — Exhaustion is enforced only when the model’s call fails and a request was refused.**

   Two constructions bypass the stated budget invariant:

   - Exhaust the budget, receive a relay refusal, then finish with a valid driver result. `!outcome.ok` is false, so no budget park occurs. Leave an implementation that fails verification: the next build iteration can receive a fresh relay under the same bounds.
   - Reach exhaustion and stop unsuccessfully before sending another request. With `exhausted: 'cost'` and `refused: 0`, the failure takes the ordinary retry path. The new conformance control explicitly expects this retry.

   The first construction makes model-controlled completion behavior determine whether runtime-observed exhaustion stops further spending. Neither requires forging meter data.

   **Resolve:** persist exhaustion independently of driver success and refusal count, and prohibit further attempts under that budget. Whether an already-produced result may finish verification is a separate policy choice. Add assertions for successful completion after exhaustion and exhaustion with zero refusals. **Confidence: high.**

2. **scripts/local-check.ts:324 and scripts/local-check.ts:344 — factually wrong — medium — Process-level failures can disappear behind test-level results.**

   Preflight reads `ran.status` but never checks it. A report containing passed requested assertions, followed by a runner-level error and nonzero exit, still passes preflight.

   Full mode checks a nonzero exit only when there are *no* paid entries classified as `notRunHere`. Consequently, an ordinary stale paid report plus an unrelated unhandled runner error can satisfy the exception. `outcomesOf` extracts assertion and file failures but does not preserve report-level unhandled errors.

   **Resolve:** retain and reject runner-level errors independently of paid assertion failures. Excuse a nonzero exit only when its complete failure accounting consists of the authorized paid-report failures. Test both combinations. **Confidence: high about the control flow; the exact runner report shape should be verified against the pinned Vitest version.**

3. **scripts/local-check.ts:342 — factually wrong — medium — Full mode has no executed-test requirement.**

   Unlike preflight’s `unproven` check, full mode accepts whatever outcomes the report contains. `classify` ignores every status except `failed`; an empty `testResults` array is also accepted by `outcomesOf`.

   A conformance configuration that skips the suite and exits successfully therefore produces “nothing failed here” without executing its assertions. The script itself does not establish that its claimed acceptance suite ran.

   **Resolve:** reconcile expected assertions against executed outcomes in full mode, explicitly accounting for authorized exclusions, and reject empty execution. Add skipped-suite and empty-report cases. **Confidence: high.**

4. **packages/api/src/run.ts:2079 — unclear — medium — An unversioned refusal becomes an ordinary open standing.**

   A run refused before this field existed can retain a `station-refused` decision without `stateVersion`. When committed state otherwise reads open, this reader discards the refusal and reports open. The new assertion deliberately requires that behavior.

   This avoids falsely treating an old refusal as current, but it does not satisfy the supplied requirement that evidence which cannot be tied to current state receive the conservative reading. It cannot distinguish an obsolete refusal from an unresolved legacy refusal.

   **Resolve:** represent that uncertainty explicitly, or require reconciliation before reporting ordinary open status. If legacy refusals are intentionally excluded from the guarantee, narrow the guarantee accordingly. This is a compatibility-policy issue, not a demonstrated model-forgery attack. **Confidence: high about behavior; uncertain about the intended compatibility contract.**

The following mechanisms look sound within the supplied trust boundary:

- Budget **bound and limit attribution** comes from the trusted meter and policy, rather than failure text.
- Once a budget park is committed, `parkRefusal` reconstructs its recorded bound and limit; a missing budget payload throws instead of guessing (`packages/core/src/station/machine.ts:416`).
- State-version equality prevents a demonstrably stale refusal from overriding newer committed state. Committed stopped and approval standings take precedence (`packages/api/src/run.ts:2053`).
- The new conformance tests are not tautologies: they exercise runtime entry points and check invocation counts, persisted state, and resume behavior. Their weakness is coverage and, for exhaustion without refusal, an expectation contrary to the supplied invariant.
- The finding-outcome validator rejects the old `resolved` spelling at runtime; the rename is more than a TypeScript declaration change (`packages/vault/src/local/vault.ts:739`).

I found no demonstrated model-accessible bypass through casts, `any`, declaration merging, module augmentation, or type predicates. The JSON assertion in `refusedAt` supplies no runtime validation, but exploiting it by manufacturing Vault records would exceed the stated attacker’s authority. Likewise, the shown failure-detail handling stores text as data; I found no shown path that inserts it into a prompt.

The adversarial framing is appropriate for model-controlled completion, request timing, and workspace contents. It should be supplemented with a recovery question: **after exhaustion or refusal is observed, what durable fact prevents another attempt across interruption and resume?** The bundle does not show `park` or the complete resume reconciliation, so its record-before-commit recovery behavior cannot be established from this review.