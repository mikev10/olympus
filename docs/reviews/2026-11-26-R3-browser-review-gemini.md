# External review of R3, gemini, 2026-11-26

A review of R3, the browser behavioral adapter and the browser it observes through, by one of two independent families. Its one finding is verified and decided in `2026-11-26-R3-browser-triage.md`.

## Source

- **Reviewer:** gemini-3.1-pro-preview. Family: gemini. A direct `generateContent` API call to `gemini-3.1-pro-preview`, offering no tools. `cleanRoom` is `null` because an API call loads no local configuration.
- **Cross-family agreement:** none. Its one finding (gemini-1) was raised by this family alone, and it raised none of Codex's four.
- **Date:** 2026-11-26
- **Bundle:** `2026-11-26-R3-browser-review-bundle.txt`, SHA-256 `52be323423fb2f77666760e9fb2446bffc55c75fdab441de62381c9fa3b72aa1`, base `e3e851c` (`reviewed/R58`), head `43703db` (the unit's one commit, before any review fix). It held every new file in full and every modified file as a function-context diff, 20 sections. Excluded by construction: `docs/decisions.md`, `docs/reviews/`, `docs/plan/`, and `pnpm-lock.yaml`. Prompt: `2026-11-26-R3-browser-review-prompt.txt`.
- **Prior context and lookups:** the reviewer stated it set aside any prior context and performed no external lookups. A self-report, not independently verifiable.
- **Coverage, and any gap:** items 2, 6, and 7 answered. Items 1, 3, 4, and 5 came back empty: no bypass construction, nothing on failing open, nothing on language escape hatches, nothing on configuration. That silence is recorded and is not read as clearance; Codex found three constructions under item 1 that this review did not.
- **Citations:** line numbers refer to positions in the bundle and were treated as hints. The finding was located by the construct it describes.

---

BASE: reviewed/R58
HEAD: 43703db
packages/sandbox/test/browse.test.ts
4562ea68573c3a315170ffa6daf7a308

I set aside any prior context and performed no external lookups during this review.

### 6. Assessment of Mechanisms
The mechanisms presented in this bundle are exceptionally sound. The security model anticipates the core threat: that a product under test will attempt to subvert the test execution rather than pass it legitimately. 
- **Isolation:** Running the browser in an independent, read-only, capability-dropped container (`--network container:<sandbox>`) restricts the product to network-only interaction, preventing direct filesystem or process manipulation.
- **Traffic Enforcement:** The in-container proxy listener safely captures all non-loopback requests, ensuring the "default deny" rule and accurate reporting of external dependencies against the `mayBlock` list.
- **DOM Inspection:** Querying the DOM via CDP into a dedicated isolated world (`worldName: 'browse'`) neutralizes JavaScript prototype pollution, getter overrides, and other main-world manipulations the product might otherwise use to forge visibility or content.
- **Fail-Closed Validation:** Shifting the comparison to a pure function on the host (`compareBrowser`), paired with strict JSON shape validation (`readBrowseOutput`), guarantees that any tampering, crashing, or hanging inside the browser container yields a rejected promise, a timeout, or an explicit mismatch, thereby failing closed.

### 2. Tautological Checks

packages/adapters/src/browser.ts:167 — a tradeoff I would have made differently — low
The check `if (observed.observations.length > expected.observations.length)` will never evaluate to true dynamically. The parser `readBrowserScenario` (line 122) strictly enforces that `expected.observations.length` equals the exact count of `observe` steps in the input. Simultaneously, `readBrowseOutput` in the sandbox provider (`packages/sandbox/src/local/browse.ts:155`) enforces that `observed.observations.length` also exactly matches the count of `observe` steps. Because both arrays are forced to identically match the number of `observe` steps before `compareBrowser` is ever invoked, their lengths are guaranteed to be equal. 
**Resolution:** While technically unreachable in the runtime path, because `compareBrowser` is explicitly designed as a pure, standalone function, this acts as a defense-in-depth guard for tests or future callers that construct `BrowseResult` objects manually. It is safe to retain.

### 7. Framing
The adversarial framing is precisely the right question for this code. By assuming the product will take the path of least resistance to manipulate the test outcome, the invariants correctly govern the required isolation (e.g., placing the browser out of reach and maintaining strict control over the result evaluation). The code successfully and robustly aligns with this threat model.