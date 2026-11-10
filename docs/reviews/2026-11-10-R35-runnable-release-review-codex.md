# External review of R35, codex, 2026-11-10

The review of R35, the runnable release and first-run docs, by the codex family. Triage: `2026-11-10-R35-runnable-release-triage.md`.

## Source

- **Reviewer:** gpt-6-astra. Family: codex.
  A headless `codex exec` run under a read-only sandbox, with recorded approval policy `never`, in an empty scratch working directory and a scratch config home holding only `auth.json`, with an environment of `CODEX_HOME` alone. The pre-run listing of both is the manifest's `cleanRoom`.
- **Cross-family agreement:** codex-2, codex-4, codex-7, and codex-8 were raised by gemini too (gemini-4, gemini-1, gemini-3, gemini-2). codex-1, codex-3, codex-5, codex-6, and codex-9 were raised by codex alone.
- **Date:** 2026-11-10
- **Bundle:** `2026-11-10-R35-runnable-release-review-bundle.txt`, SHA-256 `403fcc2bec86d0b5a3f6152f69901b57e6a9d2cf882d85f3a176d973f30a55a7`, base `49ae3fe` (`reviewed/R16`), head `31da607` (the R35 unit branch as shipped in PR #130). Every new file in full and every modified file as a function-context diff; `docs/decisions.md`, `docs/reviews/`, `docs/plan/`, and `pnpm-lock.yaml` excluded. Prompt: `2026-11-10-R35-runnable-release-review-prompt.txt`.
- **Prior context and lookups:** Says it had no prior project context and performed no external lookups, that local execution was blocked, and that it did not verify the bundle hash. A self-report, not independently verifiable.
- **Coverage, and any gap:** Items 1 to 7 all answered: concrete constructions (1, 3, 5), no unconditional tautology found (2), language escape hatches assessed (4), sound mechanisms named (6), and the framing judged appropriate with runtime attacks and assertion mutations kept distinct, naming omitted code it could not assess (7).
- **Citations:** line numbers refer to positions in the bundle's new side, not the repository; treated as hints and located by construct.

---

BASE: 49ae3fe  
HEAD: 31da607  
tsconfig.build.json  
110699b23c3d85f32c76c77f97af8f9a

I had no prior project context and performed no external lookups. I reviewed the complete inline bundle. Local execution was blocked, so these are source findings, not reproduced test results; I did not independently verify the file’s SHA-256.

1. **`scripts/local-release.ts:43` — factually wrong — medium — JSON quoting is not shell escaping.**  
   `JSON.stringify()` leaves `$()` and backticks active inside double quotes on a POSIX shell. For example, a literal target argument `'/tmp/release-$(touch /tmp/release-marker)'` reaches `pnpm pack --pack-destination` through `shell: true`, executing the substitution. An ordinary path containing `$HOME` can also be changed unexpectedly. This affects the release-script caller; it is not an HTTP exploit.

   **Resolve:** spawn commands with argument arrays without a shell on POSIX; handle Windows command shims with platform-appropriate escaping.

2. **`packages/conformance/src/registry/release.ts:129` — factually wrong — medium — the release assertion does not execute the installed commands.**  
   Both executables are launched as `node <manifest-target>`; the CLI helper does the same at line 133. Consequently, changing installation to `npm install --no-bin-links` leaves this assertion passing while the documented `PATH=.../node_modules/.bin` installation provides neither command. Checking the target’s shebang does not exercise npm’s executable links or permissions.

   **Resolve:** launch the installed `.bin/factory-host` and `.bin/olympus-ai` commands using the platform’s normal command mechanism.

3. **`packages/api/src/host/main.ts:43` — factually wrong — medium — the tests do not establish that startup enforces the symlink probe.**  
   Remove the call and its result handling at lines 43–44. The standalone probe tests still exercise the helper, while the packaged-host assertion still succeeds on a filesystem supporting symlinks. The host can consequently listen on an unsupported filesystem without these checks detecting the deletion.

   This is a concrete mutation that defeats the claimed assertion coverage, not a bypass of the current probe implementation.

   **Resolve:** exercise the executable under a condition where link creation fails and require refusal before listening. Keep the successful-start case as well.

4. **`packages/cli/test/version.test.ts:22` — factually wrong — medium — prose can satisfy the pending-major check.**  
   The regex can cross the closing frontmatter delimiter and match a package name in the body. This file passes its filter without declaring the CLI’s major bump:

   ```markdown
   ---
   "@olympus-ai/core": patch
   ---
   Example only: "olympus-ai": major
   ---
   ```

   Additionally, `localRelease()` never consumes changesets: the shown CLI manifest is still `4.5.16`, so the local installation itself retains that version. A pending changeset proves future intent, not the installed version.

   **Resolve:** parse changeset frontmatter structurally. If the assertion means the produced release must be version 5+, inspect the packed manifest after version preparation.

5. **`packages/api/src/host/main.ts:31` — factually wrong — medium — startup does not report every configuration problem together.**  
   Set a required variable to empty and name an unreadable endpoint file. `readHostConfig()` causes an immediate refusal before the endpoint read or symlink probe. After fixing the first problem, another startup discovers the next. Similarly, a short nonempty API token survives `readHostConfig()` and is rejected later by server construction.

   This remains fail-closed, but contradicts the advertised single-list behavior.

   **Resolve:** collect independently discoverable environment, file, token, and filesystem errors before the final refusal. Explicitly distinguish checks that cannot run because prerequisite settings are missing.

6. **`packages/cli/test/help.test.ts:52` — factually wrong — medium — “accepts exactly the flags” does not establish that accepted flags work.**  
   Remove `multiple: true` from the `spec` table entry. The parser now produces a string, while `strs(values, 'spec')` returns `undefined`; a valid `create --spec spec.md ...` sends an empty spec list. The help tests still agree with the table, and the acceptance test passes because it only excludes an “Unknown option” message. Most individual flag invocations lack the other required create arguments anyway.

   Deleting a flag from the table also deletes its generated test case.

   **Resolve:** retain independent command-contract cases and assert the HTTP payload for complete valid invocations, including repeated flags. Shared help generation is useful, but cannot independently specify supported behavior.

7. **`packages/api/test/examples.test.ts:80` — factually wrong — medium — the above-cap test accepts unrelated failures.**  
   Any response other than 201 passes, including an internal error. The request also supplies `approvedCostUsd: 100`, whereas the successful tests first obtain and approve the exact cost. A cost refusal can therefore satisfy this test without demonstrating enforcement of the example’s autonomy cap. Other role or trigger ceilings can mask removal of `globalCap` enforcement too.

   **Resolve:** assert the specific cap-refusal reason and construct the request so cost and other independent restrictions do not explain its rejection.

8. **`packages/api/test/host-config.test.ts:40` — factually wrong — low — the README test checks neither the secret column nor the position of the required value.**  
   It only searches the entire row for `| yes |` or `| no |`. A required non-secret variable incorrectly documented as optional and secret still contains `| yes |` and passes. A secret flag can be changed without affecting the test at all.

   **Resolve:** parse the table columns and compare both `required` and `secret` independently.

9. **`scripts/local-release.ts:74` — factually wrong — low — the generated package name violates the stated naming exemption.**  
   `olympus-local-release` embeds the mythological name outside the permitted npm scope and exact CLI executable name.

   **Resolve:** use a neutral generated name, such as `factory-local-release`, and include generated configuration literals in the naming assertion.

The mechanisms I assess as sound within the shown implementation are:

- **Webhook-name restriction:** `packages/api/src/host/config.ts:145` checks the prefix and requires a nonempty suffix before reading the environment. Naming `ANTHROPIC_API_KEY` as a webhook secret does not read it. I found no demonstrated alternate-name bypass.
- **Symlink helper:** `packages/api/src/host/symlinks.ts:20` creates a real link and verifies it with `readlink`. A regular file cannot satisfy that check. Cleanup failure rejects rather than returns success, although it bypasses the intended formatted refusal.
- **Readiness failure handling:** the route authenticates before scanning, resolves before opening the stream, refuses an absent scanner, and emits `failed` on a thrown scan error. The CLI normally treats an ended stream without a report as failure.
- **Branch-protection response validation:** `packages/api/src/readiness-scan.ts:78` rejects unsuccessful responses and requires an actual boolean `protected` value. Its cast does not replace the runtime check.
- **Example admission coverage:** the two positive example tests genuinely require cost refusal followed by successful admission. That supports the limited claim that the files admit runs; it does not establish successful execution of the example.

I found no strictly unconditional tautology. The weaknesses are narrower: shared-oracle tests, disappearing test cases, and assertions that accept failure for the wrong reason.

The `as unknown as ReadinessReport` fixture bypasses type checking, but the scanner is explicitly a trusted test stand-in. Likewise, CLI casts do not themselves bypass server validation. I found no demonstrated exploit through declaration merging, module augmentation, generic erasure, or the shown string type predicate under your threat model.

The adversarial framing is appropriate, provided **runtime attacks and assertion mutations remain distinct**. I cannot establish a current secret-disclosure or revision-injection exploit from this bundle: `resolveCommit`, `scan`, `parseEndpointFile`, and relevant composition and scheduling implementations are omitted. Their absence is a review limitation, not evidence of a vulnerability. The next questions are whether revision resolution is option-safe and commit-only, whether scanning contains repository-controlled links and commands, and whether invalid policy causes startup refusal rather than merely disabling scheduling.