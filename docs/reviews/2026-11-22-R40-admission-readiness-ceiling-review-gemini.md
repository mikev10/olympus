# External review of R40, gemini, 2026-11-22

The Gemini family's review of R40 (admission enforces the readiness ceiling), as the runner wrote it, below this header. Triage: `2026-11-22-R40-admission-readiness-ceiling-triage.md`.

## Source

- **Reviewer:** gemini-3.1-pro-preview. Family: gemini. A direct `generateContent` API call to `gemini-3.1-pro-preview`, offering no tools; `cleanRoom` is `null` because an API call loads no local configuration. Ingestion 54,907 input tokens against a floor of 39,211; all four markers echoed.
- **Cross-family agreement:** gemini-1 with codex-2 (the base commit read twice); gemini-2 and gemini-3 with codex-1 (no scanner, no enforcement). gemini-4 was raised by gemini alone.
- **Date:** 2026-11-22
- **Bundle:** `2026-11-22-R40-admission-readiness-ceiling-review-bundle.txt`, SHA-256 `770c345227f3584e4cef814fe5e53c0dda7c552a699bde561de493a8feb6b0d4` (the manifest's `bundleSha256`), base `3fde9eb` (`reviewed/R38`), head `7223b34` (the unit branch after its rebase onto R38, before review). Every new file in full and every modified file as a function-context diff; `docs/decisions.md`, `docs/reviews/`, `docs/plan/`, and `pnpm-lock.yaml` excluded by construction. Prompt: `2026-11-22-R40-admission-readiness-ceiling-review-prompt.txt`.
- **Prior context and lookups:** the reviewer said it had no prior context and performed no lookups. A self-report, not independently verifiable.
- **Coverage, and any gap:** items 1, 3, 6, and 7 answered. Item 2 (tautologies) is answered only through gemini-3, which calls the absence assertions tautological in the sense of encoding the behaviour; items 4 (language escape hatches) and 5 (configuration satisfied without effect) came back empty.
- **Citations:** line numbers are positions in the bundle's new side, not the repository, and are treated as hints.

---

BASE: 3fde9eb
HEAD: 7223b34
packages/vault/src/types.ts
e8fbe409eef0f3c601e6a8dd06820310

I have no prior context about this project, and I performed no lookups.

packages/api/src/run.ts:1281 — factually wrong — high — TOCTOU on base commit allows malicious code to execute at an elevated ceiling. At line 1245, `snapshotBase` takes a snapshot of the workspace using `req.baseCommit` (which can be a mutable branch reference like `main`). Later, at line 1281, `readinessAt` is called, which internally (line 1039) resolves `req.baseCommit` again via `resolveCommit`. An attacker who updates the branch pointer immediately after `snapshotBase` finishes but before `resolveCommit` executes causes the runtime to snapshot the older (malicious) commit, while scanning and clearing the ceiling for the newer (benign) commit. The run then executes the malicious code at an elevated autonomy level. — Resolve this by calling `resolveCommit` once at the very beginning of `admitRun`, and passing the resulting immutable commit hash to both `snapshotBase` and `readinessAt`.

packages/api/src/run.ts:718 — factually wrong — high — Omitting the readiness scanner acts as clearance, failing open to allow L3 runs. In `admissionRefusal`, the check `if (readiness?.kind === 'scanned' && level > readiness.level)` uses optional chaining and string equality. If a library caller omits the scanner port (yielding `not-scanned`) or if an older run is resumed (yielding `undefined`), the condition evaluates to `false`. The comparison disappears, and the code falls through to allow the run (line 726). Since a scanned report can never grant L3, providing a scanner strictly limits runs to L2, while omitting the scanner silently elevates the limit to L3. This violates the invariants "a check that did not run is a refusal" and "never an undefined value that disappears in a comparison and reads as clearance." — Resolve this by explicitly returning a refusal in `admissionRefusal` if `requestedLevel > 0` and the readiness record is missing or `not-scanned`.

packages/conformance/src/registry/admission-readiness.ts:68 — factually wrong — medium — Tautological conformance tests enforce the fail-open vulnerability. The `READINESS_ABSENCE_IS_RECORDED` test (line 68) and the `RESUME_HOLDS_THE_RECORDED_CEILING` test (line 126) explicitly assert that a run with a missing or `not-scanned` readiness port is successfully admitted at an elevated autonomy level, rather than being refused. This codifies the bypass into the test suite and directly contradicts the "fail closed" policy. — Resolve this by rewriting the tests to expect a refusal when a run requesting > L0 has no scanner.

packages/api/src/readiness-scan.ts:37 — a tradeoff I would have made differently — medium — Unbounded cache in the scanner leads to a memory leak and DoS. The `reports` Map caches scan results indefinitely by `checkout`, `commit`, and `protectedPaths`. Since the attacker controls the target repository and the `req.baseCommit` in the run request, they can dynamically generate and request scans for thousands of distinct commits. This will cause the Map to grow without bound, exhausting memory and crashing the runtime. — Resolve this by using a bounded LRU cache for the scan reports.

Soundness Assessment:
- The HTTP server's injection of the `readiness` port (`packages/api/src/http/server.ts:371`) is sound. The spread operator (`...request`) is safely overridden by the explicitly declared `readiness: options.readiness ?? null` that follows it, preventing an attacker from passing a malicious or null scanner port via the request body.
- The cache invalidation for branch protection (`packages/api/src/readiness-scan.ts:51`) is sound. The `protectionStands` function securely re-evaluates the branch protection constraint instead of blindly trusting a cached positive result, effectively failing closed (returning `false`) if the protection checker fails or the branch is no longer protected.

Framing Review:
The framing is correct and the adversarial question is the right one to ask. The explicit statement of invariants (such as "Fail closed" and "Its absence must be an explicit state, never an undefined value that disappears in a comparison and reads as clearance") was essential. It highlighted that the `not-scanned` state, despite being explicitly implemented and tested by the author, was actually a critical fail-open vulnerability that subverted the system's security posture.