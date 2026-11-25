# External review of R54, codex, 2026-11-23

The review of R54: the benchmark's model tier run per model, the rule that
compares two runs, the paid workflow, and the committed results. The bundle
also carried the admission change A-R40-02, merged since the last reviewed
tag. Everything below the rule under this header is the reviewer's reply,
unedited. The triage is `2026-11-23-R54-deep-tier-benchmark-triage.md`.

## Source

- **Reviewer:** gpt-6-astra. Family: codex.
  A headless `codex exec` run under a read-only sandbox, with recorded
  approval policy `never`, in an empty scratch working directory and a scratch
  config home holding only `auth.json`, with an environment of `CODEX_HOME`
  alone. The pre-run listing of both is the manifest's `cleanRoom`.
- **Cross-family agreement:** gemini raised four of these six too. codex-1 is
  gemini-1 (results not tied to a run). codex-4 is gemini-2 (the pull
  request's code runs with the key). codex-5 is gemini-3 (no comparison, no
  assertion). codex-2 and codex-3 overlap gemini-4 (summaries trusted, items
  not compared). codex-6 was raised by codex alone.
- **Date:** 2026-11-23
- **Bundle:** `2026-11-23-R54-deep-tier-benchmark-review-bundle.txt`, SHA-256
  `221f7416648bf8050a04dbf8628a0675ffb3c9e9ff87f390559c5ca6cfe89896`, base
  `03518f9` (`reviewed/R53`), head `4a3b15d` (the results and their
  comparison committed, before any review fix). It held every new file in
  full and every modified file as a function-context diff, 34 sections.
  Excluded: `docs/decisions.md`, `docs/reviews/`, `docs/plan/`,
  `pnpm-lock.yaml`. Prompt: `2026-11-23-R54-deep-tier-benchmark-review-prompt.txt`.
- **Prior context and lookups:** the reviewer said it had no prior project
  context and performed no external lookups, and that a local file-listing
  attempt was blocked. This is a self-report and cannot be verified
  independently.
- **Coverage, and any gap:** items 1, 2, 3 and 5 are answered by the six
  findings. Item 4 (language escape hatches) is answered in the closing
  paragraphs: the unchecked JSON assertion, and no declaration-merging or
  augmentation bypass found. Item 6 (sound mechanisms) names three. Item 7
  (the framing) is answered: the framing fits, with the limit that the runs
  measure judging, not authoring. The reviewer said it could not assess the
  spend reservation, because `modelTier` and the relay were not in the bundle.
- **Citations:** line numbers refer to positions in the bundle, not the
  repository. Each finding was located by the construct it describes.

---

BASE: reviewed/R53  
HEAD: 4a3b15d  
packages/vault/src/types.ts  
d8f32c58d3087eaf059f5ab13a550abb

I had no prior project context and performed no external lookups. I reviewed the inline bundle. A local file-listing attempt was blocked; no tests were executed.

1. **packages/benchmark/test/comparison.test.ts:130 — factually wrong — high — Reproducibility of the comparison does not authenticate either run.**

   A PR can replace both result files and regenerate their comparison. For example, change the candidate’s recorded spend from `11.234404` to `1`, then regenerate the comparison: the supplied aggregate scores already give `noWorse: true`, so this produces `change: true`. The byte-for-byte test passes despite no run having produced that cost.

   Making the fabricated results internally consistent would not fix this: every input to this check remains PR-controlled. The workflow uploads results, but the check never binds committed bytes to those artifacts.

   **Resolve:** require independently authenticated run artifacts, bound to the evaluated revision, corpus and configuration, and verify committed result bytes against them. Keep recomputation as a separate consistency check.

2. **packages/benchmark/src/comparison.ts:110 — factually wrong — high — Unvalidated summaries can override the actual trial outcomes.**

   `side()` reads `overall.everyTrial`, not `items`. A candidate can contain worse trial verdicts while declaring perfect detection and a zero false-refusal rate in its summary. `compareRuns` accepts those summaries.

   Even the summary’s fields need not agree: false-dones use `sample - count`, whereas false refusals use the supplied `rate`. Set candidate false refusals to `count: 24, sample: 24, rate: 0`; the comparison treats this as no refusals. Both file readers use `JSON.parse(...) as BenchmarkResult`, which performs no runtime validation. With string costs, candidate `"100"` compares less than baseline `"20"` lexicographically.

   Empty samples also bypass the intended refusal when encoded as `kind: "rate", sample: 0, count: 0`: the code checks the discriminator, not positive sample size. The resulting false-done rate becomes `NaN`, serialized as `null`, without necessarily preventing `change: true`.

   **Resolve:** parse unknown JSON through a runtime schema; require finite, nonnegative numeric costs and valid positive integer samples; reconstruct statistics from validated trial records; reject inconsistent stored summaries. These checks complement, rather than replace, provenance.

3. **packages/benchmark/src/comparison.ts:144 — factually wrong — high — Matching totals do not establish matching tasks or complete arms.**

   The comparison checks matching corpus strings, repetitions, arm names and aggregate sample sizes. It never checks item identities, kinds, groups, or individual repetition counts against the committed corpus.

   A concrete construction is to replace hard candidate items with repetitions of easier items, preserving total seeded/control counts and copying the corpus digest. Another is to remove `critic` from **both** files. Matching nonempty arm sets still pass, so a candidate worse in the omitted arm can win.

   The result also records `"tier": "model"`, not the selected `fast`/`standard`/`deep` seat, and does not record the per-call budget shown in `model.tier.ts`. Comparisons therefore cannot establish that both runs used equivalent execution settings; filenames are not validated evidence of those settings.

   **Resolve:** derive the required arm/item/repetition manifest from the trusted corpus; require exact coverage without duplicates; persist and compare execution settings that affect outcomes.

4. **.github/workflows/benchmark-model.yml:52 — factually wrong — high — The caps are enforced by code supplied in the PR being authorized.**

   The workflow checks out the PR and later executes its benchmark with `ANTHROPIC_API_KEY` available at line 77. Under the stated threat model, PR contents are controlled. A PR can change the invoked test or its dependencies to ignore the caps and call the provider directly. A single authorized label then permits spending beyond the advertised `$20 + $40`, regardless of the unchanged cap environment variables.

   `contents: read` prevents repository writes; it does not restrict use of the provider key. This construction needs an authorized label, but no control over secrets or label permissions.

   **Resolve:** enforce the authorized dollar allowance outside PR-controlled execution—for example, through a trusted metering service with a per-authorization allowance. Execute the authorization and enforcement machinery from a trusted revision, and keep unrestricted provider credentials out of PR-controlled code.

5. **packages/benchmark/test/comparison.test.ts:131 — factually wrong — medium — Removing all comparisons makes the committed-evidence check pass.**

   The test loops over discovered filenames containing `-comparison-`. Delete or rename all such files, and the loop performs zero assertions. Neither required comparison presence nor the relationship between a tier-map decision and its evidence is checked here.

   **Resolve:** maintain an explicit required evidence manifest and assert its presence before checking contents. Where a tier-map decision requires evidence, check that relationship explicitly.

6. **packages/benchmark/test/tiers/comparison.tier.ts:26 — factually wrong — low — The assertion repeats the implementation’s Boolean assignment.**

   `expect(comparison.change).toBe(comparison.noWorse && comparison.costsLess)` tests the same expression used to construct `change`. Incorrect scoring, fabricated costs, missing tasks and wrong intermediate flags all pass as long as that assignment remains consistent.

   This is not literally invariant under every possible implementation mutation—it would catch an inconsistent `change` field—but it supplies no independent evidence that the decision is correct.

   **Resolve:** use independently calculated expected decisions for adversarial fixtures. The existing unit cases provide useful examples, but need the malformed-input, omitted-arm and inconsistent-summary cases above.

The following mechanisms look sound within the evidence shown:

- **Setting syntax validation:** `modelRunPlan`, at `packages/benchmark/src/comparison.ts:54`, rejects invalid tiers, unsafe filename model IDs, nonpositive/nonfinite budgets and invalid repetition counts. The tier cast is followed by an executable membership check. This establishes syntax, not corpus existence or model price support.
- **Arithmetic on valid, authentic inputs:** the comparison requires non-increasing false-done counts at equal sample sizes, non-increasing false-refusal rates, and strictly lower cost in every included arm. Its conjunction is sound for those inputs. The committed aggregates support `change: false`: the candidate’s recorded spend is higher.
- **Missing readiness:** `packages/api/src/run.ts:730` refuses absent or non-`scanned` readiness above L0. `readinessAt`, at line 1063, records a missing port as unscanned and rejects a mismatched commit. The missing-scan conformance assertion actually calls admission and requires a refusal; it is not tautological.

I found **no demonstrated request-data-only readiness bypass** under the restriction against controlling code inside the runtime. Supplying a fabricated `ceilingAt` function would require crossing that restriction. The test and benchmark readiness stubs do return declarations without performing scans, so these callers prove enforcement of a readiness term, not execution of a scanner. The bundle does not show enough of the external request boundary to establish whether callers can select such a port.

Likewise, I cannot certify the actual spend reservation mechanism: `modelTier` and the relay’s reservation implementation are not included. The post-run spending assertion at `model.tier.ts:81` detects an overrun after payment; it cannot itself prevent one. I found no shown exception handler that turns a thrown error into success, and no relevant declaration-merging or module-augmentation bypass. The material TypeScript escape is the unchecked JSON assertions described above.

The adversarial framing is appropriate for provenance, comparison inputs and spending authorization. Its limit is the meaning of “no worse”: these runs measure judging supplied work, not authoring performance throughout the deep tier. Even authenticated results establish observed performance on this corpus, not general model superiority. The additional question is whether that measured behavior is sufficient evidence for the particular tier-map decision.