# External review of R15, codex, 2026-10-11

An adversarial pre-merge review of R15 (acceptance checks run on the base
before build): the base run and the `test-design` exit in `line.ts`, the
refusal rule in `base.ts`, the `onBase` declarations in `parseManifest`, the
write-once base record in both vaults, the fixtures, and the conformance
entries that state those properties. One of two reviews run from the same
prompt and bundle; the other is `2026-10-11-R15-base-run-review-gemini.md`.
Both are triaged in `2026-10-11-R15-base-run-triage.md`, which cites this
review's single numbered finding as `codex-1`, and its unnumbered remark on
base-record shape validation as `codex-obs`.

## Source

- **Reviewer:** gpt-6-astra. Family: codex.
  A headless `codex exec` run (CLI 0.155.1) under a read-only sandbox, with
  recorded approval policy `never`, in an empty scratch working directory and a
  scratch config home holding only `auth.json`, with an environment of
  `CODEX_HOME` alone; the pre-run listing of both is the manifest's
  `cleanRoom`. Exit 0, not timed out, 95.3 s. Ingestion `complete`: 80,478
  input tokens against a floor of 52,399. Integrity `verified`: the reply
  echoes every required bundle marker. Outcome `counted`. Reply SHA-256 as the
  runner wrote it:
  `051231ba3c2b370e95a5d460bb4d17f112c4a7e6dee6b4c2c54e517673cd17ae`, which
  matched the manifest's `replySha256` before this header was prepended.
- **Cross-family agreement:** codex-1 (a suite count taken from the tree's
  inventory stands in for tests the command never ran) was not raised by gemini
  as such. It shares with gemini-4 the built-up file name that keeps a command's
  target out of protected-path analysis, and with gemini-1 the point that a
  recorded exit code is not an executed test. `codex-obs` (the base record's
  reader does not check `suiteCount` or a finite exit code) has no gemini
  counterpart; gemini-5 is about a different cast.
- **Date:** 2026-10-11 (run started 2026-10-12T11:29Z).
- **Bundle:** `2026-10-11-R15-base-run-review-bundle.txt`, SHA-256
  `12ac8e51720e701a0f2d53b4b83faf953ac013ee7deff49d7bb2a5b9ad48e248`, base
  `2dc1f11` (`reviewed/R2`), head `3f61372` ("R15: Acceptance checks run on the
  base before build"). The range is that one commit. It held the full contents
  or whole-function diffs of 33 of the 35 changed paths; the two documentation
  paths (`docs/decisions.md`, `docs/plan/DECOMPOSITION.md`) were excluded, and
  so was every unchanged file. Prompt: `2026-10-11-R15-base-run-review-prompt.txt`.
- **Prior context and lookups:** the reviewer said it had no prior project
  context and performed no lookups, and that it neither executed tests nor
  checked the bundle's hash. A self-report, not independently verifiable.
- **Coverage, and any gap:** items 1 (codex-1), 2 (the `hello-exit-zero`
  fixture check), 3 (missing results fail closed), 4 (the unvalidated base
  record shape and casts), 6 (sound mechanisms) and 7 (the closing paragraph:
  recorded exit codes, executed tests and a fixed defect are different
  properties) were answered. Item 5, configuration satisfied without doing what
  it appears to do, was not answered under its own heading; codex-1 bears on it.
- **Citations:** line numbers are positions in the bundle's new-side hunks,
  not in the repository, and are treated as hints. Each was re-located at the
  cited construct during triage.

---

BASE: 2dc1f11  
HEAD: 3f61372  
packages/vault/test/stub.test.ts  
8d11971995a02b4729e7215edb0eae95

I had no prior project context and performed no lookups. This is a static review of the inline bundle; I did not execute tests or independently verify the file’s SHA-256.

**I found an execution-evidence gap, but no demonstrated bypass of the narrower requirement to record a required command exiting nonzero on the base and zero after build.**

1. **packages/api/src/line.ts:365, packages/api/src/base.ts:42 — factually wrong — high — A tree’s suite count can stand in for acceptance tests that never executed.**

   `runOnBase` counts suites before executing any command and attaches `suiteCountFor(check, counted)` to the command’s result. `baseMismatches` accepts that count without establishing that the command loaded those suites. `verify` uses the same arrangement.

   Concrete construction:

   - Put a supported Vitest declaration and one discoverable test file in the base.
   - Submit one required `acceptance` check with `onBase: "fails"` and `expectedSuiteCount: 1`.
   - Pin this command:

     ```json
     ["node", "-e", "process.exit(require('node:fs').existsSync(['do','ne'].join('')) ? 0 : 1)"]
     ```

   - Have build create `done`, within its granted paths.

   The command exits 1 on the base and 0 afterward. The discoverable test supplies the count, although neither invocation loads it. The new conformance fixture already demonstrates the essential separation: `REPRODUCES` executes a file-existence script while `withSuite` creates a separate, empty Vitest test (`packages/conformance/src/registry/base-run.ts:24`, `:57`).

   Thus a pinned positive suite count does not establish execution, and acceptance assertions can remain entirely unexecuted while verification succeeds. This concerns whether the suite ran, not the excluded question of why an executed assertion failed.

   **Resolution:** distinguish repository inventory from executed-suite evidence. For acceptance checks, require supported execution instrumentation that establishes which locked tests actually ran and refuses absent, empty, skipped, or insufficient execution. A standalone process probe can retain behavioral semantics, but an unrelated suite inventory must not certify it as an executed acceptance suite.

   **Confidence:** high for the separation and construction; the supplied conformance setup directly exercises that separation.

The remaining mechanisms have these strengths and limits:

- **Admission’s reproduction requirement is sound within the shown validation path.** Only a required acceptance or behavioral check declaring `"fails"` increments `reproduces`; optional checks and passing guards cannot satisfy it (`packages/api/src/validate.ts:234`). Duplicate IDs are also rejected, preventing one stored result from satisfying two admitted checks.

- **Missing process results fail closed.** Provisioning and execution exceptions produce `unstarted` entries rather than invented exit codes. A missing result becomes `no-result` (`packages/api/src/base.ts:32`). Teardown or record-reading exceptions propagate; the shown code does not turn them into a pass.

- **The visible ordering protects the base judgment.** `work` evaluates the record before committing the station as exiting, and re-evaluates an existing record on re-entry (`packages/api/src/line.ts:298`). `verify` also throws if no base reference exists. However, the surrounding station dispatcher and resume implementation are absent, so this is not a complete proof covering every committed-state resume.

- **LocalVault’s reference handling is sound in the shown code.** It uses a fixed record filename with exclusive creation, and `read` checks that a base-run reference’s hash matches its bytes (`packages/vault/src/local/vault.ts:433`). Crash atomicity depends on the omitted `createExclusive` implementation.

- **Shape validation is incomplete, but not an established attacker route here.** `baseRunProblem` permits results lacking `suiteCount`, and permits nonfinite numeric exit codes; StubVault checks only the provenance label and write-once condition (`packages/vault/src/local/vault.ts:277`, `packages/vault/src/stub/vault.ts:176`). The generic JSON cast and declaration predicate do not validate those shapes. Your threat model excludes supplying such records through an attacker-controlled Vault or runtime caller, so I would not present these casts as a concrete bypass.

- **Some fixture checks are deliberately tautological.** `hello-exit-zero` executes `process.exit(0)` regardless of repository code (`packages/api/test/fixtures/hello/verify.json:3`). It proves no compilation occurred, but the additional required reproduction prevents that fixture check alone from satisfying admission.

The adversarial framing is appropriate, with one important distinction: **recorded process outcomes, actual acceptance-test execution, and proof that the change fixed the intended defect are different properties.** This unit visibly enforces much of the first, has the execution gap above in the second, and explicitly excludes the third. A red/green process pair alone cannot establish that the change was necessary; that stronger conclusion should not be attributed to this gate.