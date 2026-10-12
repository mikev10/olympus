---
"@olympus-ai/vault": minor
"@olympus-ai/api": patch
---

R2 review fixes. The vault types gain `NoRunState` and the package exports
`isNoRunState`; both vaults reject `readRunState` with it where a run has no
state. `outcomes()` refuses where a run's state cannot be read rather than
reading it as absent, reads a merged run's integrate grant as spent, takes the
review refusal rate over finished runs, and prices the estimate only from tasks
that have ended. `GET /outcomes` takes `from` and `to` only as ISO times with a
zone.
