---
"@olympus-ai/core": minor
"@olympus-ai/vault": minor
"@olympus-ai/compiler": minor
"@olympus-ai/api": minor
"@olympus-ai/benchmark": patch
"@olympus-ai/readiness": patch
"@olympus-ai/conformance": minor
---

R24, the target repository's instructions as granted context. At admission the runtime reads a fixed list from the base it snapshotted (`CLAUDE.md`, `AGENTS.md`, `.claude/rules/*.md`, and each skill's `SKILL.md` under `.claude/skills/` and `.agents/skills/`) under R20's rules: a link or a non-regular entry, a file over 32 KiB, a set over 32 KiB, or bytes that are not UTF-8 refuse admission as `instructions-refused`, naming the file. `AdmissionRecord.repoInstructions` pins each file's path, SHA-256, text, and whether its front matter was dropped; front matter is never read. `ContextGrant` gains `'repo-instructions'`, allowed at `spec`, `plan`, `build`, and `review` and never at `test-design`, and `CapabilityScope.repoInstructions` grants it per role, `false` when absent. A granted seat at L0 to L2 receives the set first in its stable prefix, without any file a withheld sensitive class matches; above L2 the set narrows the run through `narrowRun` and arrives in the variable suffix. `runTask` takes a list of released inputs.
