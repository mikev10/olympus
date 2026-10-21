# External review of R4, codex, 2026-10-21

An adversarial review of R4, parallel task execution: the build batch and
`stepLimits`, the per-drive commit queue and per-task patch semantics,
conflict detection over the accepted chain and the iteration/start accounting
conflicts change, and the Claude Code driver's cross-sandbox bound beside its
per-sandbox lock. One of two reviews run from the same prompt and bundle; the
other is `2026-10-21-R4-parallel-tasks-review-gemini.md`. Both are triaged in
`2026-10-21-R4-parallel-tasks-triage.md`, which cites this review's numbered
findings as `codex-1` to `codex-3`.

## Source

- **Reviewer:** gpt-6-astra. Family: codex.
  A headless `codex exec` run (CLI 0.155.1) under a read-only sandbox, with
  recorded approval policy `never`, in an empty scratch working directory and a
  scratch config home holding only `auth.json`, with an environment of
  `CODEX_HOME` alone; the pre-run listing of both is the manifest's
  `cleanRoom`. Exit 0, not timed out, 128.5 s. Ingestion `complete`: 91,875
  input tokens against a floor of 61,700. Integrity `verified`. Outcome
  `counted`. Reply SHA-256 as the runner wrote it:
  `f7d48a99bf9dc80bd63973bb8c454f35d42ec94917ef3a2e3a98d475070402d3`, which
  matched the manifest's `replySha256` before this header was prepended; the
  untouched reply is in commit `e53d35a`.
- **Cross-family agreement:** none. codex-1, codex-2 and codex-3 were raised by
  codex alone; gemini reported no findings. gemini's assessment judged the
  driver's `#bounded` queue sound and the replay accounting in `startAttempt`
  precise, which codex-1 (the per-sandbox lock beside `#bounded`) and codex-2
  (the park cause after replays) contest.
- **Date:** 2026-10-21 (run started 2026-10-21T15:48Z).
- **Bundle:** `2026-10-21-R4-parallel-tasks-review-bundle.txt`, SHA-256
  `5cac0a5a6590b0027eb6a2cad9b8e3c5d0782c8016d607fcfb1d1740826863f1`, base
  `be3540f` (`reviewed/R17`), head `3ce72ad` ("R4: Parallel task execution"),
  two commits (the R4 spec amendment, #45, and the unit itself). It held 30 of
  the 33 changed paths, new files in full and modified files as whole-function
  diffs; `docs/decisions.md`, `docs/plan/DECOMPOSITION.md` and
  `docs/plan/R4-parallel.md` were excluded, and so was every unchanged file.
  Prompt: `2026-10-21-R4-parallel-tasks-review-prompt.txt`.
- **Prior context and lookups:** the reviewer stated it had no prior project
  context and performed no external lookups, reviewed the inline bundle, and
  had local file access blocked, so it neither verified the bundle's hash nor
  ran tests. This is a self-report and is not independently verifiable.
- **Coverage, and any gap:** item 1 answered (codex-1, codex-2); item 3
  answered (codex-3, a fail-open test branch); item 2 answered in prose (the
  concurrency tests judged behavioural, not tautological, with the three-caller
  gap named); item 4 answered in prose (no cast or type predicate judged to give
  an escape); item 6 answered (commit isolation, the concurrency ceiling,
  conflict refusal, workspace separation); item 7 answered (framing appropriate,
  with a refinement separating the line's guarantees from the driver's locking
  contract). Item 5, configuration satisfied without doing what it appears to,
  came back empty.
- **Citations:** line numbers refer to positions in the bundle's new-side diff
  hunks, not to the repository; they are hints, and each was located by
  construct during triage.

---

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