---
"@olympus-ai/vault": minor
"@olympus-ai/api": minor
"@olympus-ai/compiler": minor
"@olympus-ai/conformance": minor
---

R8b, the observation plan. While a policy names an observation window, every run names its plan: the checks that show the change working once merged, the checks that show it regressed, and a rollback condition. It is supplied with the run (`artifacts.observationPlan`) or drafted at `test-design` with the tests, and locked with them. When the window closes, `observe-history` reads the check runs on the merge commit and every later first parent through a new `CheckReader` (`GitHubCheckReader`, with its own read-only token, `FACTORY_CHECKS_TOKEN`). It records each planned check as working, regressed, or missing, with the commits it was read and decided on, and records a met rollback condition without acting on it. A neutral, skipped, or cancelled run never erases a failure, and a reading a failed write left part-done is finished before the window closes. A plan or provider that cannot be read keeps the window open. R2 reports each run's plan reading beside its rates.
