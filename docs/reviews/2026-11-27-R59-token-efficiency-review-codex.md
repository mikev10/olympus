# External review of R59, codex, 2026-11-27

An external review of R59 (token efficiency in the report, and tokens held to
a baseline in the benchmark), as the runner wrote it. What was done about each
finding is in `2026-11-27-R59-token-efficiency-triage.md`.

## Source

- **Reviewer:** gpt-6-astra. Family: codex.
  A headless `codex exec` run under a read-only sandbox, with recorded approval
  policy `never`, in an empty scratch working directory and a scratch config
  home holding only `auth.json`, with an environment of `CODEX_HOME` alone. The
  pre-run listing of both is the manifest's `cleanRoom`.
- **Cross-family agreement:** none. This review raised three findings
  (codex-1, codex-2, codex-3) and Gemini raised none of them; Gemini's two
  findings are about other constructs.
- **Date:** 2026-11-27
- **Bundle:** `2026-11-27-R59-token-efficiency-review-bundle.txt`, SHA-256
  `23bc61eca697eadff1300b1f11fcb7d62e9341144556eba6ee8767021d4402ee`, base
  `473324b` (`reviewed/R66`), head `887dcf6` (the unit's tip before the review
  files were committed). It held the 16 changed files: new files in full,
  modified files as function-context diffs. `docs/decisions.md`,
  `docs/reviews/`, `docs/plan/`, and `pnpm-lock.yaml` were excluded. Prompt:
  `2026-11-27-R59-token-efficiency-review-prompt.txt`.
- **Prior context and lookups:** the reviewer said it had no prior project
  context and performed no external lookups. That is its own report and
  cannot be checked independently.
- **Coverage, and any gap:** items 1, 2 and 3 were answered with findings.
  Item 4 was answered as no demonstrated bypass. Item 5 was not addressed by
  name. Item 6 lists five mechanisms it judged sound. Item 7 was answered:
  the framing fits provenance and fail-closed comparison, and "spent its
  tokens well" overstates what the figures show.
- **Citations:** line numbers refer to positions in the bundle, not the
  repository. Each finding was located by the function it names.

---

BASE: reviewed/R66  
HEAD: 887dcf6  
packages/conformance/src/registry/integration.ts  
f63039fe111cc5f142ae0bef5b4e6598

I had no prior project context and performed no external lookups. This review uses the supplied text; I did not execute tests or verify the file hash.

1. **packages/benchmark/src/tokens.ts:155 — factually wrong — medium — An unavailable comparison is reported as `within`.**  
   `fresh.perCall === null` immediately passes, even when the baseline also has no sample or the fresh figure has `bound: 'lower'`. The concrete construction is an item with repetitions `[{}, {}]`: `figure` returns no per-call figure, but `verdict` calls it `within`. A task with zero calls, positive token counts, and `bound: 'lower'` also passes validation and takes this branch.

   A critic genuinely rejected before any model call can produce empty task records legitimately. That establishes zero calls, but it does not establish a successful per-call comparison. Introduce an explicit no-sample outcome; reject contradictory zero-call counts and preserve uncertainty before considering a pass. **High confidence.**

2. **packages/benchmark/src/tokens.ts:85 and :174 — factually wrong — medium — Empty item sets satisfy the checker without checking anything.**  
   Give both results matching metadata and `tokens: { alone: [] }`. `counted` accepts them because the tokens object has a key; `holdTokens` returns `[]`; `tokenFailures` returns `[]`. The `tokenHold` callback therefore succeeds. The checker never establishes that token items cover the corpus or even the result’s own outcome items.

   This is a concrete fail-open behavior of the exported mechanism. **It is not a demonstrated bypass of the shown paid tier:** its fresh result is assembled in trusted runtime code, and editing a working-tree result does not replace that object. Nevertheless, the mechanism’s “comparison cannot be made” guarantee is false for empty inputs. Validate expected arm/item coverage against trusted corpus information, and explicitly reject or mark an empty comparison as no-sample. **High confidence in the behavior; production reachability beyond the shown caller is unestablished.**

3. **packages/benchmark/test/model.test.ts:90; packages/benchmark/src/alone.ts:112 — factually wrong — low — The new benchmark assertions do not establish relay provenance.**  
   The model test supplies `COUNTED` through replacement arm functions and verifies that `modelTier` preserves it. It never exercises the extraction in `aloneCall`. Likewise, the new critic plumbing expectation uses `tokens: {}`, so it cannot establish extraction of nonzero relay readings.

   Consequently, changing an arm to read driver-reported usage could leave these new assertions passing. Add extraction tests with deliberately conflicting driver claims and trusted meter readings, asserting that only the latter reach the result. This is a gap in the supplied assertions, **not evidence that the current extraction uses model claims**. Existing tests outside the bundle could supply coverage; checking those would resolve that uncertainty.

The following mechanisms look sound within the stated trust boundary:

- `aloneCall` copies token counts from sandbox teardown; the critic path reads usage through the trusted Vault. The shown extraction does not use a model’s usage narrative.
- `runReport` derives figures from usage and integration records, deduplicates merge commits, and reports no-sample when no merge exists.
- `committedResult` reads `HEAD` rather than staged or working-tree JSON. Missing Git objects and malformed JSON throw; the shown tier does not catch those failures and turn them into passes.
- Positive-call fresh lower bounds cannot pass merely because their measured counts are below the limit.
- The API arithmetic tests and conformance assertion use independently specified meter values. They are not tautological comparisons against the same production helper.

The baseline self-comparison is a consistency check, not evidence of regression detection. The separate “one token past the limit” assertion provides that evidence. The empty `TOKEN_BASELINES` loop is presently vacuous, but that is explicitly permitted by this unit’s scope.

I found no demonstrated language-specific bypass within the threat model. Casts erase static guarantees, but `counted` performs substantial runtime validation; its concrete omissions are identified above. Replacing trusted dependencies, augmenting repository types, or executing arbitrary runtime code would exceed the stated attacker control.

The framing is appropriate for provenance and fail-closed comparisons, but “spent its tokens well” overstates these metrics. A model can improve read-per-written by emitting unnecessary output. More equally expensive critic calls also preserve tokens per call while increasing total spend, as the tests explicitly demonstrate. Those are limitations of what the chosen metrics mean, rather than violations of their arithmetic. The useful claim is that the report faithfully describes measured consumption—not that those measurements establish useful work per token.