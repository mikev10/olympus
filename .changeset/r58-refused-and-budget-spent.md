---
"@olympus-ai/core": minor
"@olympus-ai/vault": minor
"@olympus-ai/api": minor
"@olympus-ai/conformance": minor
---

A refused run says so, and a spent budget parks at once (R58, #181, #193, A-R58-01). `ParkCause` gains `budget-spent`, with a `parked` refusal that names the bound reached (`tokens` or `cost`) and its limit, and `TaskAttempts` gains `budgetSpent`, written with the park. A driver call that fails after its relay's meter reports the budget spent and a request refused parks the task without a retry. A call that still returns a result is judged on it, and the task's next attempt is refused as the same park (A-R58-02, #248). The `station-refused` decision gains an optional `stateVersion`, and `RunStanding` gains `refused`: a run whose last drive a station refused, with nothing committed since, reads refused with the station, the refusal, and its time, from the decision record. The report's `GateOutcome` gains `refused`. Three conformance entries and a decision-table row hold these changes.
