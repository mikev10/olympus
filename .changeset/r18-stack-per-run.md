---
"@olympus-ai/vault": minor
"@olympus-ai/api": minor
"@olympus-ai/conformance": minor
---

The admission record names the stack (R18, A-R18-01). `AdmissionRecord` gains `stack`, the `AdapterSet.stack` admission detected on the base, read from the same detection as the unavailable controls; the local and stub Vaults refuse an admission record without one. `RunRecords` gains `stack`, null where no record names one, and `outcomes` adds `caughtFalseDoneByStack`, `autonomyRatioByStack`, and `firstPassYieldByStack`, a run with no recorded stack keyed `unrecorded`. Resume still reads a record written before R18. `I2.admission-records-the-detected-stack` asserts it.
