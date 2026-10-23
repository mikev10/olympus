# Triage of the external reviews of R19's conformance half, 2026-10-23

Two reviews of R19's conformance assertions, run from one prompt and one bundle
(`2026-10-23-R19-drafting-conformance-review-bundle.txt`, SHA-256
`8633523ba4e696261807bdbc73d39c8acdbef3e2987268a7606b27df6d7d44c9`, base
`cd1b536`, head `e772ef9`):

- `2026-10-23-R19-drafting-conformance-review-codex.md`: gpt-6-astra, family
  codex, outcome `counted`
- `2026-10-23-R19-drafting-conformance-review-gemini.md`:
  gemini-3.1-pro-preview, family gemini, outcome `counted`

Both replies matched their manifests' `replySha256` before their headers were
prepended, and the text beneath each header still does.

**This covers half of R19's review.** The runtime half
(`2026-10-23-R19-drafting-runtime-review-prompt.txt`, bundle SHA-256
`c0bfe209261fd5d1462a81528cf4d6ab12efe55c71535d805b77135c34826fe9`) was
committed in `b89b0fc` but has not been run. It has no replies and no
manifests, and it gets its own triage.

## Counts

| Family | Findings | Holds | Holds in part | Does not hold | Belongs to another unit |
|---|---|---|---|---|---|
| codex | 11 | 4 | 6 | 0 | 1 |
| gemini | 6 | 5 | 0 | 1 | 0 |

Three mechanisms were raised by both families: the black-box listing
(codex-1, gemini-1), the park-decision ordering (codex-4 in part, gemini-3),
and `draftingDecision`'s existential match (codex-10, gemini-4).

All 17 findings are claims about what an assertion can observe. Every one was
checked against the runtime as well, and **no runtime defect was found behind
any of them.** One possible runtime consequence, under codex-6, is still open
and is handed to the runtime half. Each finding went to a verifier with fresh
context, given the finding's text and the repository and not told who wrote
the code. Verification was by reading; no test was run.

| Finding | Restatement | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| codex-1 / gemini-1 | Black-box assertion lists the sibling `start` after the run, never the mounted `work` at seat entry; prefix checks only look for two markers; critic egress admission untested | both | holds | fix now |
| codex-2 | No scenario approves a drafted test draft, then locks it and runs it at `verify` | codex | holds | fix now |
| codex-3 | Critic stubs never check their input; nothing shows the critic judges the recorded bytes | codex | holds in part (critic half; the lock half bites) | fix now |
| gemini-3 / codex-4 (park) | `LAST_ATTEMPT_GOES_TO_A_PERSON` checks the park decision exists, not that it precedes the commit | both | holds | fix now |
| codex-4 (rest) | No drafting assertion stops between persistence steps and resumes | codex | holds in part | known limit |
| codex-7 | A refused approval is not checked for a persisted grant | codex | holds in part | fix now |
| codex-10 | `draftingDecision` matches one decision by cause; draft binding, count, contradictions unchecked | codex | holds | fix now |
| gemini-4 | `.some()` hides a missing decision for the `null` draft | gemini | does not hold (the minor `.some()` weakness folds into codex-10) | via codex-10 |
| gemini-2 | Base-output marker not checked in `role.instructions` or the retry's workspace | gemini | holds | fix now |
| gemini-5 | Attempt 3's request never checked for the unreadable-result note | gemini | holds | fix now |
| gemini-6 | Rejection notes not checked absent from the retry's workspace | gemini | holds | fix now |
| codex-8 | Drafting seats' resolved and reported identities are identical in every fixture | codex | holds (test gap) | fix now |
| codex-5 | L2/L3 floor asserted on pure functions; the line's wiring above L1 unproved | codex | holds in part | known limit, already D-R19-11 |
| codex-6 | Drafted fail-closed cases narrow: one check, one bad critic shape, no missing script | codex | holds in part | known limit; runtime question handed to the runtime half |
| codex-9 | Cost assertion checks four rows and a larger total, not the arithmetic | codex | holds in part | reject; pinned in `api/test/drafting.test.ts` |
| codex-11 | I1's closed-operation check reads only own string names on the prototype | codex | holds, belongs elsewhere (pre-existing) | issue |

The fixes marked "fix now" are recorded as D-R19-21. Three runtime mutations
were each run against the new assertions and reverted, and each was caught
(see D-R19-21).

## codex-1 / gemini-1: the black-box listing

- **Checked:** `TEST_DRAFTER_IS_BLACK_BOX` in `packages/conformance/src/registry/drafting.ts`.
  It derives `start` with `source.replace(/work$/, 'start')` and lists it after
  the run. It never lists `mounts.workspace.source`, the `work` directory the
  drafter actually saw. The prefix checks look only for `[base-repo-readonly]`
  and `[intent]`. The critic's `others` mounts are not inspected. The egress case
  grants egress only to `test-drafter`.
- **Found:** as both reviewers said. A runtime that put the repository in `work`
  and only the spec in `start` would pass.
- **Runtime:** correct. `draft()` (`packages/api/src/drafting.ts` ~369–371) copies
  only the spec files into `start` and then copies `start` to `work`.
  `run.ts` ~515–523 refuses egress for both drafter and critic.
- **Change:** the stub test drafter records the full relative listing and bytes
  of its mounted `work` when its call begins. The assertion requires exactly the
  locked spec's files with their locked bytes, and requires no `others` mount.
  It also adds an admission case that grants egress to `test-critic` and
  requires refusal.

## codex-2: drafted tests through approval, lock, and verify

- **Checked:** every `approveAndResume` in `drafting.ts` approves `spec:1`.
  `test-design:1` appears only in `awaiting(...)` stops.
- **Found:** holds. No assertion takes an approved test draft through locking and
  into `verify`.
- **Runtime:** read, not traced. `lockApproved` (~738–788) is shared by both
  stations, `applyLock`/`lockedArtifacts` set the acceptance tests and manifest
  from the draft, and `checksWithDraft` feeds `ctx.checks`.
- **Change:** one scenario approves `test-design:1` and drives to the passed
  exit. It asserts that the locks hold the drafted manifest and each drafted
  test at the approved hash, and that `verify`'s evidence names the drafted
  check ids. A second leg changes a locked drafted test after approval and
  requires the next transition to refuse.

## codex-3: what the critic is given

- **Checked:** `LOCKED_DRAFT_IS_THE_BYTES_READ` changes `work` only after
  `admitAndDrive` returns, which is after both critics have run. The `critic()`
  stubs return fixed findings. The only check on critic context is the two
  header markers `[draft]` and `[rubric]` in the test critic's prefix.
- **Found:** the critic half holds. The lock half does not: lock hashes and
  artifact-root bytes are checked against the recorded draft after a
  post-read change, so a runtime that locked live bytes would fail it.
- **Runtime:** correct. `critique()` builds the context from
  `renderDraft(record)` and writes the critic's workspace from `record.files`.
- **Change:** both critic stubs record their request and workspace. The assertion
  requires every recorded draft file's bytes in the critic's context and in its
  workspace, for spec and test critics alike. The stub drafter writes a further
  change to its `work` after its final message, which is after recording and
  before critique, so a critic fed live bytes sees a difference.

## gemini-3, and the park part of codex-4: park before commit

- **Checked:** `LAST_ATTEMPT_GOES_TO_A_PERSON` reads `decisionsOf` after
  `rejectDraft` returns.
- **Found:** holds. Commit-then-record would pass.
- **Runtime:** correct. `rejectDraft` records `approval-rejected` and the park
  before `commitRunState` (`run.ts` ~1330–1360). The ordering is asserted for
  ordinary parks only (`line.test.ts` ~403–417, `StopsAtPark`).
- **Change:** wrap the vault with the existing `around`/`beforeCommit` helper,
  and require the `drafts-rejected` decision to be readable when the parked
  state is committed.

## codex-4 (the rest): stops between persistence steps

- **Checked:** no drafting assertion uses `around`/`beforeCommit` to stop between
  a grant and its binding, or between a recorded draft and its critic. Those
  helpers appear only in `decisions.ts` (a kill during verifying) and
  `line.test.ts`.
- **Found:** holds in part. The gap is real. The two constructions describe
  runtime orders that are not the ones in the code: `approveStation` writes the
  decision before `commitRunState`, and a missing critic is `critic: null`,
  which retry treats as no critic, never clean. D-R19-12 records the lock order.
- **Outcome:** known limit. A full stop-injection matrix over the drafting
  lifecycle is larger than a review fix, and the runtime it would guard reads
  correct today. Recorded as D-R19-22, owned by issue #66.

## codex-7: refused approvals and stray grants

- **Checked:** `draftingDecision` checks the returned refusal and that a refusal
  decision exists. It never reads `state.approvals`.
- **Found:** holds in part. A stray grant bound to the real draft would be caught
  later by "no locks after attempt 2". One bound to the wrong hash or `null`
  would sit inert and pass.
- **Runtime:** correct. Every refusal in `approveStation` returns before the
  grant commit (`run.ts` ~1274–1280).
- **Change:** after each refused approval, `draftingDecision` requires the run's
  approvals to be unchanged from before the call.

## codex-10 and gemini-4: what `draftingDecision` matches

- **Checked:** `decisions.find` by cause and reason, then `decidedBy`, `station`,
  and `runId`. In `APPROVAL_BINDS_THE_DRAFT` the loop asserts
  `reason === 'draft-mismatch'` for both the zero hash and `null`. The later
  `.some()` needs only one matching decision.
- **Found:** codex-10 holds. The draft binding is unchecked, and so is the count.
  gemini-4's construction does not hold: a runtime that failed to refuse `null`
  fails the loop's own return-value check. What remains is that one recorded
  decision satisfies two refusals.
- **Runtime:** correct. run.ts records `draft: floor.draft`, and `refuse` records
  every time.
- **Change:** `draftingDecision` matches on the draft hash where the cause
  carries one. It counts the decisions a call adds and requires exactly one,
  with no contradicting `approval-granted` for the same station and draft. The
  loop checks per input.

## gemini-2, gemini-5, gemini-6: the other places text can travel

- **Checked:** `BASE_REFUSAL_CARRIES_ONLY_ITS_FACTS` checks the base-output
  marker in `variableSuffix` and `stablePrefix` only. `CRITIC_FINDING_SENDS_BACK`
  inspects `requests[1]` and never `requests[2]`. `REJECTION_TEXT_ONLY_AT_SPEC`
  checks `stablePrefix` and `role.instructions` and never the workspace.
- **Found:** all three hold as gaps in the assertions.
- **Runtime:** correct. `retryParts` (drafting.ts ~315–327) is the only route,
  and each attempt gets a fresh workspace.
- **Change:** the three assertions check `role.instructions`, both prompt parts,
  and the retry's provisioned workspace (read at call entry, as in codex-1) for
  the marker or the notes. `CRITIC_FINDING_SENDS_BACK` also requires attempt 3's
  suffix to name attempt 2's unreadable result.

## codex-8: resolved versus reported identity

- **Checked:** the `seat()` helper returns the same `model` from `resolveModel`
  and from `runTask`. `tier.ts` separates the two (`tieredDriver({claims})`) for
  the reviewer seat only.
- **Found:** holds as a test gap.
- **Runtime:** correct. The drafter's record stores the resolved model. The
  critic is graded the weaker of its planned model and the reported one
  (drafting.ts ~677).
- **Change:** a drafting scenario in which the critic's driver reports a
  different-family model while resolving a same-family one must not satisfy the
  different-family condition. The test drafter gets the same treatment.

## codex-5: the floor above L1

- **Found:** holds in part. No line run at L2 or L3 exists, because admission
  refuses every stub composition above L1 and the real one is paid. This is
  D-R19-11, already recorded. The line's L1 runs do show that it supplies
  `draftFloorOf` with the recorded `failed` list (`line.ts` ~253), and both
  drafting uses call `builderModels(ctx)`.
- **Outcome:** known limit, already recorded. No change.

## codex-6: drafted fail-closed cases

- **Critic shapes:** do not hold. `readCriticResult` (drafting.ts ~609–622)
  requires exactly one key, `findings`, holding an array of non-empty strings,
  so `{}` and `{"findings":null}` are unreadable, and unreadable counts as a
  finding. `api/test/drafting.test.ts` 22–28 covers the same branches.
- **Multiple checks, missing script:** hold as gaps. No drafted base case has
  more than one declared check, and none names an absent file. The drafted and
  supplied checks share one path (`checksWithDraft` into `judgeBase` into
  `baseMismatches`).
- **Open, and not this half's to settle:** a behavioral check is judged by its
  exit code over the product (D-R15-02). A drafted behavioral check whose
  command names a path that is neither drafted nor in the base fails on the
  base as declared, and the drafting validator does not flag it: `runs` keeps
  only drafted paths. Whether the builder could later write that path and make
  the check pass is a runtime-half question. The conformance bundle cannot
  answer it, and this triage has not run it.
- **Outcome:** known limit for the conformance gap, recorded as D-R19-23. The open question goes to the runtime half's triage,
  which should construct the case.

## codex-9: the cost assertion

- **Found:** holds in part. `WORST_CASE_COVERS_DRAFTING` checks four seats and a
  larger total only. The runtime counts attempts: `worstCaseCost` uses
  `maxStarts`. `api/test/drafting.test.ts` 91–99 pins the arithmetic at 9 calls
  per seat, $4.50 and $2.25, and +$6.75 per station.
- **Outcome:** reject. A conformance re-derivation would duplicate a unit test
  that already fails on the constructions given.

## codex-11: I1's closed operation set

- **Found:** holds. `Object.getOwnPropertyNames(LocalVault.prototype)` misses
  instance fields, symbol keys, and a getter under an allowed name. R19 only
  added six names to `NAMED_OPERATIONS`; the mechanism predates R19.
  `LocalVault` has no superclass (`vault/src/local/vault.ts` ~576). Nothing was
  shown to be reachable by an agent. Ruling out an agent's access to the Vault
  is the mount layer's job, and a separate assertion covers it.
- **Outcome:** belongs to the Vault's conformance, not R19. Opened as issue #65:
  inspect an instance and its prototype chain with `Reflect.ownKeys` and
  descriptors.

## Framing (item 7)

codex: the question is right if it asks which plausible regressions survive
the assertions. It is wrong if it assumes the party can replace trusted
components, or that family separation makes a critic's judgment true. Agreed,
and nothing here relies on either. gemini: the framing is right. Neither
reviewer proposed a different question.
