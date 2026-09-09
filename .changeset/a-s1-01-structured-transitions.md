---
"@olympus-ai/core": minor
"@olympus-ai/api": minor
"@olympus-ai/conformance": minor
---

A-S1-01: the failure arm of `StationTransition` is `StationRefusal`, a
discriminated union on `reason` where each arm carries its own typed payload
beside a `message` for display: `gate-failed` the failed checks (`FailedCheck`:
id, exit code or null, cause), `lock-tamper` the tampered paths
(`TamperedPath`), `violation` the recorded refs, `unsafe-above-l1` the
component names, `capability-missing` the station and capability, `parked`
the cause and retry count. `detail: string` is gone. The api's
`invalid-request` outcome gets the same treatment: `RequestProblem` carries a
field path and a code beside its message. No test reads a refusal by
pattern any more. `I5.transition-has-no-warn-and-continue` is rewritten to
refuse a prose-only refusal, a payload that belongs to another reason, and a
refusal with no message.
