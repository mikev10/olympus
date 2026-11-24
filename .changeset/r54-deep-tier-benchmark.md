---
"@olympus-ai/driver-claude-code": patch
"@olympus-ai/benchmark": minor
---

R54: the relay prices `claude-fable-5-2`, so a call naming it is metered
instead of refused. The benchmark's model tier takes its corpus, tier, model
and per-call limit from the environment, and `compareRuns` compares two
committed model-tier results by a fixed rule: the candidate replaces the
baseline only when it is no worse in every arm and its run cost less.
