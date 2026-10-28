---
"@olympus-ai/api": patch
"@olympus-ai/benchmark": minor
---

R7: the false-done benchmark. `@olympus-ai/benchmark` holds corpus v1, a
versioned and pinned set of seeded false-dones and clean controls, and runs
them through the real line with scripted seats (the deterministic tier) and
through a real driver alone and a real critic (the model tier). It reports
the detection and false-refusal rates as bounded proportions. `@olympus-ai/api`
exports `boundTo`, so the benchmark's driver-alone arm meters its calls the
way the line meters a task.
