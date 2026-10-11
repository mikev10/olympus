# R2 — Outcome measurement

**Unit:** R2 (M2, maintainer)
**Depends on:** P4 Station machine, P6 Verification + evidence, P9 API + CLI, P14 Enforcement record
**Blocks:** R8, R11, R12, R13 read its rates.

The spine's claim waits on a number: nothing measures a false-done rate until
this unit derives one from finished runs. R2 reads the records the runtime
already writes and derives two kinds of number, safety and throughput, each
with its sample size and a confidence bound. It collects nothing new except
two facts the derivation cannot do without, which land as contract amendments
in this unit's pull request (A-R2-01, A-R2-02).

Every number is derived by the runtime from Vault records. None is reported by
a model, and none depends on what a workspace holds now: a rate read twice
from the same records is the same rate (D-A-BR-05: any rate a control plane
shows can be recomputed from these records alone).

---

## What the records hold, verified against the code

| Input | Where it is | Used for |
|---|---|---|
| Every run the store holds | `Vault.listRuns()` (A-R2-02) | the population; a caller never picks the sample |
| Admission time, requested level | `AdmissionRecord.run.createdAt`, `.requestedLevel` | cycle time start, per-level keys |
| One evidence bundle per verified attempt, in order | `RunState.evidenceRefs`, appended with the status commit (`packages/api/src/line.ts`, `commit`) | attempts, gate outcomes, claim mismatches |
| The runtime's verdict on the latest attempt | `RunState.tasks` | the last bundle's outcome |
| Where the claim and the evidence differ | `EvidenceBundle.claimEvidenceDiff`; non-empty exactly when a `claim-mismatch` violation was recorded | caught false-done |
| Attempt counters | `RunState.attempts` | iterations to green |
| Approvals spent | `ApprovalGrant.usedAt` | autonomy ratio |
| Refusals, parks, approval requests, grants, with their times | P14's `EnforcementDecision` | refusals by cause, approval wait |
| Cost per call, with its station and model | P13's `UsageRecord` | cost per merged change, the pre-run estimate |
| Merge, with GitHub's time | `IntegrationMerged.mergedAt` (A-R2-01) | cycle time end, merged count |

## Not recorded, and therefore not measured

- **Stack.** No run record names the target's stack, so no rate is kept per
  stack. The report says so in one line. Recording it is R17.
- **Escaped false-done.** A change that passed every gate and failed later
  needs `observe` (R8). The report says the escaped rate is not established,
  and never implies zero.
- **The team's baseline.** R8 attributes it; until R8 lands, R2 publishes its
  own rates alone and says the baseline is absent.
- **Role per call.** Usage records carry station and model, not role. Role is
  read from the station: `review` is the reviewer, every other agent station
  the author. A key is named `station`, never `role`, so the inference is
  visible.

## Deliverables

1. **`outcomes(vault, window?)`** in `packages/api/src/outcomes.ts`. Reads
   every run `listRuns` names, optionally those admitted inside a window, and
   returns:

   - **Population.** Runs by terminal kind read from records alone — refused
     at admission (decisions and no state), merged, passed (its last exit
     crossed with no merge recorded, which a human merges), cancelled, halted,
     parked (a task `parked`) — and `unfinished` for every other run, counted and
     excluded from run-level rates rather than dropped silently.
   - **Safety.**
     - *Caught false-done rate.* An attempt is one evidence bundle. Its
       outcome is the runtime's: every bundle of a task before its last is a
       failed attempt (the line builds again only after a failure), and the
       last takes the task's status. A false-done is an attempt whose outcome
       is not `passed`, or whose `claimEvidenceDiff` is non-empty. The rate is
       false-dones over attempts. A pipeline that trusted the agent's end of
       turn would have accepted every one of them, so the same tasks and the
       same model are the baseline.
     - *Escaped false-done:* `not-established`, always, in this unit.
   - **Throughput.**
     - *Autonomy ratio:* merged runs that spent no approval, over finished
       admitted runs.
     - *First-pass yield* per station: tasks whose first attempt passed, over
       tasks with an attempt. Rolled across the line as the product of the
       per-station yields.
     - *Iterations to green:* median and 90th percentile of `iterations` over
       passed tasks.
     - *Rework:* attempts per task, and the share of runs whose `review` exit
       was refused, labelled as exactly that.
     - *Refusals and parks by cause*, from P14's record.
     - *Approval wait* per station and level: from the first `approval-required`
       refusal of an exit to the grant that cleared it. Median and 90th
       percentile with the sample; a request with no grant yet is counted as
       open, not as a wait.
     - *Cycle time:* admission to `mergedAt`, merged runs only. Median and
       90th percentile.
     - *Cost per merged change:* every metered dollar the window's runs spent,
       merged or not, over the merges. A lost reading makes the figure a lower
       bound and says so.
   - **Keys.** Every rate is also kept per model identity, per station, and per
     requested level.

2. **Bounds.** Every proportion carries its count, its sample size, and a
   one-sided 95% Clopper–Pearson bound on the side that matters: upper for a
   failure rate, lower for a success rate. Zero failures in 300 attempts bounds
   the rate at about 1%. A rate over no sample is `no-sample`, never 0% or 100%.

3. **The likely cost beside the worst case.** `estimateCost` reads past usage
   per station and model. For each task a run would schedule, the model is the
   one the driver resolves the task's starting tier to; the likely figure is
   the sum of each cell's median task cost. Below five past tasks in any cell
   it returns `insufficient-sample`, naming the cells, rather than a guess. A
   `cost-unapproved` refusal carries it beside the worst case, and the CLI
   prints it on the next line. The worst case remains the figure approved.

4. **`RunReport` separates what was recorded from what was observed.** It
   carries `standingSource: 'records' | 'workspace'` beside its standing, so an unfinished run's
   live lock check is never read as a recorded fact (D-I1b-15).

5. **A surface.** `GET /outcomes` on the service, and `olympus outcomes` in the
   CLI, printing safety first, then throughput, each rate with its sample and
   bound, and the not-measured list above.

## Contract amendments, landed in this unit's pull request

- **A-R2-01.** `IntegrationMerged` gains `mergedAt`: GitHub's merge time, read
  back from the pull request. GitHub's time, not the runtime's clock, so a
  resume that records the same merge writes the same entry.
- **A-R2-02.** `Vault` gains `listRuns()`: every run the store holds any
  record for, a run refused at admission included, sorted by id.

Anything further found in the work stops the unit for confirmation.

## Out of scope

- a baseline from the target's own history, R7's corpus, and the escaped rate (R8, R7)
- recording stack per run (R17)
- telemetry export (R12)
- any dashboard or UI; the control plane displays these numbers and never computes its own (D-A-BR-05)
- changing the README or spine wording about a reduction: one proof run is not a window
- recording anything new about a run beyond A-R2-01 and A-R2-02
- an escalation-aware cost estimate; the likely figure uses each task's starting tier

## Conformance

A fixture Vault of hand-built runs with known answers: the caught false-done
rate counts a failed attempt and a mismatched claim on a passing attempt, and
not a passing, matching one; a parked and a halted run are finished, an open
one is excluded and counted; approval wait pairs each grant with the first
request it cleared; cost per merged change counts an unmerged run's spend; a
lost reading marks the cost a lower bound; an empty Vault yields `no-sample`
everywhere; Clopper–Pearson bounds match published values; `estimateCost`
refuses a cell under five tasks; a finished run's report reads `records`, an
unfinished one `workspace`. The amendments: a merge record carries GitHub's
time, on a merge and on a resume after a lost record; the Vault lists a run
refused at admission.

## Acceptance

- `pnpm typecheck`, `pnpm lint`, and `pnpm test` pass
- `pnpm conformance`: the R2 assertions are registered and pass; `pending-baseline.json` is unchanged
- `olympus outcomes` prints the same figures the library returns over the same Vault (the CLI test). The M1 proof run's Vault is not committed, only its report, so it cannot be the input (D-R2-02)
- changesets for `@olympus-ai/vault`, `@olympus-ai/api`, `olympus-ai` (the CLI), `@olympus-ai/conformance`
- `git ls-files -- .plan/` prints nothing

**Gate paths:** `packages/vault/src/types.ts` and `packages/conformance/` are
protected, so the pull request carries `gate-change` and the squash body
carries `Gate-Change: acknowledged`.

**Invariants:** I2 is the subject — every rate is derived from runtime records,
and an agent's end of turn is never a pass. I5: no sample is `no-sample`, an
unfinished run is counted as excluded, a lost reading makes cost a lower bound,
and an estimate without history declines. I8: each rate has an assertion that
fails when its derivation is deleted.
