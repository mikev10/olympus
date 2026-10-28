# External review of R21, gemini, 2026-10-28

The Gemini family's review of R21, a local model endpoint on the Docker host reached through the relay. The triage of both reviews is `2026-10-28-R21-local-endpoint-triage.md`.

## Source

- **Reviewer:** gemini-3.1-pro-preview. Family: gemini. A direct `generateContent` API call to `gemini-3.1-pro-preview`, offering no tools. `cleanRoom` is `null` because an API call loads no local configuration. 56,816 input tokens ingested against a floor of 40,283; echo verified. This is the second run. The first (`2026-10-28-R21-local-endpoint-review-gemini.attempt-1.run.json`) was `FAILED`: HTTP 402 from the API, with no reply.
- **Cross-family agreement:** codex raised findings 1 (the sandbox reaches the host through the bridge gateway) as codex-1, and 4 (port 80 refused at relay start) as codex-2. Findings 2 (other authentication headers forwarded) and 3 (the framing) were raised by gemini alone.
- **Date:** 2026-10-28
- **Bundle:** `2026-10-28-R21-local-endpoint-review-bundle.txt`, SHA-256 `2bc338f9e19c5a31f04cfd1d4c35a76e0f08a36e42e73ff87c56922e57174df4`, base `f99ea35` (`reviewed/R12`), head `7e52685` (the unit branch after the acceptance run, before review). It held 15 sections: both changesets, every new file in full, and every modified file as a function-context diff. `docs/decisions.md` and `docs/plan/` were excluded. Prompt: `2026-10-28-R21-local-endpoint-review-prompt.txt`.
- **Prior context and lookups:** the reviewer stated it had no prior context and made no lookups. This is a self-report, not independently verifiable.
- **Coverage, and any gap:** item 1 is answered through findings 1 and 2, item 5 arguably through finding 4, item 6 with a list of two sound mechanisms, and item 7 through finding 3. Items 2 (tautological checks), 3 (fails open), and 4 (language escape hatches) came back empty. That is silence, not a clearance.
- **Citations:** line numbers refer to positions in the bundle, not the repository. They are treated as hints and were located by construct in the triage.

---

BASE: f99ea35
HEAD: 7e52685
packages/sandbox/test/relay.test.ts
441c5309a1463aba5a0511143c5cd253

I had no prior context about this project, and I performed no lookups.

Here are the findings based on a security review of the provided bundle:

### 1. Reaching the Docker host without the relay (Bypass of isolation)
**packages/sandbox/src/local/provider.ts:988** (and network architecture) — factually wrong — High
**The concrete bypass:** Docker’s `--internal` bridge network correctly drops traffic attempting to route to external interfaces (the internet), but it does not block traffic destined for the bridge's own gateway IP (the Docker host). Because the local model endpoint on the host is instructed to bind to `0.0.0.0` (or an address the bridge reaches), any task running in the sandbox can bypass the relay entirely and open a direct TCP connection to the host gateway IP (e.g., `172.17.0.1:port`). This completely evades the relay’s metering, access controls, and path constraints, and exposes all other host services bound to `0.0.0.0`.
**What would resolve it:** Apply strict `iptables` rules to drop traffic originating from the sandbox container to the bridge gateway IP, or bind host services exclusively to a dedicated interface/proxy container that the sandbox is not routed to.

### 2. Task supplying its own key via alternative headers
**packages/sandbox/src/local/relay.ts:396** — factually wrong — High
**The concrete bypass:** To prevent a task from supplying its own key to an unauthenticated endpoint, the relay under `scheme: 'none'` executes `delete headers[header]` (e.g., deleting `api-key`). However, it blindly forwards all other headers supplied by the task. A motivated party can simply send their key in a different standard authentication header (such as `Authorization: Bearer <key>` or `x-api-key: <key>`). Since the relay only deletes the exact header named in the configuration, the alternative header passes through untouched. If the local endpoint accepts it, the invariant that "getting a key the task supplies to the endpoint" fails.
**What would resolve it:** Under `scheme: 'none'`, explicitly sanitize the outgoing request by aggressively stripping all standard authentication headers (e.g., `authorization`, `x-api-key`, `proxy-authorization`) or only forwarding an explicit allowlist of safe headers.

### 3. Framing: The adversarial question misses the network isolation flaw
**prompt** — a tradeoff I would have made differently — High
**The issue:** The adversarial framing focuses heavily on tricking the relay's parsing or parameter handling to reach the host or forward unauthorized traffic. This is the wrong question for this architecture. The fundamental vulnerability is that the underlying network topology leaves the Docker host fully exposed to the sandbox. Asking how to trick the relay is moot when the sandbox can just route around the relay entirely to directly hit the Docker host. The right question to ask is: "How does the runtime prevent the sandbox from directly accessing services on the Docker host's network interfaces?"

### 4. Disagreement between TypeScript validation and relay startup on Port 80
**packages/sandbox/src/local/relay.ts:153** — factually wrong — Medium
**The concrete issue:** There is a discrepancy between what the TypeScript config validator accepts and what the relay's own startup script permits. `checkRelay` correctly accepts port `80` as a valid integer port for a local upstream. However, Node's `URL` parser normalizes port 80 out of the URL string. When `RELAY_SOURCE` parses `http://model-host:80`, the resulting `upstream.port` property is an empty string (`''`). The relay startup script strictly checks `upstream.port === ''` and fails. As a result, a perfectly valid configuration for port 80 is accepted by the driver but causes a fail-closed crash at startup.
**What would resolve it:** In the relay's startup script, adjust the port check to account for Node's URL normalization: default `upstream.port` to `'80'` if the protocol is `http:` and the port string evaluates to `''`.

### Mechanisms Assessed as Sound
- **Local Upstream Type Checking (`checkRelay` / `checkConfig`):** The stringent checks ensuring that `local: 'docker-host'` is explicitly defined as an object and refusing any unexpected properties or IP-based strings are sound. They effectively prevent malformed configurations or arbitrary URLs from being parsed as local upstreams.
- **Keyless Endpoint Requirements (`parseEndpointFile`):** The requirement that a local endpoint using `scheme: 'none'` strictly contradicts the presence of a `FACTORY_ENDPOINT_KEY` (and enforcing it to explicitly return `null`) is sound. It appropriately fails closed rather than inferring safety from missing or empty variables.