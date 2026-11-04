---
"@olympus-ai/core": minor
"@olympus-ai/vault": minor
"@olympus-ai/api": minor
"@olympus-ai/adapters": minor
"@olympus-ai/readiness": minor
"@olympus-ai/conformance": minor
---

R13a: nightly checks without a model. Two job templates, `nightly-integrity` and `nightly-security`, run on a schedule instead of recording a candidate, and each writes one `NightlyRecord` beside the runs. The integrity job re-hashes every object the Vault holds, which the new `listObjects` lists. It also checks every ref and every in-flight run's locks, and compares R2's rates with the previous night's snapshot. The security job runs R17's scanners over the default branch's head under `deny-all`, and audits its npm or pnpm lockfile in a sandbox that can reach only the advisory host the policy names. A part that cannot finish is recorded as a refusal, never as finding nothing. Each finding becomes an `intake` candidate whose fields are typed under the `nightly-finding` schema, and drift that names a run goes into P14's record as `record-drift`. `GET /nightly` returns the records. `TriggerPolicy` gains an optional `nightly` block, `CandidateRecord` gains `schema`, and `TriggerDecision` gains the `job` outcome.
