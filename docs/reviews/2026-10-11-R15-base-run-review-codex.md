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