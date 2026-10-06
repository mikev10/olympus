---
"@olympus-ai/api": patch
"@olympus-ai/conformance": patch
---

I1b's review fixes. `GitHubIntegrator.merge` records a merge only when the
merge commit's parents are the run's base commit and pushed commit, so a push
between the base check and the merge, or a merge someone else made over a
moved base, halts the run (D-I1b-13). `open` and `merge` refuse a pull request
that targets another branch. The base comparison compares file kind as well as
bytes, and a changed path is pushed as the kind the verified tree holds
(D-I1b-14). An accepted empty change halts at `integrate`'s work instead of
after its approval. The host refuses a half-set or non-decimal
`FACTORY_CONTAINER_UID`/`FACTORY_CONTAINER_GID` pair, through the new exported
`containerUser`. The conformance fake GitHub gains `beforeNextMerge`,
`mergeAsSomeoneElse`, and `retarget`; the report scenario pins metered totals
and the cache-hit rate to literal figures.
