# Triage of R38's external reviews, 2026-11-22

Reviews: `2026-11-22-R38-driver-evidence-does-not-flake-review-codex.md` (gpt-6-astra, counted) and
`2026-11-22-R38-driver-evidence-does-not-flake-review-gemini.md` (gemini-3.1-pro-preview, counted). Both families ran
once, with no reruns. Both replies matched their manifests' `replySha256` before the headers were prepended. The
untouched replies are in 20f20f1.

**Counts.** Codex raised 3 findings: 1 holds and is fixed, 1 holds in part and is filed, 1 holds and is filed. Gemini
raised 4: 3 hold and are fixed, 1 does not hold. None of Codex's findings failed to hold; 1 of Gemini's did. The two
families paired on one mechanism, the openai-chat request guard, through different holes in it (codex-1, codex-2,
gemini-3).

Each finding was checked by a fresh-context verifier given only the finding and the cited files. Every fix was shown
failing against the old behaviour before it was trusted.

| Finding | Restated | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| codex-1 | A request that omits `service_tier` is served at the project's default tier, and the relay never reads the tier the answer reports | Codex (same guard as gemini-3) | Holds. The defect is in the code; the billing consequence is OpenAI-side | Fixed, 09fb028 (+ 1c6ce73) |
| codex-2 | A priced search model searches, and is billed, without `web_search_options` | Codex (same guard) | Holds in part: nothing limits which models are priced, but no shipped driver prices a search model | Filed, #205 |
| codex-3 | I3 never exercises instruction files loaded during tool use | Codex | Holds, as a coverage gap | Filed, #206 |
| gemini-1 | `driver.subagents` checks parent-role absence only in `system` | Gemini | Holds | Fixed, 8480bc4 |
| gemini-2 | Requests with no parsable session are silently dropped from `requestsFor` | Gemini | Holds | Fixed, 5c790c4 |
| gemini-3 | `chatUnmeterable` does not check `tools` | Gemini (same guard) | Holds. No live exposure: the openai-compatible driver sends `function` tools only | Fixed, 09fb028 |
| gemini-4 | `systemTextOf` throws on a block with no text | Gemini | Does not hold as a defect: the throw fails the test closed, by design | Rejected |

Found during triage, not raised by either family: 09fb028 took the relay source past the Windows command-line limit.
Fixed in 1c6ce73, and the ceiling is filed as #207. The `openai-responses` half of codex-1 is filed as #208.

## codex-1: the tier an answer was served at

**Checked.** `chatUnmeterable` (relay.ts) refused only a non-default `service_tier` on the request. Omission passed,
and nothing read a response's `service_tier`: the verifier found the field only in the two request guards. The price
table holds one rate per model. That OpenAI serves an omitted tier at the project's configured default is the
reviewer's claim from OpenAI's documentation; it cannot be verified from here.

**Options.**
1. Require `service_tier: 'default'` on every request. Rejected: the openai-compatible driver never sends it, and
   local endpoints would be refused.
2. Inject the field before forwarding. Rejected: the relay forwards bytes unchanged, and some compatible servers
   reject unknown fields.
3. **Chosen:** read the tier the answer reports, in a JSON body or any stream chunk. An answer at any tier but
   `default` is counted as read and then stops the relay forwarding, as an unreadable one does. This is the same
   at-most-one-call overshoot the budget already allows. An answer naming no tier, as a local endpoint's does, is
   read at the table's rate.

**Shown failing first.** The new case in `I5.model-relay-fails-closed-on-unmetered-usage-openai-chat` sends a
default-tier answer, then a priority-tier one, then another request. It expects `200,200,402`. Against the relay
before the fix it got `200,200,200`. After the fix it passes, and so does
`I4.model-relay-enforces-budget-openai-chat`.

The `openai-responses` dialect has the same gap on the answer side. That dialect is R26's and outside this unit's
deliverable, so it is filed as #208, not fixed here.

## codex-2: search models

Holds in part. `relay.ts` checks only that the request's model has a price, and the openai-compatible driver's
config takes models and prices from the operator. No shipped driver or fixture prices a search model, so this is not
reachable from shipped configuration, and per-search billing is an external claim. Refusing models by name inside
the relay is guesswork. Filed as #205, with the two options (refuse at provisioning, or require a per-call price),
owned by the openai-compatible driver's dialect.

## codex-3: instruction files loaded during tool use

Holds as a coverage gap. The grants are `[]` and `['Skill']`, and the recording endpoint always ends the turn with
text, so no tool-triggered load is exercised. The registered title states those grants, so the scope is not hidden.
Closing it needs a scripted `tool_use` answer and a new control, which is new coverage beyond this unit's deliverable
(the assertion observes the forwarded prompt). Filed as #206, which describes a shape the R38 harness already
supports.

## gemini-1: the parent's role outside `system`

Holds. The absence check now runs over the whole request body, with the instructions in their JSON-escaped form.
The presence check still requires the child's role in the `system` blocks, which is where the driver puts it.
**Shown failing first:** with the driver temporarily appending the parent request's role to the `--print` message,
the new check failed (`the parent request's role reached the child's session`). The old check would have passed.

## gemini-2: requests that name no session

Holds. `requestsFor` now throws when any `POST /v1/messages*` request the endpoint received names no parsable
session, so a comparison cannot pass with the request that carried a difference missing. **Shown firing:** with the
recorder temporarily renaming `metadata` in stored bodies, I3 failed: `1 request(s) to the recording endpoint name no
session`. Without the mutation, both recording tests pass, so the pinned CLI attributes every request it sends.

## gemini-3: hosted tools under openai-chat

Holds. Chat Completions bills no hosted tool through `tools` today, and the openai-compatible driver sends only
`function` tools (`tools.ts`, `driver.ts`). But an upstream speaking this dialect is not necessarily OpenAI's, and the
responses dialect already allow-lists. `chatUnmeterable` now allow-lists `function` and `custom`, as
`responsesUnmeterable` does. **Shown failing first:** a request with `tools: [{ type: 'web_search' }]` was answered
200 by the old relay. A `function` tool is still sent; the partial-usage request carries one.

## gemini-4: `systemTextOf` throws

Does not hold as a defect. A throw inside the assertion fails the test; it cannot pass one. The helper's doc comment
states the reason: a request whose system prompt cannot be read would otherwise pass every "does not contain"
check. Filtering non-text blocks out would make that failure mode possible. Rejected, no change.

## Found during triage: the relay source and the Windows command line

Showing gemini-1 failing first surfaced a different failure: `the model relay could not be started ... spawn
ENAMETOOLONG`. The relay source runs as one `docker run` argument. It was 27890 characters at v2, 29777 after
c7bda48, and 31253 after 09fb028. With the Claude Code meter's JSON and the other flags, that took the command past
Windows' 32767-character limit. Linux CI does not hit this. 1c6ce73 moves the explanation out of the embedded source
into the TypeScript doc comment above it, landing at 30246. Both recording tests and the openai-chat assertions pass
locally on Windows after it. The headroom is now about 2.5K, so the ceiling itself is filed as #207, with options and
a test that would make it visible.
