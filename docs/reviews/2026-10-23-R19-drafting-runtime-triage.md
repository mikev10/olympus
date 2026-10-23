# Triage of the external reviews of R19's runtime half, 2026-10-23

Two reviews of R19's runtime, run from one prompt and one bundle
(`2026-10-23-R19-drafting-runtime-review-bundle.txt`, SHA-256
`c0bfe209261fd5d1462a81528cf4d6ab12efe55c71535d805b77135c34826fe9`, base
`cd1b536`, head `e772ef9`):

- `2026-10-23-R19-drafting-runtime-review-codex.md`: gpt-6-astra, family
  codex, outcome `counted`
- `2026-10-23-R19-drafting-runtime-review-gemini.md`:
  gemini-3.1-pro-preview, family gemini, outcome `counted`

Both replies matched their manifests' `replySha256` before their headers were
prepended, and the text beneath each header still does. The conformance half
was triaged in `2026-10-23-R19-drafting-conformance-triage.md`; this triage
also answers the runtime question that triage handed over (D-R19-23).

## Counts

| Family | Findings | Holds | Holds in part | Does not hold | Belongs to another unit |
|---|---|---|---|---|---|
| codex | 5 | 3 | 2 | 0 | 0 |
| gemini | 1 | 1 | 0 | 0 | 0 |

One mechanism was raised by both families: the base run's exit code as a
channel from the repository to the black-box test drafter (codex-1, gemini-1).
No finding failed to hold. One claim in gemini's sound-mechanisms list does not
hold: it says a stop before the lock is caught as tamper "appropriately", and
codex-4's second window shows that this tamper is false (below).

Each finding went to a verifier with fresh context, given the finding's text
and the repository and not told who wrote the code. codex-4 was settled by a
constructed stop-and-resume run; codex-3 by running the validator on the
reviewer's construction. codex-1, codex-2, codex-5, and D-R19-23 were settled
by reading, and each read was spot-checked in this session.

| Finding | Restatement | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| codex-1 / gemini-1 (exit code) | A drafted behavioral check reads the base and exits with a byte; `judgeBase` and `retrySuffix` hand the exact code to the next attempt | both | holds | amendment A-R19-11, applied |
| codex-1 (exists) | An `exists` problem names which proposed test paths the base already holds | codex | holds | same amendment, applied |
| codex-4 | A stop inside `lockApproved` leaves a run that can never resume | codex | holds (both windows, by test) | fix now |
| codex-5 | Drafting ignores a policy's `writableGlobs` for the drafting roles | codex | holds in part (ignored; the consequence is narrow) | fix now |
| codex-3 | A behavioral check is bound to a test by argv membership, not execution | codex | holds in part (the consequence equals a weak test) | known limit |
| codex-2 | At L2/auto a different-family critic returning no findings locks a draft with no person | codex | holds as stated; the designed tradeoff | reject (D-A-DS-04's known limit) |
| D-R19-23 (handed over) | A drafted check naming a path neither drafted nor in the base runs a file the builder may write | earlier triage | holds; escalated to a person, not refused | known limit, issue |

## codex-1 / gemini-1: the base run's exit code reaches the test drafter

**Checked.** `readTestDraft` (`packages/api/src/drafting.ts:503`) lets a test
drafter write `behavioral` checks, and a behavioral check's command is an
argv the drafter chooses. The base run executes it over a full copy of the base
with the draft written in (`draftTree`, `packages/api/src/line.ts:484-512`),
read-only and with no network, but readable. `judgeBase` (`drafting.ts:592-595`)
keeps the exact exit code of a `contrary` mismatch, `retryParts`
(`drafting.ts:320-324`) carries it, and `retrySuffix`
(`packages/core/src/station/machine.ts:539-552`) writes
`- <id> declared <x>: exit <n>` into the next attempt's variable suffix. No
count of checks is capped. A station allows three attempts
(`packages/core/src/station/contracts.ts:212-213`), so two rounds come back to
the drafter before the third goes to a person.

**Found.** About eight bits per check per round, with no bound on checks: a
test drafter can read the repository it must not see, a few hundred bytes or
more per round. The `exists` problem (`drafting.ts:495`) is the smaller half:
one bit per proposed path per round, naming which paths under the test
directory the base already holds.

**Verification also found a third base-derived signal neither reviewer named.**
`suiteBindingProblems` runs over the base with the draft written in
(`drafting.ts:517-519`), so whether the base's framework binds a drafted test is
also a fact about the repository returned on retry.

**The contract disagrees with itself.** D-A-DS-01's Chosen says the test drafter
"after a base-run refusal ... learns only the check's id, declaration, and exit
code", and the machine's comment (`machine.ts:529-537`) says the same. Its
"Must hold" says "no base output reaches the black-box seats". A drafted
program chooses its exit code, so the exit code is base output. D-A-DS-02
already refuses a person's notes at `test-design` for exactly this reason: an
approver who has read the repository would be "a channel around the black
box".

**Outcome.** An amendment, not a review fix: closing it changes a confirmed decision
(D-A-DS-01, D-R19-08, D-R19-09) and the `base-refusal` retry part's shape. It
was confirmed and applied as A-R19-11 (see Applied).

## codex-4: a stop inside `lockApproved` leaves a run that cannot resume

**Checked, by test.** A temporary conformance driver drafted a spec, approved it
with `approveStation`, resumed once through a vault wrapper (`around`) that threw
at the chosen point, then resumed twice with the real vault. The files were
deleted afterwards.

- **Window 1, after `recordDraftLock`, before the state commit.**
  `LocalVault.recordDraftLock` (`packages/vault/src/local/vault.ts:820-831`)
  creates a per-station file exclusively and throws on a second call, even with
  identical bytes. Nothing reads that file back. The resume sees
  `drafts.locked === null`, calls `lockApproved` again (`line.ts:280`), and
  throws "already locked a draft at spec". Both resumes threw. **Stuck for
  good, on an uncaught throw, with no refusal decision recorded.** Nothing was
  written or locked.
- **Window 2, after the state commit, before the artifact-root write.**
  `settleBase` (`drafting.ts:819-832`) repairs the base only. `loadLine`
  (`packages/api/src/run.ts:1091-1114`) rebuilds the artifact list from the
  committed lock (`lockedArtifacts`, `drafting.ts:709-722`) and reads
  `security.json` and `run-requirements.json` from the artifact root, where
  they were never written; `runLine` (`line.ts:208-210`) records a `lock-tamper`
  at phase `resume` and refuses. Both resumes refused. **Fail closed, but the
  record says tamper for files the runtime never wrote.** At `test-design` the
  manifest takes the same path (`run.ts:1110`).

**Defect and consequence.** No wrong bytes can be locked in either window. But
D-R19-12 claims an order "a stop cannot break", and both windows break it. A
false `lock-tamper` is an evidence defect in a product whose claim is its
evidence, so this is more than availability.

**Outcome.** Fix now (below).

## codex-5: drafting ignores a policy's writable globs

**Checked.** A role's `writableGlobs` is required by policy
(`packages/core/src/policy/types.ts:17`). The only runtime check against it is
build's (`line.ts:1288`). In `drafting.ts`, `scopeFor` picks a model tier only
(`:274`, `:349`, `:638`), and admission (`run.ts:609-687`) checks seats, roles,
and grants, never globs.

**Found.** What limits collection is the collector: four fixed paths at `spec`
(`drafting.ts:102-105`, `:427`); at `test-design`, new files under the spec's
`testDirectory` plus the manifest, never a path the base holds (`:484-495`).
Everything else is discarded. So the reviewer's "drafter can write anywhere"
is not in the code. What holds is narrower: **a policy that narrows a drafting
role's globs silently does nothing**, which is the default-deny rule failing
quietly. It cannot get bytes past the critic, the hash-bound approval, or the
lock.

**Outcome.** Fix now (below).

## codex-3: a behavioral check is bound to its test by naming it

**Checked, by running it.** `parseManifest`, `mergedCheckProblems`,
`suiteBindingProblems`, and `declaredChecks` were fed the reviewer's
construction: `["node", "-e", "process.exit(0)", "test/guard.js"]`, required,
`onBase: "passes"`, beside a failing reproduction check. Output: no problems.
`suiteBindingProblems` (`packages/api/src/verification.ts:124-162`) looks at
acceptance and unit checks only; a behavioral check's tie to its test is
`check.command.filter((arg) => tests.includes(arg))` (`drafting.ts:507`). A
behavioral check with no `onBase` is permitted and skipped on the base, by
D-R15-02's design.

**Defect and consequence.** The binding is membership, not execution. But the
drafter writes the test anyway: a `test/guard.js` that exits 0 is the same
check. The construction is a slightly better-disguised weak test, caught by the
same two controls as any weak test, the critic reading the recorded bytes,
command included, and the person who approves. No argv the runtime does not
own can prove execution.

**Outcome.** Known limit, recorded with D-R19-24.

## codex-2: a clean critic at L2/auto locks a draft with no person

**Checked.** Drafted auto approval needs L2, an `auto` cell, and no failed
condition (`machine.ts:144`). `conditionsFailed` (`drafting.ts:243-263`) needs
the shape check, no open question, and a different-family critic bound to the
draft with no findings (`:254`). A structurally valid spec contradicting the
intent, with no questions and a clean different-family critic, does lock.

**Found.** That is D-A-DS-04's recorded known limit, confirmed by the maintainer
on 2026-10-12: "a critic that finds too little lets drafts through at L2", with
R7's miss-rate corpus and the record of each auto approval as the mitigations.
A person must have set the cell to `auto`. Today no critic is ever independent
(D-R19-17), so every draft goes to a person.

**Outcome.** Reject as a defect. The framing point is fair and is kept: the
runtime can guarantee a correctly bound answer from a different-family seat,
never that the answer assessed anything. The prompt's question asked for both.

## D-R19-23, handed over: a check naming a path the builder may write

**Checked, by reading.** The validator keeps only drafted paths in a command's
`runs` (`drafting.ts:507`). A drafted check naming an absent `judge.js` with
`onBase: "fails"` fails on the base as declared and nothing flags it. Build's
write check is `writesOutsideGrant` over the role's globs and build's
`workspaceGlobs: ['**']` (`contracts.ts:148`), and only locked paths are tamper
(`line.ts:1281-1286`), so the builder can write `judge.js` and the check then
runs a file its judged agent wrote.

**Found.** It is escalated, not refused. `analyzeTamper` adds every changed
file a pinned command names to `protectedPathsTouched` (`tamper.ts:170-172`),
the commands include every non-security check (`line.ts:1309`), and
`effectiveApproval` raises that exit to human-required (`machine.ts:148`). A
person sees "protected path touched". This was not run end to end.

**Why not refused now.** The refusal the conformance triage proposed, "a
drafted command naming a path neither drafted nor in the base", needs a rule for
which tokens are paths. The only one in the code, `commandPaths`
(`tamper.ts:57-66`), takes every token, so `node` and `process.exit(0)` would be
refused. Getting that rule right is a design question.

**Outcome.** Known limit (D-R19-24) with an issue for the refusal and an
end-to-end assertion of the escalation.

## Applied

The maintainer confirmed the recommended amendment and fixes 1–4 on
2026-10-23. Applied as A-R19-11 and D-R19-25; the known limits are D-R19-24
with issue #67, and D-R19-23's open question is marked answered. At
`test-design`, a base run's refusal and the base-derived problems `exists` and
`unbound` reach the drafter as one empty `base-refusal`; the decision and the
standing keep the detail for a person. Verification found the `unbound`
signal, which neither reviewer named. The test-drafter role and the unit spec
were updated to say so. Three assertions, one changed and two new, each failed
against the runtime before the fixes and pass after; the stop assertion's
second window was also shown failing alone with the resume's write removed.

## Fixes and amendment as proposed

1. **codex-4, window 1:** `recordDraftLock` in both vaults
   (`packages/vault/src/local/vault.ts`, `packages/vault/src/stub/vault.ts`)
   returns the existing ref when the stored record is byte-identical, and still
   refuses a different one. No new Vault operation.
2. **codex-4, window 2:** on resume, before the tamper check, the committed
   lock's files that are absent from the artifact root are written from the
   recorded draft (`drafting.ts`, beside `settleBase`). Bytes already present
   that differ stay a tamper.
3. **codex-4, assertion:** a unit test in `packages/api/test/drafting.test.ts`
   stopping in each window and resuming to a lock, shown failing before 1 and 2.
4. **codex-5:** collection refuses a drafted path outside the drafting role's
   `writableGlobs` as a runtime problem (`outside-grant`), which sends the
   draft back as D-R19-08's other problems do. The code is new, so this changes
   the problem set D-R19-08 lists.
5. **Amendment, codex-1 / gemini-1:** waits on the maintainer.
