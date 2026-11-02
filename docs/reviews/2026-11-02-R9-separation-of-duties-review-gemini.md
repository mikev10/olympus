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