# External review of R19, codex, 2026-10-23

An adversarial review of R19's runtime half: the drafting contracts, the
Vault's draft and lock records, the line that drafts at `spec` and
`test-design`, and the API and CLI that admit, approve, and reject drafts. One
of two reviews run from the same prompt and bundle; the other is
`2026-10-23-R19-drafting-runtime-review-gemini.md`. Both are triaged in
`2026-10-23-R19-drafting-runtime-triage.md`, which cites this review's
numbered findings as `codex-1` to `codex-5`. R19's conformance half has its
own prompt, bundle, reviews, and triage
(`2026-10-23-R19-drafting-conformance-*`).

## Source

- **Reviewer:** gpt-6-astra. Family: codex.
  A headless `codex exec` run (CLI 0.155.1) under a read-only sandbox, with
  recorded approval policy `never`, in an empty scratch working directory and a
  scratch config home holding only `auth.json`, with an environment of
  `CODEX_HOME` alone; the pre-run listing of both is the manifest's
  `cleanRoom`. Exit 0, not timed out, 291.5 s. Ingestion `complete`: 143,086
  input tokens against a floor of 99,338. Integrity `verified`. Outcome
  `counted`. Reply SHA-256 as the runner wrote it:
  `8c49557128285ea3960e24a27f281687ae41279b5f3c893ca537326487777b00`, which
  matched the manifest's `replySha256` before this header was prepended; the
  untouched reply is in commit `fb73282`.
- **Cross-family agreement:** codex-1's exit-code channel was raised by gemini
  too (gemini-1); its second half, the `exists` oracle, was codex's alone.
  codex-2 to codex-5 were raised by codex alone.
- **Date:** 2026-10-23 (run started 2026-10-23T20:09Z).
- **Bundle:** `2026-10-23-R19-drafting-runtime-review-bundle.txt`, SHA-256
  `c0bfe209261fd5d1462a81528cf4d6ab12efe55c71535d805b77135c34826fe9`, base
  `cd1b536` (`v2` after `reviewed/R20`, plus the docs-only #62), head `e772ef9`
  ("R19: Drafting at spec and test-design"), one commit. It held the 42 changed
  paths outside `packages/conformance/`: the runtime source in `core`, `vault`,
  `api`, `cli`, and `compiler`, the four drafting roles, the two default
  rubrics, the changeset, and the unit tests beside them; new files in full and
  modified files as whole-function diffs. The conformance assertions were
  excluded and reviewed separately. Prompt:
  `2026-10-23-R19-drafting-runtime-review-prompt.txt`.
- **Prior context and lookups:** the reviewer stated it had no prior project
  context and made no external lookups, that local command execution was
  blocked, and that it did not verify the bundle's hash or run the tests. These
  are self-reports and cannot be independently verified.
- **Coverage, and any gap:** items 1 (codex-1, codex-3, codex-4, codex-5), 4
  (it found no TypeScript escape hatch available to this adversary), 6, and 7
  (codex-2, which argues the framing asks a critic's answer to be both
  adversary-controlled and trusted) were answered. Item 2 (tautological checks)
  got no separate answer. Item 3 (fail-open) got no separate answer; its
  sound-mechanisms list names the critic's malformed-result handling as fail
  closed. Item 5 is answered only through codex-5.
- **Citations:** line numbers are positions in the reviewer's reading of the
  bundle, not the repository. Treat them as hints, not locations.

BASE: cd1b536  
HEAD: e772ef9  
packages/vault/test/stub.test.ts  
57cf27767a57bba46a56d0dce7972dc3

I had no prior project context and performed no external lookups. I reviewed the complete inline bundle. Local command execution was blocked, so I did not independently verify its SHA-256 or execute tests.

1. **packages/api/src/drafting.ts:594 — factually wrong — high — Base-run exit codes disclose repository contents to the test drafter.**

   Draft a behavioral check whose program reads a repository file and exits with `1 + (byte % 255)`. Declare `onBase: "passes"`. The nonzero exit produces a mismatch, and `judgeBase` preserves that exact exit code. The next attempt receives it through `retryParts` and `retrySuffix`.

   Many checks can encode different bytes in one attempt; there is no shown bound on the number of checks. No network access, sandbox escape, human approval, or critic cooperation is necessary: the base-run mismatch sends the draft back before criticism.

   There is also a simpler existence oracle at **drafting.ts:495**: proposing paths beneath the test directory reveals which already exist through the `exists` problems returned on retry.

   **Resolution:** Decide explicitly what repository-derived information may be disclosed. Strict “nothing beyond the locked spec” requires withholding adaptive repository-dependent feedback. Replacing numeric exit codes with fixed outcomes reduces bandwidth but still exposes a predicate oracle.

   **Confidence: high.**

2. **packages/api/src/drafting.ts:677 — unclear — high — The semantic guarantee exceeds the stated threat model.**

   The adversary controls the critic’s answer. At L2 with an explicit `auto` cell, it can supply a structurally valid spec that contradicts the intent, report no open questions, and have the genuinely different-family critic return `{"findings":[]}`. The runtime records a clean independent result and automatically locks the draft.

   That is not a forged identity or hash substitution. The critic really was seated and returned that answer. But family separation cannot establish that an adversary-controlled answer represents an independent substantive assessment.

   **Resolution:** Distinguish two guarantees:
   
   - The runtime obtained a correctly bound response from a different-family seat.
   - The response meaningfully assessed correctness.

   The first is enforceable here. The second requires an additional trust assumption, human review, or independently enforced semantic checks. The adversarial framing is useful for authorization and information flow, but cannot simultaneously assume control of every critic answer and treat that answer as trustworthy clearance.

   **Confidence: high; the ambiguity is in the claimed property.**

3. **packages/api/src/drafting.ts:507 — unclear — medium — Naming a test in an argument vector does not establish that the command executes it.**

   The behavioral branch counts any argument equal to a drafted path as running that test. For example:

   ```json
   ["node", "-e", "process.exit(0)", "test/guard.js"]
   ```

   This names `test/guard.js` but never executes it. Mark it required and `onBase: "passes"`; another check supplies the required failing reproduction. The command succeeds regardless of the implementation or the named test’s assertions. A `deniesRule` label does not change that.

   The shown binding expression accepts this construction. **End-to-end admission remains uncertain:** `suiteBindingProblems` is imported but its implementation is absent from the bundle. It would need an additional check to reject this case.

   **Resolution:** Inspect that helper and add an adversarial execution test. For drafted checks, prefer runtime-owned runners with explicit test operands; arbitrary command arguments cannot prove execution. Also inspect behavioral checks without `onBase`: the shown validator permits them, while the base runner selects `declaredChecks`, whose implementation is likewise absent.

   **Confidence: high about the ineffective argument-membership check; medium about complete bypass reachability.**

4. **packages/api/src/drafting.ts:758 — factually wrong — medium — Draft locking cannot recover from every permitted stop.**

   Two concrete stop windows contradict the recovery claim:

   - Stop after `recordDraftLock` succeeds but before the state commit at line 759. Resume sees `drafts.locked === null` and repeats `recordDraftLock`; the Vault rejects the already-existing station lock. There is no lookup/reconciliation path.
   - Stop after that state commit but before the repository write at **line 773**. Resume reconstructs artifacts from the committed lock. `loadLine` treats the not-yet-written security/run-requirements or acceptance-manifest file as tampering and refuses before `lockApproved` can finish installation. `settleBase` repairs only the base.

   These are availability failures, not unauthorized approvals.

   **Resolution:** Separate pending installation from completed locking, make recording the same lock idempotent, and reconcile an interrupted installation before applying completed-artifact tamper checks. Preserve refusal for genuinely conflicting bytes.

   **Confidence: high.**

5. **packages/api/src/drafting.ts:484 — factually wrong — medium — Draft collection does not enforce the policy’s writable paths.**

   The collector accepts paths according to the spec’s test directory and the fixed manifest path. It does not intersect those paths with the drafter role’s `scope.writableGlobs`. The analogous spec collector accepts its four fixed files.

   Configure a drafter with a write tool but writable globs covering only a subset of those paths. `runTask` gives it a writable workspace and passes tools and budgets, but does not pass the writable globs. The drafter can produce files outside that policy grant, and the collector accepts them for approval and locking. Build verification explicitly checks writes against policy; drafting lacks the corresponding check.

   **Resolution:** Enforce the policy intersection when collecting draft artifacts, and reject incompatible drafting scopes at admission. If writable globs intentionally do not govern drafting, make that exception explicit instead of presenting them as capabilities enforced uniformly.

   **Confidence: high from the shown runtime path.**

Several mechanisms are sound within the stated trust boundary:

- **Approval binding:** `packages/core/src/station/machine.ts:152` matches station/level, unspent status, hash, and attempt. A grant for an earlier attempt cannot clear a later one.
- **Default-deny approval:** `machine.ts:144` only permits drafted auto approval at L2 with no failed conditions, while preserving stricter policy outcomes.
- **Malformed critic results:** `packages/api/src/drafting.ts:609` converts malformed, empty, or otherwise unreadable narratives into a finding.
- **Recorded-byte installation:** `drafting.ts:773` installs bytes from the recorded draft, and subsequent lock-hash comparison prevents accepting different bytes as that draft. The recovery defects above do not themselves authorize a substitute.
- **Direct critic isolation:** `drafting.ts:662` constructs the test critic’s workspace from spec artifacts plus recorded draft files. This prevents direct repository mounting; it does not eliminate the feedback channel in finding 1.

I found no demonstrated TypeScript cast, declaration-merging, module-augmentation, generic-erasure, or type-predicate bypass available to this adversary. Casting JSON from a trusted runtime-written Vault record is not, by itself, an attacker entry point. Likewise, I would not count calling exported runtime functions or supplying a malicious Vault as exploits: both violate the stated trust boundary.