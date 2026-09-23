---
"@olympus-ai/vault": minor
"@olympus-ai/api": minor
---

A-P6-03: `EvidenceBundle` gains `baseTreeSha256`, `diff: readonly DiffEntry[]`,
and `diffSha256`, so a bundle names the exact tree its checks ran over: the
admitted base and the cumulative diff. `AdmissionRecord` gains
`baseTreeSha256` and `unavailableControls`, the controls the run's adapter set
lacks, which a resume reads rather than having restated.
