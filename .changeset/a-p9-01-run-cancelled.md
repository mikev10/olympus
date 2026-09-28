---
"@olympus-ai/core": minor
"@olympus-ai/vault": minor
"@olympus-ai/api": minor
"@olympus-ai/conformance": minor
---

A-P9-01: `RunState` gains `cancelled: RunCancellation | null` and `StationRefusal` a `cancelled` arm. The station machine refuses every step of a cancelled run, and `LocalVault` refuses a stored state without the field.
