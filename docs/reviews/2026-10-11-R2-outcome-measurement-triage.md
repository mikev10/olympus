# Triage of the external reviews of R2, 2026-10-11

Two reviews of R2 (outcome measurement), run from one prompt and one bundle
(`2026-10-11-R2-outcome-measurement-review-bundle.txt`, SHA-256
`3a2cb047dfb3610f00af4b03f23f181a488776c6eec803890a098880df57cf34`, base
`9021655` `reviewed/R1`, head `0a7141d`):

- `2026-10-11-R2-outcome-measurement-review-codex.md`: gpt-6-astra, family
  codex, outcome `counted`
- `2026-10-11-R2-outcome-measurement-review-gemini.md`: gemini-3.1-pro-preview,
  family gemini, outcome `counted`

Both replies matched their manifests' `replySha256` before their headers were
prepended.

## Counts

| Family | Findings | Holds | Holds in part | Does not hold | Belongs to another unit |
|---|---|---|---|---|---|
| codex | 6 | 4 | 1 | 0 | 1 (R1, and it holds in part) |
| gemini | 4 | 1 | 1 | 2 | 0 |

One finding was raised by both families: codex-2 and gemini-1. Every finding
was checked against the code by a reviewer with fresh context that was given
the finding and the file, and the load-bearing claims were then re-read at the
cited constructs. Cases were run for codex-3 and codex-4 (a scratch test,
deleted afterwards) and for gemini-4 (`Date.parse` in node). The others were
settled by reading the code.

## Summary

| Finding | Restatement | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| codex-2 / gemini-1 | A merged run whose integrate grant is not yet spent, or not yet visible to the reader, counts as autonomous | codex, gemini | holds | fixed |
| codex-1 | Any failure to read run state is treated as "no state": the run's evidence and spend disappear, and its null cost sums as $0 | codex | holds | fixed |
| codex-4 | The review-exit refusal rate counts unfinished runs in its denominator | codex | holds | fixed |
| codex-5 | The likely-cost median takes in tasks that never finished | codex | holds | fixed |
| gemini-4 | The HTTP window accepts non-ISO times | gemini | holds in part | fixed |
| codex-3 | Rolled yield is a product over whichever stations have attempts; the `no-sample` guard cannot fire | codex | holds in part | known limit, `docs/decisions.md` |
| codex-6 | The R1 negative fixtures accept `indeterminate` as proof the check ran | codex | holds in part; belongs to R1 | owned by R1, `docs/decisions.md` |
| gemini-2 | A fully autonomous run ends without a spent integrate grant, so it reads as unfinished | gemini | does not hold | reject |
| gemini-3 | The first model of a task is chosen by hash order, so escalation misattributes yield and cost | gemini | does not hold | reject |

## codex-2 and gemini-1: a merge counted as autonomous

**Claim.** `readRunRecords` reads run state before it reads integration
records. A run can therefore read as `merged` while its integrate grant is
unspent. One way is a stop between the merge and the commit that spends the
grant (both families). The other is a reader that interleaves with a live drive
(codex only). Either way `approvalsSpent` is 0 and the run counts as
autonomous.

**Checked.** The drive merges before it spends the grant, and says so
(`packages/api/src/line.ts:200-203`). `readRunRecords` reads state at
`packages/api/src/outcomes.ts:145` and integration records at `:163`. The
autonomy predicate is `ending === 'merged' && approvalsSpent === 0` (`:281`),
and `approvalsSpent` counts grants whose `usedAt` is set (`:211`).

**Found.** The finding holds, and the consequence is worse than either reviewer
said. `integrate` states `human-required` as its own floor
(`packages/core/src/station/contracts.ts:90-92`, `:120`), and the effective
approval is the stricter of that floor and the policy
(`packages/core/src/station/machine.ts:104-112`). Every genuine merge therefore
spends a grant, so the predicate can be true only inside the window both
reviewers describe. The autonomy ratio can only be inflated; it cannot be
right. A stopped run is repaired on resume, because resume finds the merge and
spends the grant (`line.ts:200-201`). Until then the inflation persists.

gemini-1's proposed fix is to count `approval-granted` decisions. It is feasible,
because the decision is written before the grant is committed
(`packages/api/src/run.ts:745-749`). It also over-counts: a decision can stand
when the commit that would have granted it fails (`run.ts:756-758`).

**Outcome: fixed (D-R2-04).** Two changes. First, read the integration records before
the run state. A merge is only possible after its grant is committed, so any
state read after a merge was observed holds the grant. Second, on a merged run,
count an unspent `integrate` grant as spent, since the merge consumed it. That
keeps `ApprovalGrant` as the source, which is the source the spec's table names.
An assertion covers a merged run with an unspent integrate grant, and it is to
be shown failing against the current code.

## codex-1: an unreadable state read as absent

**Claim.** The bare `catch` around `readRunState` treats every error as absent
state. A torn state write therefore drops the run's tasks, usage and cost. A
`null` cost then sums as $0 without making the cost figure a lower bound.

**Checked.** `outcomes.ts:144-160` catches every error and returns empty tasks,
empty usage and `cost: null`. `LocalVault.readRunState`
(`packages/vault/src/local/vault.ts:601-607`) throws a plain `Error` for
absence. It also throws on a corrupt highest version, because each version is
written with `flag: 'wx'` and not by rename (`vault.ts:125-128`, `:160-165`), and
on any I/O error. Usage is stored independently of state
(`packages/api/src/cost.ts:126-139`), yet the catch never reads it. The cost
aggregate adds `cost?.… ?? 0` and marks the figure a lower bound only when
`cost !== null` (`outcomes.ts:342-343`).

**Found.** The finding holds. Recorded spend can vanish, and the cost per
merged change can read `exact` while it understates. The trigger is narrow (a
torn write or an I/O fault). It is still a fail-open path in the unit whose
purpose is that figures fail closed.

**Outcome: fixed (D-R2-05).** Absence is now a named failure: the vault types
gain `NoRunState` (`code: 'no-run-state'`), the package exports `isNoRunState`,
both vaults reject with it, and `readRunRecords` treats only that as absence
and propagates every other failure. It is a code rather than the class the
confirmed line named. `I5.stale-commit-is-refused-under-contention` loads
`local/vault.ts` under Node's type stripping, where a relative value import
does not resolve, so a class failed it. An assertion covers a run whose state
cannot be decoded: `outcomes()` refuses it, and does not report it as an
unfinished run with no spend.

## codex-4: unfinished runs dilute the review refusal rate

**Claim.** `reviewExitRefused` iterates over all runs, so reviews that never
returned inflate the denominator.

**Checked.** `outcomes.ts:311-315` loops over `runs`, not `finished`. The spec
calls this rate "the share of runs whose `review` exit was refused"
(`docs/plan/R2-outcomes.md:79-80`) and keeps unfinished runs out of run-level
rates (`:59-60`). A scratch test of one refused review and 99 unfinished
reviews gave `count 1, sample 100, rate 0.01, upper 0.0466`.

**Found.** The finding holds, with a caveat. A run whose review exit was
refused can itself still be `unfinished`. Excluding unfinished runs drops that
refusal too.

**Outcome: fixed (D-R2-06).** Take the rate over `finished`, as the spec's rule for
run-level rates says. This makes it consistent with the autonomy ratio beside
it. The caveat is recorded in `docs/decisions.md`: a refusal on a run that has
not ended is counted once the run ends. An assertion covers the reviewer's case.

## codex-5: unfinished tasks in the cost estimate

**Claim.** `estimateCost` admits any task whose calls are all metered, with no
check that the task finished. Five tasks stopped after one cheap attempt
therefore set the median.

**Checked.** `outcomes.ts:399-412` reads every run and groups usage by task. It
skips a task only for a non-metered call (`:407`). Neither the task's status nor
the run's ending is consulted. The spec says "past task" (`R2-outcomes.md:99-105`)
without defining it.

**Found.** The finding holds. The likely figure can be pulled down by
truncated histories, though the worst-case figure is unaffected. The spec is
ambiguous here, which working rule 5 says to raise rather than settle.

**Outcome: fixed (D-R2-07), on the confirmed reading: a task that has ended.**
As confirmed, this line listed `failed` among the final statuses. Applying the
fix showed that is wrong. The line builds a failed task again while it has
iterations left, and parks it when it has none (`line.ts`, where the verdict
sets the status), so `failed` is not final. A past task is therefore one whose
status is `passed`, `parked` or `cancelled`, or one on a run that has ended. An
assertion covers five unfinished, fully metered tasks, both `running` and
`failed`, which must not form a sample; five `parked` tasks still do.

## gemini-4: the window accepts non-ISO times

**Claim.** `outcomeWindow` checks only `Number.isNaN(Date.parse(value))`, so
non-ISO strings pass, which the reviewer calls failing open.

**Checked.** `packages/api/src/http/server.ts:397-406` does that, under a doc
comment that says "each an ISO time if given; anything else is refused". The
spec does not say ISO. The CLI forwards `--from` and `--to` unchanged
(`packages/cli/src/cli.ts:224-232`), so the service is the only gate. In node,
`Date.parse('10/11/2026')` and `Date.parse('Oct 11 2026')` both return
2026-10-11T04:00Z, which is local midnight on a UTC-4 host. `Date.parse('1')`
returns 2001-01-01 local time.

**Found.** It holds in part. Nothing fails open: an unreadable value is still
refused with a 400, and `inWindow` (`outcomes.ts:219-224`) re-parses the same
string, so the window is consistent with itself. The real defect is narrower.
A non-ISO spelling is read in the server's local time, so the same request can
name different windows on different hosts, and the code does not do what its
own comment says.

**Outcome: fixed (D-R2-08).** Accept only ISO 8601 date-times that carry `Z` or an
offset, and refuse everything else with the existing 400. An assertion covers
`10/11/2026` being refused.

## codex-3: rolled yield over the stations that happen to have attempts

**Claim.** Rolled yield multiplies only the stations that have attempts, so a
build-only population reads 1. The `no-sample` guard cannot detect a station
that is absent.

**Checked.** `Tally.add` creates a cell only when it records a sample
(`outcomes.ts:229-232`). A cell is never `no-sample`, so the
`some(no-sample)` guard at `:299-301` is dead. Review writes no evidence
bundle: `review()` records results and commits but never calls
`writeEvidence`, which happens only in the build path (`line.ts:1033`). Review
tasks therefore have no attempts and are skipped at `outcomes.ts:292`. The spec
defines rolled yield as "the product of the per-station yields"
(`R2-outcomes.md:74-76`) and names no required set of stations. A scratch test
of one passed build task gave `rolledYield: 1` over `['build']`.

**Found.** It holds in part. The guard is dead, and the figure covers only the
stations that write evidence, which at M1 is build alone. A missing review
station is not a gap in the sample, as the claim has it: review has no
attempts by design. A small related point: a task with bundles but no usage
records is keyed `no-call` (`:293`) and enters the product as if it were a
station.

**Outcome: known limit (D-R2-09).** It is recorded in `docs/decisions.md`: rolled yield
is taken over the stations that write evidence bundles, which is build alone
at M1, and is not a line-wide figure until review writes attempts. Defining a
required set of stations is a spec decision, not a review fix. The dead guard
is noted in the same entry.

## codex-6: negative fixtures accept `indeterminate`

**Claim.** The negative-fixture assertion rejects only `supported` and a
missing result. An `indeterminate` result therefore passes it. For example, a
gitleaks startup failure satisfies the secret fixture, whose `rests` list is
empty.

**Checked.** The condition is at `packages/conformance/src/registry/readiness.ts`,
around line 479. `ProbeOutcome` is `supported | absent | indeterminate`
(`packages/readiness/src/types.ts:18`). `secretScan` returns `indeterminate` for
any gitleaks exit other than 0 or 2 (`scan.ts:353-366`). `git log` places the
condition in `62147bc`, the R1 amendment (#34) recorded as D-R1-24. R2 does not
touch the file.

**Found.** It holds in part. The assertion cannot tell a check that ran and
failed from a check that never ran. D-R1-24 claims only that a probe whose
check is replaced by an unconditional `supported` is caught, and that claim
stands. This is a gap in the assertion's strength, not a break in its stated
claim.

**Outcome: owned by R1 (D-R2-10).** It is recorded in `docs/decisions.md` against R1:
each negative fixture should assert `absent` together with the evidence that
names the intended failure. It is not fixed on this branch, because it is
outside R2's scope.

## gemini-2: autonomous runs read as unfinished

**Claim.** A level-3 run completes without spending an integrate grant. Both
`deriveOutcomes` and `runStanding` would then read it as unfinished, and
`runStanding` would fall back to live workspace checks.

**Checked and found.** It does not hold. The integrate exit is
`human-required` at every level, and no policy relaxes it
(`packages/core/src/station/contracts.ts:90-92`, `:120`;
`packages/core/src/station/machine.ts:104-112`). `transition` refuses without
an unspent grant. A run with no integrator, the L1-or-below human-merge case,
still spends its grant and ends `passed`. No run reaches the end without a
spent `integrate:<level>` grant. The workspace source is reached only by runs
that have not ended.

**Outcome: reject.**

## gemini-3: the first model chosen by hash order

**Claim.** `LocalVault.readUsage` sorts by hash. `calls[0]` and
`find(attempt === 1)` therefore pick an arbitrary model when a task escalates
inside its first attempt.

**Checked and found.** It does not hold as written. Two things rule it out.
First, `readUsage` in `packages/api/src/cost.ts:126-139` takes the state's usage
references first, in the order they were committed. Only unreferenced records
follow in hash order. Second, escalation is decided between attempts:
`escalationAt` returns null below two iterations
(`packages/core/src/policy/tier.ts:59-64`), and the tier is fixed before an
attempt starts (`line.ts:421`, `:559`). Every call inside an attempt therefore
uses one model.

A minor fragility remains nearby. `estimateCost` keys a task by `calls[0]`
(`outcomes.ts:406`), which follows hash order when every record of a task is
unreferenced. Unreferenced records are almost always `pending`, and a pending
record already excludes the task (`:407`). Escalation-aware estimation is
excluded by the unit's out-of-scope list.

**Outcome: reject.**

## Framing (item 7)

Gemini accepts the framing. Codex accepts it and adds a point: Clopper–Pearson
bounds assume independent trials, and correlated attempts or a caller-chosen
window do not supply that. The point is sound, and it is not a defect in R2's
code, which computes the bounds the spec names. It belongs to whoever first
publishes a bound as a general safety claim. That is R8's escaped rate and
baseline, which R2's out-of-scope list names. It is recorded in
`docs/decisions.md` against R8.
