---
"@olympus-ai/readiness": patch
---

R40 review fix (codex-2, gemini-1): every git read the readiness package
makes passes `--no-replace-objects`, so a replace ref in the target
repository cannot make a commit's name read as another tree between the base
snapshot and the readiness scan.
