# Decisions: tiers and paid boundary (amendment)

## Amendment: tier per station, the observation plan, delivery measures, and the paid boundary

Four gaps found on 2026-09-29 by checking the line against how coding-agent
vendors announced their products the week of 2026-09-22: a split between a
frontier model for hard work and a cheaper one for volume work, a monitoring
plan written when a change is proposed and read after it deploys, review
time broken into its waits, and delivery measured against a baseline. Each
row was checked against the code on `v2` at 87265a1. The last decision
records which side of the open-source boundary a dashboard falls on. No
package changes; the amendment adds R14 and extends R8 and R2.

| Their practice | Here, in code today | Owner |
|---|---|---|
| Model chosen by the shape of the work | In part. Tier is set per role (`CapabilityScope.tier`, `packages/core/src/policy/types.ts`) and the driver resolves it (`packages/drivers/claude-code/src/driver.ts`). Not per station; no escalation | R14 |
| Cheap first, stronger model on hard failure | Absent. A failing task parks with `iterations-exhausted` at its starting tier | R14 |
| Expected signals stated before merge, read after | Absent. R8 finds reverts and failing checks; nothing states what healthy looks like | R8 |
| Delivery compared with the team's own history | Absent. R2 and R8 measure only Olympus's runs | R8, R2 |
| Review time split into its waits | Absent. `ApprovalGrant` keeps `approvedAt`; when the approval was first needed is not kept. P14 will record the refusal | R2 |

### D-A-BR-01: tier per station and escalation are one unit, R14, in M2

- **Ambiguous:** the maintainer approved choosing the model per station as a cost fix on 2026-09-25, and no unit owned it. Policy already carries a tier per role, so it could be read as done.
- **Chosen:** a new unit. A role's scope may override its tier per station. Escalation — the next iteration one tier higher after a number of failed gates — is a grant, absent by default, one tier per decision, capped by a ceiling in policy, decided by the runtime from `TaskAttempts.iterations`, charged to the same budget, and recorded in P14's record.
- **Must hold:** every model that built a task counts as its author when a reviewer is seated. Today `packages/api/src/line.ts` takes the model from the task's recorded result only, which after an escalation is the last model and not the first.
- **Why:** one tier per role spends the strongest model on mechanical work or the weakest on hard work. Escalation spends it only where evidence shows it is needed, and a model that could ask for a stronger model would be reporting its own difficulty (I2).
- **Why M2:** it saves money only once the line runs a real driver, which is I1.
- **Reverse:** drop escalation and keep the per-station override; the override stands alone.

### D-A-BR-02: R8 reads outcomes against an observation plan locked before build

- **Ambiguous:** R8 attributes reverts and failing checks to a run, which finds failure but cannot tell a healthy change from an unobserved one.
- **Chosen:** `test-design` writes an observation plan — the signal that the change works, the signal that it regressed, the rollback condition — locked in the lock manifest with the acceptance tests. `observe` reads the target's signals against it. A named signal the target does not produce is recorded as missing.
- **Why:** a plan the builder could edit after the fact would judge it by an artifact it can write (I3), and an unmeasured change reported as healthy is a silent degrade (I5).
- **Not changed:** Olympus does not deploy, instrument, or emit the target's signals (D-A-LC-03). Whether the plan needs a typed contract shape is R8's contract amendment, not this one.
- **Reverse:** drop the plan; R8's revert and check attribution stands alone.

### D-A-BR-03: R2 publishes approval wait

- **Chosen:** approval wait, from the first refusal of a station exit for want of a human approval to the grant that clears it, per station and level, as a median and 90th percentile with its sample size. A throughput number, never a safety one.
- **Why:** at L1 and L2 the line's time is mostly spent waiting for a human, and cycle time alone hides it. It is also the number that shows whether raising a station's level is worth its risk.
- **Depends on:** P14 recording the `approval-required` refusal with its time. R2 already depends on P14, so no dependency changes.
- **Reverse:** none intended.

### D-A-BR-04: outcomes are compared with the target's own history, never scored

- **Ambiguous:** R2 and R8 measure only Olympus's runs, so whether the line delivers faster or safer than the team it works beside has no answer.
- **Chosen:** R8 runs its attribution over every merge to the default branch, so git history alone yields a baseline — change-failure rate, time to restore, and lead time from first commit to merge — for changes Olympus did not make. It also records when an Olympus pull request was merged. R2 publishes each measured rate beside its baseline, both with sample size and bound, and never as one combined figure; safety is compared before throughput.
- **Why:** evidence that autonomous work is real is stronger measured against the team's own record than alone. Git history is provider-neutral and already R8's source. A single "faster by" number would hide that Olympus is not given a random share of the work.
- **Not in the core:** pull request open and review times, which need a provider's API; a provider adapter supplies them.
- **Reverse:** drop the baseline; R2's own rates stand alone.
- **Confirmed** by the maintainer, 2026-09-29.

### D-A-BR-05: the hosted product sells the interface, never the numbers

- **Ambiguous:** R12 leaves a hosted dashboard to the control plane, and the README says no capability here is gated by it, without saying which side metrics and their display fall on.
- **Chosen:** everything that collects, derives, stores, or verifies a number stays in this repository under MIT: the Vault's records, R2's rates, their API and CLI text output, and R12's export. The control plane sells the interface over them: the hosted dashboard and other UI, aggregation across repositories and teams, users and single sign-on, retention past one local Vault, alerting, and approval from a browser. A user's local files and metrics are always theirs to read without it.
- **Must hold:** the control plane displays R2's numbers and never computes its own. Any rate it shows can be recomputed from the records in this repository alone.
- **Why:** the claim is auditable evidence. A number that could only be checked inside the paid product would make the claim depend on it.
- **Also chosen:** R12 may still ship a reference dashboard definition for a backend the operator already runs. No local dashboard or report page ships here; the CLI's text output serves a single user.
- **Reverse:** none intended.
- **Confirmed** by the maintainer, 2026-09-29.
