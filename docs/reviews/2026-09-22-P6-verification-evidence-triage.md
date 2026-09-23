# Triage of P6's external reviews, 2026-09-22

Two reviews, both `counted`, from one prompt and one bundle:
`2026-09-22-P6-verification-evidence-review-codex.md` (gpt-6-astra, family
codex) and `2026-09-22-P6-verification-evidence-review-gemini.md`
(gemini-3.1-pro-preview, family gemini). Each reply's SHA-256 matched its
manifest's `replySha256` before its header was prepended. The Gemini review is
the third Gemini run. The first two were `INTEGRITY_FAILED` on the echo, with
ingestion complete, and are not triaged. Findings are cited by family and
number.

## Counts

| | Findings | Holds | Holds, part owned elsewhere | Does not hold |
|---|---|---|---|---|
| codex | 8 | 6 | 2 | 0 |
| gemini | 0 | — | — | — |

- **Both families raised:** none. Gemini reported no findings.
- **Did not hold:** 0 of 8.
- **Gemini's calibration.** Gemini assessed as sound three mechanisms that a
  codex finding disputes, and the code bore out codex each time: symlink
  handling in the tree operations (codex-1, reproduced by execution), the
  exact-key check stopping an injected `status` (codex-6; the review seat never
  runs it), and the writability refusal (codex-8). Gemini offered no
  construction for items 1–3 and left item 5 unanswered. Recorded as it is: a
  counted review that found nothing in a change where the other family found
  eight defects that hold.
- **Executed evidence:** codex-1 was reproduced end to end in a
  `node:22-bookworm-slim` container, using verbatim copies of `workspace.ts`,
  `files.ts` and `refusal.ts` and the verify sequence from `line.ts`: the
  runtime's host process deleted a file outside every workspace. It could not be
  reproduced on the Windows host, because this account lacks the symlink
  privilege (EPERM). `packages/api` `verification.test.ts` and `line.test.ts`
  were run as shipped (39/39 pass), which confirms that `line.test.ts:127-152`
  records a required `unit` check as passed with `suiteCount: null`, the
  behaviour codex-4 describes.
- **Fresh-context verification:** each finding went to a subagent given only the
  finding's text and the repository, with no account of who wrote the code.
  Every verdict below agrees with its subagent. There is one reading where this
  triage departs from a subagent's: see codex-4.

**Status: proposed.** The outcomes below are recommendations. None is applied
yet, and they wait on the maintainer's confirmation, as P8's did.

## Findings

| ID | Finding | Raised by | Verdict | Proposed outcome |
|---|---|---|---|---|
| codex-1 | Composition through a base symlink deletes a host file outside the workspace | codex | holds (executed) | fix now |
| codex-2 | Pinned argv does not pin the checker; checks share one container | codex | holds; the dispatch half is P7's | fix now (shared container); pending entry to P7 (dispatch) |
| codex-3 | Writable globs bound what propagates, not what is written | codex | holds; deliberate design | known limit, and the I4 wording narrowed |
| codex-4 | A suite check whose suites cannot be enumerated passes when no count is pinned | codex | holds | fix now |
| codex-5 | The review seat sees surviving contents and no deletions | codex | holds | fix now (deletions); known limit (before-state) |
| codex-6 | The review seat's result is not key-checked; an author's family is self-reported | codex | holds; the identity half is P5's (recorded) | fix now (key check); no action (identity) |
| codex-7 | A check's `timeoutMs` is never enforced | codex | holds; open since D-S1-11 | fix now, with codex-2's per-check sandbox |
| codex-8 | The writability refusal ignores the directory's search bit | codex | holds | fix now |

## codex-1: a base symlink turns composition into a host deletion

**Checked.** `snapshotBase` copies with `verbatimSymlinks`
(`packages/api/src/workspace.ts:160`), so a link in the admitted repository that
points outside it survives into base. `walkTree` never follows links
(`packages/adapters/src/files.ts:191`), so each task's own diff is correct. But
`composeDiff` looks entries up in base through `contentHashOrNull`, `present`
and `lstat` on a joined path (`workspace.ts:109-127`), and those resolve through
a linked *parent*. Task A's `p/x added` is recorded as `p/x modified`, because
the host file behind `base/p` exists. Task B restores the link. The link entry
cancels against base (`:192-193`), and `p/x removed` survives (`:191`).
`materialize` copies base with the link (`:218`), and `apply` runs
`rm(building/p/x)` (`:226`), which deletes the host file.

**Found.** Holds exactly as constructed, and it was reproduced by execution.
The consequence is worse than the reviewer framed it. The deletion is done by
the runtime's host process with the runtime's own permissions, during B's
verify station (`line.ts:619` composes, `:623` materializes), before any check
runs. Step A is also a host read outside the workspace, since the file is
hashed. The only preconditions are a repository link with an absolute target
and a two-task grant of `p` and `p/**`.

**Proposed fix.** Give the workspace tree operations one rule: a path whose
parent, anywhere under the tree root, is a link is absent for lookup, and every
`rm`, `mkdir`, copy, and `symlink` refuses such a path. The rule goes in
`contentHashOrNull`/`present` (which `hashAt` shares), in `apply`, and in
`copyOnly`. With it, A's entry is `p/x added`, B's removal cancels it, and
nothing outside the tree is read or touched. The regression test builds the
two-task scenario over real links and runs on Linux CI. It is shown failing
before the fix.

## codex-2: the checker, and the container the checks share

**Checked.** `verify` runs `check.command` exactly (`line.ts:643`), and the
admitted artifacts are the spec, the acceptance tests, the manifest, and the
task graph (`validate.ts`). The script that `["npm", "test"]` resolves through
is in `package.json`, which a task may be granted. Every check runs in the one
sandbox that `verify` provisions (`line.ts:634`, loop at `:639-659`). The
workspace mount is `ro`, but the rest of the container filesystem is not.

**Found.** Both halves hold. They are separate defects with separate owners.

- *Dispatch through a writable file.* A diff that changes what a pinned
  command dispatches to is a change to the checker, made by the party being
  checked: an agent judged by an artifact it can write. Recognising a diff
  that touches test configuration or runner scripts is tamper analysis, which
  P6's out-of-scope list gives to P7 ("tamper-style reading of the diff").
  **Proposed:** a pending registry entry,
  `I3.check-dispatch-not-writable-by-the-task`, owned by P7. It raises the I3
  baseline from 1 to 2 and appears in the diff. A repository that already held
  a substituted runner at admission is the admitting human's repository, and
  is outside what verification can judge.
- *Cross-check contamination.* This is P6's own defect. The unit spec says the
  checks run "in a fresh sandbox", and one sandbox shared across checks lets an
  earlier check change the container a later one runs in. **Proposed fix:** one
  freshly provisioned sandbox per check, over the same read-only tree with
  `deny-all` egress. The same change closes codex-7.

## codex-3: writable globs enforce propagation, not writing

**Checked.** A build workspace is mounted `rw` whole whenever the station grants
any workspace globs (`line.ts:440-442`). `writesOutsideGrant`
(`verification.ts:44-50`) reads only the task's own diff. `.git` is copied and
excluded from every diff (D-P6-02).

**Found.** Holds as described. It is also the design the unit specified: the
accept list says a change outside the globs "is refused from the
runtime-collected diff", and D-P6-02 records the `.git` exclusion. A write that
is restored before the task ends, or that sits under `.git`, never propagates,
never reaches verification, and never outlives the task. What does not hold is
the stronger wording, that an ungranted write is *unavailable*. The consequence
is confined to the task's own sandbox, which is already agent-writable by
definition.

**Proposed outcome.** A known limit in `docs/decisions.md`, with the I4 claim
for workspace writes narrowed to what the code enforces: *an ungranted write
never propagates beyond the task*. Enforcing write authority during execution
takes per-path mounts, which is sandbox work. It has no owner in M1, and it is
recorded as unowned rather than assigned to a unit that did not agree to it.

## codex-4: an unenumerable tree passes a suite check

**Checked.** `countSuites` returns `null` on any exception and when no test
adapter exists (`verification.ts:60-68`). `suiteCountFor` records that null for
every `unit` and `acceptance` check (`:76-78`). `requiredShortfall`
(`packages/api/src/gate.ts:24-27`) fails a null count only when
`expectedSuiteCount` is pinned. The shipped test `line.test.ts:127-152` records
the hello fixture's required `unit` check as `passed` with `suiteCount: null`.

**Found.** Holds. P6's accept list reads: "A tree whose suites cannot be
enumerated fails the check rather than reporting `null` as a pass." The fresh
verifier read that sentence as scoped to checks that pin a count. This triage
does not. The sentence stands on its own, and the fail-closed rule lists "an
unsupported stack" as a refusal. A `unit` or `acceptance` check is a suite run
by kind, so a null count on one is a tree whose suites were not established.
The line test asserts the defect, not the contract.

**Proposed fix.** `requiredShortfall` fails a suite-kind check whose
`suiteCount` is null, with cause `suite-count`. A non-suite check (`lint`,
`typecheck`) is unaffected, because `suiteCountFor` records null for it by
kind. The hello fixture gains an enumerable suite so that its test asserts a
counted pass. A second test keeps the fixture's current shape and asserts that
the check fails. That test is shown failing against the old gate first. This
strengthens the test and weakens nothing.

## codex-5: the reviewer cannot see a deletion

**Checked.** `reviewView` keeps only diff entries whose `sha256` is non-null
(`line.ts:726`), so removals are dropped. `copyOnly` copies current bytes.
`evidenceFacts` (`line.ts:739-755`) gives check outcomes and a count of claim
mismatches, and no paths.

**Found.** Holds. A run that deletes an unlocked file and a run that changes
nothing give the reviewer the same tree and the same facts. The review
contract grants `diff`, and a removal is part of the diff.

**Proposed outcome, in two parts.**
- *Fix now:* the seat is offered the runtime's own diff listing under its
  `diff` grant: every path with `added`, `modified`, or `removed`, read from
  the Vault's diff and never from the claim. That makes a deletion visible, and
  it gives the seat no author material, because the listing is runtime-derived.
- *Known limit:* the before-state of a modified file, meaning a patch rather
  than the surviving contents. D-P6-08 settled that the review contract grants
  no base tree. Showing base contents for changed paths is a contract question
  for the review panel (M3), not a review fix.

## codex-6: the review seat's result, and whose family it is

**Checked.** `build` calls `taskResultProblems` before recording
(`line.ts:546`). `review` (`line.ts:763-806`) records `ran.result` at `:799`
without calling it. `seatReviewer` compares the reviewer's family with the
authors' families as read from their recorded `TaskResult.model`.

**Found.** Both halves hold, and they have different status.
- *The key check.* This is a defect of this unit. The accept list requires the
  check "where the line receives it", and the line receives a result at review
  too. **Proposed fix:** the review station applies the same check, and stops
  the same way, before `recordTaskResult` (D-P6-07). A test hands the seat a
  result carrying `status` and requires the refusal. It is shown failing first.
- *The author's family.* A recorded limit that predates this unit.
  `docs/decisions.md` under P4 records that a driver is held to the identity its
  result reports, and that "whether a driver's identity is true is P5's claim
  to prove". I1 replaces the stub driver the line still runs. No action here.

## codex-7: a check's timeout is decorative

**Checked.** `checkProblems` validates no `timeoutMs`. `verify` never passes
one. `LocalDockerProvider.exec` bounds a command only by what remains of the
sandbox's wall clock (`provider.ts:420-441`), and `verify` provisions with
`wallClockMs: 0` (`line.ts:416`).

**Found.** Holds. This is not new: S1 recorded that `SandboxProvider.exec`
takes no timeout "except by provisioning one sandbox per check", and left the
choice to P6 and P2 (D-S1-11). P6 did not close it, and its known limits do not
mention it.

**Proposed fix.** This is the per-check sandbox from codex-2, provisioned with
`wallClockMs` set to the check's `timeoutMs`, which validation now requires to
be a positive integer. A check that outruns it produces no result, and it is
recorded in `unstarted` with the reason "timed out after N ms". A-P6-02 defines
that field as a record of a check that produced no result, and a timed-out
check is one. It needs no contract change. The test pins a one-second check
that sleeps for five and requires the gate to fail.

## codex-8: write permission without search permission

**Checked.** `checkWorkspaceWritable` (`packages/sandbox/src/local/provider.ts:170-182`)
tests only the write bit for the matching owner, group, or other.

**Found.** Holds as a defect of the check. The consequence is narrower than
claimed. Every directory the runtime creates keeps owner-execute, so no path
through Olympus's own code produces a `0600` workspace today. The check is
still incomplete for the property it asserts, and the assertion
`I5.workspace-is-writable-by-the-task` tests only a uid mismatch.

**Proposed fix.** Require both write and search (`w` and `x`) for the matching
class. Add a conformance case for an owned directory at mode `0600`, shown
failing first.

## Not changed by this triage

- The reviewers' text, the manifests, and the session records.
- The bundle, which is tracked beside this file. Its SHA-256,
  `434fb474e8ef1b712ee1b8780a4100c449e681adcdb0d7205eb490c074378aff`, is
  the value in the prompt file's first paragraph, and the tracked copy
  matches it.
