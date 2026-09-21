---
"@olympus-ai/integrity": minor
"@olympus-ai/core": minor
"@olympus-ai/api": minor
---

A-P8-01: `CheckResult` gains a required `expectation: ExpectationOutcome | null`.
A behavioral check's exit code is the product's, which can be 0 while the output
is wrong and non-zero because the scenario expects an error, so when a result
carries an expectation it is the verdict and the exit code is evidence.
`ExpectationOutcome` is `{ held: true }` or `{ held: false, mismatches }` with at
least one mismatch, so the verdict and its evidence cannot disagree.

`FailedCheck.cause` gains `'expectation'`. The verify station's gate moves to
`requiredShortfall` in `packages/api/src/gate.ts`, exported, and fails a
required check whose expectation did not hold whatever its exit code. Every
check the S1 line runs records `expectation: null` and is judged exactly as
before. The review seat's evidence facts carry `expectationHeld` beside each
exit code, so a reviewer is not shown a product's 0 as a pass.
