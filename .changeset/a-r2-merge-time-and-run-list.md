---
"@olympus-ai/vault": minor
"@olympus-ai/api": minor
"@olympus-ai/conformance": minor
---

A-R2-01: `IntegrationMerged` gains `mergedAt`, GitHub's merge time, read back
from the pull request after the merge or from the one a resume finds already
merged; the local Vault refuses a merge record without one. A-R2-02: `Vault`
gains `listRuns()`, every run the store holds any record for, a run refused at
admission included. The conformance registry adds `I2.vault-lists-every-run`,
and the integrate assertion checks the recorded merge time.
