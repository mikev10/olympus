# External review of P13, codex, 2026-09-27

An adversarial pre-merge review of P13 (Cost control: budget at the relay, cost
in evidence): the relay's request classification, request and response parsing
for model and usage, the budget check and charge, the one-call-at-a-time queue,
the SIGTERM close and closing line, the teardown read of the meter, and the
recording path from `runTask` through the Vault to `costTotals`. One of two
reviews run from the same prompt and bundle; the other is
`2026-09-27-P13-cost-control-review-gemini.md`. Both are triaged in
`2026-09-27-P13-cost-control-triage.md`, which cites this review's findings as
`codex-1` to `codex-5`.

## Source

- **Reviewer:** gpt-6-astra. Family: codex.
  A headless `codex exec` run (CLI 0.155.1) under a read-only sandbox, with
  recorded approval policy `never`, in an empty scratch working directory and a
  scratch config home holding only `auth.json`, with an environment of
  `CODEX_HOME` alone. The pre-run listing of both is the manifest's
  `cleanRoom`: `configHome` `["auth.json"]`, `workDir` `[]`. Exit 0, not timed
  out, 516.5 s. Ingestion `complete`: 203,172 input tokens against a floor of
  140,793. Integrity `verified`: the reply echoes every required bundle marker.
  Outcome `counted`. Reply SHA-256 as the runner wrote it:
  `148b45a9f83d0fa7c62e13fa5ebdb0146f584603d8e3f8d8109c3e65a30e7bc0`, which
  matched the manifest's `replySha256` before this header was prepended.
- **Cross-family agreement:** none. Gemini raised no findings. All five
  findings here were raised by codex alone. Gemini's item-6 answer assessed as
  sound the charge for an unreadable answer, calling `max_tokens` its
  "ceiling"; codex-1 disputes that it is a ceiling. The triage records which
  account the code bore out.
- **Date:** 2026-09-27 (run started 2026-09-28T02:06Z).
- **Bundle:** `2026-09-27-P13-cost-control-review-bundle.txt`, SHA-256
  `4e05a9d6dd31c88d01db9c90c34b8cd10bf9e0e19a4d2e0bf9a85167258ca8dc`, base
  `5536bdc` (`reviewed/P12`), head `a1764bb` (the P13 implementation commit).
  It held the full contents of every changed source, test, registry, and
  package file, the changeset, and `pnpm-lock.yaml`; the three changed docs
  (`docs/decisions.md`, `docs/plan/DECOMPOSITION.md`, `docs/plan/F1-spine.md`)
  were listed in the diffstat and excluded. Prompt:
  `2026-09-27-P13-cost-control-review-prompt.txt`.
- **Prior context and lookups:** the reviewer stated "Prior context: none.
  External lookups: none", and that execution was blocked by its environment,
  so its findings are from source, not reproduced. A self-report, not
  independently verifiable.
- **Coverage, and any gap:** findings are not numbered by prompt item. Items 1
  and 3 are answered by codex-1 to codex-3, item 2 by codex-4 and codex-5,
  item 4 in the closing list (casts, augmentation, and the `collectedBy`
  literal: no concrete escape found), item 6 in the closing list, and item 7
  in the closing paragraph, which proposes a complementary question about
  ambiguous responses, teardown failures, and interrupted recording. Item 5
  (configuration satisfied without doing what it appears to) was not
  addressed.
- **Citations:** line numbers refer to positions in the reviewed source files
  as the bundle carried them, not to the repository at any later commit. They
  are hints; the triage located each construct by name.

---

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