# External review of R38, gemini, 2026-11-22

The Gemini family's review of R38 (the openai-chat relay's unmeterable-request refusals, and the two driver assertions moved onto a recording endpoint). Triage: `2026-11-22-R38-driver-evidence-does-not-flake-triage.md`.

## Source

- **Reviewer:** gemini-3.1-pro-preview. Family: gemini. A direct `generateContent` API call to `gemini-3.1-pro-preview`, offering no tools. `cleanRoom` is `null` because an API call loads no local configuration. Outcome `counted`: 19276 input tokens against a floor of 13654, and all four bundle markers echoed.
- **Cross-family agreement:** gemini-3 targets the openai-chat guard, as codex-1 and codex-2 do, through a different hole (tools rather than tier or model). gemini-1, gemini-2, and gemini-4 were raised by Gemini alone.
- **Date:** 2026-11-22
- **Bundle:** `2026-11-22-R38-driver-evidence-does-not-flake-review-bundle.txt`, SHA-256 `0878085aef378fb7722d1cddd63fd6ff23439c1daace78fabe9be4ae6114f7ca`, base `reviewed/R52` (7931508 on `v2` is its descendant through the R56 amendment), head `8314a7d` (the unit branch before review). It held 8 files: the changeset, three conformance registry files, the driver's three test files, and the relay source, each changed file as a function-context diff. `docs/decisions.md`, `docs/plan/`, and `docs/reviews/` were excluded. Prompt: `2026-11-22-R38-driver-evidence-does-not-flake-review-prompt.txt`.
- **Prior context and lookups:** it reported no prior context and no lookups. Self-reported; not independently verifiable.
- **Coverage, and any gap:** findings are filed under items 1, 3, and 5. Items 2 (tautological checks), 4 (language escape hatches), 6 (which mechanisms are sound), and 7 (whether the framing is right) came back empty. Silence on them is not endorsement.
- **Citations:** line numbers refer to the bundle's new-side positions, not the repository, and are hints.

---

BASE: reviewed/R52
HEAD: 8314a7d
packages/sandbox/src/local/relay.ts
bfae41adad626471aee7e20984d84e6c

I have no prior context about this project, and I did not perform any external lookups. 

### Findings

**packages/drivers/claude-code/test/claims.test.ts:43** — Place where the mechanism can succeed while the property it protects is violated — High — The `driver.subagents` assertion only inspects the `system` parameter of the child's requests using `systemTextOf`. If a developer leaks the parent's role instructions by appending them to a user message (e.g., inside `request.messages[0].content`), `systemTextOf` entirely misses them. The `expect(system).not.toContain(parent.role.instructions)` check will successfully pass, but the core property is violated because the child session is being influenced by the parent's instructions. Resolve by inspecting all text blocks across `messages` in addition to the `system` parameter.

**packages/drivers/claude-code/test/invariants.test.ts:279** — Place where the mechanism can succeed while the property it protects is violated — High — `I3.workspace-instructions-not-loaded` relies on `requestsFor`, which filters recorded requests using `sessionOf(body)`. `sessionOf` silently returns `undefined` if `metadata.user_id` is missing or fails to parse as a valid JSON string. If the CLI developer omits or obfuscates `metadata.user_id` in the main `/v1/messages` request (which carries the planted instructions) but leaves it in the `count_tokens` request, `requestsFor` drops the main request. The assertion passes because it only compares the byte-identical `count_tokens` requests. The control run fails to catch this because it searches the raw request body using `.includes(controlSession)`, successfully finding the obfuscated session ID and the plant tokens. Resolve by asserting that every request reaching the recording endpoint has a valid, parsable session ID, or by unifying the attribution logic between the test and the control runs.

**packages/sandbox/src/local/relay.ts:536** — Ways the configuration can be satisfied without doing what it appears to do — Medium — The `chatUnmeterable` function for the `openai-chat` dialect completely forgets to check the `request.tools` array. While the `responsesUnmeterable` function correctly loops through `request.tools` to refuse any tool not in `CLIENT_TOOLS`, `chatUnmeterable` omits this logic. If the upstream API supports a hosted tool billed per-call (such as web search or retrieval), an attacker can invoke it by placing it in the `tools` array, allowing unmetered spend to easily bypass the budget. Resolve by adding a `request.tools` validation loop to `chatUnmeterable` that mirrors the one in `responsesUnmeterable`.

**packages/drivers/claude-code/test/harness.ts:46** — Anything that fails open (fails closed due to unhandled error) — Low — `systemTextOf` aggressively throws an error if any system block is an object but lacks a `text` property. If the API introduces a block type in the system prompt that does not carry text (e.g., a pure cache-control block), this test utility will throw an unhandled exception, causing assertions that rely on it to crash and fail closed. Resolve by filtering out or ignoring non-text blocks rather than throwing an error, or by specifically enforcing `type === 'text'`.