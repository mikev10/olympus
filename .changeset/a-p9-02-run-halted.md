---
"@olympus-ai/core": minor
"@olympus-ai/vault": minor
"@olympus-ai/api": minor
"@olympus-ai/conformance": minor
---

A-P9-02: `RunState` gains `halted: RunHalt | null` and `StationRefusal` a `halted` arm. The API server commits a halt when a drive ends in an error, the station machine refuses every step of a halted run, and `LocalVault` refuses a stored state without the field.
