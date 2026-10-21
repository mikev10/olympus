---
"@olympus-ai/core": minor
"@olympus-ai/vault": minor
"@olympus-ai/api": minor
"@olympus-ai/driver-claude-code": minor
"@olympus-ai/conformance": minor
---

R4: parallel task execution. `build` runs every task whose dependencies have
passed at the same time, up to `min(policy.concurrency.maxParallelTasks,
driver.capabilities().parallelism)`, each in its own sandbox with its own start
tree, relay, budget and usage record. `verify` stays one task at a time.

- `nextStep` takes `StepLimits` (`maxParallelTasks`, `maxConflictRetries`) and
  its build step names a non-empty batch, `{ kind: 'build', tasks }`. `maxStarts`
  takes the task's conflict count, and `parkRefusal` takes the limits.
- A-R4-01: `TaskAttempts` gains `conflicts: readonly TaskConflict[]`, each
  `{ with: [TaskId, ...]; paths: [string, ...] }` (D-R4-04). `failedGates` is
  `iterations - 1 - conflicts.length`, and the new `gatedIterations` is what
  `maxIterations` bounds, so a conflict spends no gate budget and raises no tier.
- A-R4-02: `ParkCause` gains `conflicts-exhausted`, whose `parked` arm carries
  `conflictsWith` and `paths`.
- A-R4-03: `DecisionCause` gains `task-conflict`, accepted by `LocalVault` from
  the line alone.
- A-R4-04: `DriverCapabilities.parallelism` means the most `runTask` calls at
  once, each on its own sandbox. The Claude Code driver declares `4`
  (`PARALLELISM`) and enforces it across sandboxes, beside its one call per
  sandbox.
- The line's commits within a drive are queued, and `tasks`, `attempts` and
  `results` in a commit name only the tasks it is about. `verify` records a path
  a sibling's accepted change touched after the task started as a conflict and
  rebuilds the task over the accepted tree, parking it past
  `maxConflictRetries`. A park, refusal or error stops new work and lets every
  build in flight finish and be recorded.
- `worstCaseCost` counts the rebuilds `maxConflictRetries` allows for a build
  task (D-R4-01), and R2's `iterationsToGreen` counts gated iterations (D-R4-03).

The conformance registry adds `I2.status-per-task-under-concurrency`,
`I3.sibling-never-sees-unaccepted-work`,
`I4.parallelism-capped-by-policy-and-driver`, `I5.conflict-retries-then-parks`,
`I5.no-accepted-change-is-lost`, `I5.park-finishes-siblings`,
`I5.parallel-resume-matches`, and P14 scenarios for
`station:parked:conflicts-exhausted` and `task-conflict`; the `driver.parallelism`
claim now asserts four tasks at once.
