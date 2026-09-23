# External review of P6, codex, 2026-09-22

An adversarial pre-merge review of P6 (Verification + evidence): the
runtime-owned base and diff trees, the verify station's checks on a task's own
diff, the gate inputs, admission's recorded controls, the review seat's view,
and the sandbox's container user. One of two reviews run from the same prompt
and bundle; the other is `2026-09-22-P6-verification-evidence-review-gemini.md`.
Both are triaged in `2026-09-22-P6-verification-evidence-triage.md`, which
cites this review's findings as `codex-1` to `codex-8`.

## Source

- **Reviewer:** gpt-6-astra. Family: codex.
  A headless `codex exec` run (CLI 0.155.1) under a read-only sandbox, with
  recorded approval policy `never`, in an empty scratch working directory and a
  scratch config home holding only `auth.json`, with an environment of
  `CODEX_HOME` alone. The pre-run listing of both is the manifest's
  `cleanRoom`: config home `[auth.json]`, working directory `[]`. Exit 0, not
  timed out, 329.8 s. Ingestion `complete`: 164,521 input tokens against a
  floor of 109,828. Integrity `verified`: the reply echoes every required
  bundle marker. Outcome `counted`. Reply SHA-256 as the runner wrote it:
  `2015f0cad8cf74bd2ba0b4345c57ff0d4bbb7597f586d6dee422770759e94393`, which
  matched the manifest's `replySha256` before this header was prepended.
- **Cross-family agreement:** none. Gemini reported no findings, so codex raised
  every finding here alone. Gemini's item-6 assessment named three mechanisms
  as sound that codex-1 (symlink handling in the tree operations), codex-6 (the
  exact-key check), and codex-8 (the writability refusal) dispute; the triage
  records which account the code bore out.
- **Date:** 2026-09-22 (run started 2026-09-23T02:37:44Z UTC).
- **Bundle:** `2026-09-22-P6-verification-evidence-review-bundle.txt`, SHA-256
  `434fb474e8ef1b712ee1b8780a4100c449e681adcdb0d7205eb490c074378aff` (the
  manifest's `bundleSha256`), base `9f30317` (`reviewed/TOOLING`), head
  `de95c2e` (P6: Verification + evidence). It held the full contents of 47 of
  the 51 files changed in that range: all source, tests, changesets, the
  conformance registry and baseline, and the lockfile. It excluded
  `docs/decisions.md`, `docs/plan/DECOMPOSITION.md`, `docs/plan/F1-spine.md`,
  and `docs/plan/WORKFLOW.md`, as the prompt states ("no design documents").
  Prompt: `2026-09-22-P6-verification-evidence-review-prompt.txt`.
- **Prior context and lookups:** the reviewer stated that it had no prior
  project context, that it performed no external lookups, and that local
  commands were blocked, so it ran no reproductions and did not verify the
  bundle's hash itself. This is a self-report and cannot be independently
  verified, although the read-only sandbox and the empty working directory are
  recorded in the manifest.
- **Coverage, and any gap:** all seven numbered items were answered. Items 1,
  3, and 5 are covered by findings 1–8. Item 2, tautological checks: none in
  production code; the fixture's `process.exit(0)` is noted as
  orchestration-only, and suite counting as enumeration, not execution. Item 4,
  language escape hatches: none beyond the incomplete result validation in
  finding 6. Item 6, sound mechanisms: argv without a shell, destroying the
  build sandbox before collecting its diff, unstarted checks recorded without
  invented exits, hash-checked materialization, locks held to admission
  hashes, and the build result's runtime key check. Item 7, framing: the
  framing is right, but two promises need sharper definitions — preventing
  writes versus preventing their propagation, and excluding designated
  narrative channels versus excluding equivalent information an author can
  copy into a permitted file. Every finding carries the label "factually
  wrong". None is labelled unclear or a tradeoff.
- **Citations:** file and line numbers refer to positions in the files as the
  bundle held them at `de95c2e`. They are hints for locating the construct, not
  locations in the repository, and the triage verified each against the
  construct itself.

---

BASE: reviewed/TOOLING  
HEAD: de95c2e  
pnpm-lock.yaml  
a2b7ae11bd21003b368d2c3b38cb0731

No prior project context; no external lookups. I reviewed the supplied text. Local commands were blocked, so I did not independently verify the SHA-256 or execute reproductions. Citations use lines within the supplied files.

1. **packages/api/src/workspace.ts:188, :226 — factually wrong — high — Symlink composition can delete files outside the workspace.**

   Concrete two-task construction, with both tasks granted `p` and `p/**`:

   - The admitted repository contains `p -> /host/victim-directory`. That host directory contains a regular file `x`, accessible to the runtime.
   - Task A replaces `p` with a directory containing `p/x`, with different bytes. Its diff removes the link and adds the child. `composeDiff` follows the **base’s ancestor symlink** when hashing `p/x`, incorrectly treating the host file as a base entry. Materialization removes the link before creating the directory, so A can pass.
   - Task B restores the original link, removing its local `p/x`. Composition drops the `p` entry because its link text matches base, but retains a removal for `p/x` because the host file exists.
   - Materialization copies base, including its symlink, then executes `rm(building/p/x)`. That deletes `/host/victim-directory/x`.

   The grants see only permitted paths, locked artifacts can remain unchanged, and unrelated pinned checks can pass. This requires neither a malicious component nor a surviving process.

   **Resolve:** Treat descendants of symlinks as absent or invalid in tree composition; prohibit ancestor-link traversal for every host read, copy, and deletion. Validate the resulting tree structure before applying operations. **High confidence from source tracing.**

2. **packages/integrity/src/types.ts:22; packages/api/src/verification.ts:53 — factually wrong — high — Pinning argv does not pin the checker it invokes.**

   Given a legitimate pinned command such as `["npm", "test"]`, an agent granted `package.json` can replace the test script with `node -e "process.exit(0)"`. Alternatively, a repository supplied at admission can already contain a substituted repository-local runner.

   Keep every test file present. Host enumeration still returns the expected count; the pinned argv runs exactly; the command exits zero; locked tests remain byte-identical. None of those observations establishes that those tests executed.

   There is also cross-check contamination: `verify` executes every check in one container. With an allowed root container user, repository code reached by an earlier check can replace a checker executable in the writable container filesystem before a later check runs. A read-only workspace does not prevent that.

   **Resolve:** Establish a trusted checker/toolchain boundary, protect its dispatch configuration and dependencies, and isolate checks from preceding checks’ processes and filesystem changes. Where product code shares the checker’s process, an external oracle is needed for stronger adversarial assurance. **High confidence; the first construction requires a manifest that invokes repository-controlled dispatch.**

3. **packages/api/src/workspace.ts:170 — factually wrong — medium — Writable globs enforce final differences, not write authority.**

   A task granted only `src/**` receives the entire workspace read-write. It can overwrite `spec.md` or another ungranted file, use the altered contents during its work, then restore the original bytes before returning. `ownDiff` contains no prohibited change, and verification uses the restored artifacts.

   Writes under `.git` are excluded altogether. A task can write there despite having no matching grant, and every grant check still passes.

   This does not, by itself, corrupt the fresh verification tree. It does violate the stated property that an ungranted write capability is unavailable.

   **Resolve:** Enforce write restrictions during execution, including read-only locked artifacts, or explicitly narrow the guarantee to “only authorized final changes propagate.” **High confidence.**

4. **packages/api/src/verification.ts:53 — factually wrong — medium — Enumeration failures become non-gating unknowns when no count is pinned.**

   `countSuites` catches every exception and returns `null`. `expectedSuiteCount` is optional. The supplied line tests explicitly demonstrate a required unit check passing with `suiteCount: null` when no count was specified.

   Thus an enumeration error or unsupported test stack can coexist with a passed task: retain a zero-exit required command and omit the optional threshold. Recording unavailable controls does not refuse this at the currently runnable levels.

   **Resolve:** Make successful enumeration mandatory for check kinds that require it, distinguish unsupported stacks from enumeration errors, and require the relevant baseline at admission. If lower levels intentionally permit missing controls, narrow the unconditional fail-closed claim. **High confidence in the shown behavior; `gate.ts` itself was not supplied.**

5. **packages/api/src/workspace.ts:261 — factually wrong — medium — The reviewer receives surviving file contents, not the diff.**

   `reviewView` selects only cumulative entries whose hash is non-null, and `copyOnly` copies their full current contents. The review prompt never supplies a `diff` value, and `evidenceFacts` supplies neither changed paths nor removals.

   Delete an unlocked file that is not required by the checks. The reviewer receives no deletion record, old contents, or patch identifying its removal. A no-change run and a deletion can produce the same review workspace; claiming the deletion accurately also leaves the mismatch count zero.

   **Resolve:** Supply a runtime-generated patch or equivalent before/after representation containing additions, modifications, and deletions. Treat any full-file context as a separate, explicit grant. **High confidence.**

6. **packages/api/src/verification.ts:99 — factually wrong — medium — Result validation leaves reviewer results unchecked and model provenance agent-controlled.**

   `build` calls `taskResultProblems`; `review` does not. A reviewer result containing `status: "passed"` is recorded despite the claimed exact-key boundary. That extra field does not itself determine status, but the boundary demonstrably does not hold at both seats.

   More consequentially, under the stated assumption that every `TaskResult` field is controlled, an author can return a false `model.family` while preserving all permitted keys. Review independence is calculated against that recorded claim. An actually same-family reviewer can therefore be recorded as independent. The pre-review model resolution does not authenticate the author’s identity.

   **Resolve:** Validate results at a shared boundary for both stations, including field values. Obtain actual model provenance through trusted driver metadata that agent-controlled result fields cannot overwrite. **High confidence for false independence recording; I am not claiming an executable L3 bypass through the current admission cap.**

7. **packages/integrity/src/types.ts:24 — factually wrong — medium — A pinned check timeout is accepted but never enforced.**

   `CheckSpec.timeoutMs` is neither validated by `checkProblems` nor passed to an enforcement mechanism in `verify`. `LocalDockerProvider.exec` uses the remaining sandbox lifetime.

   A check pinned to one second can run for substantially longer and return a passing result while the sandbox still has time remaining.

   **Resolve:** Validate and enforce each check’s deadline, terminating its process tree and recording timeout as a required-check failure. **High confidence.**

8. **packages/sandbox/src/local/provider.ts:171 — factually wrong — medium — The writability refusal checks write permission without directory search permission.**

   On Linux, give a non-root container user ownership of a workspace directory with mode `0600`. The owner-write test succeeds, so provisioning proceeds. Creating `/workspace/probe` nevertheless fails because the directory lacks execute/search permission.

   This is a concrete counterexample to “never handed back unwritable,” independent of ownership translation or ACL subtleties.

   **Resolve:** Check directory search permission as well as write permission; preferably verify effective access under the actual container identity and mount configuration. **High confidence.**

Several narrower mechanisms are sound under the stated trusted-component assumptions:

- Explicit argv avoids accidental shell parsing.
- Destroying the build sandbox before collecting its diff removes ordinary surviving-process races when destruction succeeds.
- Required execution exceptions produce missing results and named `unstarted` evidence rather than invented successful exits.
- Hashing copied file contents catches ordinary content changes between collection and materialization.
- Direct locked-file edits are checked against admission hashes, rather than merely against a newly established lock.
- Build-result extra keys are rejected at runtime; TypeScript casts alone cannot bypass that check.

I found no additional production check that is literally tautological. The fixture’s `process.exit(0)` is intentionally independent of product behavior and is suitable for testing orchestration, but cannot establish product correctness. Likewise, counting files establishes enumeration, not execution.

Casts, `any`, declaration merging, generic erasure, and asserted type predicates cannot establish runtime security properties. Conversely, modifying types in the sandbox does not modify the runtime’s own process under this threat model. The concrete language-boundary issue here is the incomplete validation and provenance handling in finding 6.

The adversarial framing is appropriate. Two promises need sharper definitions: preventing writes versus preventing their propagation, and excluding designated narrative/plan channels versus excluding equivalent information. An author can copy its plan into an otherwise permitted changed source comment. A reviewer allowed to read that diff necessarily sees those bytes; path filtering alone cannot provide semantic exclusion.