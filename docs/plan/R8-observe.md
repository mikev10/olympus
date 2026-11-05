# R8 — Observe: post-merge outcomes, as R8a and R8b

**Units:** R8a (M2), R8b (M2)
**R8a depends on:** I1, R2, R22
**R8b depends on:** R8a, R19
**Blocks:** R11 waits on R8a; R8b blocks nothing

The `DECOMPOSITION.md` entry for R8 says what `observe` is for, and it still
binds both units. This spec splits that entry into two units, names what each
delivers, what each leaves out, and what proves each done, and records the
choices the entry leaves open (D-A-OB-01 to D-A-OB-08). It was checked against
the code on `v2` at e752669, and the maintainer confirmed it on 2026-11-05.

The split follows what each unit reads. R8a reads git history and two webhook
kinds that already exist, and attributes what it finds to runs. R8b adds an
artifact that `test-design` writes and the lock holds, which is a different
part of the line and a different risk: an artifact the builder could edit
would end up judging the builder (D-A-OB-01).

---

## What the code holds, verified against it

| Input | Where it is | What it means here |
|---|---|---|
| The line never enters `observe`: after `integrate` the run returns | `api/src/line.ts:296-302`; `core/src/station/machine.ts:513-515` throws on `observe` | R8a enters `observe` for the first time (D-A-OB-03) |
| `observe` has a contract: runtime-only, `evidence-bundle`, `auto` exit, no panel | `core/src/station/contracts.ts:149-159`, `:206` | no model is seated there, and no approval is needed to leave it |
| A merged run records the merge commit and GitHub's merge time | `vault/src/types.ts:378-387`; `api/src/integrate.ts:226-255` | the entry's "records when the pull request was merged" already exists (A-R2-01). R8a reads it and builds nothing for it |
| Integrate merges with `merge_method: 'merge'`, pinned to the run's commit | `api/src/integrate.ts:242`, `:230` | the change is exactly `baseCommit..commit` of `IntegrationOpened`, so its diff comes from git alone |
| `post-merge` carries `repository`, `ref`, `commit`; `ci-failure` carries `repository`, `commit`, `checkRun`, `conclusion` | `core/src/trigger/schemas.ts:122-132` | both kinds name a commit, so a signal joins a run on commit identity and on nothing a payload says |
| A push's time comes from the signed body (`repository.pushed_at`) | `triggers/src/github.ts:86-88` (D-R22-02) | a time GitHub reports, not one the committer wrote |
| Only failed check runs are delivered; success, neutral, skipped, cancelled, and stale are ignored | `triggers/src/github.ts:145-147` | R8a sees a failure and never a recovery; R8b's "works" signal needs a success, which no trigger carries (D-A-OB-07) |
| A job template is valid on `scheduled` only | `core/src/policy/validation.ts:649-652` | R8a's signal template on `post-merge` and `ci-failure` widens that rule for its own template alone (D-A-OB-02) |
| The default branch is read from a host-side checkout | `api/src/nightly.ts:40-42`, `:328`; `readiness/src/tree.ts:27`, `:56` | nothing lists or diffs the commits in a range; R8a adds a history reader beside `resolveCommit` |
| A seat's identity is its role, driver, and model | `core/src/station/types.ts:84-88` (R9) | outcomes are keyed by the identities that built the change |
| R2 reports the escaped false-done rate as `'not-established'` and has no baseline | `api/src/outcomes.ts:100-101`, `:149-150`, `:447` | R8a replaces both with measured values, each with its sample size and bound |
| A lock entry is a path, a hash, a time, and the station that locked it | `vault/src/types.ts:24-31`; `api/src/line.ts:425`, `:472` | R8b's plan is locked by path with the acceptance tests and needs no change to the lock's shape |
| No pending registry entry names R8 | `grep -rn "'R8'" packages/conformance/src`: no match | the units add entries and owe none |

---

## R8a — Post-merge attribution and the baseline

**Deliver:**

- **The run enters `observe`.** After the merge is recorded, the run moves to
  `observe` and its drive returns, as it does today. It leaves `observe` when
  the observation window that policy names has closed. The runtime decides
  that from the merge time and the window, and it is recorded in P14's record.
  No model and no approval is involved. A run still in `observe` is counted as
  observing, never as clean (D-A-OB-03).
- **The observation window.** `observe.window` in policy is a duration. If a
  policy enables an observe template without one, validation refuses it. No
  window is implied (I5).
- **Reverts found by content.** Over the default branch's first-parent history,
  a later commit whose diff is the exact inverse of a change's diff is that
  change's rollback. The match is made on `git patch-id --stable`, never on
  the commit message. A later commit that inverts some of the change's hunks
  but not all of them is recorded as `partial-reversal` against the change. It
  is reported on its own line, never counted as a rollback, and never dropped
  (D-A-OB-04).
- **Check failures joined on commit identity.** A `ci-failure` event whose
  `commit` is a change's merge commit is a failed check against that change.
  The template uses only the typed fields, and the check is known by its
  `checkRun` id alone. R8a does not look up the check's name from the provider
  (D-A-OB-05).
- **Job templates.** `TemplateId` gains `observe-signal` and `observe-history`.
  `observe-signal` is valid only on `post-merge` and `ci-failure`. It records
  the signal against the run whose merge commit it names, or as unattributed
  when no run has that commit. `observe-history` is valid only on `scheduled`.
  It walks the default branch from the last head it observed to the current
  head, finds reverts, closes windows, and attributes the baseline. If it
  cannot read the checkout or the range, the outcome is `refused` with the
  cause, never "no reverts" (I5).
- **The observation record.** Each change gets one write-once,
  content-addressed `ObservationRecord` per signal. A run's record sits under
  the run, and a baseline change's record sits beside the runs, as R13a's
  nightly records do. Each record carries the change's commits, the signal
  kind (`rollback`, `partial-reversal`, `check-failure`, `window-closed`), the
  commit that carries the signal, its time, where that time came from, and
  `collectedBy: 'runtime'`.
- **Times say where they came from.** A time GitHub reported in a signed body
  or the merge API is `provider-reported`. A time read from commit metadata
  is `committer-claimed`, because whoever made the commit wrote it. R2 never
  combines the two kinds in one figure (D-A-OB-06).
- **The rates.** From these records come the rollback count, the
  change-failure rate (a rollback or a failed check on the merge commit, over
  changes whose window closed), and time to restore (from merge to rollback).
  Each is given per run, per role, and per seat identity, and the escaped
  false-done rate is a merged run that passed every gate and then had a
  rollback or a failed check, over merged runs whose window closed. Each rate
  carries its sample size and bound, and R2's report replaces
  `'not-established'` with it.
- **The baseline.** The same attribution runs over every first-parent change
  to the default branch that no run made. It yields the change-failure rate,
  time to restore, and lead time from first commit to merge. A squash merge
  keeps no first commit, so its lead time is recorded as not measurable,
  never as zero. R2 publishes each rate beside its baseline, never as one
  figure, and safety before throughput (D-A-BR-04).
- **The bound's assumption.** The report states that each bound assumes
  independent runs, and that runs on one repository share a codebase and are
  not independent. No rate here admits a level (D-R2-11, D-A-OB-08).

**Out of scope:**

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

**Gate paths:** `packages/vault/src/types.ts` for the record and its store
methods, `packages/core/src/policy/types.ts` for `observe.window`, and
`packages/conformance/` for the registry entries. The pull request takes
`gate-change`, and the squash merge carries `Gate-Change: acknowledged`.

**Conformance and acceptance:** `pnpm typecheck`, `pnpm lint`, and
`pnpm conformance` pass. The report names an assertion for each of the
following, and each fails when its check is deleted:

- a revert whose message names another change, and a commit titled "Revert"
  whose diff inverts nothing, are each attributed by diff alone
- a signal is attributed by its commit alone: a payload whose other fields
  name another run changes nothing, and a commit no run merged is recorded
  as unattributed
- `observe-signal` reads extracted fields alone and is refused by validation
  on any kind but `post-merge` and `ci-failure`; `observe-history` is refused
  on any kind but `scheduled`
- an unreadable checkout or range is recorded as a refusal, never as an
  empty walk
- a run whose window has not closed is excluded from every denominator and
  counted as observing
- a policy that enables an observe template with no `observe.window` is
  refused
- R2's escaped rate carries a sample size and a bound, the baseline sits
  beside each rate, and no figure combines `provider-reported` and
  `committer-claimed` times

---

## R8b — The observation plan

**Deliver:**

- **The plan.** It is supplied with the run like the acceptance tests, or
  drafted at `test-design` under R19's rules. It names the signal that shows
  the change working once merged, the signal that shows it regressed, and the
  condition that calls for a rollback. A signal is a check the target's own
  CI runs on the default branch. Olympus never collects or emits a signal
  (D-A-BR-02).
- **Locked with the acceptance tests.** The plan is one more path in the lock
  manifest, locked at `test-design` by the same `lockAdmitted` call
  (`api/src/line.ts:425`) and re-verified at every transition. A run whose
  plan is missing at `test-design` is refused, never admitted unplanned (I3,
  I5).
- **Read in `observe`.** When the window closes, every signal the plan named
  is recorded as seen working, seen regressed, or missing. A signal the target
  never reported is recorded as missing, never skipped, so an uninstrumented
  change is visible as one.

**R8b needs a contract amendment before it starts.** A "works" signal is a
check that succeeded, and no trigger delivers a success
(`triggers/src/github.ts:145-147`). The R8b amendment chooses between a
`TriggerKind` for completed checks and a provider adapter that reads check
runs, and it decides what language a plan names a check in, since D-R22-11
keeps check names out of every payload schema (D-A-OB-07).

**Out of scope:** signals other than checks (metrics, logs, traces, which
need a provider adapter); Olympus instrumenting the target; acting on a
rollback condition, which is recorded and never executed (D-A-LC-03).

**Gate paths, conformance, and acceptance:** set by R8b's amendment.
