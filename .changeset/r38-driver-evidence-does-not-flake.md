---
"@olympus-ai/sandbox": patch
"@olympus-ai/driver-claude-code": patch
"@olympus-ai/conformance": patch
---

The model relay's `openai-chat` dialect refuses, unsent, a request for a service tier other than the default, a web search, or audio, because each is billed outside the token usage its meter reads (#88). `driver.subagents` and `I3.workspace-instructions-not-loaded` now read the requests the CLI sent to a recording endpoint, not the model's reply. Whether a role or a planted file reached a session no longer depends on whether a model chose to mention it (#165, #85), and neither assertion calls a model.
