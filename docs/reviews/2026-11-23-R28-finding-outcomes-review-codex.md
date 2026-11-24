# External review of R28, codex, 2026-11-23

The Codex family's review of R28, finding outcomes derived by the runtime. Its findings are weighed in `2026-11-23-R28-finding-outcomes-triage.md`.

## Source

- **Reviewer:** gpt-6-astra. Family: codex. A headless `codex exec` run under a read-only sandbox, with recorded approval policy `never`, in an empty scratch working directory and a scratch config home holding only `auth.json`, with an environment of `CODEX_HOME` alone. The pre-run listing of both is the manifest's `cleanRoom`. Outcome `counted`: 135,129 input tokens against a floor of 93,565; all four markers echoed.
- **Cross-family agreement:** codex-1 with gemini-2 (resolution needs only a covered edit in the hunk); codex-2 with gemini-1 (refused and unreadable findings leave the denominator). codex-3, codex-4, codex-5, and codex-6 were raised by Codex alone.
- **Date:** 2026-11-23
- **Bundle:** `2026-11-23-R28-finding-outcomes-review-bundle.txt`, SHA-256 `96afaf3a54b2f967c46e9fcc5fdb156eed7434b20831e7d6db2fddc278790c75` (the manifest's `bundleSha256`), base `a320a01` (the tip of `v2` R28 was rebased onto; the A-R40-02 amendment and a tooling commit merged since `reviewed/R53` were split into their own review for size), head `7b2758f` (the unit's tip when shipped). Every new file in full and every modified file as a function-context diff; `docs/decisions.md`, `docs/reviews/`, `docs/plan/`, and `pnpm-lock.yaml` excluded. Prompt: `2026-11-23-R28-finding-outcomes-review-prompt.txt`.
- **Prior context and lookups:** it disclosed none and no external lookups, and that a local file-listing command was blocked. A self-report, not independently verifiable.
- **Coverage, and any gap:** items 1, 2, 3, 5, 6, and 7 answered; item 4 (language escape hatches) answered only as "none found" within the sound-mechanisms list.
- **Citations:** line numbers refer to the bundle's new side, not the repository; each was re-located in the code.

---

BASE: a320a01  
HEAD: 7b2758f  
packages/vault/test/stub.test.ts  
c265538f2978a7c06f2a36c835d0a4d4

Prior context: none. External lookups: none. Reviewed the complete inline bundle. A local file-listing command was blocked; I did not run tests or verify the attachment’s SHA-256.

1. **packages/api/src/findings.ts:364 — a tradeoff I would have made differently — high — Textual activity is sufficient for “resolved,” without remediation.**

   Suppose the cited line is an unsafe query inside an untested function. Change its whitespace and an adjacent line containing an unrelated, routinely executed statement. Make the edits contiguous so they form one replacement hunk. Coverage of the unrelated statement satisfies `executed.length > 0`; the unsafe operation need never execute or become safe.

   Even requiring execution of the replacement statement would not establish remediation: executing the same unsafe query with harmless input suffices.

   The critic equivalent is simpler: change a comment in the cited test file and lock the draft. Hash inequality at `findings.ts:256` resolves the finding without checking its substance. The conformance fixture actually exercises comment-only change (`packages/conformance/src/registry/drafting.ts:1294`).

   **Resolution:** Call these outcomes “covered edit” and “draft changed,” retaining a separate remediation outcome established by an independently checked regression assertion or human assessment. This implements the stated mechanical rule, but that rule does not protect the stronger property in the question. **Confidence: high.**

2. **packages/api/src/findings.ts:194 — factually wrong — high — Refusal preserves an audit record but removes the finding from the measurement.**

   Return one easily addressed finding with a valid citation, and nine difficult findings with nonexistent paths, invalid categories, or an extra `severity` field. The latter become refused findings, then `raisedFindings` excludes them. Once the easy finding resolves, the displayed rate is 1/1 rather than exposing the nine unmeasurable findings.

   An unreadable review similarly contributes nothing: `readSeatFindings` returns an empty list with `readable: false` at line 97, but the rates never consume that flag.

   Critic parsing is more destructive: append one malformed element after valid located findings. `readCriticResult` returns its single unreadable refusal, discarding the valid findings already parsed (`packages/api/src/drafting.ts:740`). Those valid findings then disappear from the denominator too.

   **Resolution:** Preserve individually valid findings; report refused elements and unreadable seat results alongside rates. Mark a rate incomplete when its collection failed instead of presenting a clean rate over the surviving subset. An unreadable response has unknown cardinality, so inventing one ordinary finding is not an adequate denominator repair. **Confidence: high.**

3. **packages/api/src/findings.ts:195 — factually wrong — high — Repeating one easy finding manufactures independent successes.**

   Each array index becomes a separate finding identity. Return 100 copies of the same valid citation plus one difficult finding. A later covered edit resolves all 100 copies independently. The resulting rate is 100/101, although only one of two distinct problems received any action.

   This also enlarges the sample used for the confidence bound. `findingKeyOf` correctly distinguishes indices, but that storage identity does not establish independent observations.

   **Resolution:** Deduplicate equivalent citations within a seat result, explicitly track repeated observations across results, and avoid treating correlated repetitions as independent evidence for confidence bounds. Otherwise label the statistic as a rate over model-emitted entries, with no resistance to repetition. **Confidence: high.**

4. **packages/adapters/src/coverage.ts:179; packages/adapters/src/python/coverage.ts:135 — unclear — high — A valid report can assert execution that never happened.**

   Both adapters derive executed lines from report contents. A process inside the coverage sandbox can write a syntactically valid Istanbul report with positive hit counts, or a coverage.py report listing the desired `executed_lines`, and exit successfully without executing the cited code.

   Static executable-line discovery protects the denominator against omissions; it does not authenticate positive hits. `resolveCodeFindings` checks the recorded check result and then trusts those hits (`packages/api/src/findings.ts:345`).

   This is **conditional on the future report channel**: current runs refuse coverage, as the prompt states. The supplied code does not show a mechanism that would make a sandbox-written report trustworthy once that channel exists. A trusted sandbox provider does not make its workload’s statements true.

   **Resolution:** Require an execution observation mechanism the workload cannot fabricate, or explicitly classify coverage as workload-reported evidence. Add an adversarial assertion that writes a forged report without running the target and must not resolve the finding. **Confidence: high about the adapters; the future collection boundary remains unknown.**

5. **packages/api/src/outcomes.ts:468 — factually wrong — medium — “Unmeasured” depends on unrelated runs, and can hide an already measured resolution.**

   Findings are selected by their originating run’s admission window. Coverage availability is selected from runs in that same window, although a later run outside it may resolve those findings.

   Construction: run S raises a finding without coverage. Later run R records coverage and resolves it. Query a window containing S but excluding R. The outcome is present, yet its resolved rate becomes `unmeasured`. Conversely, any unrelated run with non-null changed-line coverage makes every code group in the window numerically measured—even if that evidence belongs to a failed attempt.

   **Resolution:** Derive measurement availability from relevant resolution evidence or explicit observation eligibility, independently of the originating-run window. Preserve known resolutions and expose remaining measurement gaps separately. **Confidence: high.**

6. **packages/conformance/src/registry/stacks.ts:251 — factually wrong — low — The agreement check shares the implementation it purports to verify.**

   `changedLineCoverage` directly calls `coverageFraction(await changedLineReport(...))`. Comparing it with `coverageFraction(files)` repeats the same computation. Likewise, the tamper-report comparison checks another consumer of those same functions.

   These checks are not wholly vacuous: they can detect wiring changes. But a report implementation returning fabricated, sorted, disjoint, nonempty line arrays can satisfy this assertion without identifying the fixture’s actual changed lines.

   **Resolution:** Assert exact independently specified paths and line numbers for each fixture, plus an independently calculated fraction. The adapter unit tests already contain useful exact expectations; extend that approach to this conformance claim. **Confidence: high.**

The following mechanisms look sound within the stated trust boundary:

- **Outcome identity and write-once storage:** `findingKeyOf` separates source and index; exclusive creation under that key arbitrates competing outcomes. Reading the authoritative mark preserves an outcome if the secondary content-addressed write fails.
- **Resolution prerequisites:** absent coverage, a missing or failed selected check, an unmappable cited line, and no executed line in the selected hunk do not produce a resolution. History exceptions leave findings open.
- **Review task status separation:** `review` records findings without deriving task status from their contents.
- **Dismissal authorization:** the finding routes sit behind bearer-token authentication, and a second outcome is refused.
- **TypeScript boundaries:** the casts shown do not themselves give a sandbox process access to runtime memory or Vault operations. I found no concrete declaration-merging, generic-erasure, or type-predicate exploit under the stated attacker capabilities.

The adversarial framing is appropriate, but **“was the problem fixed?” and “did a covered textual edit occur?” are different questions**. This implementation primarily answers the latter. With model-controlled citations and cardinality, it also cannot establish that every real problem was reported. The defensible measurement question is: *Which distinct, successfully collected citations received what independently observed action, and where was collection or measurement incomplete?*