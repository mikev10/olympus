Prior context: none. External lookups: none. I reviewed the inline bundle; execution was blocked by the environment, so these are source findings, not reproduced exploits.

```text
BASE: 5536bdc
HEAD: a1764bb
pnpm-lock.yaml
f8fd64c836729abe5f33b60b0cf2bba0
```

1. **packages/sandbox/src/local/relay.ts:303 — factually wrong — high — The “unreadable” charge is not a ceiling on the call’s cost.**

   When `u.any` is false, `charge` records zero input and cache tokens and charges only the request’s `max_tokens` as output. That bounds output, not input.

   A concrete construction is a large-input, non-streaming request whose response is still incomplete when the runtime tears down the sandbox. `bodyParser` only reads usage after a complete body; SIGTERM cuts the call off, leaving `u.any` false even if the vendor has already processed its input. The task need not control teardown: keeping a request in flight near the existing deadline exposes this case.

   Using the test prices, 1,000 input tokens and one output token cost $0.00101. An unreadable response with `max_tokens: 64` records just $0.00064. The log still reconciles perfectly.

   The relay refuses subsequent requests, but the recording path accepts this as `metered`. `costTotals` at **packages/api/src/cost.ts:52** includes the incomplete figure normally; `unmetered` remains zero. Thus stopping further spending does not prevent under-recording what was already spent.

   **Resolve:** preserve an explicit incomplete-accounting state through the Vault and totals, and refuse continuation until resolved, or establish a conservative charge covering every potentially billed class. An output-token ceiling alone is insufficient. **Confidence: high.**

2. **packages/sandbox/src/local/relay.ts:369 and :437 — factually wrong — medium — A transport failure before response headers is treated as proof of zero spend.**

   If the upstream accepts a request, performs billable work, and the connection fails before headers arrive, `done(null, false)` reaches `charge` with `success: false`, because `call.cut` is false. The relay records zero tokens and dollars, leaves the budget usable, and releases the queue for another call.

   The code distinguishes relay-initiated cancellation from other connection failures, but neither establishes whether the upstream processed the request. Repeated ambiguous failures can therefore leave spending uncharged while retries continue.

   This is a failure-handling defect, not a demonstrated ability for the sandbox to force a vendor connection failure. The zero-charge branch is certain; actual billing in that failure window would require vendor-side reconciliation to establish.

   **Resolve:** distinguish requests proven unsent from requests possibly accepted. Treat the latter as unknown spend and stop forwarding or conservatively account for them.

3. **packages/api/src/cost.ts:87 — factually wrong — medium — Unaccounted invocations can disappear from totals across resume.**

   `readUsage` reads only references in `state.usage`. Two recording-path constructions leave spent invocations outside that list:

   - In `line.ts`, `runTask` throws when `destroy` cannot return a reading, without committing an accounting failure. The task remains `running`. A normal `resumeRun` can start it again; nothing requires resolution of the earlier missing cost.
   - `recordUsage` stores the usage object and then separately commits its reference. A failure between those operations leaves a durable but unreferenced record. Resume does not recover it, and totals omit it.

   These are not objections to granting each retry its own budget. They concern losing the previous invocation’s accounting. The existing meter-failure test verifies only that the first `startRun` rejects; it does not verify that resume remains blocked.

   **Resolve:** durably track outstanding accounting per invocation, reconcile it before another start, and make recording discoverable independently of the subsequent state-reference commit. Add failure-and-resume tests at both boundaries. **Confidence: high.**

4. **packages/sandbox/src/local/relay.ts:378 — factually wrong — medium — The serialization mechanism can be removed without failing the supplied budget assertions.**

   Replace `acquire(turn)` with `turn()` and make `release()` a no-op. The budget scenarios in `meter.test.ts` and `MODEL_RELAY_ENFORCES_BUDGET` still issue requests sequentially. The background teardown client also starts its next request only after the previous response ends.

   Those tests would continue passing, although a sandbox could now send many simultaneous requests while totals are below budget. Every request could be admitted before the first charge, defeating the promised one-call overshoot bound.

   This is a test defect; the current relay queue itself appears to serialize correctly.

   **Resolve:** hold the first upstream response open, issue multiple concurrent requests, and assert that only one reaches upstream. Make that response exhaust the budget and verify that every queued request is refused. **Confidence: high from the supplied test paths; mutation not executed.**

5. **packages/drivers/claude-code/test/driver.test.ts:207 — factually wrong — low — The model-price coverage test passes with no prices.**

   The test says it proves that every tier-resolved model is priced, but it only iterates over existing entries and existing price fields. `prices: {}` passes; deleting a model or a required price field also escapes that check.

   Provisioning validation catches some malformed tables, so this is not itself a spending bypass. It is a vacuous coverage assertion.

   **Resolve:** assert an independently established required model set and all five required price fields. **Confidence: high.**

Several mechanisms look sound within the stated trust boundary:

- **relay.ts:253:** SSE lines are parsed as JSON before inspecting event type and usage. Model text containing fake usage events remains an escaped string; it does not become a top-level event.
- **relay.ts:378:** the current queue holds its slot through charging, and queued requests recheck exhaustion before forwarding.
- **relay.ts:355:** disconnecting the sandbox client does not cancel upstream measurement.
- The recording path takes its reading from `sandbox.destroy`, not `TaskResult.usage`. I found no route for a forged agent result to replace that reading.
- The closing-line reconciliation detects missing call lines and absent closure. It establishes log completeness relative to the relay’s counters; it cannot establish that those counters captured all billed work.
- Casts, interface augmentation, and the literal `collectedBy: 'runtime'` are not authentication mechanisms. Under this threat model, however, the task cannot invoke host-side Vault methods or replace trusted providers. I found no concrete TypeScript escape crossing that boundary.

The adversarial framing is appropriate for request classification, concurrency, and parsing. Accounting also needs a complementary question: **after every ambiguous response, teardown failure, or interrupted recording operation, can the runtime resume or publish totals without acknowledging unresolved spend?** The principal defects here arise at that boundary.