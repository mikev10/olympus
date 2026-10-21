BASE: be3540f
HEAD: 3ce72ad
packages/vault/test/local.test.ts
e02f6a6f1b410c81cba7d19e568ec1d4

No prior context, no lookups performed.

I assess the mechanisms as fundamentally sound. The adversarial framing is exactly the right question to ask of this code, and the implementation anticipates and neutralizes every vector raised.

### 6. Which mechanisms you assess as sound, and why

1. **State Commit Queue (`COMMITS` in `line.ts`)**: 
   The `commit` function chains state updates onto a `WeakMap`-backed promise queue per `LineContext`. This guarantees that concurrent `build` tasks modifying their own attempts or results in `apply` will sequentially read the most recently updated `ctx.state` and `state.version`. Because each task only ever merges keys isolated to its own `taskId` (e.g., `tasks: { [task.id]: 'running' }`), siblings committing at the exact same time safely merge their updates without overwriting each other's status or attempt counts.

2. **Serial Acceptance and Cumulative Diffs (`verify` and `acceptedChain`)**: 
   The `verify` phase is strictly serial. Because no two tasks are verified simultaneously, the cumulative diffs form an unbroken chain where each `EvidenceBundle` builds cleanly upon the last. A task's `start` tree and `work` tree are materialized from this chain before the task starts, isolating its sandbox completely. A task never sees another's unaccepted work, preventing cross-contamination.

3. **Conflict Detection (`conflictOf` in `line.ts`)**:
   Instead of brittle diff parsing, `conflictOf` compares the cryptographic hash of a changed path in the task's read-only `start` tree against the current `prior.tree` (the accepted chain). If the hashes differ, it means a sibling accepted a change to that path after the task started. The task is then sent back to `build` (rebuilt over the new accepted tree) or parked if it exceeds `maxConflictRetries`. Because this detection happens *before* `composeDiff`, a sibling's accepted change is never silently dropped or overwritten. If a task modifies a file that the sibling *did not* touch, the hashes match, and `composeDiff` cleanly applies the task's changes without dropping the sibling's work.

4. **Concurrency Limits (`stepLimits` and `Promise.allSettled`)**:
   The runtime enforces the concurrency cap by aggressively slicing the build batch (`.slice(0, limits.maxParallelTasks)`), using the strictest bound between `policy.concurrency.maxParallelTasks` and `driver.capabilities().parallelism`. Even if a compromised driver internally runs unbounded, the runtime limits the batch size fed to `Promise.allSettled`. If a driver declares `0` parallelism, `stepLimits` forces a batch size of `1` specifically so the `build` station's capability check can explicitly refuse it, rather than hanging the run by silently scheduling `0` tasks.

5. **Driver Internal Concurrency Bound (`ClaudeCodeDriver.#bounded`)**: 
   The Claude Code driver enforces its `PARALLELISM = 4` declaration using an elegant async lock queue (`#waiting`). If a task requests execution while slots are full, it suspends until a slot opens. The slot is passed directly to the next caller, meaning the concurrency count never dips to allow queue-jumping, and the driver never spawns more isolated containers than its policy allows.

6. **Gate Iteration Math (`failedGates` and `gatedIterations`)**:
   Because conflicts force a rebuild, they spend a `start`, but they are not failed checks. The tier logic subtracts `conflicts.length` from `iterations` when calculating `failedGates` and `gatedIterations`. This accurately prevents conflicts from exhausting gate limits or unfairly escalating the model tier, ensuring the task's status and budget reflect its own merits.

7. **Process Stops and Replays (`startAttempt`)**:
   If the process is killed mid-batch, the next run reads the Vault. Tasks left `running` are resumed as a replay. `startAttempt` recognizes the replay, incrementing `starts` (tracking the paid invocation cost) without incrementing `iterations`. This precisely bills the cost of the interruption without punishing the task's iteration limit.

### 7. Whether the framing above is right

The framing is exactly right. The adversarial questions target the precise seams where concurrent task schedulers traditionally fail (race conditions in status maps, silent overwrites in composed diffs, limit bypasses, and unbilled replays). The code successfully closes every one of these seams by using deterministic cryptographic hash comparisons, strict promise sequencing, and enforcing limits natively in the orchestration loop rather than implicitly trusting the driver.