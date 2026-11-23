# External review of R40, codex, 2026-11-22

The Codex family's review of R40 (admission enforces the readiness ceiling), as the runner wrote it, below this header. Triage: `2026-11-22-R40-admission-readiness-ceiling-triage.md`.

## Source

- **Reviewer:** gpt-6-astra. Family: codex. A headless `codex exec` run under a read-only sandbox, with recorded approval policy `never`, in an empty scratch working directory and a scratch config home holding only `auth.json`, with an environment of `CODEX_HOME` alone; the pre-run listing of both is the manifest's `cleanRoom`. Ingestion 63,422 input tokens against a floor of 39,211; all four markers echoed.
- **Cross-family agreement:** codex-1 with gemini-2 and gemini-3 (no scanner, no enforcement); codex-2 with gemini-1 (the base commit read twice). codex-3, codex-4, and codex-5 were raised by codex alone.
- **Date:** 2026-11-22
- **Bundle:** `2026-11-22-R40-admission-readiness-ceiling-review-bundle.txt`, SHA-256 `770c345227f3584e4cef814fe5e53c0dda7c552a699bde561de493a8feb6b0d4` (the manifest's `bundleSha256`), base `3fde9eb` (`reviewed/R38`), head `7223b34` (the unit branch after its rebase onto R38, before review). Every new file in full and every modified file as a function-context diff; `docs/decisions.md`, `docs/reviews/`, `docs/plan/`, and `pnpm-lock.yaml` excluded by construction. Prompt: `2026-11-22-R40-admission-readiness-ceiling-review-prompt.txt`.
- **Prior context and lookups:** the reviewer said it had no prior context and performed no lookups, and that it executed no tests. A self-report, not independently verifiable.
- **Coverage, and any gap:** items 1 to 7 answered; item 2 (tautologies) answered that none was strictly tautological; item 4 (language escape hatches) answered as defensive hardening outside the stated attacker; item 7 (framing) answered, asking for the admission-time versus resume-time distinction to be stated.
- **Citations:** line numbers are positions in the bundle's new side, not the repository, and are treated as hints.

---

BASE: 3fde9eb  
HEAD: 7223b34  
packages/vault/src/types.ts  
e8fbe409eef0f3c601e6a8dd06820310

I have no prior project context and performed no lookups. This is a static review of the supplied bundle; I did not execute tests.

1. **packages/api/src/run.ts:1040 and :718 — factually wrong — high — Omitting the scanner disables the readiness restriction.**

   Construct an otherwise admissible L1 request against a commit whose readiness ceiling is L0, and omit `readiness`. `readinessAt` returns `not-scanned`; `admissionRefusal` only compares levels when the record says `scanned`. With cost approved, readiness adds no refusal.

   This is explicit absence in the record, but operationally it is clearance. It contradicts the stated requirement that a required check which did not run refuses admission. The same helper accepts historical records with no readiness term. This does not require forging a scanner or modifying the trusted Vault.

   Conformance deliberately preserves the bypass: `packages/conformance/src/registry/admission-readiness.ts:78` requires admission without a port to succeed, and the resume assertion requires missing and `not-scanned` terms to pass.

   **Resolution:** refuse above L0 without a successful scan, including on resume of historical records, or explicitly narrow the promised invariant to deployments that require readiness. The HTTP wiring at `packages/api/src/http/server.ts:466` also permits `null`; whether the production host always supplies a scanner is not established by this bundle. **Confidence: high.**

2. **packages/api/src/run.ts:1043 — unclear — high — The scanned commit is resolved separately from the already-created base snapshot.**

   The shown admission flow calls `snapshotBase(..., req.baseCommit)` before `readinessAt` independently resolves that same request string. It does not pass the snapshot’s resolved commit into the scanner.

   If accepted requests can name a moving revision, the construction is: point the revision at commit A with ceiling L0; let admission snapshot A; move the revision to B with ceiling L1; let `readinessAt` resolve and scan B. An L1 admission then uses A’s snapshot with B’s recorded ceiling. Checking that the scanner echoes B does not establish that B produced the snapshot.

   The conformance port returns whichever commit admission asks for. Its assertion checks hash syntax and agreement with that echoed value, not agreement with the actual snapshot.

   **Resolution:** resolve once, use that immutable identity for both snapshot and scan, and record it. Add a test that moves the requested revision between those operations and compares the scanned identity with the snapshot’s contents. **Confidence: conditional.** `requestProblems`, `snapshotBase`, and `resolveCommit` implementations are absent; verify whether they reject every noncanonical commit identifier and how repository replacement mechanisms are handled before treating this as a confirmed exploit.

3. **packages/conformance/src/registry/readiness.ts:417 — factually wrong — medium — Two “intended reason” checks accept any nonzero command failure.**

   Both `build.install` and `build.clean` use `/ exited [1-9]\d*: /`. `negativeFailure` additionally requires `absent`, executed evidence, and an exited process, but none identifies *why* the command failed.

   An install reported absent because its command was unavailable, or a clean build reported absent because of an unrelated command error, satisfies these predicates if its detail uses the expected exit format. The prerequisite checks do not isolate the intended failures: a valid pinned manifest does not establish a working install invocation; a successful install does not establish that the build failed specifically because the untracked prebuilt file was unavailable.

   Thus these rows can pass without exercising the capability their fixture is intended to defeat.

   **Resolution:** check structured failure causes or specific evidence of the intended failure, and pair each negative fixture with a minimally repaired positive control. **Confidence: high for the predicate weakness; whether current probes produce such misclassified results requires their omitted implementations.**

4. **packages/conformance/src/registry/admission-readiness.ts:134 — factually wrong — medium — The resume assertion never resumes a run.**

   `RESUME_HOLDS_THE_RECORDED_CEILING` admits a run and calls `admissionRefusal` directly on modified record objects. Removing the readiness refusal call from `resumeRun` would leave this assertion passing.

   This proves the helper’s comparison, not that resume invokes it, reads the intended Vault record, or stops before executing work. It also cannot establish recovery behavior after process termination.

   **Resolution:** exercise `resumeRun` against a controlled persisted record requiring refusal, and assert both the refusal and absence of driver activity. Keep the helper test as a separate unit assertion. **Confidence: high.** This is a demonstrated coverage gap, not proof that the omitted resume implementation currently bypasses readiness.

5. **packages/conformance/src/registry/admission-readiness.ts:28 — factually wrong — low — Every state-read exception is accepted as proof that no state exists.**

   `recorded` catches every exception and returns `false`. Consequently, a refusal that accidentally leaves state behind still passes the “no run state” assertion if reading that state throws because of corruption, decoding failure, or another storage fault.

   **Resolution:** accept only the Vault’s specific missing-state error as absence and rethrow other errors. **Confidence: high.**

The following mechanisms are sound within the shown boundaries:

- Policy refusal occurs before readiness. The readiness branch returns a refusal without changing the requested level or granting capabilities. A valid higher ceiling cannot undo an earlier policy refusal.
- With a trustworthy, well-formed scanned result, the strict `requestedLevel > ceiling` comparison correctly refuses overrequests and allows equality.
- A different returned commit throws. A thrown scan triggers base cleanup and exits admission before the shown record/state writes; it does **not** turn into successful admission. The bundle does not establish whether such exceptions receive an enforcement record.
- `negativeFailure` rejects missing probes, `supported`, `indeterminate`, wrong evidence channels, and stopped executions. This is a meaningful improvement, despite the weak reason patterns identified above.
- `protectionStands` invalidates a cached report when the protection boolean changes or the checker throws. Missing probes also invalidate it. Its unit tests do not establish that `ceilingAt` actually rescans or that every other scan input is immutable under the cache key.

I found no strictly tautological assertion in the changed readiness tests. The important distinction is that several tests establish less than their titles claim: an echoed commit is not independent snapshot evidence, and testing a refusal helper is not testing resume.

TypeScript’s `Extract`, `Exclude`, and `readonly` provide no runtime validation. A malformed scanner result with the correct commit and `level: undefined` would survive the numeric comparison. However, supplying that result requires a faulty or substituted trusted scanner, or in-process interference—outside the stated attacker’s control. I would treat runtime shape validation as defensive hardening, not report casts, declaration merging, or generic erasure as demonstrated HTTP exploits here.

The adversarial framing is appropriate, but the contract needs one explicit distinction: **readiness at original admission versus readiness when resuming**. The record-based helper enforces the former. It cannot notice branch protection removed while a run is stopped. If the latter is required, resume needs fresh checks for mutable prerequisites. That temporal requirement, and whether scanner-free admission is permitted at all, must be resolved explicitly; the current conformance assertions encode permissive answers rather than proving the stronger invariants in the question.