# External review of R19, gemini, 2026-10-23

An adversarial review of R19's runtime half: the drafting contracts, the
Vault's draft and lock records, the line that drafts at `spec` and
`test-design`, and the API and CLI that admit, approve, and reject drafts. One
of two reviews run from the same prompt and bundle; the other is
`2026-10-23-R19-drafting-runtime-review-codex.md`. Both are triaged in
`2026-10-23-R19-drafting-runtime-triage.md`, which cites this review's
finding as `gemini-1`. R19's conformance half has its own prompt, bundle,
reviews, and triage (`2026-10-23-R19-drafting-conformance-*`).

## Source

- **Reviewer:** gemini-3.1-pro-preview. Family: gemini.
  A direct `generateContent` API call to `gemini-3.1-pro-preview`
  (`generativelanguage/v1beta`), offering no tools. `cleanRoom` is `null`
  because an API call loads no local configuration. Exit 0, not timed out,
  194.5 s. Ingestion `complete`: 144,692 prompt tokens against a floor of
  99,338. Integrity `verified`. Outcome `counted`. Reply SHA-256 as the
  runner wrote it:
  `21123ff587559769a43d3cc9240d33f123472dced212d2312c647d615bae2893`, which
  matched the manifest's `replySha256` before this header was prepended; the
  untouched reply is in commit `a6bb50b`.
- **Cross-family agreement:** gemini-1 was raised by codex too (the first half
  of codex-1). Gemini raised no other finding.
- **Date:** 2026-10-23 (run started 2026-10-23T20:18Z).
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
- **Prior context and lookups:** the reviewer stated it had no prior context
  and made no lookups. This is a self-report and cannot be independently
  verified.
- **Coverage, and any gap:** items 1 (gemini-1) and 6 were answered. Items 2
  (tautological checks), 3 (fail-open), 4 (language escape hatches), 5
  (configuration), and 7 (the framing) came back empty; the reply's single
  finding is numbered 1 and its sound list 6, with nothing between. Its sound
  list also claims a stop before the lock is caught as tamper on resume, which
  codex-4 disputes; that claim is checked under codex-4.
- **Citations:** line numbers are positions in the reviewer's reading of the
  bundle, not the repository. Its `machine.ts:406` for `retrySuffix` is a
  bundle position. Treat them as hints, not locations.

BASE: cd1b536
HEAD: e772ef9
packages/vault/test/stub.test.ts
57cf27767a57bba46a56d0dce7972dc3

I had no prior context and performed no lookups.

### 1. High - Black-box test drafter can leak repository contents via behavioral check exit codes
**file:packages/api/src/drafting.ts:340**  
**file:packages/core/src/station/machine.ts:406**  
**type:** bypass  
**severity:** high  

**The concrete bypass:**  
Invariant I3 requires the test drafter to be strictly black-box, seeing only the locked spec and nothing of the base repository. However, the runtime permits the test drafter to supply `behavioral` checks inside its drafted `acceptance.json` (via `readTestDraft`). A `behavioral` check specifies an arbitrary `command` (e.g., `["node", "test/leak.js"]`) that `baseRunDraft` executes inside a sandbox over a full copy of the base repository. 

The test drafter can exploit this by writing a Node script that reads repository files (e.g., `fs.readFileSync('../../src/secret.js')`) and exits with a code corresponding to the data it read (0-255). By declaring `onBase: "passes"` on this check, any non-zero exit code produced by the script is treated as a mismatch. `judgeBase` will explicitly preserve this code:
```typescript
  const parts = mismatched.filter((m) => !admitted.has(m.checkId)).map((m): BaseRefusalPart =>
    m.cause === 'contrary' && m.exitCode !== null
      ? { checkId: m.checkId, declared: m.declared, exitCode: m.exitCode }
      ...
```
`retrySuffix` in `machine.ts` then formats this exact exit code into the variable suffix for the drafter's next attempt (`exit ${String(c.exitCode)}`). This creates a direct data exfiltration channel, allowing the test drafter to map out and read arbitrary repository contents using its three iteration attempts.

**What would resolve it:**  
Either prohibit the test drafter from defining `behavioral` checks (restricting it to `acceptance` checks that invoke the pre-defined `testCommand` framework, preventing arbitrary command execution), or censor the exact `exitCode` from the `BaseRefusalPart` sent back to the drafter, revealing only whether the check matched its declaration or not.

---

### 6. Sound Mechanisms
- **Drafting Sandboxes and Separation (I3, I6):** The implementation of workspace preparation effectively limits test drafter and critic visibility. `copyOnly` is rigorously used so that the `start` directory exclusively contains spec artifacts, preventing the test drafter from interacting with or reading the codebase directly, while `spec` gets a full copy. 
- **The Draft Lock Flow:** Writing files to `ctx.run.repo` and `base` before locking is sound and fail-closed. If a crash or manual stop occurs before `vault.lock` executes, the runtime encounters `recordTamper` on resume because `fileAt` detects a mismatch against the unrecorded lock state, halting the tampered state appropriately.
- **Auto Approval Limitations:** The drafted floor implementation (`effectiveApproval`) correctly restricts `auto` approval. At L3, the boolean logic guarantees the exit floor always escalates to `human-required`.
- **Drafter and Builder Independence:** The runtime's extraction of `builderModels(ctx)` appropriately maps across every tier an escalation could reach, and `seatTestDrafter` correctly computes the weakest grade against all builder models, securing the builder/tester separation property at L3.