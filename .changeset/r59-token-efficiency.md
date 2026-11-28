---
"@olympus-ai/api": minor
"@olympus-ai/benchmark": minor
"@olympus-ai/conformance": minor
---

R59: token efficiency is reported, and a token regression fails the
benchmark's model tier.

`RunReport` gains `efficiency`: per task, the tokens read (input, cache read,
cache write), the tokens written, and their ratio, `no-sample` where nothing
was written; `costPerAcceptedChange`, the run's metered spend over the merges
it recorded, `no-sample` until one is; and `spentBudgets`, each task whose
last call's reading says the token or the cost bound of its budget was
reached. `tokenEfficiency` and `spentBudgets` are exported from `cost.ts`.
Every figure is derived from the usage records.

A model-tier `BenchmarkResult` gains `tokens`: per arm and item, per
repetition, what the relay counted for each task. `TOKEN_BASELINES`
(`tokens.ts`) lists the results a run is held to and each one's margin; a
listed run fails when an item's tokens per driver call pass the margin over
the result committed at `HEAD`, and is refused before any call when that
result is missing or is other work. The list is empty: no committed result
records tokens yet.

The conformance registry adds
`I2.report-token-efficiency-from-usage-records`.
