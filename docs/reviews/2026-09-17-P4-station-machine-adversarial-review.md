# External review of P4, 2026-09-17

An adversarial review of the P4 station machine — the station contracts, the
pure transition and seating logic in `packages/core/src/station/`, and the line
in `packages/api` that runs a job's stations over the Vault, the sandbox, and
the drivers, including admission, resume, and recorded approvals. The reviewer
worked from the bundle alone. What each finding was checked against, and what
changed because of it, is in
`2026-09-17-P4-station-machine-adversarial-triage.md`.

## Source

- **Reviewer:** ChatGPT, as the maintainer named it. Family: **OpenAI.** The
  exact model version was not recorded at handover; rotation is tracked by
  family, and that is what is written down. Conditions: the reviewer reported
  that project-related context was available to it outside the bundle and that
  it set that context aside and did not use it; that it made no lookups of any
  kind — not the project, the author, the web, or prior conversations; and that
  it inspected only the attached bundle. It reported verifying the bundle's
  SHA-256 locally and matching it against the hash named in the prompt.
- **Family rotation:** ChatGPT reviewed F3 and S1; Gemini reviewed P1 and P2;
  Grok reviewed P3; P3's second reviewer was never named and its family is
  permanently unrecorded. This is **OpenAI's first review since S1**, four units
  back, and the widest gap available. Rotation matters because two runs of one
  family return correlated blind spots and read as corroboration without being
  it. The unrecorded P3 second family remains a hole: it cannot be avoided,
  because nobody knows what to avoid.
- **Date:** 2026-09-17
- **Bundle:** `2026-09-14-P4-station-machine-review-bundle.txt`, SHA-256
  `a8e261164b6b91d812225704615966a81727d6375315fefade27d90886bb0b47`, base
  `cea985c` (`reviewed/P3`), head `296e28d` (P4: Station machine). The bundle
  holds the full contents of every file changed between those commits, with the
  commit range at its head. It excludes `docs/decisions.md`, so the reviewer
  could not see this unit's recorded known limits — two findings below restate
  limits the unit had already written down. Prompt:
  `2026-09-14-P4-station-machine-review-prompt.txt`.
- **Prior context and lookups:** disclosed at the top of the reply, quoted in
  full in the body below. It is a self-report. Nothing here independently
  verifies that prior context was set aside or that no lookup was made; the
  disclosure is recorded as a disclosure, not as a fact.
- **Coverage, and any gap:** **all seven numbered items were answered.** Item 1
  (mechanism succeeds, property fails) produced findings 3–8; item 2
  (tautological checks) produced finding 9 and an explicit statement that it was
  the only one found; item 3 (fails open) was answered in the negative, with the
  required-check executor walked through and assessed fail-closed; item 4
  (language escape hatches) named the `unknown → Partial<TaskResult> →
  TaskResult` cast and said no further bypass was found through it; item 5
  (configuration satisfied without doing what it appears to do) is finding 9;
  item 6 (mechanisms assessed as sound) is its own section; item 7 (whether the
  framing is right) is its own section and rewrites the adversarial question.
  **No item came back empty.** Item 7 is the one most often skipped and the most
  costly to lose, and it is the most valuable part of this reply.
- **Citations:** line numbers refer to positions in the bundle, not to the
  repository, and are not independently located. Every finding was verified
  against the named construct — the function or declaration — rather than the
  cited line.

---

Prior context: **yes, project-related context was available outside this bundle, but I set it aside and did not use it.** Lookups: **none outside the attached file**; I did not search the project, author, web, or prior conversations. I inspected only `2026-09-14-P4-station-machine-review-bundle.txt` and verified its SHA-256 locally. It matches the supplied `a8e261164b6b91d812225704615966a81727d6375315fefade27d90886bb0b47` exactly. The bundle identifies HEAD `296e28d` as P4 Station machine. 

## Findings

1. **`packages/api/src/run.ts:52-100` — unclear — high — the stated threat model gives the caller executable components, which makes the station-machine gates trivially replaceable.** `RunRequest` carries the entire `ComponentGraph`; `ResumeRequest` also accepts a fresh `ComponentGraph`, and `ApprovalRequest` accepts a `Vault` directly.   Under the literal statement that the motivated party controls exported-entry-point arguments, a caller can supply a Vault whose `readRunState` fabricates approvals/status, whose `verifyLocks` always returns `ok`, or a sandbox that ignores the requested read-only mount. That party is then supplying code which executes inside the runtime process, conflicting with the separate statement that it cannot control code running there. **Resolve:** define `components` and the Vault passed to `approveStation` as runtime-owned trusted dependencies outside attacker control, or stop accepting arbitrary implementations at the security boundary and construct them from a trusted registry/factory. **Confidence: high.** If “arguments” was intentionally meant to exclude dependency objects, the prompt should say that explicitly.

2. **`packages/api/src/run.ts:94-100, 443-475` — unclear — high — with the stated control of `approveStation` arguments, an approval nobody granted can be recorded directly.** `approvedBy` is just a non-empty caller-provided string. The function verifies that the run is currently waiting at that exact station/level gate and then persists that string as the approval. There is no authentication or authorization evidence in this function.   Construction: wait until `build:1` or `integrate:1` needs human approval, then call `approveStation({…, approvedBy: "Alice"})`. The gate advances even if Alice did nothing. I recognize that authentication is explicitly assigned to P9; the problem is that the threat model simultaneously says the attacker controls these arguments and asks whether an approval nobody granted is possible. **Resolve:** either make `approveStation` accept an authenticated/authorized principal or signed/capability-bound approval, or narrow this unit's threat model so callers of `approveStation` are explicitly trusted authentication boundaries. **Confidence: high.**

3. **`packages/core/src/station/machine.ts:86-150; packages/api/src/run.ts:454-470` — factually wrong — high — an approval is a standing approval for every future visit to the same station at the same level.** Approval identity is only `${station}:${level}`, and `transition` accepts any existing grant with that key.   `approveStation` also refuses to create another grant when that key is already present. 

   Concrete bypass: make `build:1` human-required. Build version A, approve its `build:1` exit, then let verification fail. `nextStep` sends the run backward from verify to build when a build task remains unpassed.  Build version B. On version B's build exit, the old `build:1` approval is still in `state.approvals`; normal commits preserve it because they spread the existing state and never consume approvals.  Version B therefore crosses a human-required gate without a human ever approving version B. **Resolve:** bind an approval to a specific gate instance/work product, for example station + level + state/version/exit nonce + relevant result/evidence hashes, and consume or invalidate it after use or on every backward transition. Add a failed-verify → rebuild → second-build-gate test. **Confidence: high.**

4. **`packages/api/src/line.ts:253-281; packages/core/src/station/machine.ts:244-320` — factually wrong — high — process interruption gives an unbounded number of physical model invocations inside one recorded iteration.** `startAttempt` deliberately does not increment anything when the task is already `running`.  The machine explicitly treats `running` as buildable and says an in-flight task is run again after restart.  

   Construction: let `startAttempt` commit `running` and increment iteration 1; stop the process after that commit but before the task-result/status commit. Resume. The driver is invoked again, but `startAttempt` sees `running` and spends nothing. Stop in the same window repeatedly. The same trick works around driver failures by stopping before the retry-spend commit. The assertion named `I5.task-attempts-are-bounded` tests uninterrupted failures and resuming an **already parked** run, not interruption inside an active attempt.  The general resume assertion injects its stops only **after commits**, so it cannot discover this gap.  **Resolve:** treat every uncertain replay as another spent attempt before invoking the driver, or persist a unique invocation ID and require/prove driver-side idempotency. Add kill-point tests immediately after the `running` commit and count actual driver calls across resumes. **Confidence: high.**

5. **`packages/api/src/line.ts:327-354, 474-509; packages/core/src/station/contracts.ts:110-119` — factually wrong — high — `grantedContext` keeps forbidden material out of the prompt string, but not out of the reviewer's environment.** The review contract omits `plan` and `author-narrative`.  `grantedContext` correctly filters those strings.  But `runTask`, including review tasks, provisions the entire workspace read-write and passes that sandbox handle to the driver.  The workspace mount is the whole repository.  The test policy grants the reviewer a `read` tool. 

   The admitted task graph—the plan—is itself a file in that workspace. A reviewer can therefore read it directly instead of receiving it in `stablePrefix`. The conformance assertion only searches `stablePrefix + variableSuffix` for the sentinel/plan and never attempts a filesystem read, so it can pass while the forbidden channel remains available.  **Resolve:** run review in a curated, read-only view containing only the grants actually allowed, rather than the author's complete workspace; alternatively mediate all reviewer reads through grant-aware runtime APIs. Add a reviewer that actively tries to open the admitted graph and an author-created sentinel file. **Confidence: medium-high.** The missing piece is the unchanged Driver/Sandbox contract: I would verify that `read` can in fact reach the passed workspace handle. The structure here strongly implies it can.

6. **`packages/api/src/line.ts:365-419; packages/vault/src/local/vault.ts:399-415` — factually wrong — high — lock verification has a time-of-check/time-of-use window, so transient replacement of a locked artifact is invisible.** Build first calls `tamperedPaths`, and only afterward separately reads the spec and acceptance-test files to create model context.  LocalVault verification is a fresh point-in-time hash of each pathname. 

   Construction requiring no sandbox assumptions: leave the admitted spec in place for `tamperedPaths`; immediately replace it after verification returns; let `readText` feed the altered bytes to the model; restore the original before the next verification. Every lock comparison sees the admitted hash, while the model actually consumed different bytes. Verification has the same before/after pattern around executing checks.  **Resolve:** consume immutable content, not a mutable pathname that was verified earlier. Snapshot locked artifacts into runtime-owned/content-addressed storage and provide those exact bytes to model/check sandboxes; or atomically read-and-hash the exact bytes that are then consumed. **Confidence: high for build context; medium for the check-execution variant because an unchanged SandboxProvider could theoretically snapshot the tree during provisioning.**

7. **`packages/api/src/run.ts:306-344; packages/api/src/line.ts:148-183` — factually wrong — medium — “stop at any point and resume” does not hold across Vault-side-effect/RunState-commit boundaries.** On start, the admission object is written first, and only afterward is initial run state committed.  LocalVault makes that admission a fixed-name exclusive write, while `readRunState` requires a state file.  Kill the process between those operations: `resumeRun` has no state to read; retrying `startRun` reaches `recordAdmission` and is rejected because the admission already exists.

   There is a second instance at locking stations: `vault.lock` mutates the lock store, then later the line commits `phase: exiting`.  If stopped between those operations, resume sees `working`, attempts the lock again, and LocalVault deliberately refuses a previously locked path rather than re-locking it. The resume conformance test only kills after a `commitRunState`, not after these other persistent mutations.  **Resolve:** make these operations crash-recoverable/idempotent or journal the operation. An existing identical admission with no state should be recoverable into deterministic initial state; a same-station repeated lock should be safely recognized as the already-completed operation when its original hash/admission binding still matches. Test a process death after every durable Vault mutation, not only state commits. **Confidence: high.**

8. **`packages/api/src/line.ts:294-303, 474-508; packages/core/src/station/machine.ts:162-177` — unclear — medium — reviewer-family independence ultimately trusts a free-form string recovered from `TaskResult`.** `readResult` parses untrusted JSON through `unknown`, casts it to `Partial<TaskResult>`, validates little more than `taskId`, claim shape, and `typeof model.family === "string"`, then casts the whole object back to `TaskResult`.  `seatReviewer` determines independence by exact string equality of those family fields.  The review path checks both the resolved reviewer and the family returned in its result, but the latter is still the result's claimed model identity. 

   If model-controlled output can influence `result.model`, an author from family `claude` can claim `claude-2`, `Claude`, or `other`; the later L3 comparison sees no equality. The tests do not exercise this: `ChosenDriver.runTask` explicitly overwrites every result's model with `resolveModel()`.  **Resolve:** model identity must be driver/runtime-attested and canonicalized, not parsed from model-returned content. Store trusted provider/family/model/version alongside the result independently of the claim. **Confidence: medium.** I would inspect the unchanged `Driver` contract and real drivers to determine whether `TaskResult.model` can actually be model-influenced. Also, the shipped unsafe-component gate currently makes L3 unreachable, so this is latent rather than an immediately reachable shipped bypass.

9. **`packages/api/src/validate.ts:146-177; packages/api/test/harness.ts:38-44` — a tradeoff I would have made differently — medium — a verification configuration can satisfy the gate while testing nothing.** Manifest validation demands at least one required check, but the command only needs to be a non-empty string; there is no binding between that command and the acceptance tests or a trusted suite.  The repository's own fixture demonstrates the construction: its required check is literally `node -e process.exit(0)`.  A workspace-controlled manifest containing such a required command passes verification regardless of the program under test. **Resolve:** when P6 owns this area, derive required checks from a trusted adapter/policy or authenticate/validate the verification manifest against the admitted stack and expected suite inventory. Until then, the current fixture proves execution plumbing, not meaningful verification. **Confidence: high.** This is the clearest tautological check I found, but it overlaps the verification work explicitly deferred to P6, hence the classification rather than calling the executor itself wrong.

10. **`packages/api/src/line.ts:222-242` — factually wrong — low — integrity-violation attribution can combine the reviewer's role with the builder driver's provenance.** `recordTamper` always takes `driverProvenanceId` and `contractVersion` from `ctx.components.driver`, regardless of which station or role is implicated.  During review, that can record a review-task role alongside the build driver's provenance. Worse, a before-review tamper is passed the review task even though that reviewer has not run yet, so `suspectRole` can attribute the mismatch to the reviewer solely because that is the next task. The run still refuses, so this does not open the gate, but the supposedly tamper-evident audit record is factually misleading. **Resolve:** record detector provenance separately from suspected actor provenance and derive the suspected actor only from work that actually ran before detection; use `unattributed` when causation is not established. **Confidence: high.**

## Tautologies, fail-open behavior, and language escapes

The explicit tautology is the required `process.exit(0)` check above. I did **not** find a direct “exception becomes success” path in the required-check executor. A check that throws produces no result; a required no-result fails. Nonzero exit codes fail, and when `expectedSuiteCount` is present, null or undersized counts fail as well.  Sandbox provisioning failures spend retry budget rather than silently passing. That portion is fail-closed.

The significant TypeScript escape hatch is the `unknown → Partial<TaskResult> → TaskResult` cast in `readResult`; runtime validation is far weaker than the static interface.  I did not find a concrete bypass here based on declaration merging, module augmentation, generic erasure, or a malicious type predicate beyond the model-identity issue already reported. Branded `RunId`/`TaskId` types should be treated as compile-time documentation, not an input-security boundary.

## Mechanisms I assess as sound

Normal resume **does** pin authority to the admission record when the supplied Vault/components are trusted: `ResumeRequest` cannot restate level, policy, or artifacts; `resumeRun` reads those from the admission, re-reads the manifest and graph, compares them to admission hashes, and uses the admitted level/policy.  I did not find a normal caller route to resume the same admitted run at a higher level, substitute another policy, or reset the committed attempts object. The crash/replay finding is different: it exploits what a persisted `running` count means, rather than replacing the count.

`effectiveApproval` itself is sound as a **single gate-instance calculation**: it chooses the stricter contract/policy result, malformed values become blocked, tamper takes priority, and an exact station/level grant is required when the outcome is human-required.  The defect is grant lifetime/identity across repeated station visits, not the strictness arithmetic.

The narrow I2 mechanism is also sound: verification status comes from runtime check outcomes, not the model's narrative; the claim is stored alongside evidence rather than used as the verdict.  Persistent lock tampering is handled well too: missing, unreadable, and path-escape cases become mismatches rather than “intact,” and LocalVault refuses re-lock laundering.  The weakness is transient TOCTOU mutation between verification and consumption.

## Framing

The adversarial framing is mostly the right one: **gate-instance identity, crash/replay semantics, immutable judging inputs, and reviewer isolation are exactly where I found the substantive problems.** The one part I would change is the trust-boundary definition.

As written, “the party controls the arguments to exported entry points” includes `ComponentGraph` and `Vault`, which makes the rest of the exercise almost moot. It also includes unauthenticated `approvedBy`, making “approval nobody granted” an expected consequence of the explicitly deferred P9 boundary. The sharper question for this unit would be:

> Given trusted runtime-selected Vault, SandboxProvider, Driver implementations, and an authenticated approval caller, but attacker-controlled model outputs, workspace bytes, ordinary request data, and process-stop timing, can the attacker cross an exit without the evidence/approval for that specific exit, cause runtime judgment to consume bytes other than the admitted locked bytes, exceed attempt bounds, or gain authority on resume?

Under that framing, findings **3 through 8** remain relevant; findings **1 and 2** become explicit trust assumptions rather than trivial bypasses. That would make the review target the station machine rather than ambiguities at the boundary assigned to later units.
