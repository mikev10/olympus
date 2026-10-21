---
"@olympus-ai/driver-claude-code": patch
---

The per-sandbox lock re-checks the handle after every wait, so calls queued behind a running one on the same sandbox run one at a time rather than together once it settles (external review of R4, codex-1; D-R4-09).
