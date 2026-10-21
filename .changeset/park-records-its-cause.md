---
"@olympus-ai/core": minor
"@olympus-ai/api": patch
---

A park records its cause. `TaskAttempts` gains an optional `parkedFor`, written by every park in the commit that parks the task, and `parkRefusal` returns it, so a task whose last iteration was replayed to the start bound is recorded as `starts-exhausted` rather than as a gate that failed on every iteration, on the first record and on every resume (A-R4-05, #47). A park committed without one is read from its counts as before.
