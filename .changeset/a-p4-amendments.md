---
"@olympus-ai/core": minor
"@olympus-ai/vault": minor
"@olympus-ai/conformance": minor
---

A-P4-01: `StationRefusal` gains `approval-blocked` and `approval-required`,
each carrying the `ApprovalKey` it read, and `same-family-reviewer`, carrying
the review task and the shared `ModelFamily`. `parked` now names its task, a
closed `ParkCause` (`iterations-exhausted` | `retries-exhausted`), and the
`limit` it reached.

A-P4-02: `ReviewSeat` records a seat's authors, reviewer, and whether its
independence is reduced; `RunState.reviews` holds every seat, so the record is
durable rather than a field on a `GateResult` nothing persists.

A-P4-03: the Vault gains `recordAdmission`, once per run, holding the `Run`, the
resolved `Policy`, and each station's artifacts with their admission hashes;
and `recordTaskResult`, so a claim and the author's model identity survive a
resume or a wait for approval. `RunState` gains `admission`, `phase`,
`attempts`, `results`, `approvals`, and `reviews`; `VaultRefKind` gains
`admission` and `task-result`. A resume reads its level, policy, and bounds
from the Vault and never from its caller.
