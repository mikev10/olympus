---
"@olympus-ai/sandbox": minor
"@olympus-ai/conformance": minor
"@olympus-ai/driver-claude-code": patch
"@olympus-ai/driver-codex": patch
---

The relay meters what it forwards, and starts on Windows (R66).

- A price table naming a model that searches on every call (`PER_CALL_MODEL`: an id ending `-search-preview` or `-search-api`, dated or not) is refused at provisioning and by the relay's own start. A search is billed outside the token counts the meter reads (#205).
- The `openai-responses` dialect reads the tier an answer reports, from the body and from `response.completed`, and stops forwarding after one served at any tier but `default`, as `openai-chat` does (#208).
- The relay's source is written to its container's standard input and is in no argument, so it no longer counts toward the Windows command-line limit. `AppliedRelay.runArgs` is now the `docker create` argv. `relayCreateArgs`, `windowsCommandLineLength`, and `WINDOWS_COMMAND_LINE_LIMIT` are exported, and each driver that ships a meter tests its own table against the limit (#207).
- New conformance entry `I5.model-relay-source-is-in-no-argument`; the openai-chat and openai-responses fail-closed entries gain the cases above.
