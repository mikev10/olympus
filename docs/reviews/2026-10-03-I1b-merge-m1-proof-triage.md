# Triage of I1b's external reviews, 2026-10-03

Two reviews, both `counted`, from one prompt and one bundle:
`2026-10-03-I1b-merge-m1-proof-review-codex.md` (gpt-6-astra, family codex)
and `2026-10-03-I1b-merge-m1-proof-review-gemini.md` (gemini-3.1-pro-preview,
family gemini). Before each header was prepended, each reply's SHA-256 matched
its manifest's `replySha256`, and the reply beneath each header still hashes
to that value. Both runs sent one byte-identical payload (`f29e9690…`), both
ingested it completely, and both echoed every bundle marker. Gemini's counted
run is its second; the first was `FAILED` on an HTTP 402 with no reply and is
kept as `…-gemini.attempt-1.run.json`. Findings are cited by family and
number, as each reply numbers them.

## Counts

| | Findings | Holds | Holds in part | Does not hold |
|---|---|---|---|---|
| codex | 7 | 3 | 4 | 0 |
| gemini | 4 | 2 | 2 | 0 |

- **Both families raised:** two mechanisms. codex-4 and gemini-3 are one
  defect: an accepted empty change opens no pull request, and an approved
  integrate exit with no integration record reads `passed`. codex-7 and
  gemini-4 are one defect: an empty `FACTORY_CONTAINER_UID` or `_GID` parses
  as 0. codex-1 and gemini-1 both concern a merge over a moved base, by
  different constructions; they are kept apart and share one fix.
- **Did not hold:** none of 11. Four held only in part, each because the
  defect is real and the consequence or the novelty is overstated (below).
- **Fresh-context verification:** all eleven findings went to two subagents,
  one for the integrator and one for the report, standing, and host
  configuration, each given the finding text and the repository with no
  account of who wrote the code. Each verdict below agrees with its subagent,
  and the load-bearing code was then read directly: `baseMismatches`,
  `blobBytes`, `open`, `merge`, and `#baseUnmoved` in
  `packages/api/src/integrate.ts`; `runStanding` in `packages/api/src/run.ts`;
  `openAccepted`, `mergeAccepted`, and the exit sequence in
  `packages/api/src/line.ts`; `containerUser` in
  `packages/api/src/host/main.ts`.
- **Executed evidence:** codex-7 / gemini-4 was reproduced with node
  (`FACTORY_CONTAINER_UID=1000 FACTORY_CONTAINER_GID=` gives gid `0`, and
  `Number(' ')` is `0`). The rest are readings of one code path each; the
  fake GitHub does not model a merge's parents, so codex-1 and gemini-1 were
  not run. Each accepted fix begins with a test that fails on the reviewed
  code.

| Finding | Restatement | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| codex-1 | The base can move between `#baseUnmoved` and the merge PUT, which pins only the head | codex | Holds in part | Fixed: parent check after merge (D-I1b-13); residual window a known limit; confirmed by the maintainer |
| gemini-1 | An already-merged pull request is accepted without any base check | gemini | Holds in part | Fixed by the same check (D-I1b-13), confirmed by the maintainer |
| gemini-2 | The pull request's base branch is never read, so a retargeted PR merges elsewhere | gemini | Holds | Fixed: base branch checked at open and merge (D-I1b-13), confirmed by the maintainer |
| codex-3 | The base comparison and publication ignore file type and mode | codex | Holds (type); holds in part (exec bit) | Fixed (type, D-I1b-14); exec bit a known limit; confirmed by the maintainer |
| codex-4 / gemini-3 | An accepted empty change leaves no record, and an approved exit reads `passed` before the drive halts | codex, gemini | Holds in part | Fixed: refused at `integrate`'s work (D-I1b-04 amended), confirmed by the maintainer |
| codex-7 / gemini-4 | A half-empty container user parses the empty half as 0 | codex, gemini | Holds | Fixed: base branch checked at open and merge (D-I1b-13), confirmed by the maintainer |
| codex-6 | The report scenario checks cost against the same helper production uses | codex | Holds in part | Fixed: literal totals and cache rate, confirmed by the maintainer |
| codex-2 | Snapshot files the base does not track are verified and not merged | codex | Holds in part | No change: already a recorded known limit (D-I1b-03) |
| codex-5 | An unfinished run's report re-hashes the working copy, so it is not read from the Vault alone | codex | Holds in part | Known limit, owned by R2 (D-I1b-15), confirmed by the maintainer |

## codex-1: the base can move between the check and the merge

**Checked.** `merge()` calls `#baseUnmoved(opened.baseCommit)`, a GET of the
base ref, then a separate `PUT /pulls/{n}/merge` with `sha: opened.commit`.
The PUT pins the pull request's head; GitHub's merge endpoint takes no
expected-base parameter. A push to the base between the two requests is
merged in with `merge_method: 'merge'`, and the returned `merged.sha` is
recorded as `IntegrationMerged`.

**Defect:** holds. The run records a merge whose first parent is a commit its
checks never saw. **Consequence:** narrower than stated. The window is one
HTTP round-trip, the attacker gets no retry within it, and the result is a
true merge commit that contains `B′` rather than a rewrite. The reviewer's
proposed resolution, an atomic server-side update that fails if the base
moved, exists (a non-forced fast-forward of the base ref to the run's
commit), but it bypasses the pull request merge and is refused by branch
protection that requires pull requests, which would make the runtime unusable
on most real repositories.

**Proposed outcome.** After either merge path, read the merge commit and
require its parents to be exactly `[opened.baseCommit, opened.commit]`;
otherwise throw, and the run halts (D-I1b-04) with the merge named in the
message. This cannot undo a merge made in the window, but it guarantees the
run is never recorded merged or reported passed over a moved base. The
residual window, that the merge happens before it is detected, is recorded as
a known limit with the fast-forward alternative and why it was not taken.

## gemini-1: an already-merged pull request skips the base check

**Checked.** In `merge()`, the `pull.merged_at !== null` branch checks only
that the head is `opened.commit` and that a merge commit is named, then
accepts `merge_commit_sha`. The comment records why: an earlier drive merged
and stopped before recording it (D-I1b-01).

**Defect:** holds in part. The skip of `#baseUnmoved` is right: calling it
there would fail a legitimate earlier merge once anyone pushed to the base
after it. What is missing is a lineage check, that the found merge commit's
first parent is `opened.baseCommit`. **Consequence:** the construction needs
someone with merge rights on the pull request, which is outside the stated
threat model (it grants pushes, not merges), so the severity is below the
reviewer's "high".

**Proposed outcome.** The codex-1 parent check applies to both paths, so this
is fixed by the same change.

## gemini-2: the pull request's base branch is never verified

**Checked.** The `PullRequest` interface has no `base` field, so the base is
never read. `open()` finds an existing pull request by head ref in any state;
neither it nor `merge()` checks `base.ref === this.baseBranch`.
`#baseUnmoved` reads `this.baseBranch`'s ref, not the pull request's target.
A pull request retargeted to another branch merges there, while
`IntegrationMerged` records `baseBranch: this.baseBranch`.

**Verdict:** holds. Retargeting is a collaborator's API action, not a push,
so it needs a stronger actor than the threat model grants; but the record
would then name a destination that is false, and the check costs one
comparison.

**Proposed outcome.** Add `base: { ref }` to `PullRequest` and refuse in both
`open()` and `merge()` when `pull.base.ref !== this.baseBranch`. The parent
check above would also catch it at merge, since the merge commit's first
parent would not be `opened.baseCommit`, but the open-time refusal stops it
before the human is asked to approve.

## codex-3: blob equality does not establish type or mode

**Checked.** `baseMismatches` compares `gitBlobSha(bytes)` with `entry.sha`
and never reads `entry.mode`. `blobBytes` returns a symlink's target text as
its bytes, so a symlink and a regular file holding the same text hash alike.
Publication takes modes from the remote listing (`modes.get(path) ??
'100644'`) for both modified and removed entries; the verified tree's file
type is never consulted.

**Defect:** holds for type. A remote symlink `config -> production` and an
admitted regular file `config` containing `production` pass the comparison;
the checks read a regular file and the merged tree keeps a symlink. For a
path in the diff, the run's regular file is pushed under mode `120000`, which
turns its contents into a link target. **Exec bit:** holds in part. The
comparison does not see it either, but comparing it rests on two things not
verified here: that the base snapshot preserves mode bits, and that the host
reports them (D-I1b-10 records a host with no uids, which is a Windows host,
where they are not reported).

**Proposed outcome.** Compare type in `baseMismatches`: a `120000` entry must
be a symlink in the snapshot and any other blob entry must not be. Publish
each changed path's type from the verified tree: a symlink as `120000`, a
regular file as the base's `100644`/`100755` where the base had a regular
file, else `100644`. Exec-bit equality is recorded as a known limit with the
two unverified conditions named.

## codex-4 / gemini-3: an accepted empty change reads `passed`

**Checked.** `openAccepted` returns without a record when
`diff.length === 0`. In `runStanding`, an approved integrate exit with an
unspent grant falls to the integration guard, which returns `open` only when
an `opened` record exists without a `merged` one; with no records it returns
`passed`, and `runReport` marks every gate passed. `mergeAccepted` throws on
the same state ("a run that merged nothing is not done"), so the drive halts
the run (D-I1b-04).

**Defect:** holds. Between the approval and the drive's merge, or after a stop
in that window, the standing and the report say `passed` for a run the drive
will halt. **Consequence:** codex's "an approved no-change run can report
passed without any integration" holds for that window only; the run is never
recorded done, and a resume halts it. The Vault does not record whether an
integrator was wired, so `runStanding` cannot tell "no records because L1 and
no integrator" from "no records because nothing was accepted".

**Proposed outcome.** Refuse the empty change where it is found: with an
integrator wired, `openAccepted` throws on an empty accepted diff, so the run
halts at `integrate`'s work and no human is asked to approve a merge of
nothing. This is codex's second resolution, and it is D-I1b-04's own outcome
moved earlier; no run can then reach an approved integrate exit with an
integrator and no `opened` record. The guard in `mergeAccepted` stays. No test
covers the empty change today; one is added, failing first.

## codex-7 / gemini-4: a half-empty container user parses as 0

**Checked.** `containerUser` returns `undefined` only when both variables are
absent or empty. `UID=1000, GID=''` passes that, and `Number('')` is `0`,
which passes `Number.isInteger` and `>= 0`. Reproduced with node; `' '` gives
`0` too. The function's own comment says a half-named user is refused.

**Verdict:** holds. The container runs with gid 0, the root group.

**Proposed outcome.** Require each variable, when present, to match
`^\d+$`, and refuse when exactly one is absent or empty. `containerUser` is
inside the host entry script, which runs on import, so it moves into an
exported function beside `composeHost` in `packages/api/src/host/` with a
test for the one-empty, whitespace, and both-absent cases.

## codex-6: the report scenario's cost oracle is the production helper

**Checked.** `RUN_REPORT_READS_ONLY_RECORDS` compares `report.cost` with
`costTotals(usage)`, the helper `runReport` calls. A uniformly wrong helper
passes that line. Independent pins exist elsewhere: `line-assertions.ts`
compares metered, unmetered, and lost totals against a separate reduce over
the records' `costUsd`. `cacheHitRate` is asserted nowhere, and cache-token
sums are not pinned to literals.

**Defect:** holds in part. The scenario detects wiring, not arithmetic; cost
arithmetic is covered elsewhere, and the cache rate is not covered at all.

**Proposed outcome.** Seed the scenario's usage with literal token counts and
assert the report's cache-read and cache-write totals and `cacheHitRate`
against literal values, including the `null` rate for zero input.

## codex-2: snapshot files the base does not track

**Checked.** `baseMismatches` iterates only the remote's tracked entries, and
the pushed tree is `base_tree` plus the diff, so an unchanged file the
snapshot holds and the base does not track was present for the checks and is
absent from the merge.

**Verdict:** holds in part. The mechanism is as described, and the
construction (an extra `.js` beside a tracked `.ts`) is a real use of it. It
is not a new finding: D-I1b-03 records exactly this as a known limit, with the
reason that deciding which untracked files are ignored is a `.gitignore`
question the runtime cannot answer without git, and the code's comment cites
it. The reviewer saw the comment and not the decision, which the bundle
excluded.

**Outcome.** No change. The limit stands as recorded. Its tension with
failing closed (a non-ignored extra file is verified and dropped silently) is
real and is the reason it is recorded rather than accepted as harmless.

## codex-5: an unfinished run's report reads the working copy

**Checked.** `runReport` calls `runStanding`, which re-hashes the admitted
graph and manifest from the working copy (`reloadExecuted`) unless the run is
cancelled, halted, or its last exit grant is spent. A run awaiting approval
whose artifact is then edited reports `stopped` with `lock-tamper`, a finding
the read path returns and does not record. A missing file hashes as
`missing`, with the same result. Not verified: what happens when the whole
working copy is gone.

**Defect:** holds in part. For a finished run the report is read from the
Vault alone, because each of the three short-circuits precedes the re-hash
(P9 review, codex-3, ordered them so). For an unfinished run the standing is
a live observation by design: lock re-verification at every transition is
what keeps an admitted artifact from being swapped. The finding is right that
the report presents that observation as though recorded.

**Proposed outcome.** A known limit in `docs/decisions.md`: the report of an
unfinished run includes a live workspace observation that is not a Vault
record; the report of a finished run does not. Separating the two in the
report's shape is a contract change to `RunReport`, owned by R2 (rates over
finished runs), which is where a report is read without a live run.

## Applied

Confirmed by the maintainer on 2026-10-04 and applied on `unit/i1b`. Every fix
began with a test that failed on the reviewed code:

- `packages/api/test/integrate.test.ts`: six new tests (base moved during the
  merge, an outside merge over a moved base, a retargeted pull request, both
  directions of a symlink/file mismatch, and a changed path's published kind)
  failed on the reviewed `integrate.ts` and pass after it. The three symlink
  tests skip on Windows; they were run here once with the skip lifted, on a
  host with Developer Mode (D-I1b-12). The control (a merge whose record was
  lost is recorded again) passes before and after.
- `I5.failed-integration-never-reports-done` gained the empty-change case,
  which failed before the `openAccepted` change and passes after.
- `packages/api/test/host.test.ts`: the half-set and non-decimal cases failed
  against `containerUser` moved unchanged, and pass after the fix.
- `I2.run-report-reads-only-records` now meters every sandbox with a fixed
  reading and pins the totals and the 0.6 cache-hit rate to literals, plus an
  unmetered run whose rate is `null`. Doubling the cache-read sum in
  `costTotals`, and separately miscomputing the rate, each made it fail.

**A fix that grew, and was confirmed again.** Refusing the empty change broke
`I1.composed-host-mounts-no-vault`: its composition wires a placeholder
integrator that is never reached, with a task that writes nothing, and it had
relied on the empty change passing through. The maintainer chose to compose
that check with no integrator, valid at L1 (D-I1b-05). Its assertions are
unchanged.

**Gates.** Typecheck is clean. Lint errors are only in a gitignored local hook.
Every package's tests pass. In the local conformance run, the external entries
whose packages' paid suites have not run on this tree refuse on `tree-changed`,
and the registry-completeness checks fail on those alone. The paid suites run
in CI under the pull request's `run-driver` label.

**The same fix, a second knock-on, also confirmed.** CI's paid line suite
(run 37312602465) halted in its setup with "accepted no change": its fixture,
`hello`, needs no change (its one check is `process.exit(0)`), so the real
model rightly wrote nothing. A run above L1 cannot drop its integrator
(D-I1b-05), so the maintainer chose a paid-only fixture,
`packages/api/test/fixtures/hello-change`, whose check needs `hello.txt`
written. The run reaches the integrate approval with a change, as the suite
asserts; the shared `hello` fixture and every assertion are unchanged.
