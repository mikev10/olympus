---
"@olympus-ai/core": minor
"@olympus-ai/api": minor
"@olympus-ai/vault": patch
"@olympus-ai/conformance": minor
---

P4: the station machine. `core` gains the ten `StationContract`s, with
`test-design` held to the locked spec and a review seat barred from the author
narrative and the plan by type and by `contractTableProblems`, and the pure
machine over them: `transition` (locks, then approvals, the stricter of the
contract floor and the policy cell), `seatReviewer` (I6: reduced independence
recorded at L0-L2, a same-family reviewer refused at L3), `grantedContext`,
`capabilityRefusal`, `stationCapRefusal`, and `nextStep`, which schedules from
committed run state alone so a started and a resumed run take the same path.

`api` runs stations 1-8 through it. `startRun` admits a run, refusing before
anything is written on an invalid request, a missing driver capability, or an
over-request at any station; `resumeRun` drives an admitted run from its last
committed state; `approveStation` records a human's grant for exactly the exit
a run is waiting at. `ComponentGraph` gains a `reviewer` driver, and a run
request names its artifacts, including a verification manifest and a task
graph read from the workspace. `SKELETON_LINE` no longer declares the policy
engine or the missing stations.

`StubVault.lock` now adds to the manifest and refuses an already-locked path,
as `LocalVault` does; the replace semantics went unnoticed while the skeleton
locked once.
