# External review of R8a, codex, 2026-11-05

This is the codex family's review of R8a, post-merge attribution and the baseline. The reply follows the header unchanged. The triage covering both reviews is `2026-11-05-R8a-post-merge-attribution-triage.md`.

## Source

- **Reviewer:** gpt-6-astra. Family: codex. A headless `codex exec` run under a read-only sandbox, with recorded approval policy `never`, in an empty scratch working directory and a scratch config home holding only `auth.json`, with an environment of `CODEX_HOME` alone. The pre-run listing of both is the manifest's `cleanRoom`.
- **Cross-family agreement:** Raised codex-1 with gemini-2 (a dropped merge closes clean) and codex-5 with gemini-1 (a full revert plus an edit vanishes). Raised alone: codex-2, -3, -4, -6, -7, -8, -9, and the coverage note.
- **Date:** 2026-11-05
- **Bundle:** `2026-11-05-R8a-post-merge-attribution-review-bundle.txt`, SHA-256 `972319244dcf87c895c3e7bd72e79b09911cf84a3cf827b85b4a75b2210f8c8b`, base `reviewed/R13b`, head `9ecba3a` (the unit branch as shipped in PR #100). The bundle holds every new file in full and every modified file as a function-context diff. It excludes `docs/decisions.md`, `docs/reviews/`, `docs/plan/`, and `pnpm-lock.yaml`. Prompt: `2026-11-05-R8a-post-merge-attribution-review-prompt.txt`.
- **Prior context and lookups:** It stated that it had no prior project context and performed no external lookups. It also stated that local filesystem access was blocked. This is a self-report and cannot be verified independently.
- **Coverage, and any gap:** Items 1, 3, 5, 6, and 7 were answered. On item 2 it named one coverage gap and no tautology. Item 4 had no entry.
- **Citations:** Line numbers are positions in the bundle's new-side diff hunks, not in the repository. Each finding was located by its function before it was judged.

---

BASE: reviewed/R13b  
HEAD: 9ecba3a  
packages/vault/src/types.ts  
0cad6e8534028c02a53b887af149fec0

I had no prior project context and performed no external lookups. I reviewed the inline bundle. Local filesystem access was blocked, so I did not independently verify the file’s SHA-256 or execute tests. Citations use new-side source line numbers.

1. **packages/api/src/observe.ts:147 — factually wrong — high — A removed merge can close clean without ever being walked.**  
   Construction: after the last observed head `P`, the runtime merges `M`. Before the next walk, reset the default branch to `P`, retaining `M` through another branch. The ancestry check passes because `from === head === P`; the walk is empty. `M` is absent from `inRange`, so line 168 treats it as an already-open change. Once its time has elapsed, the closure loop reads the still-existing commit object and closes it clean.

   The ancestry check also accepts a previous head reachable **only through a second parent**. Merge the old head into a branch based before the change, keeping that branch’s old tree. The first-parent diff can be empty despite removing the change from the default branch.

   **Resolve:** require both the cursor and every observed merge to occupy the expected first-parent history. Refuse missing merges and changes to that history; ordinary ancestor membership is insufficient.

2. **packages/api/src/observe.ts:142, 198–209 — factually wrong — high — Closure covers time beyond the head actually examined.**  
   Construction: the walk captures head `H` shortly before a run’s window expires. While it processes the captured range, land an exact rollback `R`, still before expiration. The closure loop subsequently sees an expired window and writes `window-closed`, although `R` was never examined. On the next walk, `openRuns` excludes the closed run, so the rollback is never attributed to it.

   This needs only control over commit timing, not the runtime clock or Vault.

   **Resolve:** close against an explicit coverage boundary. At minimum, only consider windows already expired when the head was captured, and establish that the captured history covers that boundary. A fresh head or coverage validation is needed before committing closure.

3. **packages/api/src/observe.ts:81–85 — factually wrong — high — Signals arriving before the integration record are permanently orphaned.**  
   Construction: a merge-commit check fails and its signed delivery arrives after GitHub merges but before the runtime persists its `merged` integration record. `mergedRuns()` cannot yet find the run, so the observation is stored beside the runs with `runId: null`. Later integration recording does not reconcile it. The run’s derivation reads only its own observations and can report clean; the failure remains unattributed.

   The supplied integration test explicitly exercises a stop between merging and recording, so this interval is part of the supported lifecycle.

   **Resolve:** retain immutable signal evidence keyed by commit and join it to integration records during derivation, or add durable reconciliation when a merge becomes known.

4. **packages/api/src/outcomes.ts:431–434 — factually wrong — medium — Delivery time overrides when the failure occurred.**  
   A signed check can complete inside the observation window but arrive just after its closure. It is successfully recorded, yet `recordedAt <= closedAt.recordedAt` excludes it permanently. Conversely, a check that completes after the nominal window can count if the scheduled closure is late.

   Thus the measured interval depends on delivery and scheduler timing, rather than the configured interval after merge. This is distinct from the head-capture race above.

   **Resolve:** specify event eligibility separately from collection completeness. Use trustworthy event times where available, and either permit corrections for delayed evidence or delay finalization until a defined delivery boundary. Do not label incomplete collection clean.

5. **packages/api/src/history.ts:207–211 — a tradeoff I would have made differently — medium — A complete reversal plus an unrelated edit disappears entirely.**  
   Construction: restore every hunk of a run’s change and add an unrelated file in the same commit. The overall patch ID differs from the inverse. All inverse hunks match, so `hunks === change.inverseHunks.length`; the strict `<` test rejects the partial-reversal classification too. The result is `none`, with no failure or reversal count.

   This follows the stated narrow rollback definition, so it is principally a limitation of the evidence claim, not a failure to implement that definition.

   **Resolve:** represent “all inverse hunks plus other changes” explicitly. It need not be called a rollback, but it should not disappear. More generally, describe this figure as exact-inverse detection rather than evidence that merged work stayed successful.

6. **packages/api/src/observe.ts:193–195, 203 — a tradeoff I would have made differently — medium — The baseline and the line receive unequal exposure periods.**  
   Runs age from provider merge time; baseline changes age from the walk’s `firstSeen`. Suppose both land just after a daily walk and the window is one hour. At the next walk, the run closes immediately, while the baseline remains exposed for another walk. A subsequent reversal can fail the baseline while the equivalent run is already excluded from comparison.

   Both also receive whatever retrospective history the discovering walk happens to include. The resulting rates are sensitive to landing time relative to the schedule.

   **Resolve:** use comparable exposure rules, or publish the difference and avoid presenting the rates as equivalent cohorts. Where landing time is unknown, report that uncertainty explicitly.

7. **packages/vault/src/local/vault.ts:118–128; packages/api/src/outcomes.ts:431–444 — factually wrong — medium — A malformed closure record can produce a clean sample.**  
   `observationProblem()` accepts a record whose signal is merely:

   ```json
   {"kind":"window-closed","at":{"at":"anything","source":"runtime"}}
   ```

   Given the accepted outer fields, it requires no `windowMs`, `opened`, `committedAt`, or valid timestamp. The reader then casts it to `ObservationRecord`. With no failure signals, `changeOutcome()` treats this as a closed, clean change.

   This is a malformed-input weakness, **not an exploit available through the stated repository-only attacker**: that attacker cannot write the trusted Vault. Type assertions make the incomplete validation consequential, however.

   **Resolve:** validate the full discriminated union, timestamps, numeric bounds, and closure prerequisites before consuming records. Test malformed closure records through the actual reader.

8. **packages/core/src/policy/validation.ts:626–696 — unclear — medium — Valid observation configuration does not establish failure-signal coverage.**  
   A policy can schedule `observe-history` with a valid window while having no `ci-failure` subscription, or routing that kind to `intake-candidate`. History still closes runs, and the report can show clean samples and zero check failures. Nothing in closure or derivation distinguishes “no failed checks” from “failed checks were not collected.”

   Confidence is high about the configuration and code path; the unresolved question is whether incomplete signal coverage is intentionally permitted for this metric.

   **Resolve:** require the necessary observation routes before producing a complete change-failure figure, or attach explicit coverage status and withhold a clean classification when required channels are absent.

9. **packages/api/src/observe.ts:20 — factually wrong — low — The literal naming invariant is not satisfied.**  
   New code contains Greek mythological names in package strings, including `@olympus-ai/core`. This is inherited namespace usage, not an attribution vulnerability.

   **Resolve:** explicitly exempt existing package namespaces if that is the intended rule; otherwise the stated invariant requires their migration.

Several mechanisms are sound within their stated boundaries:

- `Intake.deliver` verifies the signature before extraction and routes signals before the candidate budget. The visible observation writer projects specific fields and does not read check names, messages, outputs, or pull-request lists.
- Commit-identity lookup prevents those free-text fields from selecting another run, once its integration record exists.
- Missing targets, missing windows, ordinary Git read errors, and detected non-ancestry produce refusals.
- The derivation excludes runs lacking closure records from the failure-rate denominator.
- Restore durations use two provider times or two committer times, rather than subtracting across sources.

I found no demonstrated tautological assertion or skipped test that independently establishes these properties. There is a concrete coverage gap: `OPEN_WINDOW_IN_NO_DENOMINATOR` advertises moving a run out of observe, but seeds integration records without run state; `leaveObserve` skips missing state at `observe.ts:242`. Removing the state transition would not fail that assertion.

The framing is appropriate for attribution and collection integrity. It overstates what exact inverse patches and merge-commit checks establish about real-world success. The additional question should be: **what evidence proves that each closed sample received complete, comparable observation?** The present code establishes neither that completeness nor that comparability.