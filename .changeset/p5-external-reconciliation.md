---
'@olympus-ai/conformance': patch
'@olympus-ai/core': patch
---

An assertion in another package's suite now counts, once it is reconciled
against that package's own run report: the named test ran, in the named file,
passed, and did so against the tree being evaluated. Ten refusals, each with
its own name. Pays `I8.external-assertion-execution-reconciled`, whose pending
count drops from 1 to 0.

`Driver` gains `declaredTools()`, the driver-side half of the tool-grant gap
D-P3-04 split. `validateToolGrants` has taken a mandatory inventory since P3
and nothing could produce one. `StubDriver` declares the empty list, which
refuses every grant.

Workspace discovery reads the globs from `pnpm-workspace.yaml` rather than
scanning one level under `packages/`.
