BASE: 03518f9
HEAD: fb1206b
packages/vault/src/types.ts
99d1e029ba2638eefc7964b6a9adb194

Prior Context: None
Lookups: None

The adversarial framing (evaluating if a sandbox can subvert the relay to execute ungranted capabilities or spend uncounted budget) is exactly the right question for this code. The relay is the sole enforcement boundary between the untrusted agent and the upstream provider. 

After a thorough adversarial review against the invariants and mechanisms in scope, I found no vulnerabilities, bypasses, tautological checks, or fail-open conditions. The mechanisms are exceptionally robust and uniformly fail closed.

### 1-5. Violations, Tautologies, Fail Opens, Escape Hatches, and Configuration Bypasses
None found. The implementation strictly adheres to the invariants:
- **No uncounted spend:** If a successful request fails to report `server_tool_use`, the relay safely penalizes it by charging the full `max_uses` offered.
- **No ungranted capabilities:** Any typed tool not explicitly in the relay's `toolPrice` map is refused before reaching the upstream. 
- **Type safety:** Escape hatches like `unknown` in `checkServerTools` are immediately and securely narrowed using runtime checks (`isRecord`, `typeof`, etc.). `Object.prototype.hasOwnProperty.call` is used uniformly in the relay to prevent prototype pollution.

### 6. Sound Mechanisms

**`anthropicTools` inside `packages/sandbox/src/local/relay.ts`**
*Assessment:* Sound.
*Why:* It enforces a strict default-deny posture. Any tool with a `type` that is not exactly `'custom'` is checked against `toolPrice`, which only contains server tools explicitly granted to the relay. It unconditionally refuses `mcp_servers` and `container`. Furthermore, it enforces that `max_uses` is a strictly positive integer, neutralizing potential exploits involving negative counts, floats, or missing bounds that could otherwise distort billing.

**`charge` and `usageReader` in `RELAY_SOURCE`**
*Assessment:* Sound.
*Why:* The fallback logic perfectly closes the accounting loop. If a request succeeds but the `server_tool_use` is unreadable or missing, `read` is `undefined`, and the script securely defaults to charging `offered[t]` (the `max_uses` ceiling). If the request fails (`!success`), it appropriately skips charging for the tool since it wasn't executed, avoiding inaccurate penalization while maintaining strict adherence to the budget on success. The `usageReader` correctly processes streaming (`text/event-stream`) SSE deltas by overwriting the `u.uses` object, which perfectly aligns with Anthropic's reporting of total counts in later chunks.

**`checkServerTools` in `packages/sandbox/src/local/relay.ts`**
*Assessment:* Sound.
*Why:* It performs flawless runtime validation of the configuration grant. It asserts exact shape matches (`{ type, perUseUsd }`), strictly positive and finite USD values, and ensures the `type` is present in the `COUNTED_SERVER_TOOLS` allowlist. It also refuses any server tool grants when the dialect is not `anthropic-messages`, proactively preventing configurations that the OpenAI/Codex relays wouldn't know how to meter.

**`ClaudeCodeDriver.relayRequest`**
*Assessment:* Sound.
*Why:* It correctly derives the relay's `serverTools` grant by filtering the driver's hardcoded `SERVER_TOOLS` map against the task's granted `tools`. By freezing `SERVER_TOOLS` and using `Object.entries()`, it prevents any rogue tool names (like prototype pollution vectors) from leaking into the relay specification.

### 7. Framing
The framing is absolutely correct. The most significant threat is a motivated agent exploiting the API protocol (e.g., sneaking ungranted server tools, obfuscating `max_uses`, manipulating usage streams, or forcing the relay into an unaccountable state) to gain ungranted capabilities or drain the budget. The code successfully defends against these vectors at the relay boundary.