# External review of R59, gemini, 2026-11-27

An external review of R59 (token efficiency in the report, and tokens held to
a baseline in the benchmark), as the runner wrote it. What was done about each
finding is in `2026-11-27-R59-token-efficiency-triage.md`.

## Source

- **Reviewer:** gemini-3.1-pro-preview. Family: gemini.
  A direct `generateContent` API call to `gemini-3.1-pro-preview`, offering no
  tools. `cleanRoom` is `null` because an API call loads no local
  configuration.
- **Cross-family agreement:** none. This review raised two findings
  (gemini-1, gemini-2) and Codex raised neither. Codex's three findings are
  in `tokens.ts` and the benchmark's tests; this review judged `tokens.ts`
  sound apart from its cast.
- **Date:** 2026-11-27
- **Bundle:** `2026-11-27-R59-token-efficiency-review-bundle.txt`, SHA-256
  `23bc61eca697eadff1300b1f11fcb7d62e9341144556eba6ee8767021d4402ee`, base
  `473324b` (`reviewed/R66`), head `887dcf6` (the unit's tip before the review
  files were committed). It held the 16 changed files: new files in full,
  modified files as function-context diffs. `docs/decisions.md`,
  `docs/reviews/`, `docs/plan/`, and `pnpm-lock.yaml` were excluded. Prompt:
  `2026-11-27-R59-token-efficiency-review-prompt.txt`.
- **Prior context and lookups:** the reviewer said it had no prior context
  and performed no lookups. That is its own report and cannot be checked
  independently.
- **Coverage, and any gap:** item 4 was answered with one finding (the
  cast). Item 6 lists five mechanisms it judged sound. Item 7 was answered:
  it called the framing the right question. Items 1, 2, 3 and 5 came back
  with no finding and no statement that none was found; that silence is not
  a clearance, and Codex found constructions under items 1 to 3 in the same
  file.
- **Citations:** line numbers refer to positions in the bundle, not the
  repository. Each finding was located by the function it names.

---

BASE: reviewed/R66
HEAD: 887dcf6
packages/conformance/src/registry/integration.ts
f63039fe111cc5f142ae0bef5b4e6598

I had no prior context and performed no lookups.

The adversarial framing provided is exactly the right question for this code. The purpose of these token-efficiency and regression mechanisms is to produce an unforgeable account of what resources a model consumed, preventing the model or its environment from artificially making a run appear efficient or hiding a regression. 

I assess the mechanisms as highly sound for the following reasons:
- **In-Memory Verification**: `tokenHold` (in `model.tier.ts`) tests the fresh `result.result` directly from memory before the file system is ever involved, completely bypassing any manipulation of the working tree file by an adversary.
- **Strict Baseline Provenance**: `committedResult` reads the baseline directly from `git show HEAD:`, ensuring the adversary cannot spoof the baseline by altering local files.
- **Fail-Closed Execution**: Any anomaly—whether a lost reading (`totals.lost > 0`), an unreadable call (which translates to `bound: 'lower'` and thus `held: 'unmeasured'`), or mismatched arms/items between the baseline and fresh run—immediately throws an exception. This causes the test runner to fail the run, perfectly adhering to the fail-closed invariant.
- **Unforgeable Token Counts**: Tokens are strictly accumulated from the relay's `meter` object (in `aloneCall` and `costTotals`), never from the model's self-reported usage or text output.
- **Valid Empty Baseline Fallback**: A listed baseline that is missing correctly throws, whereas an unlisted baseline returns `null` and skips enforcement, which aligns precisely with the intended "explicit no-sample state" for unconfigured baselines.

Here are the concrete findings based on your criteria, ordered by severity:

packages/benchmark/src/tokens.ts:55 — a tradeoff I would have made differently — low — The manual type cast `named.result as unknown as { ... }` acts as a language escape hatch. While the runtime checks that immediately follow are mathematically exhaustive and secure against the adversary (verifying types, required properties, and bounds), casting through `unknown` bypasses TypeScript's structural guarantees. A developer could inadvertently remove a check later without the compiler complaining. This would be resolved by using a formal type guard function or a schema validation library to assert the shape of the parsed JSON without relying on a cast.

packages/api/src/cost.ts:161 — a tradeoff I would have made differently — low — In `spentBudgets`, the logic to identify the last call of an attempt relies on `record.attempt >= seen.attempt` inside a loop over `records`. For multiple calls within the exact same attempt, this perfectly retains the last call ONLY because `records` is strictly ordered by insertion. While secure under the current vault retrieval guarantees (which state records are yielded in order), it is slightly fragile to future refactoring of how records are fetched or sorted. This would be resolved by adding an explicit sequence or timestamp comparison if multiple calls per attempt become common, or by adding a strict runtime assertion on the chronological ordering of `records`.