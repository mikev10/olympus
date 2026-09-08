---
"@olympus-ai/core": minor
"@olympus-ai/triggers": patch
---

F2 review amendments. `Task.status` is removed; `RunState.tasks` is the sole
authority for task status. `PolicyDocument` (sparse, as authored) is split from
`Policy` (total, as resolved and stored in the Vault), with
`PolicyEngine.resolvePolicy` between them; an approval the document omits
resolves to `human-required`, never `auto`. The I7 note on
`TriggerEvent.extracted` now states that the field is unconstrained pending
per-kind field schemas.
