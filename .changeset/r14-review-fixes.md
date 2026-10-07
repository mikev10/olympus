---
"@olympus-ai/api": patch
"@olympus-ai/sandbox": patch
"@olympus-ai/conformance": patch
---

R14 review fixes. The line commits the stricter of the reviewer's two seats, so a reviewer resolved to an author's family is recorded as reduced independence whatever family its result reports (codex-1, gemini-1); `I6.every-model-that-built-is-an-author` gains that case. `LocalDockerProvider` no longer holds its own output-cap default: an omitted cap reaches `dockerCli`, whose default a test now runs past (codex-2).
