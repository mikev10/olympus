# R4 — Parallel task execution

**Unit:** R4 (M2, maintainer)
**Depends on:** P4 Station machine, P6 Verification + evidence, I1a and I1b Integration
**Blocks:** R5 decomposes goals into graphs this unit runs in parallel.

P4 runs tasks one at a time in graph order and records that as a known limit
(D-P6-11). This unit removes it for `build`: tasks whose dependencies have all
passed are built at the same time, each in its own sandbox. `verify` stays one
task at a time, because the accepted tree is a chain and each link is checked
over the one before it. A sibling's change that a later task would silently
overwrite is a conflict, retried and then parked, never resolved by picking a
side.

Written when the amendment that settled its open questions landed
(D-A-PT-01 to D-A-PT-05). The DECOMPOSITION entry said the contract already
carried what the unit needs. It does not, and the amendments it does need are
listed below and land in this unit's pull request.

---

## What the code holds, verified against it

| Input | Where it is | What it means here |
|---|---|---|
| `concurrency.maxParallelTasks`, `maxConflictRetries` | `core/src/policy/types.ts:75`, validated at `core/src/policy/validation.ts:505-508` | validated, and read by nothing else: the line never consults either |
| `DriverCapabilities.parallelism` | `core/src/driver/contract.ts:44` | a count with no stated meaning; `0` is refused at `build` (`core/src/station/machine.ts:59`) |
| Claude Code's `parallelism: 1` | `drivers/claude-code/src/driver.ts:306,376` | one in-flight call per sandbox, enforced by a lock keyed on the handle; nothing bounds calls across sandboxes |
| The stub driver's `parallelism: 1` | `core/src/driver/stub/driver.ts:55` | the conformance suite cannot show concurrency without a stub that declares more |
| One task per step | `core/src/station/machine.ts:246-254,352-355` | `nextStep` returns the first buildable task; the line awaits it before asking again |
| A task's start tree | `api/src/line.ts`, `build` | base and `accepted()`, materialized fresh per attempt: a sibling's unaccepted work is never in it |
| The accepted tree | `api/src/line.ts`, `accepted()` | the cumulative diff of the latest-passed task. Correct only while each verify composes over the one before |
| What `verify` composes | `api/src/line.ts`, `verify` | `composeDiff(base, accepted-now, own)`, where `own` is the task's change from its start tree. A path a sibling accepted after this task started, and this task also wrote, is overwritten without a trace |
| Commits inside one drive | `api/src/line.ts:1366-1386` | each `StateChange` carries whole maps built from `ctx.state` before an await, committed against `state.version`. Two tasks committing from one drive would lose to each other or overwrite each other's keys |
| Commits across processes | `commitRunState`, asserted by `I5` in `conformance/src/registry/i5.ts:148` | one winner, every loser refused. A second drive of the same run is refused as it is today |
| Park causes | `core/src/station/types.ts:98`, derived from counts by `parkRefusal` (`machine.ts:278`) | three causes; P14's scenario table needs one scenario per cause (`conformance/src/registry/decisions.ts:48`) |

---

## Deliverables

- **The step names a batch.** `nextStep` takes the run's effective parallelism and returns `{ kind: 'build', tasks }`: every task whose dependencies have passed and that has not passed, up to that number, in graph order. `verify` and `review` steps still name one task. Effective parallelism is `min(policy.concurrency.maxParallelTasks, driver.capabilities().parallelism)`, read by the line at each step, never larger than either.
- **Builds run concurrently.** The line starts every task in the batch, each with its own start tree, sandbox, relay, budget and usage record, exactly as one task is run today, and waits for all of them. A build that throws does not abandon the others: every one is awaited and recorded before the error ends the drive.
- **Commits inside a drive are serialized.** One queue per drive. Each change is applied to the latest committed state and names only what it changes, per task, so no task's commit carries a sibling's stale view.
- **Verify detects conflicts.** Before composing, `verify` compares each path in the task's own change between its start tree and the accepted tree now. A path that differs is a sibling's accepted change this task would overwrite. The task is not verified: one conflict is recorded in run state and in P14's record, naming the sibling whose accepted change touched the path and the paths, and the task returns to `build`, where it starts again over the accepted tree. A conflict is not a failed gate: it spends no iteration, raises no tier, and is bounded by `maxConflictRetries` alone. One past the bound parks the task with cause `conflicts-exhausted`, naming the sibling and the paths. A conflict is a whole path changed by both; nothing is merged inside a file.
- **A park stops new work, not work in flight.** A parked task, a refusal, a cancel, or a halt stops the line from starting anything new. Siblings already building finish; each one's result and usage are recorded and its status committed before the run stops. A dependent of a task that has not passed never starts.
- **`parallelism` has one meaning.** The most `runTask` calls the driver runs at the same time, each on its own sandbox. One call per sandbox stays enforced. Claude Code declares `4` and enforces it with a bound across sandboxes, the same way it enforces one per sandbox; the driver claim and its assertion change with it.
- **The report shows conflicts.** Each task's attempts in the per-run report carry its conflicts, read from run state.

## Contract amendments, landed in this unit's pull request

- **A-R4-01:** `TaskAttempts` gains `conflicts: readonly TaskConflict[]`, one entry per conflict, in the order they happened: `{ with: TaskId; paths: [string, ...string[]] }`. Required, as every attempt count is. `failedGates` becomes `iterations - 1 - conflicts.length`, never below zero, and `maxStarts` allows one more iteration's starts for each conflict.
- **A-R4-02:** `ParkCause` gains `conflicts-exhausted`, and `StationRefusal`'s `parked` arm for it carries `conflictsWith: TaskId` and `paths`. `parkRefusal` reads them from the last conflict, and its limit from the policy, which `nextStep` is given.
- **A-R4-03:** `DecisionCause` gains `{ cause: 'task-conflict'; decidedBy: 'line'; task: TaskId; with: TaskId; paths }`, written before the conflict is committed, as a park is. `LocalVault` accepts it from the line alone.
- **A-R4-04:** `DriverCapabilities.parallelism`'s comment states the meaning above. No shape change.

## Out of scope

- Running several runs at once, and distributed execution (M4b).
- Merging inside a file, and any automatic resolution of a conflict.
- Verifying tasks in parallel. The accepted tree is a chain; verify stays serial.
- Review seats in parallel. M1 seats one reviewer; panels are R9 and M3.
- Goal decomposition (R5).
- A parallelism value in policy per role or per station.
- Raising the egress, budget, or wall-clock grants because tasks overlap. Each task keeps its own.

## Conformance

Each is a registry assertion that fails when the capability it covers is deleted (I8).

- `I4.parallelism-capped-by-policy-and-driver`: with `maxParallelTasks: 2` and a stub declaring `3`, two independent tasks' driver calls overlap and a third never runs alongside them; with the stub declaring `1`, none overlap.
- `I3.sibling-never-sees-unaccepted-work`: two siblings built at once each start from base and accepted changes only; neither's start tree holds the other's change.
- `I5.conflict-retries-then-parks`: two siblings writing one path: the second to verify is recorded as a conflict naming the first, rebuilt over the accepted tree, and, past `maxConflictRetries`, parked with `conflicts-exhausted` naming both. Removing the conflict check makes it fail.
- `I5.no-accepted-change-is-lost`: siblings writing different paths are each in the tree `integrate` opens.
- `I5.park-finishes-siblings`: a task that parks while siblings build: each sibling's result and usage are recorded, no dependent starts, and the run refuses with the park.
- `I5.parallel-resume-matches`: a run stopped mid-batch and resumed reaches the state an uninterrupted run reaches, each task in flight replayed as today.
- `I2.status-per-task-under-concurrency`: each task's status follows its own evidence; a sibling's commit never changes it.
- P14's scenario table gains `station:parked:conflicts-exhausted` and `task-conflict`.
- `driver.parallelism` (Claude Code driver suite): four tasks on four sandboxes overlap, a fifth waits, and a second task on one sandbox still waits for the first. Paid: the maintainer applies `run-driver` (D-A-CI-05).

## Acceptance

- every conformance entry above is present and passes
- `git grep -n "maxConflictRetries" -- packages/api/src` prints the line's use of it
- every package change has a changeset
- `pnpm typecheck`, `pnpm lint`, `pnpm test` pass, and `pnpm conformance` passes in CI after the maintainer applies `run-driver`
- `git ls-files -- .plan/` prints nothing

**Gate paths:** `packages/core/src/station/types.ts`, `packages/core/src/driver/contract.ts`, `packages/vault/src/types.ts`, and `packages/conformance/` are protected, so the pull request carries the `gate-change` label and the squash body carries `Gate-Change: acknowledged`.

**Invariants:** I5 is the subject: a sibling's change is never silently overwritten, and a conflict past its bound parks rather than picking a side. I3: a task starts from base and accepted changes only. I2: each task's status is derived from its own evidence, and no task reports on another. I4: concurrency is what policy and the driver's declaration allow, never more. I8: `parallelism` is a declared number something enforces and an assertion checks.
