# External review of R19, gemini, 2026-10-23

An adversarial review of R19's conformance half: the assertions in
`packages/conformance/src/registry/drafting.ts` that are meant to prove
drafting at `spec` and `test-design`, the enforcement-decision rows for the new
causes, the Vault's closed operation set, and the updated independence grades.
One of two reviews run from the same prompt and bundle; the other is
`2026-10-23-R19-drafting-conformance-review-codex.md`. Both are triaged in
`2026-10-23-R19-drafting-conformance-triage.md`, which cites this review's
numbered findings as `gemini-1` to `gemini-6`. R19's runtime half has its own
prompt and bundle (`2026-10-23-R19-drafting-runtime-review-*`) and is not
covered here.

## Source

- **Reviewer:** gemini-3.1-pro-preview. Family: gemini.
  A direct `generateContent` API call to `gemini-3.1-pro-preview`, offering no
  tools; `cleanRoom` is `null` because an API call loads no local
  configuration. Exit 0, not timed out, 200.8 s. Ingestion `complete`: 57,971
  prompt tokens against a floor of 41,585. Integrity `verified`. Outcome
  `counted`. Reply SHA-256 as the runner wrote it:
  `b117b7cd552d6dfd9d35ac6ab8048fdd05bf89b46802537558400821be9a8801`, which
  matched the manifest's `replySha256` before this header was prepended; the
  untouched reply is in commit `9ef13be`.
- **Cross-family agreement:** gemini-1 was raised by codex too (codex-1), and
  so was gemini-3 (the park-ordering part of codex-4). gemini-4 and codex-10
  both question `draftingDecision`'s existential match, from different angles.
  gemini-2, gemini-5, and gemini-6 were raised by gemini alone.
- **Date:** 2026-10-23 (run started 2026-10-23T16:56Z).
- **Bundle:** `2026-10-23-R19-drafting-conformance-review-bundle.txt`, SHA-256
  `8633523ba4e696261807bdbc73d39c8acdbef3e2987268a7606b27df6d7d44c9`, base
  `cd1b536` (`v2` after `reviewed/R20` at `bc2ada7`, plus the docs-only #62),
  head `e772ef9` ("R19: Drafting at spec and test-design"), one commit. It held
  the 16 changed paths under `packages/conformance/`, new files in full and
  modified files as whole-function diffs. The runtime source, docs, and
  changeset were excluded and went to the separate runtime bundle. Prompt:
  `2026-10-23-R19-drafting-conformance-review-prompt.txt`.
- **Prior context and lookups:** the reviewer stated it had no prior context and
  made no lookups. These are self-reports and cannot be independently verified.
- **Coverage, and any gap:** items 1, 6, and 7 were answered. Items 2
  (tautologies), 3 (fail-open), 4 (language escape hatches; the reply's only
  word on them is that the I7 fixture is sound), and 5 (configuration) came back
  empty. Silence on them is not a clearance.
- **Citations:** line numbers are positions in the reviewer's reading of the
  bundle, not the repository. Treat them as hints, not locations.

Prior context: None. I relied entirely on the provided bundle and CONTEXT.
Lookups performed: None.

BASE: cd1b536
HEAD: e772ef9
packages/conformance/src/registry/verification.ts
3bdd87b264a9720cd6f37ec8062743b0

### 1. TEST_DRAFTER_IS_BLACK_BOX reads start directory post-run instead of work directory at provision
- **file:** packages/conformance/src/registry/drafting.ts:373
- **type:** factually wrong
- **severity:** high
- **concrete bypass:** The property guarantees the test drafter's sandbox mounts a tree holding the locked spec and nothing of the repository. The runtime could violate this by placing the entire repository directly into the `work` directory (which is mounted into the test drafter's sandbox) while placing only the three spec files in the sibling `start` directory. Because the test reads the `start` directory *after* the run (by regex-replacing the `work` path), it will falsely conclude the drafter only saw the spec. The test passes, but the drafter sees the full repository.
- **resolution:** Intercept the sandbox `provision` call and read the actual `source` directory of the `workspace` mount before the agent executes, verifying its contents exactly match the locked spec.

### 2. BASE_REFUSAL_CARRIES_ONLY_ITS_FACTS misses the workspace and role instructions for leaked output
- **file:** packages/conformance/src/registry/drafting.ts:414
- **type:** factually wrong
- **severity:** high
- **concrete bypass:** The property states the next attempt learns the facts of the base run "and never its output, which carries the repository". A malicious or flawed runtime could pass the base-run output to the test drafter by injecting the marker into `req.role.instructions` or by writing it to a file in the drafter's workspace (`req.sandbox`) for the retry. The test only asserts that the output marker is absent from `req.variableSuffix` and `req.stablePrefix`, allowing these leaks to go undetected.
- **resolution:** Assert that `req.role.instructions` does not contain the marker, and read the provisioned sandbox files for the retry to ensure the output is not written to the workspace.

### 3. LAST_ATTEMPT_GOES_TO_A_PERSON lacks a timing assertion for the park decision
- **file:** packages/conformance/src/registry/drafting.ts:588
- **type:** factually wrong
- **severity:** high
- **concrete bypass:** The property explicitly requires the park to be "recorded with its station before it is committed". The test retrieves all decisions with `decisionsOf` at the very end of the run and checks if the park decision exists. A runtime that commits the parked state and *then* records the decision (or fails to record it if the process dies in between) passes this test but violates the invariant.
- **resolution:** Wrap the vault in the `around` helper and use the `beforeCommit` hook to verify that the `drafts-rejected` decision is already returned by `readDecisions` when the parked state is committed.

### 4. APPROVAL_BINDS_THE_DRAFT's use of `.some()` hides missing enforcement decisions
- **file:** packages/conformance/src/registry/drafting.ts:318
- **type:** factually wrong
- **severity:** medium
- **concrete bypass:** The test iterates over two invalid draft values (`'0'.repeat(64)` and `null`), expecting both to be refused. It then checks that `decisionsOf` contains `.some()` decision for `draft-mismatch`. If the runtime correctly records a decision for the string hash but silently drops or skips recording a decision for the `null` hash, the test still passes, violating the fail-closed / default-deny requirement to record all decisions.
- **resolution:** Assert the decision recording independently inside the loop, or check that exactly two `draft-mismatch` decisions were recorded.

### 5. CRITIC_FINDING_SENDS_BACK fails to verify the unreadable result warning reaches the third attempt
- **file:** packages/conformance/src/registry/drafting.ts:526
- **type:** factually wrong
- **severity:** medium
- **concrete bypass:** The test uses an unreadable critic result (`'Looks fine to me!'`) on attempt 2, which correctly sends the draft back. However, the test only inspects `requests[1]` (the retry for attempt 2) to ensure the finding from attempt 1 was passed. It never inspects `requests[2]` (the retry for attempt 3) to verify that the runtime actually informs the drafter that its attempt 2 was unreadable. Furthermore, it only checks `stablePrefix` and `role.instructions`, ignoring the workspace.
- **resolution:** Extract the third request (`requests[2]`) and verify its `variableSuffix` carries the unreadable result warning.

### 6. REJECTION_TEXT_ONLY_AT_SPEC fails to check the workspace for rejection notes
- **file:** packages/conformance/src/registry/drafting.ts:604
- **type:** factually wrong
- **severity:** medium
- **concrete bypass:** The test ensures a human's rejection notes do not reach the `stablePrefix` or `role.instructions`, but a runtime could bypass this by writing the notes into a file in the drafter's sandbox.
- **resolution:** Inspect the contents of the provisioned sandbox for the retry attempt to ensure the notes are not present as files.

### Sound Mechanisms
- `DRAFTED_SPEC_LOCKS_NOTHING_UNTIL_APPROVED`: Accurately proves that the draft is not locked prematurely by ensuring `readLocks` throws if any lock is registered before approval.
- `DRAFTED_EXIT_FLOOR` / `DRAFTED_FLOOR_CONDITIONS`: Asserting L2 and L3 conditions using pure functions is a valid tradeoff given the L1 limitation on stub compositions, especially because the line's enforcement is verified directly at L1.
- `INTENT_IS_NOT_A_PAYLOAD` and its associated lint checks soundly prevent type coercions and casts that could circumvent the trusted channel origin requirements.

### Framing Assessment
The adversarial framing is correct and necessary. Given that the system orchestrates unauthenticated LLM agents outputting untrusted content within a closed loop, the runtime must be defensively constructed against its own internal components acting unexpectedly. Assuming the easiest path will be taken proves the invariants hold structurally, regardless of deceptive intent.