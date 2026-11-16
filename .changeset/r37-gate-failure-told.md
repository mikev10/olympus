---
"@olympus-ai/core": minor
"@olympus-ai/api": minor
"@olympus-ai/conformance": patch
---

R37: a failed gate tells the retry, and the run, why. A build task's next iteration after a failed gate carries each failed check's id and cause in its variable suffix (`gateRetrySuffix` in `core`), never the check's output. `LastFailure` is now a union discriminated by `kind` (`attempt-failed` or `gate-failed`), read for any park that names a task; a gate's check that did not start carries its evidence's reason as `untrustedReason`. The event stream publishes `gate-failed`, and `DriveHooks` gains `onGateFailed`.
