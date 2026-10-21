BASE: be3540f
HEAD: 3ce72ad
packages/vault/test/local.test.ts
e02f6a6f1b410c81cba7d19e568ec1d4

No prior project context; no external lookups. I reviewed the inline bundle. Local file access was blocked, so I did not verify the file’s SHA-256 or execute tests.

1. **packages/drivers/claude-code/src/driver.ts:439 — factually wrong — medium — Three callers defeat the per-sandbox lock.**  
   Start A on sandbox S and hold it open. Call B and C on S before A finishes. Both read A’s promise as `previous` and await it. When A settles, both proceed into `#bounded` without checking or reserving S again. With available global slots, B and C overlap inside the same sandbox.

   The global four-call bound survives, but the per-sandbox isolation claim fails. The tests queue only one follower on a sandbox, so they miss this construction. Reserve each caller’s place in the sandbox promise chain **before awaiting** its predecessor; test three simultaneous calls on one handle, including a rejected predecessor.

   **Confidence: high.** This is a driver-contract defect; the shown line allocates separate task workspaces, so I have not established this as an attacker-reachable cross-task exploit through that line.

2. **packages/core/src/station/machine.ts:314 — factually wrong — medium — Start exhaustion can be reported as failed gates that never happened.**  
   `byStarts` requires `gatedIterations(attempts) < maxIterations`. Reach the third build iteration after two failed gates, then repeatedly stop after the call’s usage is recorded but before its result is committed—the restart boundary exercised by `PARALLEL_RESUME_MATCHES`. Replays increase `starts` without increasing `iterations`. When the next start exceeds the bound, `startAttempt` parks the task.

   With `iterations = 3`, no conflicts, and the start allowance exhausted, `byStarts` is false. With no excess retries, the recorded cause becomes `iterations-exhausted`, claiming all three gates failed even though the third iteration never reached a gate.

   Pass the actual exhaustion cause into `park`, or persist enough evidence to distinguish an unfinished final iteration from a failed final gate. Add a restart test on the final allowed iteration.

   **Confidence: high.** The task still stops safely; its enforcement record gives the wrong reason.

3. **packages/api/test/line.test.ts:283 — factually wrong — low — Missing evidence makes the evidence assertion pass.**  
   The “required check that cannot be started” test returns successfully when `state.evidenceRefs` is empty. A regression that parks the task but records no evidence therefore bypasses the assertion about recorded checks. The suite-count test in the same supplied block uses the same pattern.

   Require the reference to exist and throw if absent. These are fail-open test branches, not demonstrated production acceptance bypasses. They are unchanged context in the supplied diff.

The central concurrency mechanisms otherwise look sound within the stated boundary:

- **Commit isolation:** `line.ts:1492` queues commits, and `apply` merges task patches into the latest state. The shown callers patch only their own task entries; appended evidence and usage references are preserved.
- **Concurrency ceiling:** `stepLimits` takes the smaller limit, `nextStep` slices the batch, and the line awaits the entire batch. The driver’s global semaphore transfers occupied slots directly to waiters, including after exceptions.
- **Conflict refusal:** `line.ts:960` compares each changed path against the accepted tree before composition. A detected mismatch produces a recorded conflict or throws if attribution fails; neither route accepts the change. Conflict exhaustion parks before composition.
- **Workspace separation:** build materializes a task-specific start tree from accepted evidence and copies it into that task’s workspace. Verification remains serial.

I found no demonstrated silent overwrite, global concurrency-limit bypass, or sibling commit losing another task’s counts in the shown code. Full assurance about filesystem aliases, diff composition, result identity, and crash-time cost recovery requires the omitted implementations of the filesystem helpers, `readResult`, `runTask`, and usage recovery.

The concurrency tests are behavioral rather than tautological, but the per-sandbox test lacks the three-caller case. The visible casts and type predicates do not establish an attacker-controlled escape into the runtime: workspace TypeScript does not augment the runtime’s already-running types or access its JavaScript private fields. Compile-time tuple and `readonly` declarations alone are not runtime validation.

The framing is appropriate. The useful refinement is to distinguish **snapshot preservation and restart accounting in the line** from **the driver’s independently promised locking contract**. The first finding breaks the latter without establishing a bypass of the former.