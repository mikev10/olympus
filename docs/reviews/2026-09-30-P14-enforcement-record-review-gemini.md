# External review of P14, gemini, 2026-09-30

An adversarial pre-merge review of P14 (the enforcement record): the runtime's
single write path for decisions and its call sites in `run.ts` and `line.ts`,
the egress proxy's decision log and its read at teardown, the Vault's
acceptance rule for a decision, and the conformance table keyed by every cause.
One of two reviews run from the same prompt and bundle; the other is
`2026-09-30-P14-enforcement-record-review-codex.md`. Both are triaged in
`2026-09-30-P14-enforcement-record-triage.md`, which cites this review's five
unnumbered findings, in the order they appear, as `gemini-1` to `gemini-5`.

## Source

- **Reviewer:** gemini-3.1-pro-preview. Family: gemini.
  A direct `generateContent` API call to `gemini-3.1-pro-preview`
  (`POST https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent`),
  offering no tools. `cleanRoom` is `null` because an API call loads no local
  configuration. Exit 0, not timed out, 254.1 s. Ingestion `complete`: 157,298
  input tokens against a floor of 113,126. Integrity `verified`: the reply
  echoes every required bundle marker. Outcome `counted`. Reply SHA-256 as the
  runner wrote it:
  `f9b76c80a742c49b6ebc721541e6c5f71804b6dcb5e3af3b79cfa07743751a2e`, which
  matched the manifest's `replySha256` before this header was prepended.
- **Cross-family agreement:** gemini-1 (the proxy's 400 refusals are not
  logged) was raised by codex too, as codex-3. gemini-2 (a failed log read
  discards the verdicts the proxy already acted on) pairs with codex-1, which
  describes the same loss from an interrupted process. gemini-3, gemini-4, and
  gemini-5 were raised by gemini alone.
- **Date:** 2026-09-30 (run started 2026-09-30T20:40Z).
- **Bundle:** `2026-09-30-P14-enforcement-record-review-bundle.txt`, SHA-256
  `dcb8b51f87c93a0cc6e209fe2ac9f69c99ea1ff255a84fd4ebf4403e76fa6596`, base
  `329c049` (`reviewed/P7`), head `5762bb2` (the last P14 implementation
  commit). It held the full contents of every changed source, test, registry,
  and skill file, `CLAUDE.md`, and the changeset; the changed docs
  (`docs/decisions.md`, `docs/plan/DECOMPOSITION.md`, `docs/plan/F1-spine.md`,
  `docs/plan/WORKFLOW.md`, `docs/plan/WORKFLOW-DIAGRAM.md`) were listed in the
  diffstat and excluded. Prompt:
  `2026-09-30-P14-enforcement-record-review-prompt.txt`.
- **Prior context and lookups:** the reviewer stated "I have no prior context
  about this project, and I performed no lookups." A self-report, not
  independently verifiable.
- **Coverage, and any gap:** findings are not numbered by prompt item. Items 1
  and 3 are answered by gemini-1, gemini-2, gemini-3, and gemini-5, and item 2
  by gemini-4. gemini-3 touches item 4 (a non-string value past a TypeScript
  type) without naming it. Items 4 (as a question in its own right), 5
  (configuration satisfied without doing what it appears to), 6 (which
  mechanisms are sound), and 7 (whether the framing is right) came back empty.
  Silence on 6 and 7 is not an endorsement of any mechanism or of the framing.
- **Citations:** line numbers refer to positions in the reviewed source files
  as the bundle carried them, not to the repository at any later commit. They
  are hints; the triage located each construct by name. gemini-5's citation
  (`run.ts:620`, an early return) names no construct the code has.

---

Before reviewing, I must state the four required values:
BASE: reviewed/P7
HEAD: 5762bb2
packages/vault/src/types.ts
d860616fd001ecc16bc412f629d082de

I have no prior context about this project, and I performed no lookups.

Here are the findings regarding the code under review:

**packages/sandbox/src/local/proxy.ts:68** — factually wrong — high — The proxy enforces egress by reading the request and opening or refusing a connection. However, if a sandbox agent sends an origin-form request (e.g., `GET / HTTP/1.1`) or a non-HTTP request, `url.protocol` will not be `'http:'`. The proxy responds with a 400 Bad Request and immediately returns, closing the connection. It **does not call** `record('refused', ...)` before returning. Thus, a connection was refused by the proxy (a control decision taking effect) without any record holding it. A similar bypass occurs in the `clientError` event handler (line 122), where malformed HTTP requests are refused with a 400 response but no decision is logged. The conformance table passes because the `egress:refused` scenario mocks the provider with a hardcoded `PROXIED` log rather than interacting with the real proxy implementation.
*What would resolve it:* Call `record('refused', target)` before returning the 400 response for invalid URLs/protocols, and similarly log decisions in the `clientError` event handler.

**packages/sandbox/src/local/provider.ts:400** — factually wrong — high — If `readEgress` throws an error (e.g., if an agent crashes the proxy container by exhausting memory or finding an unhandled exception before it can write its `closed` log line, causing `egressLogFrom` to throw), the `egress` variable is assigned the `Error` object. Subsequently, `sandbox.destroy` throws this error. In `runTask` and `verify`, this thrown error is caught and wrapped, causing the line to halt (failing closed). However, any network connections the proxy *already* opened, tunnelled, or refused before crashing took effect, but because `destroy` threw, `recordEgress` is never reached. The decisions took effect without the record holding them. The conformance table passes because it uses a mocked sandbox provider for the proxy scenarios.
*What would resolve it:* Refactor `destroy` to decouple sidecar teardowns. It should return whatever valid log lines *could* be read alongside any teardown errors, ensuring that partial egress logs and relay usage (which might have succeeded) are recorded even if one sidecar fails.

**packages/api/src/run.ts:635** — factually wrong — medium — In `approveStation`, a malicious API caller can pass a non-string value for `req.runId` (e.g., an array or object). While the TypeScript type `ApprovalRequest` expects a `RunId` string, runtime JavaScript allows other types. The local `refuse` helper checks `if (typeof req.runId === 'string' && req.runId !== '')` before calling `recordDecision`. If `runId` is an array, the condition is false, so it skips recording the decision entirely and simply returns the `{ ok: false, reason: 'invalid-request' }` refusal. The decision (a refusal returned) takes effect without the record holding it. The conformance test passes because it only tests `invalid-request` with valid strings (like an empty string or malformed key).
*What would resolve it:* Remove the `typeof` check and rely on `recordDecision` (which validates the ID) or stringify the `runId` before recording so that an invalid-request refusal is always recorded even for malformed IDs.

**packages/conformance/src/registry/decisions.ts:318** — factually wrong — medium — The `blocked-above-l1` mark in the conformance table is tautological. It purports to check that specific causes (like `admission:controls-unavailable` or `station:same-family-reviewer`) are blocked above L1. However, the check solely verifies that *any* L2 or L3 run fails globally with the `unsafe-above-l1` refusal triggered by the stub `SkeletonLine` components in `unsafeComponents`. It proves absolutely nothing about the specific causes it claims to test; it would pass even if the code handling those causes was completely deleted.
*What would resolve it:* The test must inject a scenario where `SkeletonLine` is temporarily bypassed or replaced with production components, allowing the test to verify that the *specific* mechanism (e.g., `controls-unavailable`) actually fires at L3.

**packages/api/src/run.ts:620** — factually wrong — medium — In `admitRun`, if `admissionRefusal(record)` returns an `AdmissionOutcome` due to `controls-unavailable`, it is returned directly (line 620). Unlike the normal `outcome` returned from `admission(req)` on line 629, which is caught and routed to `recordDecision` on line 640, the `refusedControls` early return completely skips the `recordDecision` call. Thus, if a run requests L3 while controls are unavailable, the admission is refused, but the decision is never recorded in the Vault. The conformance table completely misses this because `admission:controls-unavailable` uses the tautological `blocked-above-l1` check (see previous finding).
*What would resolve it:* Remove the early return inside `admission()`. Let `admissionRefusal` return its outcome back up to `admitRun`, so that it passes through the standard `recordDecision` block before being returned to the API caller.