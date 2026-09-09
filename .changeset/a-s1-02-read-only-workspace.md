---
"@olympus-ai/sandbox": minor
"@olympus-ai/api": minor
"@olympus-ai/conformance": minor
---

A-S1-02: `MountTable.workspace` admits `mode: 'ro'` as well as `'rw'`, so
verification can run against a tree the checks cannot modify. I1 at the
substrate is restated: at most one mount may be rw, and if one is, it is the
workspace; `others` still admits ro only. The skeleton's line mounts the
workspace rw for build and ro for verify. `I1.mount-table-single-rw` is
rewritten for the restated invariant and was shown failing on a two-rw table
and on an rw entry in `others`; the pending `I1.mount-layer-enforcement` now
also requires a provider to honour the workspace mode. The stub provider
declares that it does not.
