# External review of I1b, gemini, 2026-10-03

An adversarial pre-merge review of I1b (the merge step and the M1 proof): the
`GitHubIntegrator` that pushes the accepted change over the admitted base and
merges after the human's approval, the integrate sequencing in the line and
the run service, the Vault's integration record, the per-run report, host
configuration for the merge token and the container user, and the sandbox
working-directory fix. One of two reviews run from the same prompt and bundle;
the other is `2026-10-03-I1b-merge-m1-proof-review-codex.md`. Both are triaged
in `2026-10-03-I1b-merge-m1-proof-triage.md`, which cites this review's
findings as `gemini-1` to `gemini-4`, as the reply numbers them.

## Source

- **Reviewer:** gemini-3.1-pro-preview. Family: gemini.
  A direct `generateContent` API call to `gemini-3.1-pro-preview` (v1beta),
  offering no tools. `cleanRoom` is `null` because an API call loads no local
  configuration. Exit 0, not timed out, 210.8 s. Ingestion `complete`: 151,998
  prompt tokens against a floor of 107,733. Integrity `verified`: the reply
  echoes every required bundle marker. Outcome `counted`. Reply SHA-256 as the
  runner wrote it:
  `0ad6259935a82dd893c5b7494d619431d2fe20729a6b9600b8bf9fe5b1ab25f3`, which
  matched the manifest's `replySha256` before this header was prepended.
  This is the second run. The first (started 2026-10-04T01:49Z, kept as
  `2026-10-03-I1b-merge-m1-proof-review-gemini.attempt-1.run.json` with its
  session record) was `FAILED`: exit 1 after 0.3 s on HTTP 402, ingestion
  `unreported`, integrity `failed` with `base`, `head`, `finalSection`, and
  `endNonce` absent, and no reply written. The family was re-run from the same
  prompt and bundle.
- **Cross-family agreement:** gemini-3 (an accepted empty change leaves no
  integration record, and the standing reads `passed` once the exit is
  approved) was raised by codex too, as codex-4. gemini-4 (an empty
  `FACTORY_CONTAINER_GID` parses as 0) was raised by codex too, as codex-7.
  gemini-1 (an already-merged pull request skips the base check) and codex-1
  (the base can move between the check and the merge) concern the same
  property by different constructions and are not paired. gemini-2 was raised
  by gemini alone.
- **Date:** 2026-10-03 (counted run started 2026-10-04T22:18Z).
- **Bundle:** `2026-10-03-I1b-merge-m1-proof-review-bundle.txt`, SHA-256
  `3ce7e2aae37d708b252152d472ebeedfa3671ab97c46b4a661854b8951a1d482`, base
  `e37aab6` (`reviewed/I1a`), head `288555b` ("I1b: the M1 proof — run
  904f6dab merged canary PR #1"). It held the full contents of 38 of the 39
  changed paths across four commits: source, tests, registry, the two
  changesets, and the M1 proof README and report. The changed
  `docs/decisions.md` was excluded, and so was every unchanged file. Prompt:
  `2026-10-03-I1b-merge-m1-proof-review-prompt.txt`.
- **Prior context and lookups:** the reviewer stated it used no prior context
  and no external searches. A self-report, not independently verifiable.
- **Coverage, and any gap:** findings are not numbered by prompt item. Item 1
  is answered by gemini-1 and gemini-2, item 3 by gemini-3, item 5 by
  gemini-4. Items 2 (tautological checks), 4 (language escape hatches), 6
  (mechanisms assessed sound), and 7 (whether the framing is right) came back
  empty. Silence on 6 and 7 is not an endorsement of any mechanism or of the
  framing.
- **Citations:** line numbers refer to positions in each file as the bundle
  carried it, not to the repository at any later commit. They are hints; the
  triage located each construct by name.

---

BASE: e37aab6
HEAD: 288555b
packages/vault/src/types.ts
ea01ba80ce4ac3dd9f22ebc035c6189a

I reviewed the code based on the provided invariants and adversarial constraints. I did not use any prior context or external searches.

### 1. `merge()` skips the base-movement check if the PR is already merged
**File:** `packages/api/src/integrate.ts`  
**Line:** 161 (inside `GitHubIntegrator.merge`)  
**Type:** Factually wrong  
**Severity:** High  

**Concrete bypass:**  
The runtime's security model dictates that a merged change must be exactly what the checks verified, meaning the base branch must not have moved (`#baseUnmoved`). However, if an attacker manually merges the PR on GitHub *after* the base branch has moved, `pull.merged_at` will be non-null. The `merge()` function assumes any existing merge was done by a previous aborted drive of the runtime, and it immediately accepts `pull.merge_commit_sha` without calling `this.#baseUnmoved(opened.baseCommit)`. 

When the human subsequently approves the gate, the runtime accepts this externally created merge commit. This violates "merge after the base moved" and "Fail closed ... a moved base stops the run", as the code merged on GitHub combines the verified diff with unverified base changes.

**Resolution:**  
Call `await this.#baseUnmoved(opened.baseCommit)` even when `pull.merged_at !== null`, or explicitly verify that the PR's `merge_commit_sha` has `opened.baseCommit` as its first parent.

### 2. The PR's base branch is never verified, allowing merges into arbitrary branches
**File:** `packages/api/src/integrate.ts`  
**Line:** 147 (in `open`) and 168 (in `merge`)  
**Type:** Factually wrong  
**Severity:** High  

**Concrete bypass:**  
When the runtime checks an existing PR in `open()` or fetches it in `merge()`, it never checks `pull.base.ref === this.baseBranch`. Because the attacker has write access to the repository (implied by their ability to move the base branch), they can log into GitHub and change the PR's target base branch from `main` to `attacker-branch`. 

When the runtime calls `PUT /pulls/{pull.number}/merge`, GitHub will merge the verified tree into `attacker-branch`. However, the runtime builds the `IntegrationMerged` record using `opened.baseBranch` (which is hardcoded to `this.baseBranch`). This makes the Vault record falsely claim the code was merged into the configured base branch.

**Resolution:**  
In both `open()` and `merge()`, verify that `pull.base.ref === this.baseBranch` and throw an error if it does not match.

### 3. A run that accepts no changes is transiently reported as `passed` while destined to halt
**File:** `packages/api/src/run.ts`  
**Line:** 1073 (in `runStanding`)  
**Type:** Factually wrong  
**Severity:** Medium  

**Concrete bypass:**  
If a task makes no changes (`diff.length === 0`), `openAccepted` exits early and does not create an `IntegrationOpened` Vault record. When a human approves the exit, the client polls `status`. `runStanding` sees that the unspent grant is present, evaluates the `integration` array, finds it empty, and tautologically assumes there is no integrator. It returns `{ standing: 'passed' }`.

However, the background drive running `runLine` will reach `mergeAccepted`, see that `integrator !== null`, but find no `opened` record. It will throw an error ("a run that merged nothing is not done") and halt the run. This leaves the run transiently reported as `passed` to the client when its merge is half-completed and doomed to fail.

**Resolution:**  
`runStanding` should not assume that an empty integration array means the run is done if it hasn't verified whether an integrator is configured or if the drive has successfully completed.

### 4. Configuration parsing accepts an empty string as GID 0
**File:** `packages/api/src/host/main.ts`  
**Line:** 31 (in `containerUser`)  
**Type:** Factually wrong  
**Severity:** Low  

**Concrete bypass:**  
The runtime intends to enforce that `FACTORY_CONTAINER_UID` and `FACTORY_CONTAINER_GID` must both be provided, or neither. However, if an operator sets `UID=1000` but explicitly leaves `GID=''` (empty string), `Number('')` evaluates to `0` in JavaScript. `Number.isInteger(0)` returns true, bypassing the validation check and silently defaulting the container group to `0` (root group) rather than refusing the configuration. 

**Resolution:**  
Check `uid === ''` and `gid === ''` explicitly before passing them to `Number()`, or use `parseInt` with strict validation.