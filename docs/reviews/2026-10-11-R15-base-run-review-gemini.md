# External review of R15, gemini, 2026-10-11

An adversarial pre-merge review of R15 (acceptance checks run on the base
before build): the base run and the `test-design` exit in `line.ts`, the
refusal rule in `base.ts`, the `onBase` declarations in `parseManifest`, the
write-once base record in both vaults, the fixtures, and the conformance
entries that state those properties. One of two reviews run from the same
prompt and bundle; the other is `2026-10-11-R15-base-run-review-codex.md`.
Both are triaged in `2026-10-11-R15-base-run-triage.md`, which cites this
review's findings as `gemini-1` to `gemini-6`, as the reply numbers them; its
seventh section lists sound mechanisms and is not a finding.

## Source

- **Reviewer:** gemini-3.1-pro-preview. Family: gemini.
  A direct `generateContent` API call to `gemini-3.1-pro-preview`, offering no
  tools; `cleanRoom` is `null` because an API call loads no local
  configuration. Exit 0, not timed out, 577.0 s. Ingestion `complete`: 75,264
  prompt tokens against a floor of 52,399. Integrity `verified`: the reply
  echoes every required bundle marker. Outcome `counted`. Reply SHA-256 as the
  runner wrote it:
  `fb322887da5da147d62a887e9081ef62c94632a12611462148d11508ecfd5c7b`, which
  matched the manifest's `replySha256` before this header was prepended.
- **Cross-family agreement:** gemini-4 (a built-up file name escapes
  protected-path analysis) uses the same construction as codex-1, which codex
  raised for a different consequence. gemini-1 (an exit code is not proof a test
  ran for the right reason) is close to codex's closing remark on item 7.
  gemini-2, gemini-3, gemini-5 and gemini-6 were raised by gemini alone.
- **Date:** 2026-10-11 (run started 2026-10-12T11:30Z).
- **Bundle:** `2026-10-11-R15-base-run-review-bundle.txt`, SHA-256
  `12ac8e51720e701a0f2d53b4b83faf953ac013ee7deff49d7bb2a5b9ad48e248`, base
  `2dc1f11` (`reviewed/R2`), head `3f61372` ("R15: Acceptance checks run on the
  base before build"). The range is that one commit. It held the full contents
  or whole-function diffs of 33 of the 35 changed paths; the two documentation
  paths (`docs/decisions.md`, `docs/plan/DECOMPOSITION.md`) were excluded, and
  so was every unchanged file. Prompt: `2026-10-11-R15-base-run-review-prompt.txt`.
- **Prior context and lookups:** the reviewer said it had no prior context and
  performed no lookups. A self-report, not independently verifiable.
- **Coverage, and any gap:** every numbered item was answered: 7 (gemini-1),
  3 (gemini-2), 5 (gemini-3), 2 (gemini-4), 4 (gemini-5, gemini-6), 6 (its
  seventh section), and 1 through gemini-2 to gemini-4.
- **Citations:** line numbers are positions in the bundle's new-side hunks,
  not in the repository, and are treated as hints. Each was re-located at the
  cited construct during triage.

---

BASE: 2dc1f11
HEAD: 3f61372
packages/vault/test/stub.test.ts
8d11971995a02b4729e7215edb0eae95

I have no prior context about this project and performed no lookups.

**1. Framing and the Adversarial Question**
packages/api/src/base.ts:36 — factually wrong — high — The adversarial question ("How would I get a change accepted at `verify` while the run never showed, from records the runtime made, that a required check failed on the base and passes after the change?") is the wrong question for this code. The runtime's records *will always show* that the check failed on the base and passed after the change, because the runtime strictly enforces exit codes. The actual vulnerability is that the runtime cannot distinguish a semantic test failure from a missing file. The right question to ask is: "How can an agent bypass the semantic intent of the acceptance gate, given that the runtime strictly verifies exit codes to produce those records?"

**2. Missing Files Yielding a Pass (Fail Open)**
packages/api/src/line.ts:377 — factually wrong — high — A missing file yields a pass for the `onBase: 'fails'` requirement. Because `runOnBase` copies only the base tree without applying the diff that contains the newly submitted acceptance tests, any test script submitted in the PR will be missing on the base. Executing it (e.g., `node new_test.js`) yields a non-zero exit code due to "file not found". `baseMismatches` interprets this non-zero exit code as a successful demonstration that the defect exists. In `verify`, the diff is applied, the script exists, and it trivially exits 0. The mechanism succeeds while the property it protects (that the change fixed a defect) is violated.
*Resolve by:* Distinguishing execution errors (like command/file not found) from test assertion failures, or by applying the test files (but not the product changes) to the base tree before running the base checks.

**3. Configuration Satisfied Without Testing the Code**
packages/api/src/line.ts:1062 — factually wrong — high — A behavioral check that runs a workspace script (e.g., `["npm", "run", "test:behavioral"]`) can be bypassed by modifying the un-locked configuration. The PR diff can modify `package.json` to change the `test:behavioral` script to `exit 0`. The check fails on the base (using the original script) and passes in `verify` (using the modified script) without the agent fixing any code.
*Resolve by:* Locking configuration files that behavioral checks rely on, or restricting behavioral checks from relying on mutable workspace configurations.

**4. Tautological Checks Evading Protected Paths**
packages/api/test/harness.ts:74 — factually wrong — medium — A check can be made tautological and evade protected-path escalation by dynamically building filenames. If a check command uses `['my', 'bypass.txt'].join('')`, `analyzeTamper`'s static analysis of the command string will not flag `mybypass.txt` as a protected path. The diff can then add `mybypass.txt` to satisfy the check in `verify` after it failed on the base, completely bypassing the code under test.
*Resolve by:* Observing actual filesystem reads/writes during the sandbox execution rather than relying on static analysis of the command arguments.

**5. Language-Specific Escape Hatch: Type Cast**
packages/api/src/validate.ts:184 — a tradeoff I would have made differently — medium — The function uses a type cast (`value.checks as CheckSpec[]`) to return the parsed manifest. This bypasses TypeScript's structural typing, allowing unvalidated, unexpected properties in the JSON to persist in the `checks` array throughout the runtime, which could be exploited if downstream logic inspects them.
*Resolve by:* Explicitly constructing and returning new `CheckSpec` objects containing only the validated properties.

**6. Language-Specific Escape Hatch: Type Predicate**
packages/api/src/base.ts:14 — a tradeoff I would have made differently — low — The type predicate `check is DeclaredCheckSpec` narrows the type based solely on `check.onBase !== undefined`. While current upstream validation prevents `OtherCheckSpec` from having `onBase` defined, this predicate would silently fail to catch bugs if validation logic changes, incorrectly casting a unit check to an acceptance/behavioral check.
*Resolve by:* Including `check.kind === 'acceptance' || check.kind === 'behavioral'` in the predicate's condition.

**7. Sound Mechanisms**
packages/vault/src/local/vault.ts:424 — The `Vault.recordBaseRun` mechanism is sound. It uses an exclusive file creation (`wx` flag equivalent) to ensure the base record is written exactly once per run, preventing an adversary from overwriting the record with favorable results.
packages/api/src/line.ts:1010 — The sandbox isolation in `verify` is sound. Each check is provisioned in a fresh sandbox and destroyed immediately after, effectively preventing cross-test contamination or state leakage.