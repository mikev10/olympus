# External review of P12, gemini, 2026-09-25

An adversarial pre-merge review of P12 (Credential at the egress layer), the
same scope as its companion `2026-09-25-P12-credential-relay-review-codex.md`,
from the same prompt and bundle. Both are triaged in
`2026-09-25-P12-credential-relay-triage.md`. This reply reported no findings,
so the triage cites none from it by number.

## Source

- **Reviewer:** gemini-3.1-pro-preview. Family: gemini.
  A direct `generateContent` API call (`POST` to the v1beta
  `models/gemini-3.1-pro-preview:generateContent` endpoint) to
  `modelRequested` `gemini-3.1-pro-preview`, offering no tools. `cleanRoom` is
  `null` because an API call loads no local configuration. Exit 0, not timed
  out, 197.3 s. Ingestion `complete`: 70,753 prompt tokens against a floor of
  51,552. Integrity `verified`: the reply echoes every required bundle marker.
  Outcome `counted`. Reply SHA-256 as the runner wrote it:
  `9eadf6937c31e38fa5bbad1b68bb2b101f09c72e8576fe85a1a0a689b6816b29`, which
  matched the manifest's `replySha256` before this header was prepended.
- **Cross-family agreement:** none. This reply raised no findings. Its
  item-6 assessment named mechanisms as sound, and codex disputes none of them.
  Its item 2 and item 3 answers, however, claimed two things that codex-1 and
  codex-3 dispute: that the control proves the credential search is not blind,
  and that a failed start tears down what it created. The triage records which
  account the code bore out.
- **Date:** 2026-09-25 (run started 2026-09-25T16:21:17Z UTC).
- **Bundle:** `2026-09-25-P12-credential-relay-review-bundle.txt`, SHA-256
  `922953cb079f962ec66d85ddb95fc94d4e2ebcc9f452c0d8994415ba25e47f8e` (the
  manifest's `bundleSha256`), base `22079d2` (`reviewed/P6`), head `1522900`
  (P12: tool search stays on behind the relay, and the owed driver run
  passes). It held the full contents of 19 of the 21 files changed in that
  range. It excluded `docs/decisions.md` and `docs/plan/DECOMPOSITION.md`, the
  design documents, as the prompt states ("no design documents"). The payload
  (257,762 bytes, SHA-256 `0a1638b5…`) is byte-identical to codex's. Prompt:
  `2026-09-25-P12-credential-relay-review-prompt.txt`.
- **Prior context and lookups:** the reviewer stated that it had no prior
  context about the project and performed no lookups. This is a self-report
  and cannot be independently verified. An API call offering no tools had no
  means of lookup in any case.
- **Coverage, and any gap:** all seven items are answered under headings with
  the prompt's numbers. Items 1 to 5 each read "None found". Items 3 and 5
  give reasons. Items 1, 2, and 4 give reasons but no attempted construction.
  Item 6 names five mechanisms as sound, with reasons. Item 7: the framing is
  right. No item came back empty. Every item that asked for a construction
  came back with none.
- **Citations:** the reply cites functions and files by name, not line. Its
  section numbers are the prompt's item numbers, not finding numbers.

---

BASE: 22079d2
HEAD: 1522900
packages/sandbox/test/upstream.ts
6bab41bc088c4cb4167eee43b454577e

I held no prior context about this project and performed no external lookups during this review. 

The code provided is exceptionally well-engineered, robust against the defined threat model, and rigorously adheres to its fail-closed and default-deny invariants. After a thorough review of the HTTP proxying logic, Docker isolation mechanics, Node.js stream handling, and conformance assertions, I found no ways to bypass the relay, exfiltrate the credential, or cause the assertions to pass vacuously. 

Here is the assessment organized by the requested categories:

### 1. Places where the mechanism can succeed while the property is violated
**None found.** 
The relay completely segregates the model credential from the sandbox. Because the credential is provided directly to the relay container's environment via the host-side Docker daemon (and never passed as a command-line argument that could be leaked via `ps`), it is mathematically isolated from the sandbox PID namespace. The sandbox's only route out under `deny-all` is the internal network containing the relay, and the relay's code contains no paths that echo its environment back to the client.

### 2. Checks that are tautological
**None found.** 
The conformance assertions are anchored by strong controls. For instance, `I4.model-credential-not-readable-by-the-task` does not just assert that a search finds nothing; it runs a control immediately afterward where it explicitly leaks a canary credential to a subprocess and confirms the exact same search logic successfully finds it. This proves the search is not blind. 

### 3. Anything that fails open
**None found.** 
Every error path evaluated fails closed.
- If the upstream URL cannot be parsed (`RELAY_UPSTREAM`), it defaults to `null` and crashes the relay at startup.
- If the target path contains illegal characters, double slashes, or percent-encoding, `SEGMENT.test` returns `false` and the request is rejected with a `403`.
- If the upstream TLS verification fails, the relay's `https.request` emits an error, which is caught and translated to a `502 Bad Gateway`.
- If Docker fails to start the relay or proxy, the provider tears down the partially created networks and throws an error rather than provisioning a sandbox with degraded egress.

### 4. Escape hatches specific to the language
**None found.**
The TypeScript code avoids `any`, relies on strict structural checks, and handles prototype pollution safely. The raw HTTP manipulation in `RELAY_SOURCE` (which runs in raw Node.js) avoids built-in parsing quirks:
- `req.headers` in Node.js normalizes all keys to lower-case, meaning the `DROPPED` set correctly matches and purges `x-api-key` regardless of the case the attacker sends it in.
- The path extraction (`target.indexOf('?')`) handles query strings cleanly, passing them untouched to the upstream while validating only the path prefix.
- `req.url` retains exactly what the HTTP parser saw. `target.charAt(0) !== '/'` blocks absolute-form URI attacks (like `http://...`) and `CONNECT` requests efficiently.

### 5. Ways the configuration can be satisfied without doing what it appears to do
**None found.**
- **`--mcp-config` modification race condition:** The configuration for MCP tools is written to a JSON file in the sandbox before the task runs. If an attacker's background process races to modify this file, the inspection session will read the altered tools, but the driver validates the session *after* it starts using `#refuseSessionUnlikeGrant`. Any tools introduced that were not explicitly granted in the policy will cause the task to be refused outright, rendering modification attacks futile.
- **`NO_PROXY` manipulation:** The sandbox can unset the proxy environment variables, but because the underlying internal Docker network lacks a default route, it can only reach the proxy or the relay, preventing bypass.

### 6. Sound Mechanisms
- **Path Matching (`RELAY_SOURCE`):** The `granted` function strictly splits the path and regex-tests every segment against `^[A-Za-z0-9_~-][A-Za-z0-9._~-]*$`. This is highly restrictive (pure ASCII) and rejects `..`, `.`, percent-encoding (`%`), semicolons, and double slashes. Prefix matching uses `path === p || path.indexOf(p + '/') === 0`, preventing partial string matches (e.g., `/v1/messages-fake` will correctly fail).
- **Header Stripping (`RELAY_SOURCE`):** The `forwarded` function safely purges all authentication and hop-by-hop headers. By cross-referencing against the `Connection` header contents, it also thwarts HTTP request smuggling attempts that might try to hide restricted headers using `Connection: x-api-key`.
- **Chunked Encoding / Smuggling:** The relay pipes `req` to `https.request`. Since Node's HTTP parser (`llhttp`) defines the boundaries of `req`, the relay will not pipeline smuggled requests into a single upstream request. If an attacker pipelines multiple HTTP requests to the relay, the relay processes them as distinct requests, subjecting each individually to the path and authorization checks.
- **Sandbox Concurrency (`#serialized` in `ClaudeCodeDriver`):** The `parallelism: 1` constraint is enforced via a map of `Promise<unknown>` (`#inFlight`). The mechanism safely awaits the previous promise and carefully manages its cleanup in a `finally` block, ensuring no race conditions can corrupt the lock state.

### 7. Framing Evaluation
The framing accurately identifies the critical attack vectors (credential exfiltration, proxy bypassing, and test tautology). The adversarial perspective matches the constraints of an isolated container environment. Assessing this code through the lens of a capable party owning the container was the correct approach, and the mechanisms implemented stand up entirely to that threat model.