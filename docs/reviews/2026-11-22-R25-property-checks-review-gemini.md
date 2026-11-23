# External review of R25, gemini, 2026-11-22

This is the Gemini family's review of R25, property checks: the new `property` check kind, the fast-check adapter slot and its preload, admission, the base run and `verify`, the policy field `propertyPerAuthorizationRule`, and corpus v2. It is triaged in `2026-11-22-R25-property-checks-triage.md`.

## Source

- **Reviewer:** gemini-3.1-pro-preview. Family: gemini. A direct `generateContent` API call to `gemini-3.1-pro-preview`, offering no tools. `cleanRoom` is `null`, because an API call loads no local configuration.
- **Cross-family agreement:** gemini-1, with gemini-4 as its tradeoff form, is codex-1. gemini-3 concerns the same function codex-3 does, `propertyBaseCause`, from the opposite direction. Only gemini raised gemini-2.
- **Date:** 2026-11-22
- **Bundle:** `2026-11-22-R25-property-checks-review-bundle.txt`, SHA-256 `0f835f16bc14dffef8402f0ce7ed39e561e38552c19e882f01707f560d451922`. Base `3fde9eb` (`reviewed/R38`), head `34d5616`, the unit branch's tip before the review. It held every new file in full and every modified file as a function-context diff. Excluded: `docs/decisions.md`, `docs/reviews/`, `docs/plan/`, and `pnpm-lock.yaml`. Prompt: `2026-11-22-R25-property-checks-review-prompt.txt`.
- **Prior context and lookups:** the reviewer said it had none and performed no external lookups. That is a self-report, and it cannot be verified independently.
- **Coverage, and any gap:**
  - Items 1, 3, and 5 are answered by gemini-1 to gemini-3.
  - Item 6 is answered in gemini-4.
  - Item 7 is answered: the framing is right.
  - Item 2 (tautological checks) came back empty.
  - Item 4 (language escape hatches) is answered only in passing: "sound against generic erasure and typing bypasses".
- **Citations:** line numbers are positions in the bundle's new-side diffs, not in the repository. Each finding was located by its construct.

I had no prior context about this project and I did not perform any external lookups.

BASE: 3fde9eb
HEAD: 34d5616
packages/vault/test/local.test.ts
e89de9cc65a9dd6fde538eafa334778f

---

packages/adapters/src/property.ts:130 — factually wrong — high — The preload script embeds `config.tag` (which contains the secret random marker), `config.seed`, and `config.numRuns` as a JSON literal into the generated `preload.mjs` source file. Because this file is mounted into the sandbox at `/property-preload/preload.mjs` (readable by the code under test), an adversarial change can intercept test execution (e.g., via vitest configuration or importing a hooked module), read this file to extract the secret marker, parse the locked test files to find `fc.assert` line numbers, and print perfectly forged passing JSON reports to `stdout`, followed by `process.exit(0)`. The runtime will accept these forged reports, completely bypassing the checks. — Resolve this by keeping the marker out of the sandbox's readable filesystem and environment. For example, pass the secret via a dedicated file descriptor or secure out-of-band pipe that the preload script writes to but user code cannot read.

packages/adapters/src/property.ts:137 — factually wrong — high — The preload script explicitly loads `fast-check` from the workspace's `node_modules` directory (`const dir = join(root, 'node_modules', 'fast-check')`). Because the agent controls `package.json` and `package-lock.json`, they can replace `fast-check` with a malicious package (e.g., pulling from a local `file:` path or a spoofed npm package). The runtime installs this lockfile before the checks run. When the preload executes, it calls `configureGlobal` on the malicious `fast-check` package, directly handing it the `config` (including the secret tag). The malicious package can then silently output the required passing reports to `stdout` without running any actual tests. — Resolve this by having the runtime inject its own trusted `fast-check` reporter logic that cannot be intercepted by workspace dependencies, or by cryptographically verifying that the installed `fast-check` matches a known good version.

packages/api/src/property.ts:144 — factually wrong — medium — In `propertyBaseCause`, when a property check declares `onBase: 'fails'`, the function requires that `result.property?.runs.some(r => r.failed)` is true. If the base run throws an error before reaching `fc.assert` (for example, a `Module not found` or `SyntaxError` because the check is drafted for a newly added function that does not exist in the base commit), no runs are reported. Consequently, `failed` is false, and the function returns `'no-result'`. The `test-design` gate treats `'no-result'` as a mismatch and refuses the run. This fail-closed behavior makes it impossible to successfully draft a property check for a new function, as the base run will always be rejected. — Resolve this by treating any non-zero exit code as satisfying `onBase === 'fails'` for property checks, just as it is done for acceptance checks, or specifically handle the case where the test exits with an error before any properties are evaluated.

packages/adapters/src/property.ts:40 — a tradeoff I would have made differently — low — Soundness assessment: The static parser in `FastCheckAdapter.registrations` and the validation of `propertyPerAuthorizationRule` appear sound against generic erasure and typing bypasses. The logic correctly verifies that multiple properties do not share the same line, preventing report spoofing collisions. However, deriving test verification strictly through standard output (`stdout`) interleaved with user-controlled logging is inherently fragile. Even with a random marker, side-channels (like reading the preload configuration or module overriding) break the chain of trust. I would have used an inter-process communication (IPC) channel or a dedicated file descriptor for the reporter to communicate with the runtime.

Framing Assessment: 
The adversarial framing is correct and entirely appropriate for this code. The questions accurately modeled the threat landscape, prompting the discovery of how the verification mechanism can be undermined from within the sandbox through standard Node.js execution hooks. No digression from the framing is needed.