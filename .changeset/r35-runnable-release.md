---
"@olympus-ai/core": patch
"@olympus-ai/sandbox": patch
"@olympus-ai/vault": patch
"@olympus-ai/integrity": patch
"@olympus-ai/adapters": patch
"@olympus-ai/readiness": patch
"@olympus-ai/compiler": patch
"@olympus-ai/triggers": patch
"@olympus-ai/driver-claude-code": patch
"@olympus-ai/driver-codex": patch
"@olympus-ai/driver-openai-compatible": patch
---

R35: a build step emits each package to `dist/`, and the packed `main`,
`types`, and `bin` point at it (#55).
