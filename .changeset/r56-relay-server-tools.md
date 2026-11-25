---
"@olympus-ai/core": minor
"@olympus-ai/sandbox": minor
"@olympus-ai/api": minor
"@olympus-ai/driver-claude-code": minor
"@olympus-ai/driver-codex": minor
"@olympus-ai/driver-openai-compatible": minor
"@olympus-ai/benchmark": patch
"@olympus-ai/conformance": patch
---

The model relay forwards only the server tools a task was granted (A-R56-01, #189). `RelaySpec` gains a required `serverTools` list of `{ type, perUseUsd }`, and `Driver.relayRequest` takes the call's granted tools. Under the Messages dialect the relay refuses unsent a request that offers a typed tool its grant does not name, names `mcp_servers` or a `container`, or offers a granted tool with no positive `max_uses`. It charges each web search the response reports, or `max_uses` when a success reports none. The Claude Code driver grants `web_search_20250305` only to a task granted `WebSearch`; Codex and openai-compatible grant none. The relay's shipped source drops whole-line comments and indentation to stay inside Windows' command-line limit.
