---
"@olympus-ai/vault": minor
"@olympus-ai/api": minor
---

A-P6-02: `EvidenceBundle` gains `unstarted: readonly UnstartedCheck[]`, one
`{ checkId, reason }` per check that produced no result. `CheckResult.exitCode`
stays a real process's exit code and is never invented. Pays
`I2.unstarted-check-is-in-the-evidence`.
