# Triage of R66's external reviews, 2026-11-26

Codex (gpt-6-astra) counted on its first run. Gemini's first run was `FAILED`: the API answered HTTP 402 because the account's prepaid credits were depleted, and no reply came back. It was rerun once after the credits were topped up, and that run (gemini-3.1-pro-preview) counted. Both attempts are committed.

Codex raised 2 findings. Both describe the code accurately. Neither is fixed in R66: one is recorded as a known limit with an issue, one is rejected. Gemini raised 0. No finding was raised by both families, and no finding failed verification.

Gemini answered two of the prompt's seven items. Its silence on the other five is not an endorsement, and its statement that the tier check is sound sits against codex-1, which holds.

| Finding | Restated | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| codex-1 | a Responses answer with no `service_tier`, or `null`, is taken as served at the default rate | codex | holds; it is the rule `openai-chat` already had, which the unit's entry says to match | known limit (D-R66-07), #258 |
| codex-2 | a Responses answer with readable input and no output count is charged a ceiling and forwarding continues | codex | holds as a description; the ceiling is an upper bound, and the rule predates R66 (A-R26-01, D-R26-10) | rejected |

## codex-1: an answer that names no tier is priced at the default

**Claim.** `tierOpenai` leaves `offTier` false for `undefined` and `null`, so a Responses answer with valid usage and no tier passes, whole or in `response.completed`. Codex asks for forwarding to stop when the final tier is missing or null, or for the exception to be limited to an endpoint known to bill at the default.

**Checked.** A fresh-context check of `packages/sandbox/src/local/relay.ts` confirmed it: `tierOpenai` sets `offTier` only for a value that is neither `undefined`, `null`, nor `'default'`, and both the `response.completed` path and the whole-body path call it the same way. The function is R38's, written for `openai-chat`. R66 calls it from the Responses paths and does not change it.

**Found.** The description holds. Codex's own qualification also holds: the task cannot write upstream metadata, and a request naming any tier but the default is already refused unsent. The exposure is an upstream that serves another rate and does not say so. OpenAI's documentation says a Responses answer reports the tier it was served at.

**Options, each checked against the code.**

1. *Stop forwarding on a missing or null tier, in both dialects.* Not viable: `openai-chat` serves OpenAI-compatible endpoints, and the local-endpoint conformance entries answer with no tier at all. Every such run would stop after one call.
2. *Stop on a missing or null tier in `openai-responses` only.* This is the fail-closed reading, and only the Codex driver uses that dialect. It rests on a fact D-R66-02 records as unverified: that a live Responses answer always carries the field, whole and in `response.completed`. If it does not, every Codex run stops after one call. It also goes past the unit's entry, which says "as `openai-chat` does".
3. *Leave the rule as the entry states it and record the limit.* Chosen.

**Outcome.** Not changed. Option 2 is the stronger rule and is not applied because it rests on a fact that cannot be verified from here without a paid call, and it changes the acceptance criterion the entry states. Recorded as D-R66-07 and filed as #258, which says how to settle the fact first.

## codex-2: missing output usage is charged a ceiling

**Claim.** `takeResponses` accepts readable input without readable output; the answer is charged a ceiling and the relay keeps forwarding. Codex says this conflicts with the prompt's statement that missing usage "must stop the spending" and is "never estimated", and asks for either the stricter rule or a reworded invariant.

**Checked.** The same fresh-context check confirmed the path: `u.any` is set from `input_tokens` alone, `u.final` only from a readable `output_tokens`, and an answer with the first and not the second is charged the ceiling and does not set `exhausted`. An answer with no readable usage at all is charged the ceiling and does stop the relay. The ceiling comes from `responsesCeiling`: the model's `maxOutputTokens` from the price table, or the request's `max_output_tokens` where that is larger, and a table with no `maxOutputTokens` is refused at provisioning. The check noted that the relay does not rewrite the request's cap. `git diff reviewed/R58..HEAD` shows R66 changes neither function.

**Found.** The description holds, and the mismatch is in the prompt, not the code. The ceiling is the most the model can generate for that request, so the charge is an upper bound, never an under-count. That is the rule A-R26-01 confirmed and D-R26-10 records, and the `openai-responses` conformance entry asserts it. The prompt this session wrote stated the fail-closed rule more strictly than the contract does. Codex's item-7 note says the same thing.

**Outcome.** Rejected. The behaviour is not R66's, it is asserted by an existing conformance entry, and charging an upper bound is counting, not estimating. Changing it would be an amendment to A-R26-01.

## What the reviews did not cover

Codex notes that the bundle did not show the relay's request admission, model lookup, or final accounting, so it could not judge whether a request's model value can pass the checked table or how an off-tier answer is recorded. That is the cost of function-context diffs, and those functions are unchanged by R66. The off-tier accounting is exercised by the new `#208` test and the extended conformance entry, which read the meter after an off-tier answer.

## Changes

None to code. D-R66-07 is added to `docs/decisions.md`. The acceptance run of D-R66-06 stands: nothing under `packages/` or `scripts/` changed after it.
