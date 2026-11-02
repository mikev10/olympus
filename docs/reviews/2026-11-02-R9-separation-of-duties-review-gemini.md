# External review of R9, gemini, 2026-11-02

The Gemini family's review of R9, separation of duties across every seat. The triage of both reviews is `2026-11-02-R9-separation-of-duties-triage.md`.

## Source

- **Reviewer:** gemini-3.1-pro-preview. Family: gemini.
  A direct `generateContent` API call to `gemini-3.1-pro-preview`, offering no tools. `cleanRoom` is `null` because an API call loads no local configuration.
- **Cross-family agreement:** none of gemini-1 to gemini-3 was raised by codex as a finding. gemini-2 (the identity check is unreachable through the line) bears on the same mechanism as codex's closing framing remark.
- **Date:** 2026-11-02
- **Bundle:** `2026-11-02-R9-separation-of-duties-review-bundle.txt`, SHA-256 `bbfa4cd5fc9da44506447b77bd627ad7dd1c92ea0d2d1374689d0cf815cd6ab5` (the manifest's `bundleSha256`), base `4dee3f1` (`reviewed/R26`), head `e695015` (the unit branch tip when the bundle was built). It held every new file in full and every modified file as a function-context diff; `docs/decisions.md`, `docs/reviews/`, `docs/plan/`, and `pnpm-lock.yaml` were excluded. Prompt: `2026-11-02-R9-separation-of-duties-review-prompt.txt`.
- **Citations:** line numbers are positions in the bundle's new-side diff hunks, not repository lines; each was located against the code at triage.
- **Prior context and lookups:** it states it had no prior context and performed no external lookups. A self-report, not independently verifiable.
- **Coverage, and any gap:** it numbers its sections by the prompt's items and answers items 1, 2, 4, and 6. Items 3 (fail-open), 5 (configuration), and 7 (framing) came back empty; that silence is not an endorsement. Findings here are cited gemini-1 (item 1), gemini-2 (item 2), gemini-3 (item 4).

---

BASE: reviewed/R26
HEAD: e695015
packages/vault/test/stub.test.ts
0004c038048ac3748f3cfa09beef2d03

I have no prior context about this project and performed no external lookups.

1. Places where the mechanism can succeed while the property it protects is violated.
File: packages/api/src/validate.ts:563 (and packages/api/src/line.ts:803)
Type: bypass
Severity: high
The derived security task in `parseGraph` copies `task.role` verbatim from the user-specified review task (e.g., `reviewer`). When the runtime executes the security seat via `runTask`, it calls `scopeFor(ctx, task)`, which determines the sandbox capabilities (tools, network egress, budget) based on this user-controlled `task.role`. However, `runTask` records the usage using the explicitly passed `role` argument (`SECURITY_REVIEWER_ROLE`). If the policy grants the `reviewer` role broader capabilities (e.g., network egress) than the `security-reviewer` role, the security seat will execute with those broader capabilities, yet the usage records will falsely claim it ran under the stricter `security-reviewer` role. To resolve this, explicitly overwrite `role: SECURITY_REVIEWER_ROLE` when deriving the `.security` task in `parseGraph`.

2. Checks that are tautological — that would pass regardless of the code under test.
File: packages/core/src/station/machine.ts:262
Type: tautological check
Severity: medium
The exact identity match check `authors.some((author) => identityKey(author) === identityKey(reviewer))` will always evaluate to false. `identityKey` incorporates `role?.id`. For any reviewer, the role is strictly pinned to `reviewer` or `security-reviewer` by `review()` in `line.ts`. Meanwhile, `parseGraph` explicitly forbids build tasks from using reviewing roles, guaranteeing that every author identity collected from build task usage records will have a different role ID (e.g., `builder`). Thus, an author's identity can never strictly match a reviewer's identity, rendering this check a tautology. To resolve this, redefine identity matching to exclude the role when comparing the author and reviewer, ensuring the runtime actually blocks the same model + driver combination.

4. Escape hatches specific to the language.
File: packages/api/src/cost.ts:129
Type: cast
Severity: low
The usage record read back from the Vault is cast via `const record = parsed as Partial<UsageRecord> | null` and later `record as UsageRecord`. While this bypasses structural type checking, it does not pose a security risk because the Vault itself rigorously validates the schema of usage records upon writing, and no untrusted agent has write access to the record store.

6. Which mechanisms you assess as sound, and why.
- **Model Family Spoofing Protection:** The `authorsOf` method reliably prevents an author from claiming a false model family to achieve an unearned `different-family` independent review grade. It aggregates the runtime-resolved models retrieved from `readUsage` alongside the model claimed by the author in its result. Because `gradeAgainst` evaluates independence against all collected models and returns the weakest grade, the true (runtime-resolved) family will always correctly downgrade the independence score.
- **Security Seat Context Restriction:** `securitySeatContract` strictly filters `allowedContext` against a hardcoded whitelist (`SECURITY_SEAT_GRANTS`). This ensures that regardless of the policy or the role inherited, the security seat can never be granted unauthorized contextual materials like the author narrative or the plan.
- **Pre-R9 Record Handling (Fail Closed):** `readUsage` correctly substitutes `driver: null` for legacy records that lacked the field. Because `seatReviewer` checks for null and throws an error if any seat identity is missing its role or driver, legacy runs that attempt to advance or generate new security seats upon resumption will predictably fail closed rather than continuing with incomplete identity data.