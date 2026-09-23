# External review of P6, gemini, 2026-09-22

An adversarial pre-merge review of P6 (Verification + evidence), the same
scope as its companion `2026-09-22-P6-verification-evidence-review-codex.md`,
from the same prompt and bundle. Both are triaged in
`2026-09-22-P6-verification-evidence-triage.md`. This reply reported no
findings, so the triage cites none from it by number.

## Source

- **Reviewer:** gemini-3.1-pro-preview. Family: gemini.
  A direct `generateContent` API call (`POST` to the v1beta
  `models/gemini-3.1-pro-preview:generateContent` endpoint) to
  `modelRequested` `gemini-3.1-pro-preview`, offering no tools. `cleanRoom` is
  `null` because an API call loads no local configuration. Exit 0, not timed
  out, 293.4 s. Ingestion `complete`: 168,513 prompt tokens against a floor of
  109,895. Integrity `verified`: the reply echoes every required bundle marker.
  Outcome `counted`. Reply SHA-256 as the runner wrote it:
  `7e4a43ee9302fdc69b2596149c333154ce330f33efdb833c2ccf34fb7ab4c8d2`, which
  matched the manifest's `replySha256` before this header was prepended.
  **This is the third Gemini run.** The first two, kept beside it as
  `…-review-gemini.attempt-1.md` and `…attempt-2.md` with their manifests, were
  `INTEGRITY_FAILED`: ingestion was complete (168,432 tokens against 109,828),
  but the echo failed, with `base`, `head`, `finalSection`, and `endNonce` all
  absent from the reply. Neither is triaged. Between the second and third runs
  the runner was changed to repeat the echo request after the bundle
  (`72e046d`), so this run's payload (549,478 bytes, SHA-256 `48a2a01b…`) is
  337 bytes longer than the payload of codex's run and of the first two
  attempts (549,141 bytes, `bb9858ac…`). The bundle and the prompt are
  byte-identical across all four runs.
- **Cross-family agreement:** none. This reply raised no findings. Its item-6
  assessment named as sound three mechanisms that codex disputes: symlink and
  traversal handling in the tree operations (codex-1), the exact-key check
  preventing an injected `status` (codex-6), and the writability refusal
  (codex-8). The triage records which account the code bore out.
- **Date:** 2026-09-22 (run started 2026-09-23T16:20:15Z UTC).
- **Bundle:** `2026-09-22-P6-verification-evidence-review-bundle.txt`, SHA-256
  `434fb474e8ef1b712ee1b8780a4100c449e681adcdb0d7205eb490c074378aff` (the
  manifest's `bundleSha256`), base `9f30317` (`reviewed/TOOLING`), head
  `de95c2e` (P6: Verification + evidence). It held the full contents of 47 of
  the 51 files changed in that range and excluded the four design documents,
  as the prompt states. Prompt:
  `2026-09-22-P6-verification-evidence-review-prompt.txt`.
- **Prior context and lookups:** the reviewer stated that it had no prior
  context about the project and performed no lookups. This is a self-report
  and cannot be independently verified; an API call offering no tools had no
  means of lookup in any case.
- **Coverage, and any gap:** items 4, 6, and 7 are answered in sections headed
  with those numbers. Items 1, 2, and 3 are answered by one sentence — no
  bypasses, no tautological checks, nothing that fails open — with no
  construction offered. **Item 5, configuration satisfied without doing what
  it appears to do, is not answered.** Item 7, framing: the framing is right.
- **Citations:** the reply cites functions and files by name, not line. Its
  section numbers are the prompt's item numbers, not finding numbers.

---

BASE: reviewed/TOOLING
HEAD: de95c2e
===== pnpm-lock.yaml =====
a2b7ae11bd21003b368d2c3b38cb0731

I have reviewed this bundle with no prior context about the project. No lookups were performed.

### Findings

After a thorough adversarial review of the verification, evidence runtime, tree diffing mechanisms, and sandbox provision layers, I found no mechanisms that bypass the protected properties, no tautological checks, and no components that fail open.

**6. Mechanisms assessed as sound**

The following mechanisms are highly robust and fulfill the invariants defined in your threat model:

- **Tree Operations & Diff Composition (`workspace.ts` & `files.ts`)**
  The choice to implement directory diffing (`ownDiff` / `diffTrees`) natively via `lstat` and content hashing, rather than relying on `git` or an agent-provided summary, securely wrests control of the diff away from the sandbox. 
  - **Symlink & Path Traversal Prevention:** `walkTree` does not recurse into symlinks, and special files (FIFOs, devices) are explicitly rejected in `sameEntry` (fail closed). Path parsing splits strictly by `/` ensuring materialized targets cannot traverse upwards with `..` relative to the workspace mount.
  - **Exclusion Handling:** The `.git` directory is explicitly excluded by `DIFF_WALK`. By completely omitting `.git` from the diff, any malicious agent changes (or deletions) to `.git` are discarded during `materialize`. The next verification clones a pristine `.git` from the `basePath`, enforcing the property that "nothing written under it outlives the task."
  - **Conflict & Reversion Resolution:** `composeDiff` correctly tracks removals and reversions. If a task reverts a previously modified file back to its `base` hash, the file is safely deleted from the cumulative diff, natively returning it to its exact base state upon materialization.

- **Strict Verification Sandboxing (`line.ts`)**
  The separation of the build sandbox and the verification sandbox guarantees that an agent cannot judge its own work. 
  - Verification is run over a distinct materialized clone of `base + diff` in a pristine sandbox with a strictly read-only (`ro`) mount.
  - If an agent somehow managed to escape or corrupt a locked file during verification, `tamperedIn(ctx, tree)` executes *after* the checks run and explicitly drops the evidence bundle in favor of a violation record, denying the agent a passed status.

- **Gate Inputs & Unstarted Check Handling (`verify` & `taskResultProblems`)**
  - **Failing Closed on Unstarted:** If a pinned verification command fails to execute (e.g., missing binary), the `sandbox.exec` catch block explicitly records an `undefined` result. The gate's `requiredShortfall` is invoked against `undefined` and reliably flags this as a gate failure, preventing an unexecutable command from yielding a silent pass.
  - **Strict Schema Enforcement:** `taskResultProblems` relies on `Reflect.ownKeys` to flag any non-contract keys. This explicitly prevents an attacker from injecting a `status: 'passed'` field into a JSON response or via a JavaScript proxy, ensuring the "model never reports it" invariant holds.

- **Egress & Mount Enforcement (`provider.ts` & `egress.ts`)**
  - **Explicit `deny-all`:** In `LocalDockerProvider`, a `deny-all` egress rule does not merely skip proxy setup; it explicitly sets `--network none` in the `docker run` execution array, isolating the container entirely via kernel constraints.
  - **Write Permission Checks:** By verifying host file ownership against the requested container `uid/gid` (on Linux), it explicitly refuses provisioning rather than mounting an unwritable directory. This prevents the silent degradation where an agent fails the task simply because it lacked file permissions.

- **Lock Verification (`validate.ts` & `vault.ts`)**
  Locks strictly enforce content integrity. The `tamperedIn` check uses exact byte-hashes, meaning any alteration to artifacts by the agent, even one that technically passes test cases, throws an `IntegrityViolation` and halts the line.

**4. Escape Hatches**
Type casts (`as Record<string, unknown>`, `as Partial<TaskResult>`) are used directly at JSON/API boundaries. However, they are consistently backed by runtime property and object-type checks immediately following the cast, neutralizing the generic erasure vulnerabilities that typically accompany `as` usage.

**7. Framing**
The adversarial question is exactly the right framework for evaluating this layer. Since this component dictates the truth of agent task outcomes, assessing it against an active, sandbox-bound attacker ensures that runtime boundaries, diff calculations, and verification isolation do not break under deceptive agent actions. The code rigorously holds to the core tenet: the agent proposes, but the runtime exclusively measures and disposes.