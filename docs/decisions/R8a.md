# Decisions: R8a

## R8a: Post-merge attribution and the baseline

### D-R8a-01: the boundary R8a was started on

- **Unit:** R8a, post-merge attribution and the baseline (`docs/plan/R8-observe.md`).
- **Deliverables:**
  - a merged run commits `observe` and its drive returns; the history walk
    moves it out once `triggers.observe.windowMs` has passed since
    `mergedAt`, recorded in P14's record (D-A-OB-03);
  - the policy block `triggers.observe` with its window, required while any
    observe template is named;
  - reverts found by `git patch-id --stable` over the default branch's
    first-parent history, and partial reversals reported on their own line
    (D-A-OB-04);
  - check failures joined to a change on its merge commit, known by the
    `checkRun` id alone (D-A-OB-05);
  - the job templates `observe-signal` (on `post-merge` and `ci-failure`
    only) and `observe-history` (on `scheduled` only);
  - `ObservationRecord`, write-once and content-addressed, under the run or
    beside the runs, each saying where its time came from (D-A-OB-06);
  - the rollback count, change-failure rate, time to restore, and the
    escaped false-done rate, per run, role, and seat identity, each with its
    sample and bound, in R2's report in place of `'not-established'`;
  - the baseline over every first-parent change no run made, beside each
    rate, with lead time from first commit to merge and a squash merge's
    lead time recorded as not measurable;
  - the report's statement that each bound assumes independent runs, which
    these are not (D-A-OB-08);
  - a registry assertion for each conformance row, and a changeset for each
    package changed.
- **Out of scope, verbatim from the spec:**
  - the observation plan and everything `test-design` writes (R8b)
  - a check's name looked up from the provider by its `checkRun` id, pull
    request open and review times, and any other provider API in the core
    (D-A-BR-04)
  - a check's success or recovery, which no trigger delivers
  - Olympus acting on an outcome: no revert, no reopened run, no new run from a
    signal (D-A-LC-03)
  - a rate that admits or caps an autonomy level, including L3 (M3)
  - any template that starts a build; any source but GitHub's two kinds
  - counting a partial reversal as a rollback
- **Acceptance, as commands:** `pnpm typecheck`, `pnpm lint`, and
  `pnpm conformance` pass, and the report names each of these, each shown
  failing with its check deleted:
  - `I2.observe-rollback-is-found-by-diff-alone`: a revert whose message names
    another change, and a commit titled "Revert" whose diff inverts nothing,
    are each attributed by diff alone;
  - `I5.observe-partial-reversal-is-reported-apart`: a commit inverting some
    of a change's hunks is a `partial-reversal`, never a rollback;
  - `I7.observe-signal-is-attributed-by-commit-alone`: a payload whose other
    fields name another run changes nothing, and a commit no run merged is
    recorded as unattributed;
  - `I7.observe-templates-are-valid-only-on-their-kinds`: `observe-signal`
    reads extracted fields alone and is refused by validation on any kind but
    `post-merge` and `ci-failure`; `observe-history` on any kind but
    `scheduled`;
  - `I5.observe-unreadable-history-is-refused`: an unreadable checkout or
    range is a refusal, never an empty walk;
  - `I5.observe-open-window-is-in-no-denominator`: a run whose window has not
    closed is in no denominator and is counted as observing;
  - `I5.observe-window-is-required`: a policy naming an observe template with
    no window is refused;
  - `I2.observe-rates-carry-bound-and-baseline`: R2's escaped rate carries a
    sample and a bound, the baseline sits beside each rate, and no figure
    combines `provider-reported` and `committer-claimed` times.

  `pnpm test` passes for every package changed, and `git ls-files -- .plan/`
  prints nothing.
- **Invariants touched:**
  - The runtime derives status (I2): every observation is the runtime's, read
    from git and from signed bodies, and a run's state out of `observe` is
    committed by the runtime on its own clock. No model is seated.
  - Fail closed (I5): an unreadable history is a refusal; a run still
    observing is never clean; a missing window refuses the policy.
  - Payloads are data (I7): a signal reads the kind's extracted fields alone
    and is attributed by commit identity, never by what a payload says.
  - Default deny (I4): the templates are valid only on their kinds.
  - No agent writes to the Vault (I1): nothing added is reachable from a
    sandbox. No Greek names (I10).
- **Pending registry entries owed:** none (`grep -rn "'R8'"
  packages/conformance/src`: no match).
- **Dependencies, verified:** I1 (I1a, I1b), R2, and R22 are merged into
  `v2` and tagged `reviewed/I1a`, `reviewed/I1b`, `reviewed/R2`,
  `reviewed/R22` (`git tag -l 'reviewed/*'`).
- **Gate paths:** the spec's: `packages/vault/src/types.ts`,
  `packages/core/src/policy/types.ts`, `packages/conformance/`. Nothing in
  `packages/core/src/run/types.ts` or `packages/core/src/station/types.ts`
  changes (D-R8a-03, D-R8a-04). The pull request takes `gate-change`, and the
  squash merge carries `Gate-Change: acknowledged`.

### D-R8a-02: what the code holds, verified, and where it differs from the spec

- The spec's input table holds on `v2` at dfcc09b, line for line, with these
  additions and one correction.
- **Correction, the change's diff.** The spec says a change is
  `baseCommit..commit` of `IntegrationOpened`. That equals the merge's
  first-parent diff `M^1..M` only while the default branch did not move
  between the run's base and its merge. A revert made with
  `git revert -m 1 M` inverts `M^1..M`. Verified in a scratch repository: the
  `patch-id --stable` of the revert equals that of `git diff M M^1`, and the
  change's own differs. So every change, a run's or the baseline's, is its
  first-parent diff (D-R8a-06).
- A merged run stays at `integrate`, phase `exiting`, with the integrate grant
  spent in the commit that ends the drive (`api/src/line.ts:297-302`).
  `runStanding` reads `passed` from that spent grant before it calls
  `nextStep` (`api/src/run.ts:1555`), so a run at `observe` still reads
  as passed and cannot be cancelled (`run.ts:1617`).
- `nextStep` throws at `observe` (`core/src/station/machine.ts:513-515`), and
  `approveRun` calls it on any run (`run.ts:1380`). The `Step` union is in
  `machine.ts:337`, not a gate path.
- `integrate`'s contract floors its approval at `human-required`
  (`core/src/station/contracts.ts:205`), so every merged run spent a grant.
- `VaultRefKind` is in `core/src/run/types.ts:28`, a gate path the spec does
  not declare (`.github/protected-paths.txt`: `src/.*types\.ts$`).
- A delivery's template is looked up after the budget check, and every
  outcome is written once under the body's digest (`api/src/intake.ts:118-140`); the budget is checked before the template is read (`:120-121`), so a signal must be routed before it (D-R8a-11).
  The `post-merge` extractor keeps only pushes to the default branch and
  names the head commit `after` (`triggers/src/github.ts:126-132`).
- A job's firing is run by `NightlyJobs.run` and written as a
  `NightlyRecord`, then named by a `job` trigger decision
  (`api/src/intake.ts:174-185`).
- Build seats' identities are in their usage records: `role`, `driver`,
  `model` (`vault/src/types.ts:123-155`).
- R13a snapshots rates over runs ending `refused`, `merged`, or `cancelled`
  (`api/src/nightly.ts:58`). A merged run's escaped status now changes until
  its window closes, so a snapshot over it would drift (D-R8a-12).

### D-R8a-03: where an observation is stored

- **Chosen:** `runs/<id>/observations/<sha256>.json` for a run's, and
  `observations/<sha256>.json` beside the runs for a baseline or an
  unattributed one, written by `recordObservation`, read by
  `readObservations`. Both are content-named, so R13a's re-hash checks them.
- **Rejected:** *A `VaultRef` kind `observation`.* It needs
  `core/src/run/types.ts`, an undeclared gate path, and nothing holds the
  ref: a run's observations are listed by the store, as usage is.
- **Reverse by:** adding the kind in an amendment and storing under
  `objects/observation/`.

### D-R8a-04: how a run enters and leaves `observe`

- **Chosen:** the commit that spends the integrate grant after a merge also
  moves the run to `observe`, phase `working`. `nextStep` at `observe`
  returns a new `observe` step, and the drive returns on it. The walk leaves
  the window by writing a `window-closed` record, then an
  `observation-closed` decision by `observe` in P14's record, then committing
  phase `exiting` at `observe`. A run whose line has no integrator merges
  nothing and does not enter `observe`.
- **Rejected:** *Moving to `learn`.* That is M3's station. *Leaving state
  alone and deriving the exit from the records.* The state would still say
  the run is being watched after it is not (D-A-OB-03).
- **Reverse by:** returning at `integrate` and dropping the `observe` step.

### D-R8a-05: the window

- **Chosen:** `triggers.observe: { windowMs }`, a positive integer at most 90
  days, required while a subscription's template or a schedule is
  `observe-signal` or `observe-history`. It is under `triggers`, beside
  `nightly`, because the templates are what use it, and in milliseconds like
  every other duration in the policy. The walk closes a window with the
  policy it runs under, and records the `windowMs` it used in the
  `window-closed` record.
- **Rejected:** *The run's admitted policy.* A run admitted before the block
  existed would never close. A shortened window is a versioned policy edit
  by a person (I4), and the record names the window that closed each run.
- **Reverse by:** reading the admitted policy first.

### D-R8a-06: what a rollback and a partial reversal are

- **Chosen:** a change is a first-parent commit `M` of the default branch,
  and its diff is `M^1..M` (the empty tree for a root commit). A later
  first-parent commit `R` is a rollback when the `patch-id --stable` of
  `R^1..R` equals that of `M..M^1`. It is a `partial-reversal` when it is not
  a rollback and some, not all, of `M`'s hunks, taken at zero context as path
  plus removed and added lines, appear inverted among `R`'s. An empty diff
  has no patch id and is never reverted. Git is run with `--no-ext-diff`,
  `--no-textconv`, and `core.fsmonitor=false`, so no command the repository
  configures runs.
- **Rejected:** *`baseCommit..commit`.* A revert of the merge would not match
  once the default branch had moved (D-R8a-02). *Per-file patch ids.* A file
  with one of two hunks reverted would not count as partial.
- **Reverse by:** changing `classifyReversal` in `api/src/history.ts`.

### D-R8a-07: which signals count against a window

- **Chosen:** a signal counts against a change when it was recorded before
  the change's `window-closed` record. One walk records every reversal it
  finds before it closes any window, so a window is effectively the policy's
  plus up to one walk's interval, which errs toward counting a failure.
- **Rejected:** *The signal's commit time.* It is committer-claimed, and a
  committer could date a revert outside the window.
- **Reverse by:** comparing a provider-reported time with the window's end.

### D-R8a-08: what a `post-merge` signal records

- **Found:** the spec lists four kinds and does not say what a push is.
- **Chosen:** a fifth kind, `pushed`: the head commit `after` landed on the
  default branch at `repository.pushed_at`, `provider-reported`. A rollback
  whose commit has a `pushed` record takes that time; one that has none takes
  its committer time, `committer-claimed`.
- **Rejected:** *A push starts a walk.* That runs git from the webhook route
  on a payload's say-so; the scheduled walk finds the revert anyway.
  *Recording a push as ignored.* A valid template would do nothing.
- **Reverse by:** removing the kind; rollback times are then all
  committer-claimed.

### D-R8a-09: times and their sources

- **Chosen:** `provider-reported` (a signed body, or GitHub's merge API),
  `committer-claimed` (commit metadata), and `runtime`, the runtime's own
  clock, for a `window-closed` record and for the time a baseline change was
  first seen. Time to restore is figured from two times of one source:
  provider-reported where both ends have one, otherwise committer-claimed
  from both commits' dates, and each source is its own distribution. A
  baseline change's window opens when the walk first sees it.
- **Rejected:** *A commit's own date as a baseline change's window start.*
  A committer could close the window before a revert by backdating.
- **Reverse by:** none intended.

### D-R8a-10: where a walk starts

- **Chosen:** at the last head the previous walk recorded. The first walk
  starts at the first parent of the oldest merge commit among runs still
  observing, or at the head where there are none. A recorded head that is
  not an ancestor of the current head is refused `history-rewritten`.
- **Rejected:** *The whole history.* Its windows would be closed by commit
  dates a committer wrote.
- **Reverse by:** a policy start commit.

### D-R8a-11: a signal is not a candidate and spends no budget

- **Chosen:** a delivery whose template is `observe-signal` writes an
  observation and a trigger decision `observed` naming it, after the same
  signature, replay, age, and schema checks as any delivery. It records no
  candidate, so it is not counted against `budgetPerWindow`, which counts
  candidates a person must read.
- **Rejected:** *Counting signals in the budget.* A busy CI would stop
  candidates being recorded.
- **Reverse by:** counting `observed` decisions in `#overBudget`.

### D-R8a-12: a merged run is settled for R13a only once its window closed

- **Chosen:** R13a's rate snapshot takes a merged run only once its window
  has closed; its locks are still not checked after merge, as before. The
  first snapshot after R8a ships reports drift on the figures R8a adds,
  which is a figure that changed.
- **Reverse by:** the old `SETTLED` set.

### D-R8a-13: the history reader lives in `api`

- **Chosen:** `api/src/history.ts`, beside the jobs that call it, using
  `resolveCommit` from `readiness` as it is exported today.
- **Rejected:** *In `readiness`.* It would widen that package's exports for
  a reader readiness does not use.
- **Reverse by:** moving the file.

### D-R8a-14: found while building

- **Each assertion fails with its check deleted.** Shown by deleting each
  check in turn and running its assertion: the patch-id comparison
  (`I2.observe-rollback-is-found-by-diff-alone`); partial reversals read as
  rollbacks (`I5.observe-partial-reversal-is-reported-apart`); a signal
  attributed to another run than its commit's
  (`I7.observe-signal-is-attributed-by-commit-alone`); the signal-kind check
  and the schedule check in validation, each alone
  (`I7.observe-templates-are-valid-only-on-their-kinds`); an unreadable
  checkout returned as an empty walk, and the ancestry check, each alone
  (`I5.observe-unreadable-history-is-refused`); open windows counted in the
  denominator (`I5.observe-open-window-is-in-no-denominator`); the window
  requirement (`I5.observe-window-is-required`); and a time to restore taken
  from two sources, and the baseline left unread, each alone
  (`I2.observe-rates-carry-bound-and-baseline`). Eleven deletions, eleven
  failures.
- **The rates fixture first missed one.** With one run, whose rollback had a
  provider-reported push, a time to restore mixing sources gave the same
  number as the correct one, and the assertion passed. A second run whose
  rollback has no reported push now makes a mixed figure differ, and the
  deletion fails it.
- **The run's entry into `observe` is asserted** in
  `I5.integrate-merges-the-verified-tree-after-the-gate`: after the merge,
  the state is `working` at `observe` and `observe` is the last station
  entered. Deleting the commit that moves it fails the assertion.
- **Two registry tables follow the new contract.** I1's list of named Vault
  operations gains `recordObservation` and `readObservations`, so an
  operation added without a name still fails I1. P14's decision table gains
  an `observation-closed` row, run by the open-window scenario, which checks
  the decision is recorded and decided by `observe`.
- **R13b's findings reviewer sees `observation-closed`** with its window
  alone; the observation's hash is not projected (`nightly-review.ts`).
- **One validation rule the spec does not state:** at most one schedule may
  name `observe-history`. Two walks of one branch would record the same
  reversal twice and race to close one window.
- **A walk that fails part way** keeps no head, so the next walk covers the
  range again. A reversal it records twice is one signal: R2 counts a
  change's signals by change, kind, commit, and check run, never by record.
- **Known limits, owned:**
  - a `history-rewritten` refusal repeats every night until the branch again
    descends from the recorded head; repairing the record is the operator's,
    as R13a's drift is (D-A-NR-02);
  - a signal recorded after a change's window closed is kept and never
    counted, so a late revert is visible in the record and absent from the
    rates by design (D-R8a-07);
  - the window a walk applies is the policy's when it runs, recorded in each
    `window-closed` record (D-R8a-05).

### D-R8a-15: what the external review changed, and what it left

Triage: `docs/reviews/2026-11-05-R8a-post-merge-attribution-triage.md`. Both
families counted on the first run. 13 findings: 11 fixed, 1 stated as a limit,
1 rejected. Each fix landed after an assertion of the reviewer's construction
was shown failing on the code as reviewed.

- **The walk's start, and every watched change, must be on the head's
  first-parent history**, or the walk is refused `history-rewritten`, naming
  them (codex-1, gemini-2). This replaces the plain ancestry check that
  D-R8a-10 relied on. Reverse by restoring `isAncestor` in `walkHistory`.
- **A window closes only if it had closed when the head was read**, and only
  once `windowMs` plus `maxDeliveryAgeMs` have passed (codex-2, codex-4). The
  delivery age is the bound intake already enforces on a signed event, so a
  failure the window covered has arrived by then or never will. Each
  `window-closed` carries `graceMs`. This refines D-R8a-07: the rule that a
  signal counts only if recorded before the close stands, and the close now
  waits for every delivery that could still be valid. Reverse by setting the
  grace to 0 and using the close-time clock.
- **A commit that inverts every hunk of a change is a rollback**, recorded
  `match: 'all-hunks'`, beside `match: 'patch-id'` (codex-5, gemini-1). This
  extends D-A-OB-04's exact-inverse rule to a whole reversal that carries an
  unrelated edit. A partial reversal is still some hunks and not all, and is
  still never counted. Reverse in `classifyReversal`.
- **Every diff is read with `--text`** (gemini-3). A `-diff` or `binary`
  attribute emptied the hunks a partial reversal is matched on. An exact
  rollback was already found, through the blob ids that `--full-index` writes.
- **A signal kept beside the runs on a run's merge commit joins that run**
  in the derivation (`RunRecords.mergeCommit`), and leaves the baseline and the
  unattributed count (codex-3).
- **The store checks each observation kind's fields whole** (codex-7).
- **A schedule naming `observe-history` needs `ci-failure` enabled, routed
  to `observe-signal`, and subscribed** (codex-8). Without that route, a
  closed window would read as free of failures nothing collected.
- **Known limit (codex-6):** the line's windows open at GitHub's merge time,
  and the baseline's when a walk first sees the change. The report now says
  so. Opening a baseline window at a recorded push time would narrow the gap,
  and is left as an option.
- **Rejected (codex-9):** the npm scope is exempt from the naming check by
  construction.
