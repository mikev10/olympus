# Triage of R8b's external reviews, 2026-11-06

Two reviews, both `counted`: codex (gpt-6-astra, 72,793 input tokens against a
floor of 45,484) and gemini (gemini-3.1-pro-preview, 65,277 against the same
floor). Neither family was rerun. Both replies matched their manifests'
`replySha256` before their headers were prepended.

**Counts.** Codex reported 4 findings and Gemini reported 2, which pair into
4 distinct findings. Two were raised by both families (A and B).

| Verdict | codex | gemini |
|---|---|---|
| holds, fixed now | 3 (codex-1, codex-3, codex-4) | 1 (gemini-1) |
| holds, recorded as a known limit | 1 (codex-2) | 1 (gemini-2) |
| does not hold | 0 | 0 |

Each finding was checked by a subagent given only the claim and the cited
files, with no account of who wrote the code. Every claim it confirmed was
also reproduced by a test that failed against the code as reviewed.

| # | Finding | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| A | A partial write of a plan's signals is read as a complete reading, so the next walk closes the window on what was written | codex-1, gemini-1 | holds | fixed |
| B | A check is matched by app and name alone, so a trivial check, or a CI job emptied under a planned name, reads `working` | codex-2, gemini-2 | holds, as a limit of the design | known limit, D-R8b-03 |
| C | A later neutral, skipped, or cancelled completion replaces an earlier failure, so the check reads `missing` and the rollback streak breaks | codex-3 | holds | fixed |
| D | A `regressed` check that succeeded once reads `working` though later commits reported nothing, and nothing records the gap | codex-4 | holds | fixed (coverage recorded) |

## A: a partial reading closed the window

- **Checked:** `observePlan` returned `'recorded'` when any `plan-signal`
  existed (`packages/api/src/observe.ts`, at review head). It wrote signals
  one by one and the rollback condition last. `recordObservation` writes one
  file per call.
- **Reproduced:** the new assertion
  `I5.observe-partial-plan-reading-is-finished-before-close` fails the second
  plan-signal write through a proxy over the store. Against the reviewed code
  it failed with `the finished reading holds ["works:test"]`: the next walk
  closed the window on one of three checks and no rollback condition.
- **Fix:** the reading is complete only when every planned check (role, app,
  name) has its signal. A met rollback condition is recorded before any
  signal, so a run holding every signal holds its condition too. A part-done
  reading is finished on the next walk, which records only what is absent.
  Rejected: a count of signals, which a duplicate would satisfy, and a
  separate completion marker, which is one more record that can fail between
  writes.

## B: the plan names a check, not what the check runs

- **Checked:** `decidingRun` matches app, name, status, and time. `CheckRun`
  carries no workflow or job definition, and a drafted plan is checked for its
  shape alone.
- **Verdict:** holds, as a statement of what the mechanism proves. It proves
  that GitHub reported this conclusion for this app's check of this name on
  this commit, not that the check tests what its name suggests. Binding a
  check to its executed definition would mean reading and pinning the
  target's workflow files. The out-of-scope list excludes Olympus
  instrumenting the target or running a check, and the trust model gives the
  repository's CI to the adversary.
- **Outcome:** recorded as a known limit (D-R8b-03). What stands against a
  trivial check today: a drafted plan passes the test critic and an approval
  before it is locked, and a supplied plan is a person's. No change.

## C: a later non-decisive run erased a failure

- **Reproduced:** `a later neutral, skipped, or cancelled completion never
  erases a failure` failed against the reviewed `decidingRun`.
- **Fix:** only a decisive run decides: a success, or a failing conclusion. A
  later neutral, skipped, cancelled, or stale completion is passed over, and a
  later success still decides, as a rerun that passed (a control test covers
  it). Rejected: reading any failure on a commit as regressed, which would
  report a passing rerun as a regression.
- **Residual:** two runs of one app and one name on one commit, such as a
  matrix job with a fixed name, cannot be told from a rerun. The latest
  decisive one decides. Recorded in D-R8b-03.

## D: a gap in coverage folded into `working`

- **Reproduced:** `a regressed check counts the commits it was read on and
  the commits it was decided on` failed: no coverage was reported.
- **Fix:** every `plan-signal` carries `coverage: { commits, decided }`. The
  store refuses a signal without it, or one whose `decided` exceeds
  `commits`. The status rule is unchanged, so a check seen passing once and
  absent afterwards is still `working`, now with its gap on the record.
  Rejected: reading such a check as `missing`, which would discard a real
  success, and a new status, which the amended spec does not define.

## Applied

All three fixes are in one commit, because they share `judgePlan`, the
`plan-signal` type, and `observePlan`. Each is named in the commit message.
After the fixes, the full acceptance set was rerun. Typecheck and lint pass,
the api tests pass, and every observe assertion passes, the new one included.
The remaining conformance failures are the paid-suite externals pending CI.
