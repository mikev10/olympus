# External review of R15's review fixes, gemini, 2026-10-12

An adversarial review of the R15 review fixes: suite checks that run the base's
own test framework over the tests they name (D-R15-04), the `node_modules`
filter on what a task's diff carries into `verify` (D-R15-05), and the stricter
base-record reader (D-R15-06). One of two reviews run from the same prompt and
bundle; the other is `2026-10-12-R15-base-run-fixes-review-codex.md`. Both are
triaged in `2026-10-12-R15-base-run-fixes-triage.md`, which cites this review's
two findings, in the order given, as `gemini-1` and `gemini-2`.

## Source

- **Reviewer:** gemini-3.1-pro-preview. Family: gemini.
  A direct `generateContent` API call to `gemini-3.1-pro-preview`, offering no
  tools; `cleanRoom` is `null` because an API call loads no local
  configuration. Exit 0, not timed out, 237.3 s. Ingestion `complete`: 56,844
  prompt tokens against a floor of 39,430. Integrity `verified`. Outcome
  `counted`. Reply SHA-256 as the runner wrote it:
  `4d1ad3946745e18efd219d4de8dcaa3b2b21181366b2ccf4dfa858e676de443e`, which
  matched the manifest's `replySha256` before this header was prepended.
- **Cross-family agreement:** none. gemini-2 and codex-2 both defeat the
  `node_modules` carry filter, by different mechanisms; gemini-1 and codex-1
  both concern a suite count that does not evidence execution, by different
  mechanisms. Neither pair is the same defect.
- **Date:** 2026-10-12 (run started 2026-10-12T22:22Z).
- **Bundle:** `2026-10-12-R15-base-run-fixes-review-bundle.txt`, SHA-256
  `31e6c759093ed7fc652f6acafdf4d5f7b134a8f17d09f766334c7ecde01370d5`, base
  `2dcd5d2` ("R15: triage of the external reviews", untagged), head `94fe9c3`
  ("R15: name the dependency-install issue (#40)"). The range is two commits.
  It held 29 of the 32 changed paths in full or as whole-function diffs; the
  three documentation paths (`docs/decisions.md`, `docs/plan/DECOMPOSITION.md`,
  and the earlier triage) were excluded, and so was every unchanged file.
  Prompt: `2026-10-12-R15-base-run-fixes-review-prompt.txt`.
- **Prior context and lookups:** the reviewer stated it had no prior project
  context and performed no lookups. A self-report; not independently
  verifiable.
- **Coverage, and any gap:** items 1 and 3 were answered (both findings; the
  first is framed as failing open). Items 2, 4, 5, 6 and 7 came back empty: no
  tautology, no language escape hatch, no configuration finding, no mechanism
  assessed as sound, and no view on whether the framing was right. Silence on
  those items is not an endorsement.
- **Citations:** line numbers are positions on the new side of the bundle's
  diffs, not repository lines. Treat them as hints; the triage locates each
  construct by name.

---

BASE: 2dcd5d2
HEAD: 94fe9c3
packages/vault/test/stub.test.ts
7b87d325a1f3b0b1d319880a7755e912

I have no prior context about this project other than the prompt, and I performed no external lookups. 

### Findings

packages/api/src/verification.ts:161 — factually wrong — high — At verify time, `suitesRun` silently drops any extra suites selected by the test runner instead of failing the check. Because Vitest treats test paths as substring filters rather than exact paths, an agent can add a malicious file matching the required test's substring (e.g., adding `src/a.test.ts.malicious.ts` when a check requires `src/a.test.ts`). At verify time, Vitest will load and run both files, allowing the malicious test to dictate the runner's exit code (e.g., by intercepting test results or forcefully calling `process.exit(0)` to report a pass). `suitesRun` filters the test runner's selected suites down to just the named tests (`.filter((suite) => named.has(suite)).length`), successfully returning the required count and causing the gate to pass. This fails open and violates the property that the runtime records exactly what the runner was made to load. — Resolve this by verifying that the `selected` suites list contains exactly the `named` tests and no more (e.g., failing if `extra.length > 0`), enforcing the strict exact-match validation at verify time just as `suiteBindingProblems` does during admission.

packages/api/src/workspace.ts:209 — factually wrong — high — The `inDependencyTree` function uses an exact case-sensitive string match for the `node_modules` directory (`path.split('/').includes('node_modules')`). On a case-insensitive file system (such as Windows or macOS default), an agent can rename `node_modules` to `Node_Modules` and modify the installed test framework's runner within it. The `ownDiff` function will record the tampered files under `Node_Modules/`, which circumvents the `inDependencyTree` filter and carries them into the verified tree. When the runner command is executed targeting `node_modules/vitest/vitest.mjs`, the host file system natively resolves it to the tampered files residing in `Node_Modules`. This completely bypasses the protections introduced in D-R15-05, allowing the change to overwrite and replace its own judge. — Resolve this by normalizing the path segments to lower case before checking for the dependency tree (e.g., `path.toLowerCase().split('/').includes('node_modules')`).