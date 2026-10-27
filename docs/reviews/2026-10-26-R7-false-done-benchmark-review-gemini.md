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