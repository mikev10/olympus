---
"@olympus-ai/vault": minor
"@olympus-ai/api": minor
"@olympus-ai/conformance": minor
---

R40: admission enforces the readiness ceiling. A-R40-01 adds the
`readiness-refused` admission refusal and the `readiness` term on
`AdmissionRecord` (scanned, or not scanned and why). `RunRequest.readiness`
takes a scan port; a run asked above its base commit's ceiling is refused
before its cost is asked for, naming the probe that holds it. The host's
scanner gains `ceilingAt`, cached by checkout, commit, and protected paths,
and rescanned when branch protection no longer reads as recorded. R1's
negative fixtures now require `absent` with the intended failure named, so an
`indeterminate` probe no longer passes one (#38).
