# Decisions: agent run delivery (amendment)

## Amendment: the line checked against an account of agent-run delivery

Cloudflare published two posts, "The Agent Development Lifecycle" and "The
Agent Access Model", reported by InfoQ on 2026-09-21. The first argues that
implementation is now the cheap step and that everything after it must be run
by agents on a platform built for them, to a reliability bar of nines rather
than parity with a human. The second describes how such agents are authorized:
task-scoped credentials the model never holds, enforcement outside the prompt,
a ratchet that only narrows, and a record written by the enforcers.

Every control the two describe was first checked on 2026-09-21 against the
code on `unit/p8`. That amendment was never merged. It was carried to `v2` on
2026-09-29, with every row below checked again against the code as P6, P7, P9,
and P11 to P13 left it, and its units renumbered after the ones `v2` added in the
meantime: its P13 is P14 here, and its R4 to R10 are R7 to R13. The confirmations
dated 2026-09-21 are the maintainer's from then, and they still hold. No
package changed except the registry.

| Their control | Here, in code today | Owner |
|---|---|---|
| Scope fixed at dispatch, never widened | Built. A write-once admission record; a resume reads level, policy, and hashes from it (`packages/api/src/run.ts`) | — |
| Enforcement outside the prompt | Built. Mount layer (P2), egress allowlist (P10), credential relay (P12), tool grants (P3, P5) | — |
| Status from the enforcers, not self-report | Built. `TaskResult` has no status; the claim/evidence diff records a `claim-mismatch` (P6, `packages/api/src/verification.ts`) | — |
| Never judged by what it can write | Built. Locks re-verified at every transition (P4); checks in a fresh read-only tree (P6); assertion comparison (P8); tamper analysis that escalates `integrate` (P7, `packages/api/src/tamper.ts`) | — |
| Reviewer independent of author | Review seat only, by family only (`seatReviewer`, `packages/core/src/station/machine.ts`) | R9 |
| Reviewer cannot write what it judges | Built (P6) | — |
| Reviewer cannot read the plan | Built. The seat gets only the files its grants cover (`reviewView`, `packages/api/src/line.ts`; D-P6-08) | — |
| The model never holds the key | Built. The credential lives in the relay container (P12) | — |
| Capabilities end with the task | Built (P6, `I4.task-capabilities-do-not-outlive-the-task`) | — |
| Denials recorded by the enforcer | In part. The relay's budget refusals reach the Vault in P13's usage records. The proxy's per-connection verdicts still go to its stdout (`packages/sandbox/src/local/proxy.ts`); admission and station refusals and park causes are not persisted | P14 |
| Approver is an authenticated principal | Built behind HTTP: the service records its authenticated principal and ignores the body (P9, `packages/api/src/http/server.ts`). The library call `approveStation` still takes any non-blank string | — |
| Merge credential out of an agent's reach | No merge code exists | I1 |
| Capability narrows on protected input | Absent | R10 |
| Grants reviewed from evidence | Absent | R11 |
| Success rates, rollbacks, cycle time | Usage and cost per driver call are recorded (P13); nothing aggregates; `observe` is never entered | R2, R8 |
| A measured reliability figure | Absent | R7, R2 |
| Deploy, flags, gradual rollout | Not Olympus's | D-A-LC-03 |
| Traces of model calls, tool calls, and tokens (OpenTelemetry) | Usage and cost per call in the Vault; no export of any kind | R12 |
| Durable workflows: steps, retries, state held for weeks | Built for the line: bounded attempts, run state under compare-and-swap, a resume proven identical to an uninterrupted run (P1, P4). Tasks run one at a time (R4); no scheduled run exists | D-A-LC-08 |
| A nightly job that sends findings to a reviewer | Absent; `scheduled` exists only as a trigger kind in the contract | R13 |
| One agent serving principals with different permissions | Absent, and unsolved by the posts' authors too | M5 |

The questions both posts leave open — who writes the tests, whether the author
can edit what judges it, whether the reviewer is independent — are the ones
this line was built around. The gaps are where the Access Model is ahead.

### D-A-LC-01: the model credential leaves the container in M1, as its own unit

- **Ambiguous:** `I4.model-credential-not-readable-by-the-task` was owned by P6, and D-P5-20 says the fix spans the sandbox, the proxy, and the driver.
- **Chosen:** a new unit blocking I1.
- **Paid.** `v2` reached the same answer on its own path: P12, "Credential at the egress layer", shipped (#15) and paid the entry. Recorded so the reasoning is kept; nothing here changes.

### D-A-LC-02: refusals are recorded from M1, because a rate cannot be backfilled

- **Ambiguous:** R2 is M2 and was written as derivation from data that already exists. It does not: the proxy's verdicts, admission and station refusals, and park causes are never persisted, and admission refusals write nothing by design. P13's usage records carry the relay's budget refusals and nothing else.
- **Chosen:** P14, blocking I1, records every enforcement decision beside run state, never inside it.
- **Why:** a refusal no auditor can see is a control nobody can verify, and every run before P14 is a run whose refusals are lost for good.
- **Reverse:** move P14 to M2 and accept that M1's runs carry no refusal history.
- **Confirmed** by the maintainer, 2026-09-21, with the gap made a ledger entry rather than prose, as PR #10 did for the writable-workspace limit: `I2.enforcement-decisions-recorded-by-the-enforcer`, pending, owned by P14. `UnitId` gains `P14`, and the I2 ceiling in `pending-baseline.json` rises from 0 to 1 to hold it, a deliberate edit in the diff.

### D-A-LC-03: Olympus gains no deploy station

- **Ambiguous:** the posts' lifecycle runs through deploy, maintain, and retire; this line ends at `integrate` and `observe`.
- **Chosen:** no new station. The target's own pipeline ships; `observe` (R8) attributes what happened after merge to the run that caused it. Maintenance arrives through triggers that already exist in the contract (`ci-failure`, `post-merge`, `scheduled`). Retiring something is a spec like any other.
- **Why:** deployment is provider-specific and Olympus is provider-neutral; the stations are frozen vocabulary; and owning production is the step toward the lights-off claim the spine forbids.
- **Reverse:** revise the spine's vocabulary deliberately and add a station. Nothing here is built on its absence.

### D-A-LC-04: reliability is a measured bound on escaped false-done, and L3 waits for it

- **Ambiguous:** "nines" can mean the share of tasks the line finishes, or the share of finished work that is right.
- **Chosen:** the second. The target is set in policy, three nines at the least, and is met by refusing, not by trusting the model more. A refusal is a safe outcome that costs throughput. Every rate carries its sample size and confidence bound, and L3 is refused on any stack whose measured bound has not met the target. Stated in F1.
- **Why:** a self-driving car that pulls over has not crashed. A line that is right 99.9% of the time when it says done, and hands the rest to a human, is useful now; a line that finishes everything and is right 80% of the time is not usable at any level of autonomy.
- **Reverse:** none intended. Lowering the target is a policy edit, visible in the Vault.
- **Confirmed** by the maintainer, 2026-09-21: three nines is the floor.

### D-A-LC-05: self-improvement proposes, a human applies, and nothing it touches judges it

- **Chosen:** R11 writes proposals only. A human applies each as a versioned Vault edit that governs runs admitted afterwards. The loop cannot propose changes to acceptance tests, `verify.yaml`, rubrics, R7's corpus, or R2's metric definitions, and a proposal is accepted on held-out evidence.
- **Why:** a loop that edits its own grader is an agent judged by an artifact it can write, one level up. A loop that rewards its own metric learns to shrink the metric.
- **Reverse:** after R7 has measured the loop's proposals over enough runs to bound the rate of harmful ones, a class of proposal may be applied without a human, by a policy edit.

### D-A-LC-06: the factory's supervisor is the runtime, never a model

- **Chosen:** read the line as a factory. Stations are stations; a worker is a role bound to a driver and a model; quality control is `verify` and `review`; the line stops on a refusal, and nothing warns and continues; mistake-proofing is a type that will not compile; yield and escapes are R2's; a recall is R8's rollback. The supervisor that decides whether work advances is the runtime and the human at an approval, and never a model, whatever it is called.
- **Why:** a supervising model is a model reporting status (I2). A model may work at any station, review included; it never decides what advances.
- **Not taken, by the maintainer's decision (2026-09-21):** freezing "worker" and "supervisor" as vocabulary. They are used to reason about the line and to explain it in documents, and they name nothing in code, config, or policy. Freezing them later is a deliberate revision to F1's frozen list.

### D-A-LC-07: separation of duties at M1 is what one family can enforce

- **Chosen:** at M1, a review seat cannot write and cannot read the plan (both built by P6), receives no author narrative (built), and is refused at L3 when it shares a family with an author (built); an approval behind the service is its authenticated principal, never the agent (built by P9); the merge credential never enters a sandbox (I1). Every other pair, test design against build first, is R9's, which needs the second driver.
- **Why:** with one family, independence can be recorded as reduced but never delivered. M1 claims only what it can enforce.
- **Reverse:** none; R9 extends it.

### D-A-LC-08: the line is the workflow; Olympus does not adopt a general one

- **Ambiguous:** the posts' orchestration layer runs any graph of steps, and says a pipeline is only one thing it can be.
- **Chosen:** keep the fixed line. What a general engine offers that matters here is already built for the line: durable state (run state under compare-and-swap), bounded retries (iterations, retries, and starts), and a resume proven to reach the state an uninterrupted run reaches. The two pieces it lacks are taken separately: scheduled runs, through the `scheduled` trigger the contract already names (M2), and parallel tasks within a run, which is R4.
- **Why:** an arbitrary step graph is a way around the stations, and the stations are where policy decides what advances. Binding the runtime to one vendor's engine would also end its provider neutrality.
- **Reverse:** put the station machine behind an interface a durable-execution engine could implement, without making the graph of stations configurable.

### D-A-LC-09: telemetry is exported from the record and never read back

- **Chosen:** R12 emits OpenTelemetry traces and metrics from the host: one trace per run, spans per station, task, attempt, and check, with token use, cost, and outcomes taken from Vault records, P13's usage records, and P14's record, named to the OpenTelemetry conventions for generative AI so any backend can chart them. Olympus ships no dashboard of its own before the control plane; a reference dashboard definition may ship with R12.
- **Why:** an operator needs to see the line running, and a dashboard is where they look. It must not become a second source of truth: a gate that read telemetry would be judged by a stream anyone on the collector's path can alter. The Claude Code CLI can export its own telemetry, but only from inside the sandbox, within the agent's reach and through an egress grant the allowlist does not carry, so it is not used.
- **Also chosen:** no prompt, completion, or payload text is exported by default. Such text may carry secrets or a person's data, and payloads are untrusted (I7).
- **Reverse:** none intended; exporting more attributes is a policy edit.

### D-A-LC-10: the nightly review is a deterministic audit and a reviewer that only proposes

- **Chosen:** R13 runs on the `scheduled` trigger in two halves. The first half involves no model: it re-hashes every evidence bundle, lock, and record in the Vault, recomputes R2's published rates from raw records, and records a violation for any mismatch. The second seats a reviewer over the day's findings — refusals, parks, violations, failed checks, and post-merge outcomes — as typed fields. The reviewer's family differs from every author family whose work it reviews, and its output is recorded as a claim that becomes R11 proposals or candidates for `intake`, which a human admits.
- **Why:** the audit is the cheapest check that the record is still what it was, which is the whole claim. The review is where patterns across runs are found, and a reviewer's text is model output: it can suggest, and it never changes a run, a grant, or a status.
- **Reverse:** drop the model half; the audit stands on its own.
