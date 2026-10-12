---
"@olympus-ai/api": minor
"olympus-ai": minor
"@olympus-ai/conformance": minor
---

R2: outcome measurement. `outcomes()` derives safety (caught false-done rate,
escaped rate `not-established`) and throughput (autonomy ratio, first-pass
yield, iterations to green, rework, refusals and parks by cause, approval wait,
cycle time, cost per merged change) from Vault records across every run the
Vault lists, each rate with its sample and a one-sided 95% Clopper–Pearson
bound, and `no-sample` where there is none. `estimateCost()` gives the likely
cost beside the worst case at a `cost-unapproved` refusal, or declines below
five past tasks per station and model. `RunReport` gains `standingSource`.
The service serves `GET /outcomes` and the CLI gains `outcomes`. Conformance
adds `I2.outcomes-derived-from-run-records` and
`I5.outcomes-refuse-without-a-sample`.
