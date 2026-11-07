# External review of R8b, gemini, 2026-11-06

Gemini's adversarial review of R8b, the observation plan, from the bundle alone. The triage is `2026-11-06-R8b-observation-plan-triage.md`.

## Source

- **Reviewer:** gemini-3.1-pro-preview. Family: gemini. A direct `generateContent` API call to `gemini-3.1-pro-preview`, offering no tools. `cleanRoom` is `null` because an API call loads no local configuration.
- **Cross-family agreement:** gemini-1 (a partial write of plan signals read as complete) and gemini-2 (a drafter can name a trivial check) were raised by Codex too, as codex-1 and codex-2. Gemini raised nothing alone.
- **Date:** 2026-11-06
- **Bundle:** `2026-11-06-R8b-observation-plan-review-bundle.txt`, SHA-256 `f9be8ee14c52a95505e295b6763f146cfc06bf0b72e6e29741473ed55e669ab6`, base `bd03b6f` (`reviewed/R8a`), head `174bf3a` (R8b's implementation commit on `unit/r8b`). It holds every new file in full and every modified file as a function-context diff, 23 sections; `docs/decisions.md`, `docs/reviews/`, `docs/plan/`, and `pnpm-lock.yaml` were excluded. Prompt: `2026-11-06-R8b-observation-plan-review-prompt.txt`.
- **Prior context and lookups:** the reviewer said it held no prior context and performed no external lookups. A self-report, not independently verifiable.
- **Coverage, and any gap:** two findings, under items 1 and 3 (gemini-1) and 2 (gemini-2). Items 4, 5, 6, and 7 came back empty: no assessment of which mechanisms are sound, and nothing on whether the framing was right. That silence is not an endorsement.
- **Citations:** line numbers are positions in the bundle's new-side diffs, not in the repository; each was located by construct before it was checked.

---

I hold no prior context about this project, and I performed no external lookups.

BASE: bd03b6f
HEAD: 174bf3a
packages/vault/src/types.ts
a83cd161fa6cb4d37145f5d606f4c11a

### Findings

packages/api/src/observe.ts:168 - fails open - high - An exception (e.g., a transient Vault I/O error or rate limit) during the sequential `vault.recordObservation` loop inside `observePlan` causes a partial write of the plan's signals. On the next scheduled history walk, `already.some((e) => e.record.signal.kind === 'plan-signal')` detects the first successfully written signal, immediately returns `'recorded'`, and completely skips evaluating and recording the remaining checks and the rollback condition. The walk then proceeds to close the observation window as if it were fully observed, allowing a change with failing/missing checks to bypass observation and have its window closed as clean. - Resolve by ensuring the number of existing `plan-signal` records matches the total number of planned checks before returning `'recorded'`, or write all signals and the rollback condition in a single atomic transaction.

packages/api/src/drafting.ts:512 - tautological checks / bypass - high - The adversarial model drafting the tests and the observation plan has full control over the `works` array. It can deliberately name a tautological or trivial check (e.g., a basic code formatter, a static analysis linter, or a CLA check) that is guaranteed to pass regardless of the actual code under test. Because the runtime blindly trusts the CI check names drafted by the model, it will observe this trivial check as `working`, recording the merged change as healthy even if the actual behavioral tests failed or were never run by the named check. - Resolve by requiring the model to map the named CI checks to the specific drafted acceptance tests and validating this mapping, or by having the runtime independently extract and enforce the relevant check names without relying on model input.