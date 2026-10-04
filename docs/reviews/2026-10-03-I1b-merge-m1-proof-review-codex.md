BASE: e37aab6  
HEAD: 288555b  
packages/vault/src/types.ts  
ea01ba80ce4ac3dd9f22ebc035c6189a

I had no prior project context. I performed no external lookups. I reviewed the complete inline bundle; local filesystem access was blocked, and I did not execute tests. Line references below are relative to each bundled file.

1. **packages/api/src/integrate.ts:219 — factually wrong — high — The base can move between its check and the merge.**

   Let the base check return admitted commit `B`. Immediately afterward, push `B′` containing a nonconflicting change. The subsequent merge request pins only the PR’s **head** SHA, not its base. It can therefore merge the verified head into `B′`, incorporating changes the run never checked, and record success.

   Checking the base earlier in `open()` has the same race, with considerably more work between checking and opening.

   **Resolve:** Make the base condition part of an atomic, server-enforced update. For example, construct the exact intended merge commit over `B` and use an update mechanism that cannot succeed if the destination moved. Another GET immediately before merging only narrows the race. Add a test that moves the base between the GET and PUT.

   **Confidence: high.**

2. **packages/api/src/integrate.ts:104, 168 — factually wrong — high — Extra admission files can affect verification but disappear from the merged tree.**

   `baseMismatches()` checks remote tracked entries against the snapshot in only one direction. The pushed tree starts from the remote base and applies only the task’s diff.

   Admit a working copy containing an additional, unchanged `src/feature.js` alongside a tracked `src/feature.ts`. Have a consumer resolve the `.js` implementation during checks, while the task changes the `.ts` implementation. The extra `.js` file can make checks pass, yet it is neither in the remote base nor in the task’s diff. It disappears from the merged tree, changing which implementation executes.

   An extra test configuration or helper can produce the same discrepancy. Calling untracked files a “known limit” does not preserve the stated tree-equality property.

   **Resolve:** Verify the exact publishable Git tree. Reject extra files that can influence execution, or explicitly include them in the candidate tree. Keep dependencies and other verification inputs separately controlled.

   **Confidence: high for the integrator defect; the omitted workspace implementation would establish precisely which extra paths survive admission.**

3. **packages/api/src/integrate.ts:112, 155–166 — factually wrong — high — Blob equality does not establish file-type or mode equality.**

   The base comparison ignores `TreeEntry.mode`; publication takes modes from the remote base instead of the verified filesystem.

   For example, let the remote track `config` as a symlink whose target text is `production`. Supply an admission working copy where `config` is a regular file containing exactly `production`. The blob comparison passes. Checks read a regular file, while the published tree retains a symlink and resolves another file’s contents. Executable-bit differences likewise go undetected.

   **Resolve:** Compare and preserve Git entry type and mode alongside content. Refuse unsupported modes explicitly. Bind verification evidence to the complete candidate Git tree, including modes.

   **Confidence: high.** The example requires no symlink in the admitted workspace.

4. **packages/api/src/report.ts:66 — factually wrong — medium — An approved no-change run can report passed without any integration.**

   A model can make no changes and still pass the required checks. `openAccepted()` returns on an empty diff, and the line commits `integrate/exiting`. After approval, stop the process before `mergeAccepted()` runs.

   `runStanding()` now evaluates the approved exit successfully. Its integration guard rejects completion only when an `opened` record exists without a `merged` record. With **no integration records**, it returns `passed`; `runReport()` consequently marks every gate passed. Resuming would instead throw because no PR exists.

   **Resolve:** Record whether integration is required at admission, and require a matching merged record plus an explicit completion state before reporting success. Reject an empty accepted change before presenting its merge approval, or give it a distinct, explicitly supported outcome.

   **Confidence: high.**

5. **packages/api/src/report.ts:66 — factually wrong — medium — Report outcomes are not derived from the Vault alone.**

   `runReport()` calls `runStanding()`, which calls `reloadExecuted()` and `verifyLocks()` for unfinished runs. Those read the mutable admission working copy.

   While a run awaits approval, change its graph or manifest. Without changing any Vault record, a second report changes from awaiting approval to stopped with a new tamper finding. That finding need not have been recorded in the Vault. Removing the working copy can likewise prevent reporting despite the records remaining available.

   **Resolve:** Separate recorded standing from a live workspace-integrity observation. Either persist the observation before reporting it as the run’s outcome, or label it separately. A historical report should be reconstructible from the Vault alone.

   **Confidence: high.**

6. **packages/api/src/report.ts:72; packages/conformance/src/registry/integration.ts, `RUN_REPORT_READS_ONLY_RECORDS` — factually wrong — low — The report’s cost assertion has a shared implementation as its oracle.**

   Production calculates `costTotals(usage)`. The assertion compares the report against another call to that same helper over the same records. If that helper doubles every cost or omits a token class, this equality still passes.

   This is not a tautology for the entire report test: it can detect incorrect wiring. It does not independently establish correct arithmetic. The separate cost assertion shown elsewhere provides some independent coverage, but this report scenario does not establish cache-rate arithmetic or metered aggregation correctness.

   **Resolve:** Supply known metered records and assert independently calculated literal totals and cache rates, including pending, lost, and unmetered cases.

   **Confidence: high.**

7. **packages/api/src/host/main.ts:39–46 — factually wrong — low — An empty UID or GID silently becomes root’s numeric ID.**

   Set `FACTORY_CONTAINER_UID=1000` and `FACTORY_CONTAINER_GID=''`. The “both absent” condition is false, and `Number('')` becomes `0`, satisfying the integer check. Reversing the values can silently select UID 0. Whitespace has the same conversion behavior.

   **Resolve:** Validate that both variables contain explicit decimal integers before conversion. Test one-empty and whitespace-only pairs.

   **Confidence: high.**

Several mechanisms are sound within the stated trust boundary:

- **Credential separation:** `composeHost()` gives the Git token to the integrator, while sandbox-provider credentials contain only the model credential. The integrator uses a genuine JavaScript `#token` field. I found no demonstrated sandbox path to that token.
- **Approval sequencing:** The line evaluates the exit gate before calling `mergeAccepted()`, records the merge before spending the grant, and does not spend the grant when merging throws. This is the right ordering, subject to the completion-reporting defect above.
- **Head binding and ordinary failures:** The integrator checks the PR head and supplies its SHA to the merge operation. Truncated tree listings, missing tracked files, blob mismatches, HTTP failures, and explicit unsuccessful merges throw rather than silently continuing.
- **Working directory:** The provider explicitly sets Docker’s working directory. Its new test uses a different mount target and reads a relative file, so the image’s default cannot satisfy the test accidentally.

The casts and generic JSON assertions are not runtime validation. However, under your explicit assumption that the Vault, GitHub responses, and runtime components are trusted, I found no additional bypass merely from `as T`, declaration merging, or forged component brands. Treating attacker-supplied replacement components as an exploit would change your threat model.

The adversarial framing is appropriate. Its most useful refinement is: **which exact Git tree was verified, and what atomic operation binds human approval, that tree, and the expected destination commit?** The present code binds file bytes and the PR head more strongly than it binds the complete tree or destination. Also distinguish historical Vault facts, current workspace observations, and recovery of external side effects; they currently share reporting paths that imply stronger guarantees than they provide.