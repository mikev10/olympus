# Triage of the external reviews of R8a, 2026-11-05

Two reviews of `2026-11-05-R8a-post-merge-attribution-review-bundle.txt`
(SHA-256 `972319244dcf87c895c3e7bd72e79b09911cf84a3cf827b85b4a75b2210f8c8b`,
base `reviewed/R13b`, head `9ecba3a`), each `counted` on the first run, with no
reruns:

- Codex (`gpt-6-astra`): 106,033 input tokens against a floor of 71,127, echo
  verified. Its reply's SHA-256 matches the manifest's `replySha256`.
- Gemini (`gemini-3.1-pro-preview`): 103,852 input tokens against a floor of
  71,127, echo verified. Its reply's SHA-256 matches the manifest's
  `replySha256`.

**Counts.** Codex: 9 numbered findings and one coverage note. Gemini: 3
findings. 13 in all, of which both families raised two pairs (codex-1 with
gemini-2, codex-5 with gemini-1).

**Verdicts.** 11 findings hold, in whole or in part, and all of those 11 were
fixed. One holds and was recorded as a stated limit (codex-6). One does not
hold (codex-9). By family: Codex has 7 fixed (counting the coverage note), 1
recorded, and 1 rejected. Gemini has 3 fixed and none rejected.

**Method.** Each finding was checked twice. First, a fresh-context agent read
every finding against the cited functions, was not told who wrote the code,
and returned a verdict. Second, each finding that predicted a behaviour was
built as a conformance assertion and run against the code as reviewed. Ten
assertions were added. Each one, apart from the coverage assertion, was shown
failing on the pre-fix code before its fix landed (commit `2bb8df3` for the
assertions, then one commit per fix). Where the agent and a test disagreed, the
test decided. That happened once, on gemini-3.

| Finding | Restatement | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| codex-1 / gemini-2 | A watched merge dropped from the branch, or a last head kept only as a second parent, is closed clean | both | holds, in part (see below) | fixed, `e3d3293` |
| codex-2 | A window closes covering time after the head the walk read | codex | holds | fixed, `0d3c4bd` |
| codex-3 | A failed check delivered before the run's merge is recorded is orphaned as unattributed | codex | holds | fixed, `db998db` |
| codex-4 | A failure inside the window but delivered after its close is shut out | codex | holds | fixed, `bc569b9` |
| codex-5 / gemini-1 | A full revert plus an unrelated edit is classified as nothing | both | holds | fixed, `0a0c584` |
| codex-6 | The baseline and the line get unequal exposure | codex | holds | stated in the report, `6121c2a`; known limit |
| codex-7 | The store accepts a `window-closed` record missing its fields | codex | holds (not reachable by the stated attacker) | fixed, `01ae938` |
| codex-8 | A walk can close windows with no route for failed checks | codex | holds | fixed, `ebe73b9` |
| codex-9 | `@olympus-ai/` package strings break the naming rule | codex | does not hold | rejected |
| codex, coverage | The open-window assertion never exercises leaving `observe` | codex | holds | assertion added, `2bb8df3` |
| gemini-3 | `.gitattributes` `-diff` or `binary` blinds the diff and hides rollbacks | gemini | holds, in part | fixed, `c830eb7` |

---

## codex-1 / gemini-2: a dropped merge closes clean

- **Checked:** `walkHistory`. The only history check was
  `isAncestor(from, head)`, which follows every parent. Watched changes outside
  the walked range were never checked against the branch.
- **Found:** part of it holds. If the last walk had already passed the merge,
  `from` stops being an ancestor and the walk was refused, so Gemini's variant
  of a force-push after a walk does not hold. Codex's variant does hold: the
  merge lands after the last walk, then the branch is reset to the last head.
  Codex's second-parent variant also holds. Both were built in
  `I5.observe-dropped-merge-is-refused`, and both failed on the code as
  reviewed: the dropped merge was closed clean, and the second-parent head was
  accepted.
- **Changed:** `firstParentChain` (`history.ts`). The walk's start, and every
  change still watched, must be on the head's first-parent history; otherwise
  the walk is refused `history-rewritten`, naming the changes.
- **Rejected:** Gemini's resolution, which records a dropped change as a
  failure. A change missing from the history is not evidence of a revert. A
  refusal keeps it observing and puts the rewrite in front of the operator, as
  D-R8a-10 already does for a rewritten range.

## codex-2: a window closes past the head the walk read

- **Checked and found:** the close test used `now()` after the walk had
  finished. The construction was built in
  `I5.observe-closes-only-what-the-head-covered`: a clock that moves on every
  read, with the window closing after the head was read. It failed on the code
  as reviewed.
- **Changed:** the walk notes the time when it read the head (`headAt`), and
  closes only windows that had closed by then. A rollback that lands after the
  head was read is walked next time, and that is before any window it could
  count against has closed.

## codex-3: an early signal is orphaned

- **Checked and found:** `recordSignal` attributes a signal using the
  integration records as they stand at that moment, and the derivation joined
  the records kept beside the runs only to baseline changes. The test
  `I7.observe-early-signal-joins-its-run` delivers the failure, then records
  the merge, then walks. On the code as reviewed the escaped count was 0.
- **Changed:** `RunRecords.mergeCommit`. The derivation now joins every record
  kept beside the runs whose change is a run's merge commit to that run, and
  removes it from the baseline and from the unattributed count.
- **Rejected:** rewriting or copying the record under the run once the merge
  is known. The record stays where and as it was written, and the join is made
  by commit identity, which is already the rule for attributing a signal.

## codex-4: a late delivery is shut out

- **Checked and found:** `changeOutcome` counts a signal only when it was
  recorded before the close. A failure inside the window that is delivered
  after the close is excluded. In
  `I5.observe-window-waits-for-late-deliveries`, the window closed as soon as
  it passed.
- **Changed:** a window closes only once `windowMs` plus the policy's
  `maxDeliveryAgeMs` have passed (`graceMs`, recorded in each `window-closed`).
  A signed event older than that age is refused as stale at intake. So by the
  time a window closes, every failure GitHub could still deliver about it has
  either arrived or will be refused.
- **Not changed:** the converse case, where a failure completes after the
  window but is counted because the close is late. That errs toward counting a
  failure, which is D-R8a-07's stated direction.

## codex-5 / gemini-1: a full revert plus an edit vanishes

- **Checked and found:** `classifyReversal` returned `none` when every hunk
  was inverted but the patch id differed. The construction is built in
  `I2.observe-whole-reversal-with-other-edits-is-a-rollback` and failed on the
  code as reviewed.
- **Changed:** a commit that inverts every hunk of the change is a rollback,
  recorded with `match: 'all-hunks'`, beside `match: 'patch-id'` for an exact
  inverse.
- **Options checked:** recording it as a partial reversal would contradict
  "some, not all", and would keep an undone change out of the failure rate.
  Recording it as a rollback with how it matched keeps D-A-OB-04's protection:
  an ordinary edit that inverts some of the hunks still never counts. A change
  with a single hunk can now be rolled back inside a larger commit, and that is
  counted as a rollback.

## codex-6: unequal exposure

- **Verdict:** holds. It is D-R8a-09's choice: a baseline change's window
  opens when a walk first sees it, because its commit date is
  committer-claimed.
- **Outcome:** a known limit, now stated in the report's `notMeasured` list.
  Opening the baseline window at a provider-reported push time, where one
  exists, would narrow the gap. That is left as an option and not built.

## codex-7: malformed closure accepted

- **Verdict:** holds. The Vault is trusted and the stated attacker cannot
  write to it, but a check that reads only part of a record is still a check
  that can be passed with part of one.
- **Test:** `I5.observe-malformed-closure-is-refused` writes and plants a bare
  `window-closed` record. The code as reviewed accepted it.
- **Changed:** `signalProblem` (`vault/src/local/vault.ts`) checks each kind's
  fields whole: commit names, times, counts, how a rollback matched, the
  window and grace, the opening time, the commit date, and the lead time.

## codex-8: no route for failed checks

- **Verdict:** holds. A walk could close windows that no ci-failure route
  could ever fail.
- **Test:** `I5.observe-history-needs-the-check-route`.
- **Changed:** validation refuses an `observe-history` schedule unless
  `ci-failure` is enabled, routed to `observe-signal`, and has a subscription.
  This is the fail-closed reading: a check that is missing is a refusal, never
  a figure of zero. One existing assertion's "valid" policy lacked a
  subscription and was given one. That change makes the fixture valid under the
  stricter rule; it does not loosen any check.

## codex-9: package scope

- **Verdict:** does not hold. The naming check exempts the npm scope
  `@olympus-ai/` by construction (`registry/i10.ts`, `SCOPE`). The real
  violation of this rule in R8a, a field named `olympus`, was found by that
  check before review and fixed in `9ecba3a`.

## codex, coverage: leaving `observe` is never exercised

- **Verdict:** holds. `leaveObserve` was untested because the scenario seeded
  no run state.
- **Changed:** `I2.observe-closed-run-leaves-observe` seeds two runs at
  `observe`. A run whose window closed is committed out, phase `exiting`, and a
  run whose window is open stays at `working`. Deleting the transition fails
  the assertion; this was shown.

## gemini-3: attributes blind the diff

- **Checked:** run, not reasoned. With `*.txt -diff` and `*.dat binary`
  committed, an exact rollback was still found: `--full-index` puts the blob
  ids into the patch, so the patch ids still match. That part of the finding
  does not hold. A partial reversal of a `-diff` file was not found, because
  its hunks were empty. That part holds.
- **Changed:** every diff is read with `--text`. The assertion
  `I2.observe-attributes-do-not-blind-the-diff` fails without the flag and
  passes with it. The first version of this assertion had a fixture error: the
  file was new in the change, so the change had one hunk. It was corrected
  before the result was trusted.

---

## Framing (item 7)

Codex judged the framing right for attribution, and wrong in what it implies:
an exact inverse and a failed check on the merge commit are not evidence that
the work succeeded. It proposed asking instead whether each closed sample had
complete and comparable observation. codex-4, codex-6, and codex-8 answer that
in part. Comparability across cohorts is stated as a limit, not built. Gemini
judged the framing right.

## Silence

Neither reviewer reported a tautological check beyond the coverage note
(item 2), or a language escape hatch (item 4). Gemini left items 2, 4, and 5
empty.
