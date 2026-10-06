# External review of I1b, codex, 2026-10-03

An adversarial pre-merge review of I1b (the merge step and the M1 proof): the
`GitHubIntegrator` that pushes the accepted change over the admitted base and
merges after the human's approval, the integrate sequencing in the line and
the run service, the Vault's integration record, the per-run report, host
configuration for the merge token and the container user, and the sandbox
working-directory fix. One of two reviews run from the same prompt and bundle;
the other is `2026-10-03-I1b-merge-m1-proof-review-gemini.md`. Both are triaged
in `2026-10-03-I1b-merge-m1-proof-triage.md`, which cites this review's
findings as `codex-1` to `codex-7`, as the reply numbers them.

## Source

- **Reviewer:** gpt-6-astra. Family: codex.
  A headless `codex exec` run (CLI 0.155.1) under a read-only sandbox, with
  recorded approval policy `never`, in an empty scratch working directory and a
  scratch config home holding only `auth.json`, with an environment of
  `CODEX_HOME` alone; the pre-run listing of both is the manifest's
  `cleanRoom`. Exit 0, not timed out, 227.5 s. Ingestion `complete`: 148,704
  input tokens against a floor of 107,733. Integrity `verified`: the reply
  echoes every required bundle marker. Outcome `counted`. Reply SHA-256 as the
  runner wrote it:
  `ad8eef29b5881902649db00e688cf7415a1ae7274016ee81cda1c7135174174a`, which
  matched the manifest's `replySha256` before this header was prepended.
- **Cross-family agreement:** codex-4 (an accepted empty change leaves no
  integration record, and the standing reads `passed` once the exit is
  approved) was raised by gemini too, as gemini-3. codex-7 (an empty
  `FACTORY_CONTAINER_UID` or `_GID` parses as 0) was raised by gemini too, as
  gemini-4. codex-1 (the base can move between the check and the merge) and
  gemini-1 (an already-merged pull request skips the base check) concern the
  same property by different constructions and are not paired. codex-2,
  codex-3, codex-5, and codex-6 were raised by codex alone.
- **Date:** 2026-10-03 (run started 2026-10-04T01:49Z).
- **Bundle:** `2026-10-03-I1b-merge-m1-proof-review-bundle.txt`, SHA-256
  `3ce7e2aae37d708b252152d472ebeedfa3671ab97c46b4a661854b8951a1d482`, base
  `e37aab6` (`reviewed/I1a`), head `288555b` ("I1b: the M1 proof — run
  904f6dab merged canary PR #1"). It held the full contents of 38 of the 39
  changed paths across four commits: source, tests, registry, the two
  changesets, and the M1 proof README and report. The changed
  `docs/decisions.md` was excluded, and so was every unchanged file. Prompt:
  `2026-10-03-I1b-merge-m1-proof-review-prompt.txt`.
- **Prior context and lookups:** the reviewer stated it had no prior project
  context and performed no external lookups, that local filesystem access was
  blocked, and that it did not execute tests. A self-report, not independently
  verifiable.
- **Coverage, and any gap:** findings are not numbered by prompt item. Item 1
  is answered by codex-1 to codex-5; item 2 by codex-6; item 3 by codex-4;
  item 4 by a closing paragraph finding no bypass from casts or brands under
  the stated trust model; item 5 by codex-7; item 6 by a list of mechanisms
  assessed sound (credential separation, approval sequencing, head binding,
  the working directory); item 7 by a closing paragraph refining the question
  to which exact tree was verified and what atomic operation binds approval,
  tree, and destination. No item came back empty.
- **Citations:** line numbers refer to positions in each file as the bundle
  carried it, not to the repository at any later commit. They are hints; the
  triage located each construct by name.

---

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