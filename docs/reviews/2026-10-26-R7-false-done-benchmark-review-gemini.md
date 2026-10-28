# External review of R7, gemini, 2026-10-26

The false-done benchmark (`packages/benchmark`, `corpus/v1`, both tiers' results), reviewed from the bundle alone. Triage: `2026-10-26-R7-false-done-benchmark-triage.md`.

## Source

- **Reviewer:** gemini-3.1-pro-preview. Family: gemini. A direct `generateContent` API call to `gemini-3.1-pro-preview`, offering no tools; `cleanRoom` is `null` because an API call loads no local configuration.
- **Cross-family agreement:** gemini-1 = codex-3 (unreadable dropped from the denominator); gemini-2 = codex-2 (critic unreadable counted as a catch). gemini-3 raised by gemini alone.
- **Date:** 2026-10-26 (run at 2026-10-27T02:26Z)
- **Bundle:** `2026-10-26-R7-false-done-benchmark-review-bundle.txt`, SHA-256 `17bef4bb2a5505d58aa986130a299949cf25caa1fa1d9631af65c1a0dde97407`, base `ed19c31` (`reviewed/R6`), head `cacf9f6` (R7 with the model tier's result committed). It holds 70 files: new files in full, modified files as function-context diffs. Excluded: `docs/decisions.md`, `docs/reviews/`, `docs/plan/`. Prompt: `2026-10-26-R7-false-done-benchmark-review-prompt.txt`.
- **Prior context and lookups:** it disclosed none of either. A self-report, not independently verifiable.
- **Coverage, and any gap:** items 1 and 3 through findings 1–3. Items 2 (tautological checks), 4 (language escape hatches), 5 (configuration), 6 (sound mechanisms) and 7 (framing) came back empty; silence on them is not endorsement.
- **Citations:** line numbers are positions in the bundle's new side, treated as hints and located by construct.

---

I had no prior context about this project and performed no external lookups.

BASE: ed19c31
HEAD: cacf9f6
pnpm-lock.yaml
b0991afc1f5e0f5f338f0c8fd973e1af

Here are the findings, ordered by severity.

### 1. Unreadable verdicts silently exclude items from the sample, inflating published rates
**packages/benchmark/src/result.ts:80**
- **Type:** factually wrong
- **Severity:** high
- **The concrete bypass:** The `rates` function calculates the sample size as exactly `caught + passed`. If a model produces an `unreadable` verdict, that item is simply dropped from the denominator entirely. The invariant strictly states: "Fail closed... an unreadable answer... is never counted as a pass or a catch, and never degrades silently." By selectively outputting unreadable text (e.g., malformed JSON) for items it cannot confidently classify, an adversarial model removes its mistakes from the evaluation. This artificially inflates the published detection rate for seeded items and artificially lowers the published false-refusal rate for clean controls, successfully gaming the benchmark.
- **What would resolve it:** The `sample` size must include all items run for that group/kind. For detection, an `unreadable` answer on a seeded item must penalize the model as a miss (expanding the denominator while adding nothing to the numerator). For false refusal, an unreadable answer on a control must count as a failure (e.g., explicitly treated as a false refusal). 

### 2. An unreadable critic verdict is falsely counted as a successful catch
**packages/benchmark/src/critic.ts:133**
- **Type:** factually wrong
- **Severity:** high
- **The concrete bypass:** In the critic arm, if the model returns findings but they are not readable, the code pushes `critic:unreadable` to the `causes` list. Because the `causes` array length is then greater than zero, the code automatically assigns a `caught` verdict (`causes.length > 0 ? 'caught' : 'passed'`). The invariants demand that an unreadable answer is "never counted as a pass or a catch". Here, it explicitly counts as a catch. An adversarial model acting as a critic can guarantee a 100% detection rate on drafted false-dones simply by outputting unreadable gibberish on every run, earning a perfect score without doing the work.
- **What would resolve it:** Stop coercing unreadable critic outputs into a `caught` verdict. The `CriticOutcome` interface should support an `'unreadable'` verdict, and `throughTheCritic` should explicitly return `'unreadable'` when `verdict.readable` is false, ensuring it receives the fail-closed penalty described in the first finding.

### 3. Scripted seat changes fail to land because of an incorrect `process.argv` index
**packages/benchmark/src/seats.ts:25**
- **Type:** factually wrong
- **Severity:** medium
- **The concrete issue:** The `applyCommand` script reads `JSON.parse(process.argv[1])` to get the change payload. However, when Node.js is executed with the `-e` flag, `process.argv[1]` is hardcoded to the literal string `"[eval]"`. The actual argument provided to the script begins at `process.argv[2]`. When the scripted seat executes, `JSON.parse("[eval]")` will throw a `SyntaxError`, causing the script to exit with a non-zero code. While this safely fails closed (crashing the deterministic tier rather than judging an unchanged tree), it breaks the functionality of the benchmark.
- **What would resolve it:** Change `process.argv[1]` to `process.argv[2]` in the `APPLY` script block.