# External review of P1, 2026-09-10

The verbatim findings of an external adversarial review of the Vault
(`packages/vault/src/local/vault.ts`, its package tests, and the P1
conformance additions). The triage, with what was and was not acted on and
why, is the companion file `2026-09-10-P1-vault-adversarial-triage.md`.

## Source

- **Reviewer:** Gemini 3.1 Pro, Extended Thinking. Family: Google Gemini.
  Temporary chat, no repository access; worked from the review bundle alone.
- **Family rotation:** ChatGPT reviewed F3 and S1, so this is the first
  Gemini review. Rotating matters because two runs of one family return
  correlated findings, which reads as consensus while being one opinion
  sampled twice.
- **Date:** 2026-09-10.
- **Bundle:** base `6193a4a` (`reviewed/S1`), head `db9adab` (the tip of
  `unit/p1` at the time). The bundle held the full contents of every tracked
  file changed in that range, with `docs/plan/`, `docs/decisions.md`, and
  `docs/reviews/` excluded. It also carried the three S1 contract amendments
  (A-S1-01, A-S1-02, A-S1-03), which fall in that range and were in scope.
- **Prior context and lookups:** the reviewer stated at the top that it held
  no prior memory or context about the project and performed no external
  lookups. Recorded as disclosed. It is a self-report and is not
  independently verifiable.
- **Coverage, and one gap:** the prompt asked for seven things. The reviewer
  answered items 1, 4, and 6 substantively and returned nothing under item 2
  (tautological checks), item 3 (failing open), item 5 (configuration
  satisfied without doing what it appears to do), or item 7 (whether the
  adversarial framing was the right one). Silence on those is recorded here
  so it is not later mistaken for a clean bill on them.
- **Citations:** the findings cite file and line against the bundle. Line
  numbers were treated as hints during triage, not citations, and every
  finding was verified against the code at the cited construct.

## Review, verbatim

I performed this review in a clean-room context with no prior memory, context, or external lookups regarding this project or its authors. I analyzed the provided diff bundle strictly against the stated invariants.

Here are the concrete findings regarding the persistence layer, ordered by severity.

### 1. `hashArtifact` Unhandled Exceptions Bypass Violation Recording

- **Location:** `packages/vault/src/local/vault.ts:123` and `131` (inside `hashArtifact`)

- **Type:** A tradeoff I would have made differently
- **Severity:** **High**
- **Issue:** `isAbsent` accurately catches `ENOENT` and `ENOTDIR` to return the `MISSING` sentinel. However, if an agent replaces a locked artifact with a directory (yielding `EISDIR` when read), a symlink loop (yielding `ELOOP` when resolved), or removes read permissions (yielding `EACCES`), these system errors bypass the `isAbsent` check and propagate upwards as unhandled exceptions. Because `api/src/line.ts` calls `vault.verifyLocks()` without wrapping it in a try/catch, the pipeline crashes immediately.
  While this does not yield a "pass", it strictly violates **I3**, which requires that a mismatch generates a recorded `IntegrityViolation` and commits a failed task state. By crashing the line, the agent fails the run without leaving the required audit trail of a tamper.

- **Resolution:** Expand `isAbsent` to treat `EISDIR`, `ELOOP`, and `EACCES` as missing/tampered files so the sentinel is returned. Alternatively, wrap `vault.verifyLocks()` in the API line to catch unhandled Vault exceptions and convert them into a standard `lock-tamper` refusal.

### 2. Language Escape Hatches in Record Hydration

- **Location:** `packages/vault/src/local/vault.ts:153` (`requireRunState`) and `161` (`requireManifest`)

- **Type:** Factually wrong
- **Severity:** **Medium**
- **Issue:** The structural validation for records read from disk relies on unsafe TypeScript casts (`as RunState` and `as LockManifest`) after incomplete checks. `requireRunState` validates string properties and the `tasks` object, but completely omits checking for the presence or array-type of `evidenceRefs` and `violations`. `requireManifest` similarly omits checking inner elements for the required `LockEntry` properties.
  If an older, partial, or manipulated JSON record is read from disk, TypeScript will blindly trust the shape. When `api/src/line.ts` later spreads these assumed arrays (e.g., `[...state.evidenceRefs]`), it will throw a `TypeError: is not iterable`, crashing the state machine rather than cleanly refusing a partial/corrupt record at the boundary.

- **Resolution:** Enforce the full boundary using `Array.isArray()` for `evidenceRefs` and `violations` in `requireRunState`, and similarly validate `runId` and array element shapes in `requireManifest` before returning the casted type.

### 3. TOCTOU Window During Hash Resolution

- **Location:** `packages/vault/src/local/vault.ts:120` to `128`

- **Type:** A tradeoff I would have made differently
- **Severity:** **Low**
- **Issue:** There is a microscopic Time-Of-Check to Time-Of-Use (TOCTOU) gap in `hashArtifact`. It calls `real = await realpath(target);` and evaluates `contains(root, real)`. If an agent swaps the file at `real` for a symlink pointing outside the workspace _after_ `realpath` but _before_ `readFile(real)`, `readFile` will follow the new symlink.
  _Why it is low severity:_ To actually pass the gate and subvert **I3**, the external file read via this TOCTOU must strictly hash to the exact SHA-256 of the originally locked artifact. If the agent can source an external file matching that exact hash, they already know its content and could just write it safely into the workspace anyway, meaning no true privilege escalation occurs.

- **Resolution:** Open a file descriptor to the resolved path first, verify the file descriptor's path using `fs.promises.realpath(fd)` (or `fstat` checks), and then read from the descriptor directly, eliminating the path-based race condition.

---

### Additional Mechanisms Assessed as Sound

- **Concurrent Run State Validation (`I5` / CAS enforcement):** The compare-and-swap mechanism in `commitRunState` via the `wx` filesystem flag (`createExclusive`) is exceptionally sound. By defining dense, strictly incrementing versions (`next = String(current + 1)`) and refusing to write unless `held < current`, the implementation mathematically ensures any stale commit will encounter `EEXIST` at the filesystem layer. It is immune to read-then-write race conditions.

- **Vault Object Immutability:** Storing `EvidenceBundle` and `IntegrityViolation` objects under their exact SHA-256 digest is airtight. Attempting to overwrite an object fails harmlessly with `EEXIST` while returning the correct ref, guaranteeing that content-addressed records cannot be spoofed or mutated.

- **Symlink/Junction Escape Constraints (`I3`):** The logic combining `resolve` and `realpath` cleanly normalizes symlink escapes on all operating systems. The `ESCAPED` sentinel elegantly maps escapes to a tamper mismatch rather than an application crash.
