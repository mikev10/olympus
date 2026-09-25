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