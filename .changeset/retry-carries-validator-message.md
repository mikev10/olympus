---
"@olympus-ai/core": minor
"@olympus-ai/api": patch
"@olympus-ai/conformance": patch
---

A sent-back draft's retry is told the validator's message, not only its code. A runtime problem in `DraftSendBack` and in the `runtime-problems` retry part gains an optional `message`, written where a validator read the draft alone (a drafted manifest's shape, a drafted spec's parts, a drafted observation plan) and rendered as `- path: code — message`, cut to 300 characters (`RETRY_MESSAGE_LIMIT`). Problems judged against the base keep their code only, and still reach a test drafter as one contentless `base-refusal`. Records written before this carry no message and read as before (A-R36b-01, #174). New assertion: `I3.retry-is-told-its-own-shape-mistakes`.
