# Decisions: I1a

## I1a: The real line

### D-I1a-01: the line's sandboxes take their image and limits from a host-supplied profile

- **Found reading the code:** every sandbox the line provisions is specified with `image: 'none'` and zero limits (`packages/api/src/line.ts`, `workspaceOnly`). The stub sandbox ignores both; `LocalDockerProvider` refuses zero limits and would run `none` as an image. The entry did not say where real ones come from.
- **Options:** (A) the graph builder takes a sandbox profile from the host: a build image, a check image, and fixed CPU, memory, and PID limits, with each sandbox's wall clock from its scope's budget or its check's timeout; (B) limits per role in policy.
- **Chosen: A**, with the maintainer. B is a policy-schema amendment and decides nothing the M1 proof needs.
- **Reverse:** B, moving the profile's limits into `CapabilityScope`.

### D-I1a-02: `station:same-family-reviewer` is marked blocked until M3

- **Found reading the code:** the cause fires only at L3 (`seatReviewer`), and every L3 run is refused at admission because the adapter set never provides `mutation` (M3) and admission builds it with no coverage provider. Deleting the skeleton does not make it reachable, and lifting L3 is out of scope.
- **Options:** (A) a **blocked until M3** mark whose check asserts an L3 run is refused at admission naming `mutation`, so it fails the moment L3 becomes reachable; (B) leave the row as a known limit owned by the unit that lifts L3.
- **Chosen: A**, with the maintainer. Like D-P14-12's marks, it fails when it stops being true.
- **Reverse:** B.

### D-I1a-03: the model on a usage record is the runtime's resolution of the scope's tier

- **Ambiguous:** the driver resolves a tier to an alias (`sonnet`), and the concrete model id exists only in the request the relay prices.
- **Chosen:** `UsageRecord.model` is the `ModelIdentity` the runtime obtains from `driver.resolveModel(scope.tier)` before the call, never the driver's `TaskResult.model`. The record names the alias and CLI version, not the dated model id.
- **Why:** recording what the relay saw needs a fourth contract change (`MeterReading`), which the entry does not list.
- **Reverse:** add the observed model names to `MeterReading` and record those.

### D-I1a-04: composed-host scenarios run real infrastructure and a scripted driver at L1; one scenario is paid

- **Chosen, with the maintainer:** the tamper, Vault-mount, lower-bound, and lost-reading scenarios build the graph through the sole builder with `LocalVault` and `LocalDockerProvider` and a scripted driver, at L1, where the scripted driver's lack of provenance does not refuse them. Only the scenarios that need a real model call use `ClaudeCodeDriver`, and they are paid (D-I1a-07).
- **Reverse:** run every composed-host scenario with `ClaudeCodeDriver`, at the cost of a model call each.

### D-I1a-05: the host is `olympus-host`, configured from its environment, and the driver's relay request is a contract method

- **Chosen, with the maintainer:** `packages/api/src/host/main.ts`, exposed as the `factory-host` bin (I10: the name `olympus-host` was confirmed, but a Greek name is not allowed in a config key, so the bin takes the `FACTORY_` prefix `FACTORY_API_TOKEN` already uses), reads its token, policy file, Vault root, repository, workspace-store root, and the model key from the environment. The key reaches only `LocalDockerProvider`'s `credentials` and is never provisioned into a sandbox. `Driver.relayRequest()` returns `Omit<RelaySpec, 'budget'> | null`; `StubDriver` returns `null`, and the line refuses to run a driver task above L1 for a driver with no relay, so no call above L1 is unmetered.
- **Reverse:** export the relay as a constant again (D-P12-05's option A) and have the host pass it in.

### D-I1a-06: provenance is positive; a component the builder cannot attest is unsafe above L1

- **Found while planning the assertion:** D-A-I1-05's builder reads each component's `unsafe` declaration as it builds. A wrapper made before the build that does not forward the declaration is read as carrying none, and passes. The conformance rig's own scripted driver is such a wrapper.
- **Options:** (A) as D-A-I1-05 says, with the pre-build wrapper recorded as a known limit; (B) the builder counts a component safe only when it is an instance of a real component class (`LocalVault`, `LocalDockerProvider`, `ClaudeCodeDriver`), and names every other component unattested, refused above L1 like a declared stub.
- **Chosen: B**, with the maintainer. A wrapper that forgets to forward fails closed instead of open (I5). A `Proxy` around a real component still passes, since it forwards. The brand and the runtime check on it still refuse a graph changed after the build. The cost: every scenario above L1 runs real components, so the L2 escalation at `integrate` needs a real build call.
- **Reverse:** A — read only `unsafe`, and record the pre-build wrapper as a known limit.

### D-I1a-07: the paid line assertions run in their own cached CI step

- **Ambiguous:** CI reruns paid assertions only for the driver package's tree, and the driver package cannot import `api` without a dependency cycle once `api` depends on the driver.
- **Chosen, with the maintainer:** paid line assertions live in `packages/api/test/paid/` as external entries, and CI runs them in a second step keyed by `driver-report-key.ts packages/api`, under the same `run-driver` label, cache, and pull-request artifact rules as the driver's. One L2 run on the fast tier carries both paid assertions. Its config is `vitest.config.paid.ts`, a name the protected-path pattern `vitest.(config|workspace).` already covers, since the file decides which reporter counts the assertions.
- **Reverse:** run the paid scenarios inside the conformance step, paying on every labelled run.

### D-I1a-08: a lost reading is recorded, usage is listed by run, and a resume over a lost reading is a recorded refusal

- **Found while planning D-P13-20:** `UsageRecord.reading` has no lost state, the Vault cannot list a run's usage records, and `ResumeRefusal` has no arm for a lost reading. `starts` cannot stand in: it is committed before every call by design, so a replay after a crash looks the same as a lost reading (A-P4-06).
- **Options:** (A) three amendments: a `lost` reading, `Vault.readUsage(runId)`, and a `meter-lost` resume refusal recorded through P14; (B) record `lost` and throw on resume, leaving the orphaned record and the unrecorded refusal as known limits owned by I1b.
- **Chosen: A**, with the maintainer. B leaves D-P13-20 half open and a refusal P14's record does not see. At M1 the human resolves a lost reading by cancelling the run; acknowledging the loss and continuing is a known limit.
- **Reverse:** B.

### D-I1a-09: the CLI's home is under `/tmp`, so it runs as whatever uid the line gives the sandbox

- **Found wiring the driver into the line,** as D-P6-10 said I1 would: the line runs a sandbox as the runtime's uid (D-P6-10), and the Claude Code image's home belongs to its `node` user, uid 1000. Run as uid 1001, a GitHub runner's, `touch $HOME/x` is refused in the pinned image, while `/tmp` is writable and the CLI runs with `HOME` there.
- **Chosen:** the driver sets `HOME=/tmp/claude-home` in every exec's environment and creates it before the CLI starts. Inside the plan: no interface changes, and the workspace stays the one writable mount the diff is taken from.
- **Not closed:** D-A-CI-03's broader limit, a sandbox whose user differs from the image's, is unchanged for anything else the image assumes about its user.
- **Reverse:** drop `HOME` from the CLI environment, and run the line only on hosts whose runtime is uid 1000.

### D-I1a-10: the untested-suite escalation is carried to the approver, because `integrate` already needs one

- **Found while writing its assertion:** `integrate`'s exit floor is `human-required` at every level (D-P4-03), so D-A-I1-06's premise, that an L2 run would otherwise leave `integrate` on a report that reads clean, does not hold. The finding raised a gate already raised, the `approval-required` refusal did not carry it, and an assertion on "stops at the approval" passed with the escalation deleted (I8).
- **Options:** (A) the `approval-required` refusal names what escalated it, the finding among them; (B) `TamperReport` records whether test analysis ran.
- **Chosen: A**, with the maintainer (A-I1a-07). The approver is told why in the outcome, in P14's decision record, and in the run's standing, and the same holds for every protected path and tamper finding, which no approver was told before either. `I5.unanalysed-tests-escalate-the-integrate-approval` proves it free at L1 with a control repository that declares vitest; the paid entry proves it on the composed host at L2.
- **Reverse:** B, and move both assertions to the evidence bundle.

### D-I1a-11: a spread of a built graph type-checks; the runtime refuses it as unbuilt

- **Found while converting the tests:** an object spread keeps the brand's symbol-keyed property in its type, so `{ ...built, driver }` is assignable to `BuiltGraph`. D-A-I1-05's "a brand makes an unbuilt graph a compile error" holds for a graph assembled from parts, not for one copied from a built graph.
- **Chosen:** the runtime check is the guard. Provenance lives in a `WeakMap` keyed by the frozen object `buildGraph` returned, so a copy carries none and is refused above L1 as `unbuilt graph`; `I5.unsafe-declaration-survives-composition` asserts exactly that case.
- **Reverse:** a class-private brand the spread cannot copy, at the cost of a class for what is now a plain frozen object.

### D-I1a-12: a driver call is recorded `pending` before it is made

- **Found by I1a's external review** (codex-1, gemini-1, both families): a process stop while a driver call was in flight left no usage record of any kind. `startAttempt` commits `running` and `starts + 1` before the call, and nothing else was written until the sandbox was destroyed and read, so a resume found no lost reading, replayed the task, and the run total read `exact` without the killed call. D-I1a-08 closed the destroy failure and the record-then-commit crash; neither covers a stop during the call.
- **Options:** (A) `runTask` writes a `pending` reading through `recordUsage` after provisioning and before `driver.runTask`; a `pending` no terminal reading for the same task and attempt followed is lost, so the resume is refused `meter-lost` and the total is `lower`; (B) infer the loss at resume from a `running` task whose `starts` has no usage record, which is the inference D-I1a-08 declined, and makes `costTotals` take run state.
- **Chosen: A**, with the maintainer (A-I1a-08). The evidence of a call is a record written before it, not a counter read afterwards. Its one over-caution, a stop between the pending write and the call, refuses a resume that was safe: fail closed, and a human cancels. A pending write that fails destroys the sandbox and stops the run before any call. The pending record is stored and not referenced from run state, since `readUsage` lists a run's records whether referenced or not (A-I1a-05): no committed state holds a call that has not begun, so `I2.resume-derives-state-from-the-vault`'s resume at every committed state still holds, and the refusal arises only from a stop inside the call's window. `I2.call-recorded-before-it-is-made` fails when the pending write is deleted.
- **Reverse:** B.

### D-I1a-13: the relay does not bind a sandbox to the tier's model; owned by R14

- **Found by I1a's external review** (codex-2, held in part): `relayRequest()` returns one relay for every tier, and the relay prices each request by the model that request names, so a task with a command tool can call any priced model while its usage record names the tier's alias. The cost is not misstated, since each request is charged at its own model's price against the task's budget; the tier policy names is not enforced at the relay.
- **Chosen:** a known limit, owned by R14 (a tier per station), where model selection and its enforcement are decided. Pinning the relay needs the tier's alias resolved to the concrete model ids the CLI sends, which the driver does not know today, and recording observed models is D-I1a-03's reverse, a `MeterReading` change. Carried as the pending entry `I2.relay-bound-to-tier-model`, with I2's baseline raised 0 → 1 (the D-S1-18 precedent).
- **Reverse:** pin the relay's price table to the tier's models in I1a.

## I1a amendments to the contracts

### A-I1a-01: `UsageRecord.model`

`model: ModelIdentity`, the runtime's `driver.resolveModel(scope.tier)` taken before the call, never `TaskResult.model`. `LocalVault` refuses a record that names no provider, family, and model. Reasoned in D-A-I1-04 and D-I1a-03.

### A-I1a-02: `Driver.relayRequest()`

Returns the relay a sandbox the driver runs in must be provisioned with, less its budget, or `null` for a driver that calls no model through one. The line adds the budget the policy grants the role. The graph builder declares a driver with no relay unmetered, so it carries no run above L1. `DRIVER_CONTRACT_VERSION` is 1.1.0. Reverses D-P12-05, as that entry anticipated.

### A-I1a-03: the cost totals' lower bound

`UsageTotal` gains `lost`, `bound: 'exact' | 'lower'`, and `MeteredTotal.unreadable`. A total holding any unmetered, lost, or unreadable call is `lower`. Closes D-P13-19 by its option A. An api type, not a contract file; listed here because the unit entry named it.

### A-I1a-04: `UsageReading` and the `lost` reading

`UsageRecord.reading` is `MeterReading | { kind: 'lost'; detail: string }`. The line writes a `lost` record when a sandbox that ran a call cannot be destroyed and read, before the run stops (D-P13-20, D-I1a-08).

### A-I1a-05: `Vault.readUsage(runId)`

Every usage record stored for a run, referenced from run state or not, like `readDecisions`. Cost and the resume check read through it, so a record stored before a crash took its commit is still counted (D-P13-20).

### A-I1a-06: `ResumeRefusal` gains `meter-lost`

`{ reason: 'meter-lost'; tasks: TaskId[] }`, recorded through P14's record as a `resume-refused` decision, with its own row in P14's table. `RunOutcome` gains the same arm for a resume. At M1 a human resolves it by cancelling the run.

### A-I1a-07: `approval-required` carries its escalations

`StationRefusal`'s `approval-required` arm gains `escalations: string[]`: each protected path touched and each tamper finding that raised the exit, empty when none did. `runStanding`'s `awaiting-approval` carries the same (D-I1a-10).

### A-I1a-08: the `pending` reading

`UsageReading` gains `{ kind: 'pending' }`, written through `recordUsage` before each driver call; the call's terminal reading follows for the same task and attempt. A `pending` with no terminal reading is lost: the resume is refused `meter-lost`, and the totals count it as a lost call and report `lower`. A followed `pending` is not a call of its own (D-I1a-12).
