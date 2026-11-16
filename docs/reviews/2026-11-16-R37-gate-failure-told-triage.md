# Triage of R37's external reviews, 2026-11-16

Reviews: `2026-11-16-R37-gate-failure-told-review-codex.md` (gpt-6-astra, counted) and
`2026-11-16-R37-gate-failure-told-review-gemini.md` (gemini-3.1-pro-preview, counted). No reruns.
Both reply hashes matched their manifests' `replySha256` before the headers were prepended
(committed untouched in 1283afc).

**Counts.** Codex: 2 findings. 1 holds (fixed), 1 holds in part (known limit, #164). Gemini: 2 findings. 1 does not hold, 1 holds in part (rejected as a tradeoff). Neither family raised a finding the other did. Each finding was verified by a fresh-context subagent given the finding and the code, and the fixed one by an executed test.

| Finding | Restatement | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| codex-1 | "latest" decision chosen by wall-clock `decidedAt`, ties broken by hash order | codex | holds in part | known limit, issue #164 |
| codex-2 | the server's `gate-failed` publish has no assertion; deleting it fails nothing | codex | holds | fixed, cdf8029 |
| gemini-1 | `gateRetry` ignores `attempt-failed`, so a retry after an unjudged verify is told a stale gate failure | gemini | does not hold | rejected |
| gemini-2 | `untrustedReason` is a plain string, not the `UntrustedText` brand | gemini | holds in part | rejected (tradeoff) |

## codex-1: ordering by `decidedAt`

**Checked.** `readDecisions` returns refs sorted by content hash (`packages/vault/src/local/vault.ts`). A decision carries `decidedAt` (ISO ms) and a random `occurrence`, and no sequence. `gateRetry` (`packages/api/src/line.ts`) and `lastFailureOf` (`packages/api/src/run.ts`) take the greatest `decidedAt` with `>=`, so a tie goes to an arbitrary decision. The outcomes reader (`outcomes.ts`) orders the same way, and so did `lastFailureOf` before R37.

**Defect and consequence.** The mechanism is real. A same-millisecond tie between the decisions these readers compare is not realistic: a gate failure and a later conflict for one task are separated by a full build and a commit. A host clock stepping backward can misorder them, and then `status` shows an older failure or a retry is told a stale one. Severity is low.

**Outcome.** A monotonic per-run decision sequence is a Vault contract change, so it is not a review fix. Recorded as a known limit in D-R37-04 and filed as #164.

## codex-2: the event stream's delivery is unasserted

**Checked.** The R37 assertion passes its own `onGateFailed` to `drive()`, so it never reaches `http/server.ts`. The server's event-stream tests covered `state`, `standing` and `end` only. Deleting the server's handler failed no test.

**Fix.** Test-first in `packages/api/test/server.test.ts`. On a run whose required check always fails, a subscriber receives one `gate-failed` event per iteration, each naming the check, `exit-code`, and `untrustedReason: null`. With the server's publish replaced by a no-op, the test fails ("expected [] to have a length of 3"). Restored, it passes. Chosen over a conformance assertion because the server is the delivery boundary and its own suite already drives it over HTTP. The same gap for `attempt-failed` predates R37 and is left as it is.

## gemini-1: stale feedback after an `attempt-failed` at verify

**Checked.** `spendRetry` commits `attempts` (retries + 1) and never sets a task's status. A sandbox refusal at verify therefore leaves the task `verifying`, and the station machine re-verifies the same change rather than starting a build. A task becomes `failed`, and goes back to build, only from a gate failure (`line.ts`, the verify step's status). The iteration the finding describes, one that follows an unjudged verify, never starts. A driver failure inside build is retried within the same iteration, and the latest judged verdict is still the earlier gate failure, which is what the retry is told.

**Outcome.** Does not hold. Nothing changed.

## gemini-2: `untrustedReason` is not branded

**Checked.** The field is `string | null`. The existing `AttemptFailure.untrustedDetail` (`packages/vault/src/types.ts`) is a plain `string` with the same naming convention. `UntrustedText` is used only for trigger payloads (`packages/triggers`). The field never reaches a prompt: `gateRetrySuffix` takes only `checkId` and `cause`, and the I7 assertion checks that the startup error marker never reaches `status` through a prompt.

**Outcome.** The fact holds. Branding one field would make it an outlier among the runtime's stored failure texts. Branding all of them is a cross-cutting change that touches a contract type (`vault/src/types.ts`). Rejected as a tradeoff here. Reversal: an amendment branding every `untrusted*` field together.

## Framing (item 7)

Both families judged the framing appropriate. Codex added a question: does every consumer identify the same recorded failure in execution order, and does an assertion cover its actual delivery boundary? codex-1 and codex-2 answer it.
