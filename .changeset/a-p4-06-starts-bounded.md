---
"@olympus-ai/core": minor
"@olympus-ai/api": minor
"@olympus-ai/conformance": minor
---

A-P4-06: `TaskAttempts` gains `starts`, and a replayed attempt is spent rather
than free. `startAttempt` counted nothing for a task already `running`, so a run
killed between the commit marking a task running and the commit recording its
result invoked the driver again at no cost — repeatable, and reachable by an
ordinary crash loop rather than only by an attacker. `starts` now counts every
invocation including a replay, bounded by `maxIterations * (retry.max + 1)` for
the station, past which the task parks with a new `ParkCause` arm,
`starts-exhausted`.

`iterations` and `retries` keep their meaning: they measure work, and a replay
costs neither, so a transient crash cannot park a task that was going to pass.
The P4 accept criterion and `comparable()` now name which counts must match
after a resume and which must only never fall below the work required.
