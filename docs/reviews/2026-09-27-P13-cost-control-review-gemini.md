# External review of P13, gemini, 2026-09-27

An adversarial pre-merge review of P13 (Cost control: budget at the relay, cost
in evidence): the relay's request classification, request and response parsing
for model and usage, the budget check and charge, the one-call-at-a-time queue,
the SIGTERM close and closing line, the teardown read of the meter, and the
recording path from `runTask` through the Vault to `costTotals`. One of two
reviews run from the same prompt and bundle; the other is
`2026-09-27-P13-cost-control-review-codex.md`. Both are triaged in
`2026-09-27-P13-cost-control-triage.md`. This review raised no findings.

## Source

- **Reviewer:** gemini-3.1-pro-preview. Family: gemini.
  A direct `generateContent` API call to `gemini-3.1-pro-preview`
  (`v1beta`), offering no tools. `cleanRoom` is `null` because an API call
  loads no local configuration. Exit 0, not timed out, 249.8 s. Ingestion
  `complete`: 212,650 prompt tokens against a floor of 140,793. Integrity
  `verified`: the reply echoes every required bundle marker. Outcome
  `counted`. Reply SHA-256 as the runner wrote it:
  `e244a225186e931d08f6939107a5493cb91eaba1ded4fe73cbdedf1479f38725`, which
  matched the manifest's `replySha256` before this header was prepended.
- **Cross-family agreement:** none. Codex raised five findings; this review
  raised none. Its item-6 answer calls the `max_tokens` charge for an
  unreadable answer a "ceiling", which codex-1 disputes. The triage records
  which account the code bore out.
- **Date:** 2026-09-27 (run started 2026-09-28T02:06Z).
- **Bundle:** `2026-09-27-P13-cost-control-review-bundle.txt`, SHA-256
  `4e05a9d6dd31c88d01db9c90c34b8cd10bf9e0e19a4d2e0bf9a85167258ca8dc`, base
  `5536bdc` (`reviewed/P12`), head `a1764bb` (the P13 implementation commit).
  It held the full contents of every changed source, test, registry, and
  package file, the changeset, and `pnpm-lock.yaml`; the three changed docs
  (`docs/decisions.md`, `docs/plan/DECOMPOSITION.md`, `docs/plan/F1-spine.md`)
  were listed in the diffstat and excluded. Prompt:
  `2026-09-27-P13-cost-control-review-prompt.txt`.
- **Prior context and lookups:** the reviewer stated it had no prior context
  and performed no external lookups. A self-report, not independently
  verifiable.
- **Coverage, and any gap:** items 6 (sound mechanisms) and 7 (framing: "no
  changes to the framing are necessary") were answered under their own
  headings. The opening paragraph and item 6 state that no bypass or logic
  error was found, which is the only answer to item 1. Items 2
  (tautological checks), 3 (fail-open paths), 4 (language escape hatches), and
  5 (configuration satisfied without effect) came back empty: not answered,
  which is not the same as cleared.
- **Citations:** the reply cites no line numbers. Its references to invariants
  by number ("I1/I4", "I2", "I5") are its own labels and do not always match
  the invariants the prompt glossed.

---

I have carefully reviewed the spending controls and cost recording implementation. The runtime and relay designs are remarkably robust. They fail closed consistently, enforce limits using structural guarantees (such as network topology and OS-level stream handling), and defend against multiple sophisticated attack vectors including stream desynchronization, concurrent mutation, and log truncation. 

BASE: 5536bdc
HEAD: a1764bb
===== pnpm-lock.yaml =====
f8fd64c836729abe5f33b60b0cf2bba0

I have no prior context about this project from earlier conversations or outside sources, and I did not perform any external lookups while reviewing this code.

### 6. Sound Mechanisms

I assess the implementation as highly secure and sound. I did not find any bypasses or logic errors that would allow an agent to spend unrecorded money or break the stated invariants. Here is why the core mechanisms hold:

- **Relay Egress Isolation (I1/I4)**: The `deny-all` execution strategy ensures the relay is physically the only route out of the sandbox. Even if the agent unsets proxy environment variables or spoofs DNS, the kernel provides no default route to `api.anthropic.com` or anywhere else. The agent is forced to use the relay.
- **Relay HTTP Parsing & Request Smuggling**: The relay buffers the entire request body to read `max_tokens` before proxying. By completely reading the payload and resetting the `Content-Length` header for the outbound request, it prevents HTTP Request Smuggling (e.g., conflicting `Content-Length` and `Transfer-Encoding` headers) and ensures the upstream processes the exact same bytes the relay parsed.
- **Credential Protection (P12)**: The model credential is piped exclusively to the Docker daemon process for the relay container (`--env RELAY_CREDENTIAL` with `secrets` passed to `dockerCli`). It is never placed in a command-line argument that `ps` could read, nor does it ever enter the sandbox's environment or filesystem. The request's original authentication headers are stripped and overwritten.
- **Robust SSE/Usage Parsing**: The `streamParser` safely ignores SSE chunks containing `content_block_delta` events that exceed `LINE_LIMIT` (1 MB) by clearing the buffer and skipping to the next newline. It gracefully resumes parsing the stream afterward, guaranteeing it will capture the `message_delta` event containing the final token usage. 
- **Fail-Closed Budgeting (P13)**: Any trick an agent might use to make the API response unreadable (e.g., requesting gzip encoding which is overwritten to `identity`, or providing malformed payloads that crash the parser) results in the response usage being marked `unreadable`. The relay correctly fails closed by charging the requested `max_tokens` ceiling against the budget, marking the budget exhausted, and refusing all subsequent calls. 
- **Client Disconnect Handling**: If the agent terminates the HTTP connection to the relay early, the relay intentionally keeps the upstream connection alive (`outbound` is not destroyed until a `SIGTERM` kills the container). This ensures that the upstream completes the response and returns the final token usage, forcing the accounting to complete so the agent cannot avoid being billed.
- **Cost Recording (I2)**: The runtime enforces that `UsageRecord` references can only be trusted if `collectedBy === 'runtime'`. Cost calculations explicitly sum `Vault` records rather than relying on the model's `TaskResult` claims. 
- **Vault Concurrency (I5)**: Run state commits use the filesystem's `wx` flag for atomic compare-and-swap operations. The code catches both "stale commits" (prevented by atomic `EEXIST` rejection) and "future jumps" (prevented by the explicit `held < current` check), avoiding lost updates completely.
- **Truncation Detection**: The `meterReadingFrom` function calculates the running total of all `call` lines and checks it against the totals in the `closed` line. If the Docker logs were truncated (e.g., due to log rotation), the sum will disagree with the closing totals and the runtime will correctly fail closed by throwing an error.

### 7. Framing

The adversarial framing provided is excellent and exactly the right question for this code. By explicitly delineating what the attacker controls (the inside of the sandbox, HTTP request shapes, output text size) versus what they do not (the relay, the host, Docker), the prompt accurately models the threat landscape of untrusted AI agents operating within a bounded execution environment. No changes to the framing are necessary.