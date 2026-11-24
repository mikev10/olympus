BASE: a320a01
HEAD: 7b2758f
packages/vault/test/stub.test.ts
c265538f2978a7c06f2a36c835d0a4d4

I have no prior context about this project and performed no external lookups.

### 1. Denominator Disappearance via Unlocated/Unreadable Findings
**packages/api/src/findings.ts:164** — factually wrong — high
**packages/api/src/findings.ts:171** — factually wrong — high
**packages/api/src/findings.ts:183** — factually wrong — high
**packages/api/src/findings.ts:104** — factually wrong — high

**The concrete bypass:** The invariants state that an unreadable or unlocatable finding must never be read as "no findings," to prevent an adversarial model from improving its success rate by ignoring instructions. However, when deriving finding rates, the `raisedFindings` function explicitly skips any finding where `f.kind !== 'located'` (or `f.kind === 'refused'`). Because these refused findings are not yielded, they disappear entirely from the array length that forms the denominator in `findingRates`. A model can artificially drop its finding rate to 0 by intentionally outputting invalid paths, out-of-bound lines, or schema-breaking fields. 
Furthermore, for code reviews, if the model returns unreadable JSON, `readSeatFindings` at line 104 returns an empty `findings: []` array. This causes zero findings to be stored, meaning zero findings are later processed, perfectly dropping the denominator.

**What would resolve it:** 
1. In `raisedFindings`, yield `refused` findings so they are counted in the denominator as `raised` but remain permanently `open`. 
2. In `readSeatFindings`, when `!read.readable` is true, return a dummy finding (e.g., `{ kind: 'refused', cause: 'unreadable' }`) instead of an empty array so the unreadable result is tracked and counted.

### 2. Code Finding Resolution via Broad Hunks
**packages/api/src/findings.ts:236** — logic bug — high

**The concrete bypass:** `resolveCodeFindings` marks a finding as resolved if its mapped line falls within a modified `hunk` and the coverage report indicates at least one `executed` line exists anywhere within that hunk's boundaries (`hunk.newStart` to `end`). An adversarial builder can bypass addressing the specific cited problem by superficially rewriting the entire file (e.g., modifying whitespace or replacing everything to force `git diff -U0` to produce a single massive hunk that spans from line 1 to EOF). As long as *any* single line in the file executes (e.g., an import statement), `executed.length > 0` evaluates to true. The finding is incorrectly recorded as resolved, despite the actual cited line remaining unchanged and unexercised.

**What would resolve it:** Require that the specifically mapped `line` itself is present in the `executed` array, rather than accepting any executed line within the broad bounds of the surrounding hunk.

### 3. `line: 0` causes an unhandled Vault rejection and pipeline crash
**packages/api/src/findings.ts:51** — logic bug / fails open — medium

**The concrete bypass:** The `CHAR_CLASSES.decimal` regex permits the string `'0'`, which `seatFields` parses as `line: 0`. During validation, `readSeatFindings` correctly asserts that the line does not exceed `lineCount(text)` but fails to check if it is `< 1`. Thus, it considers line 0 valid and returns `{ kind: 'located', line: 0 }`. However, when this payload reaches the Vault, `reviewFindingsProblem` correctly asserts `(f.line as number) < 1` and rejects the payload with an `Error`. Because this validation failure throws an exception inside the runtime loop (during `vault.recordReviewFindings`), it causes an unhandled rejection that crashes the task execution instead of cleanly returning a refusal or a `refused` finding.

**What would resolve it:** Update `seatFields` or `readSeatFindings` to explicitly enforce `line >= 1`, ensuring that line 0 is properly returned as `{ kind: 'refused', cause: 'unlocated' }` without crashing the downstream Vault layer.