# Triage of R56's external reviews, 2026-11-24

Reviews: `2026-11-24-R56-relay-server-tools-review-codex.md` (gpt-6-astra, counted, 112,995 input tokens against a floor of 77,485) and `2026-11-24-R56-relay-server-tools-review-gemini.md` (gemini-3.1-pro-preview, counted, 112,170 against 77,485). Both runs were first attempts, with no reruns. Each reply's SHA-256 matched its manifest's `replySha256` before its header was added. The untouched replies are in 60acea7.

**Counts.** Codex: 1 finding, 1 holds, 0 do not hold. Gemini: 0 findings. Raised by both families: 0.

| Finding | Restatement | Raised by | Verdict | Outcome |
|---|---|---|---|---|
| codex-1 | A server-tool count read from a stream's `message_start` is kept as the call's count. A stream cut before its final usage is then charged that early count, zero, instead of `max_uses`. | codex | holds | fixed, 2849b55 |

## codex-1

**Claim.** `usageReader.take()` stores any readable `server_tool_use` count without marking whether it is final. `charge()` falls back to `max_uses` only when no count was stored. A stream whose `message_start` reports zero searches, and which is cut before `message_delta`, is therefore charged zero searches. The token ceiling still applies, but the search fees go unmetered.

**Checked.**
- A fresh-context subagent read the relay source and answered "confirmed". `message_start` goes through the same `take(usage, false)` path, and `false` gates only the output count. `charge` reads `u.uses` whenever it is defined. A cut 200 stream is settled as a success (`done(answer, false)` with a 2xx status), so the tool loop bills the stored zero.
- A regression test sends a streamed, granted search whose `message_start` carries `server_tool_use: { web_search_requests: 0 }` and which is cut before `message_delta`. It failed on the old code: the reading lacked the $0.08 for eight searches. (`packages/sandbox/test/meter.test.ts`, "a count read before the final usage is not the call's count".)

**Consequence.** Whether the API's `message_start` carries a running count is not verified from here. If it does, any cut stream from a granted search undercounts its fees. Only a task granted `WebSearch` can reach this, and no policy grants it today. The relay still refuses ungranted tools, so this is a metering gap, not a capability one.

**Fix.** A count is taken only from final usage: the whole JSON body, or `message_delta`. A stream with no final count is charged `max_uses`, as it already was when no count arrived at all. Rejected: keeping the larger of the early count and `max_uses`, which is the same charge with more code, since `max_uses` bounds the count. The test passes after the fix, and the relay source is 25,760 characters.

## Gemini

Gemini reported no findings and assessed all four named mechanisms as sound. One of them is the reader codex-1 shows defective. That disagreement is recorded, not weighed: the executed test settles the point. Gemini's description of the reader matches the code; its conclusion missed the case where a count arrives before the final event.
